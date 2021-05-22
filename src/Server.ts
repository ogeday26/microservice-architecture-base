import amqp, { Channel, Connection } from 'amqplib/callback_api';
import EventEmitter from 'events';
import { v4 } from 'uuid';
import fs from 'fs';
import path from 'path';

type Modify<T, R> = Omit<T, keyof R> & R;

interface ServerOptions {
  amqp: {
    host: string,
    user: string,
    password: string,
    durable: boolean,
    ackMode: boolean,
    reply: boolean,
  },
  serviceName: string
  path: string,
  infoQueue: string
}

type EventEmitterChannel = Modify<Channel, {
  responseEmitter: EventEmitter
}>

class Server {
  private replyQueue = 'amq.rabbitmq.reply-to';
  private connectionString: string;
  private serviceId: string; 
  private path: string;
  private durable: boolean;
  connection!: Connection;
  channel!: EventEmitterChannel;
  private ackMode: boolean;
  private infoQueue: string;
  private reply: boolean;

  constructor(options: ServerOptions) {
    this.connectionString = `amqp://${options.amqp.user}:${options.amqp.password}@${options.amqp.host}`;
    this.serviceId = `${options.serviceName}-${v4()}`;
    this.path = options.path;
    this.durable = options.amqp.durable;
    this.ackMode = options.amqp.ackMode;
    this.infoQueue = options.infoQueue;
    this.reply = options.amqp.reply;
  }

  async setup() {
    await this.createConnection();
    this.initConnectionEvent();
    await this.createChannel();
    this.createServiceCommunicationProtocol();
    if (this.reply) {
      this.setReplyQueue();
    }
    this.consumeController();
    return this;
  }
  
  private createConnection(): Promise<Connection> {
    return new Promise((resolve, reject) => {
      amqp.connect(this.connectionString, (err, connection) => {
        if (err) return reject(err);
        resolve(connection);
      });
    })
  }

  private initConnectionEvent() {
    this.connection.on("error", (err) => {
      console.log(err);
      setTimeout(this.createConnection, 5000);
    });

    this.connection.on("close", (err) => {
      console.log(err);
      setTimeout(this.createConnection, 5000);
    });
  }

  private createChannel() {
    return new Promise((resolve, reject) => {
      this.connection.createChannel((err, channel) => {
        if (err) return reject(err);
        resolve(channel);
      })
    });
  }

  private setReplyQueue() {
    this.channel.prefetch(1);
    this.channel.responseEmitter = new EventEmitter();
    this.channel.responseEmitter.setMaxListeners(0);

    this.channel.consume(this.replyQueue,
      (msg) => {
        this.channel.responseEmitter.emit(msg?.properties.correlationId, msg?.content ? JSON.parse(msg.content.toString()) : null);
      },
      { noAck: this.ackMode }
    );
  }

  private createServiceCommunicationProtocol() {
    this.channel.consume(this.serviceId, () => {
      this.publishServiceInfo();
    });
  }

  publishServiceInfo() {
    fs.readdirSync(this.path).forEach((file) => {
      if (!fs.existsSync(path.join(this.path, file, `${file}.route.js`)) && !fs.existsSync(path.join(this.path, file, `${file}.doc.js`))) return;
      
      const doc = require(path.join(this.path, file, `${file}.doc`));
      const route = require(path.join(this.path, file, `${file}.route`));

      this.channel.sendToQueue(this.infoQueue, Buffer.from(JSON.stringify({ route, doc })));
    })
    return this;
  }

  private consumeController() {
    fs.readdirSync(this.path).forEach((file) => {
      if (!fs.existsSync(path.join(this.path, file, `${file}.route.js`))) return;

      const methods = require(path.join(this.path, file, `${file}.controller`));

      Object.keys(methods).forEach((method) => {
        this.channel.assertQueue(method, { durable: this.durable });

        this.channel.consume(method, async (msg) => {
          if (!msg) return;

          const content = JSON.parse(msg.content.toString());
          const reply = JSON.stringify(await methods[method](content));

          this.channel.sendToQueue(msg.properties.replyTo, Buffer.from(reply), { correlationId: msg.properties.correlationId });
          this.channel.ack(msg);
        });
      })
    });
  }
}

export default Server;
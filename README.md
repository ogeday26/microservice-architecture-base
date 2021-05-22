# microservice-architecture-base

```javascript
(async () => {
  const server = new Server({
      amqp: {
        host: "test",
        user: "test",
        password: "test",
        durable: false,
        ackMode: false,
        reply: true,
      },
      serviceName: "test",
      path: "domains",
      infoQueue: "StatusTracker"
    });

  (await server.setup()).publishServiceInfo();
})()
```

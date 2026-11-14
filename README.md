# traffic-app-server

The API behind Quadrum's traffic signal controllers and dashboard: REST and
WebSocket in one Node.js process (`wss_server.js`), MongoDB through Mongoose.

- Controllers connect over WebSocket, identify, ping every 6 s and report their
  signals, state and settings; dashboards watch and operate the junctions they
  are allowed to see.
- Live at `https://api.quadrumtechnologies.com`.

Run it locally:

```bash
npm install
# .env with at least DATABASE_URI and JWT_SECRET; TLS=off for plain HTTP
TLS=off PORT=5000 node wss_server.js
```

Tests that need no database:

```bash
node test/status.test.js
node test/backup-restore.test.js
```

Hosting, deploys, backups, alerts and moving to a new Pi: see [DEPLOY.md](DEPLOY.md).

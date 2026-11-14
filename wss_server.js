const https = require("https");
const http = require("http");
const WebSocket = require("ws");
const fs = require("fs");
require("dotenv").config();
require("./cronJobs");

const app = require("./app");
const connectToMongoDB = require("./db");
const {
  infoDataRequestHandler,
  infoDataHandler,
} = require("./handlers/infoHandler");
const { signalDataHandler } = require("./handlers/signHandler");
const {
  deviceStateHandler,
  stateDataRequestHandler,
} = require("./handlers/stateHandler");
const { uploadRequestHandler } = require("./handlers/uploadHandler");
const { downloadRequestHandler } = require("./handlers/downloadHandler");
const {
  uploadAndDownloadHandler,
} = require("./handlers/uploadAndDownloadHandler");
const junctionCommands = require("./handlers/junctionCommandHandler");
const { AuditLog } = require("./models/auditModel");
const { UserDevice, UserDeviceState } = require("./models/appModel");
const { AdminDevice } = require("./models/adminAppModel");
const { setDeviceOnline } = require("./handlers/deviceStatusNotifiesHandler");
const { resolveToken } = require("./utils/authTokens");
const { deviceRecord, canAccessDevice, roleOf } = require("./utils/deviceAccess");
const { isDemoDevice, isDemoAccount } = require("./utils/demo");
const demoJunction = require("./handlers/demoJunction");

// Dashboard requests: handler, and whether the request operates the junction
// (an admin may only operate a user's device if the owner allows support).
const WEB_REQUESTS = {
  state_request: { handler: stateDataRequestHandler, control: false },
  info_request: { handler: infoDataRequestHandler, control: false },
  // Explicit commands and manual control (handlers/junctionCommandHandler.js).
  junction_command: { handler: junctionCommands.handleCommand, control: true },
  // The old toggle commands and the API-timed manual signals are retired:
  // a page that still sends them is out of date.
  intersection_control_request: { handler: retiredRequest, control: true },
  signal_request: { handler: retiredRequest, control: true },
  upload_request: { handler: uploadRequestHandler, control: true },
  download_request: { handler: downloadRequestHandler, control: true },
};

function retiredRequest(ws) {
  sendError(ws, "This page is out of date. Reload it to use the new junction controls.");
}

// Controllers send their secret key when they identify. Until every unit in
// the field carries the key stored for it, a mismatch is only logged;
// DEVICE_KEY_ENFORCE=true turns mismatches into a refusal.
const DEVICE_KEY_ENFORCE =
  String(process.env.DEVICE_KEY_ENFORCE || "").toLowerCase() === "true";

// TLS is on by default: the EC2 setup served HTTPS on 443 with the
// Let's Encrypt certificate. Set TLS=off to serve plain HTTP on PORT
// (default 5000) instead, e.g. behind a Cloudflare Tunnel that terminates TLS.
const TLS_ENABLED = String(process.env.TLS || "on").toLowerCase() !== "off";
const PORT = TLS_ENABLED
  ? Number(process.env.HTTPS_PORT) || 443
  : Number(process.env.PORT) || 5000;
// Optional bind address, e.g. HOST=127.0.0.1 when only a local tunnel connects.
const HOST = process.env.HOST || undefined;
const TLS_KEY_PATH =
  process.env.TLS_KEY_PATH ||
  "/etc/letsencrypt/live/traffic-api.quadrumtechnologies.com/privkey.pem";
const TLS_CERT_PATH =
  process.env.TLS_CERT_PATH ||
  "/etc/letsencrypt/live/traffic-api.quadrumtechnologies.com/fullchain.pem";

// Keep-alive ping for dashboard (web_app) sockets. Proxies such as
// Cloudflare close WebSockets that carry no data for ~100 s. Browsers answer
// pings automatically. Controllers are not pinged: they ping the server
// themselves every few seconds.
const WS_KEEPALIVE_MS = Number(process.env.WS_KEEPALIVE_MS) || 30000;

// The name httpsServer is kept for a small diff; with TLS=off it is plain HTTP.
const httpsServer = TLS_ENABLED
  ? https.createServer(
      {
        key: fs.readFileSync(TLS_KEY_PATH),
        cert: fs.readFileSync(TLS_CERT_PATH),
      },
      app
    )
  : http.createServer(app);

let wss;

const timeoutMap = new Map();

// The sockets that may receive messages about a device: the controller itself,
// the dashboard that made the request (if any), and signed-in dashboards whose
// account owns the device or administers its department.
async function audienceFor(deviceId, requester) {
  const record = await deviceRecord(deviceId);
  const audience = [];
  wss.clients.forEach((client) => {
    if (client.clientType === deviceId || client === requester) {
      audience.push(client);
      return;
    }
    if (client.clientType !== "web_app" || !client.account || !record) return;
    if (isDemoAccount(client.account)) {
      if (isDemoDevice(deviceId)) audience.push(client);
      return;
    }
    const email = String(client.account.user.email || "").toLowerCase();
    const isOwner =
      Boolean(record.ownerEmail) && record.ownerEmail.toLowerCase() === email;
    const isDepartmentAdmin =
      client.account.isAdmin &&
      record.known &&
      record.department === client.account.user.department;
    if (isOwner || isDepartmentAdmin) audience.push(client);
  });
  return audience;
}

// "Data change, remote": sending timing to a controller goes in its activity.
async function logUpload(ws, payload) {
  try {
    const user = ws.account.user;
    await AuditLog.create({
      userType: ws.account.isAdmin ? "admin" : "user",
      email: user.email,
      actorName: user.name,
      endpoint: "ws upload_request",
      deviceId: payload.DeviceID,
      reason: `Sent timing to the controller${payload.patternName ? ` (pattern ${payload.patternName})` : ""}`,
      status: "success",
    });
  } catch (error) {
    console.error("Audit log write failed:", error.message);
  }
}

function sendError(ws, message) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ event: "error", message }));
  }
}

function initWebSocketServer() {
  wss = new WebSocket.Server({ server: httpsServer, path: "/ws" });
  junctionCommands.init({ wss, audienceFor });

  const keepAlive = setInterval(() => {
    wss.clients.forEach((client) => {
      if (
        client.clientType === "web_app" &&
        client.readyState === WebSocket.OPEN
      ) {
        client.ping();
      }
    });
  }, WS_KEEPALIVE_MS);
  wss.on("close", () => clearInterval(keepAlive));

  wss.on("connection", (ws) => {
    console.log("A client is connected");

    ws.clientType = null;
    ws.userEmail = null;
    ws.isAdmin = false;

    ws.on("message", async (message) => {
      try {
        const data = JSON.parse(message);

        if (data.event) {
          if (data.event === "identify") {
            // Dashboards prove who they are with their sign-in token; the
            // email and admin flag they send are not trusted. Requests that
            // arrive while the token is being checked wait for this result
            // (see below), so a page can send them right after identifying.
            ws.identifying = resolveToken(data.token).catch(() => null);
            const account = await ws.identifying;
            if (!account) {
              ws.clientType = null;
              ws.userEmail = null;
              ws.isAdmin = false;
              ws.account = null;
              ws.send(
                JSON.stringify({
                  event: "identify_error",
                  message: "Please sign in again to get live updates.",
                })
              );
              return;
            }
            ws.account = account;
            ws.clientType = "web_app";
            ws.userEmail = account.user.email;
            ws.isAdmin = account.isAdmin;
            console.log("Dashboard identified:", ws.userEmail);
            ws.send(
              JSON.stringify({
                event: "identify_success",
                clientType: "web_app",
                userEmail: ws.userEmail,
                isAdmin: ws.isAdmin,
              })
            );
            return;
          }

          const route = WEB_REQUESTS[data.event];
          if (!route) {
            console.log("Unknown event from client:", data.event);
            sendError(ws, `Unknown event: ${data.event}`);
            return;
          }
          if (ws.identifying) await ws.identifying;
          if (ws.clientType !== "web_app" || !ws.account) {
            sendError(ws, "Please sign in again.");
            return;
          }

          const payload = data.payload || {};
          const deviceId = payload.DeviceID;
          if (
            isDemoAccount(ws.account) &&
            (data.event === "upload_request" || data.event === "download_request")
          ) {
            sendError(ws, "The demo junction runs a fixed plan. Sending timing is for real junctions.");
            return;
          }
          const allowed = await canAccessDevice(ws.account, deviceId, {
            control: route.control,
          });
          if (!allowed) {
            const viewerBlocked =
              route.control &&
              !ws.account.isAdmin &&
              roleOf(ws.account.user) === "viewer";
            sendError(
              ws,
              viewerBlocked
                ? "Your account can view this junction but not operate it."
                : `You don't have access to device ${deviceId}.`
            );
            return;
          }

          // Act for the device's real owner, whatever email the browser sent.
          const record = await deviceRecord(deviceId);
          if (record && record.ownerEmail) payload.email = record.ownerEmail;

          const audience = await audienceFor(deviceId, ws);
          route.handler(ws, audience, payload);
          if (data.event === "state_request") junctionCommands.sendLease(ws, deviceId);
          if (data.event === "upload_request") logUpload(ws, payload);
          return;
        }

        if (data?.Event === "data") {
          const param = data.Param || {};

          if (data.Type === "identify") {
            const deviceId = param.DeviceID;
            const record = await deviceRecord(deviceId);
            if (!record || !record.known) {
              console.log(`Unknown device tried to identify: ${deviceId}`);
              return;
            }
            if (record.secretKey && param.SecretKey !== record.secretKey) {
              console.warn(
                `Device ${deviceId} sent a secret key that doesn't match its record.`
              );
              if (DEVICE_KEY_ENFORCE) {
                ws.close(4001, "Device key mismatch");
                return;
              }
            }

            console.log(`Hardware identified as:`, deviceId);
            ws.clientType = deviceId;
            wss.clients.forEach((client) => {
              if (client.clientType === deviceId) {
                client.send(
                  JSON.stringify({
                    Event: "ctrl",
                    Type: "info",
                    Param: {
                      DeviceID: deviceId,
                      Rtc: Math.floor(Date.now() / 1000 + 3600),
                    },
                  })
                );
              }
            });
            // Set device online immediately
            await setDeviceOnline(deviceId, wss, timeoutMap);
            junctionCommands.onDeviceIdentify(deviceId).catch((e) =>
              console.error("Lease check on identify failed:", e.message)
            );
            return;
          }

          // A controller reports only for itself, after identifying.
          if (!ws.clientType || ws.clientType !== param.DeviceID) {
            console.log(
              `Ignoring "${data.Type}" for ${param.DeviceID} from an unidentified socket.`
            );
            return;
          }

          const audience = await audienceFor(param.DeviceID);
          junctionCommands.onDeviceActivity(param.DeviceID);
          switch (data.Type) {
            case "info":
              infoDataHandler(ws, audience, param);
              break;
            case "sign":
              signalDataHandler(ws, audience, param);
              break;
            case "state":
              deviceStateHandler(ws, audience, param);
              junctionCommands.onDeviceState(param.DeviceID, param);
              break;
            case "prog":
              uploadAndDownloadHandler(ws, audience, param);
              break;
            default:
              console.log("Unknown event from hardware:", data?.Type);
          }
        }
      } catch (error) {
        console.error("Error processing message:", error);
        ws.send(
          JSON.stringify({
            event: "error",
            message: "An error occurred while processing your request.",
          })
        );
      }
    });

    ws.on("ping", async (buffer) => {
      const deviceId = buffer.toString("utf8");

      // Only a controller that has identified on this socket keeps itself online.
      if (ws.clientType !== deviceId) return;

      // Verify device exists in AdminDevice
      const adminDevice = await AdminDevice.findOne({ deviceId });
      if (!adminDevice) {
        console.log(`Unknown device ping: ${deviceId}`);
        return;
      }

      // Reset online status and timeout
      await setDeviceOnline(deviceId, wss, timeoutMap);
    });

    ws.on("close", () => {
      console.log("A client disconnected");
    });
  });

  httpsServer.on("close", () => {
    wss.close(() => {
      console.log("WebSocket server closed");
    });
  });
}

connectToMongoDB()
  .then(() => {
    console.log("Connection to MongoDB is successful.");
    httpsServer.listen(PORT, HOST, () => {
      console.log(
        TLS_ENABLED
          ? "Secure websocket server running on port ->"
          : "Websocket server (plain HTTP, TLS=off) running on port ->",
        PORT
      );
      initWebSocketServer();
      // The demo junction (Try the demo). DEMO_JUNCTION=off leaves it out.
      if (String(process.env.DEMO_JUNCTION || "on").toLowerCase() !== "off") {
        demoJunction.start({ wss }).catch((e) => console.error("Demo junction failed to start:", e.message));
      }
    });
  })
  .catch((error) => {
    console.log(
      error.message || error,
      "Connection to MongoDB was unsuccessful."
    );
  });

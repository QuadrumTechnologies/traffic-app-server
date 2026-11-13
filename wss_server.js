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
const {
  intersectionControlRequestHandler,
} = require("./handlers/intersectionControlHandler");
const { uploadRequestHandler } = require("./handlers/uploadHandler");
const { downloadRequestHandler } = require("./handlers/downloadHandler");
const {
  uploadAndDownloadHandler,
} = require("./handlers/uploadAndDownloadHandler");
const { manualControlHandler } = require("./handlers/manualHandler");
const { UserDevice, UserDeviceState } = require("./models/appModel");
const { AdminDevice } = require("./models/adminAppModel");
const { setDeviceOnline } = require("./handlers/deviceStatusNotifiesHandler");

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

function initWebSocketServer() {
  wss = new WebSocket.Server({ server: httpsServer, path: "/ws" });

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
          switch (data?.event) {
            case "identify":
              console.log(`Client identified as:`, data.userEmail);
              ws.clientType = data.clientType;
              ws.userEmail = data.userEmail || null;
              ws.isAdmin = !!data.isAdmin;
              ws.send(
                JSON.stringify({
                  event: "identify_success",
                  clientType: data.clientType,
                  userEmail: data.userEmail,
                  isAdmin: data.isAdmin,
                })
              );
              break;
            case "state_request":
              stateDataRequestHandler(ws, wss.clients, data?.payload);
              break;
            case "info_request":
              infoDataRequestHandler(ws, wss.clients, data?.payload);
              break;
            case "intersection_control_request":
              intersectionControlRequestHandler(ws, wss.clients, data?.payload);
              break;
            case "upload_request":
              uploadRequestHandler(ws, wss.clients, data?.payload);
              break;
            case "download_request":
              downloadRequestHandler(ws, wss.clients, data?.payload);
              break;
            case "signal_request":
              manualControlHandler(ws, wss.clients, data?.payload);
              break;
            default:
              console.log("Unknown event from client:", data.event);
              ws.send(
                JSON.stringify({
                  event: "error",
                  message: `Unknown event: ${data.event}`,
                })
              );
          }
        }

        if (data?.Event === "data") {
          switch (data?.Type) {
            case "identify":
              console.log(`Hardware identified as:`, data.Param.DeviceID);
              ws.clientType = data.Param.DeviceID;
              const deviceId = data.Param.DeviceID;
              wss.clients.forEach((client) => {
                if (client.clientType === data.Param.DeviceID) {
                  client.send(
                    JSON.stringify({
                      Event: "ctrl",
                      Type: "info",
                      Param: {
                        DeviceID: data.Param.DeviceID,
                        Rtc: Math.floor(Date.now() / 1000 + 3600),
                      },
                    })
                  );
                }
              });
              // Set device online immediately
              await setDeviceOnline(deviceId, wss, timeoutMap);
              break;
            case "info":
              infoDataHandler(ws, wss.clients, data?.Param);
              break;
            case "sign":
              signalDataHandler(ws, wss.clients, data?.Param);
              break;
            case "state":
              deviceStateHandler(ws, wss.clients, data?.Param);
              break;
            case "prog":
              uploadAndDownloadHandler(ws, wss.clients, data?.Param);
              break;
            default:
              console.log("Unknown event from hardware:", data?.Event);
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
    });
  })
  .catch((error) => {
    console.log(
      error.message || error,
      "Connection to MongoDB was unsuccessful."
    );
  });

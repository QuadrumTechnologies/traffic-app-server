const { createServer } = require("https");
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
const { UserDevice } = require("./models/appModel");

const PORT = 443;

const options = {
  key: fs.readFileSync(
    "/etc/letsencrypt/live/traffic-api.quadrumtechnologies.com/privkey.pem"
  ),
  cert: fs.readFileSync(
    "/etc/letsencrypt/live/traffic-api.quadrumtechnologies.com/fullchain.pem"
  ),
};

const httpsServer = createServer(options, app);

let wss;

const timeoutMap = new Map();

function initWebSocketServer() {
  wss = new WebSocket.Server({ server: httpsServer, path: "/ws" });

  wss.on("connection", (ws) => {
    console.log("A client is connected");

    ws.clientType = null;

    ws.on("message", (message) => {
      try {
        const data = JSON.parse(message);

        // Web application logic
        if (data.event) {
          console.log(data?.event, "received from client");
          switch (data?.event) {
            case "identify":
              console.log(`Client identified as:`, data);
              ws.clientType = data.clientID;
              ws.send(
                JSON.stringify({
                  event: "identify_success",
                  clientID: data.clientID,
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

        // Hardware logic
        if (data?.Event === "data") {
          switch (data?.Type) {
            case "identify":
              console.log(`Hardware identified as:`, data.Param.DeviceID);
              ws.clientType = data.Param.DeviceID;
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
      const idUtf8 = buffer.toString("utf8");
      const currentTime = new Date().toISOString();

      await UserDevice.updateOne(
        { deviceId: idUtf8 },
        { $set: { lastSeen: null } }
      );

      const message = JSON.stringify({
        event: "ping_received",
        source: { type: "hardware", id: idUtf8 },
        timestamp: currentTime,
      });

      console.log("Ping received from device: 💦💧", idUtf8);

      wss.clients.forEach((client) => {
        if (
          client.readyState === WebSocket.OPEN &&
          client.clientType !== idUtf8
        ) {
          client.send(message);
        }
      });

      clearTimeout(timeoutMap[idUtf8]);
      timeoutMap[idUtf8] = setTimeout(async () => {
        console.log(
          "Device went offline: 🐦‍🔥🧨",
          idUtf8,
          new Date().toISOString()
        );
        await UserDevice.updateOne(
          { deviceId: idUtf8 },
          { $set: { lastSeen: new Date().toISOString() } }
        );
        wss.clients.forEach((client) => {
          if (
            client.readyState === WebSocket.OPEN &&
            client.clientType !== idUtf8
          ) {
            client.send(
              JSON.stringify({
                event: "device_status",
                source: {
                  type: "hardware",
                  id: idUtf8,
                  status: false,
                  lastSeen: new Date().toISOString(),
                },
                timestamp: new Date(),
              })
            );
          }
        });
      }, 20000);
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
    httpsServer.listen(PORT, () => {
      console.log("Secure websocket server running on port ->", PORT);
      initWebSocketServer();
    });
  })
  .catch((error) => {
    console.log(
      error.message || error,
      "Connection to MongoDB was unsuccessful."
    );
  });

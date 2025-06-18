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
const { UserDevice, UserDeviceState } = require("./models/appModel");
const { AdminDevice } = require("./models/adminAppModel");

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
    ws.userEmail = null;
    ws.isAdmin = false;

    ws.on("message", async (message) => {
      try {
        const data = JSON.parse(message);

        if (data.event) {
          console.log(data?.event, "received from client", data);
          switch (data?.event) {
            case "identify":
              console.log(`Client identified as:`, data);
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
      const deviceId = buffer.toString("utf8");
      const currentTime = new Date().toISOString();

      // Verify device exists in AdminDevice
      const adminDevice = await AdminDevice.findOne({ deviceId });
      if (!adminDevice) {
        console.log(`Unknown device ping: ${deviceId}`);
        return;
      }

      // Update lastSeen for UserDevice if assigned
      const userDevice = await UserDevice.findOneAndUpdate(
        { deviceId },
        { $set: { lastSeen: null } },
        { new: true }
      );

      const deviceState = await UserDeviceState.findOne({
        DeviceID: deviceId,
      });
      deviceState.Power = true;
      await deviceState.save();

      const message = JSON.stringify({
        event: "ping_received",
        source: { type: "hardware", id: deviceId },
        timestamp: currentTime,
      });

      wss.clients.forEach((client) => {
        console.log(
          "Ping received from device: 💦💧",
          deviceId,
          client.userEmail
        );

        if (
          client.readyState === WebSocket.OPEN &&
          client.clientType !== deviceId &&
          client.clientType === "web_app"
        ) {
          // Send to admins or user who own the device
          if (client.isAdmin || client.userEmail) {
            console.log("Sending ping message to client:", client.userEmail);
            client.send(message);
          }
        }
      });

      clearTimeout(timeoutMap[deviceId]);
      timeoutMap[deviceId] = setTimeout(async () => {
        console.log(
          "Device went offline: 🐦‍🔥🧨",
          deviceId,
          new Date().toISOString()
        );
        await UserDevice.updateOne(
          { deviceId },
          { $set: { lastSeen: new Date().toISOString() } }
        );
        const offlineMessage = JSON.stringify({
          event: "device_status",
          source: {
            type: "hardware",
            id: deviceId,
            status: false,
            lastSeen: new Date().toISOString(),
          },
          timestamp: new Date(),
        });

        wss.clients.forEach((client) => {
          if (
            client.readyState === WebSocket.OPEN &&
            client.clientType !== deviceId &&
            client.clientType === "web_app"
          ) {
            if (client.isAdmin || client.userEmail) {
              client.send(offlineMessage);
              console.log(
                "Sending offline message to client:",
                client.userEmail
              );
            }
          }
        });
      }, 30000);
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

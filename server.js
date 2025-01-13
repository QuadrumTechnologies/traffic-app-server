const { createServer } = require("http");
const WebSocket = require("ws");
require("dotenv").config();

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

const PORT = process.env.PORT || 5000;

const httpServer = createServer(app);

let wss;

// Initialize WebSocket server
function initWebSocketServer() {
  wss = new WebSocket.Server({ server: httpServer, path: "/ws" });

  wss.on("connection", (ws) => {
    console.log("A client device is connected to the server");

    // Temporary property to store client type
    ws.clientType = null;

    ws.on("message", (message) => {
      const data = JSON.parse(message);

      // Web application logic
      if (data.event) {
        console.log(data?.event, "recieved form client");
        switch (data?.event) {
          case "identify":
            console.log(`Client identified as:`, data);
            ws.clientType = data.clientID;
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
        }
      }

      // Hardware logic
      if (data?.Event === "data") {
        console.log(`${data?.Type} data received from hardware`);
        switch (data?.Type) {
          case "identify":
            console.log(`Hardware identified as:`, data.Param.DeviceID);
            ws.clientType = data.Param.DeviceID;
            console.log(ws.clientType);
            return wss.clients.forEach((client) => {
              if (client.clientType !== data.Param.DeviceID) return;
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
            });
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
    });

    ws.on("ping", (buffer) => {
      const idUtf8 = buffer.toString("utf8");

      const message = JSON.stringify({
        event: "ping_received",
        source: { type: "hardware", id: idUtf8 },
        timestamp: new Date(),
      });

      wss.clients.forEach((client) => {
        if (
          client.readyState === WebSocket.OPEN &&
          client.clientType !== idUtf8
        ) {
          client.send(message);
        }
      });
    });

    ws.on("close", () => {
      console.log("A client disconnected");
    });
  });

  // Handle server shutdown
  httpServer.on("close", () => {
    wss.close(() => {
      console.log("WebSocket server closed");
    });
  });
}
connectToMongoDB()
  .then(() => {
    console.log("Connection to MongoDB is successful.");
    httpServer.listen(PORT, () => {
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

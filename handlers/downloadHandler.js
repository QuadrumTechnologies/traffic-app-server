const catchAsync = require("../utils/catchAsync");
const { dayToNum } = require("./uploadHandler");
const { UserDevice } = require("../models/appModel");

exports.downloadRequestHandler = catchAsync(async (ws, clients, payload) => {
  try {
    console.log("Received download request data from Client", payload);

    const device = await UserDevice.findOne({ deviceId: payload.DeviceID });
    if (!device) {
      console.error(`Device with ID ${payload.DeviceID} not found.`);
      clients.forEach((client) => {
        if (client.clientType !== payload.DeviceID) {
          client.send(
            JSON.stringify({
              event: "error",
              message: `Device with ID ${payload.DeviceID} not found.`,
            })
          );
        }
      });
      return;
    }

    console.log("Download", {
      Event: "ctrl",
      Type: "prog",
      Param: {
        DeviceID: payload.DeviceID,
        Plan: dayToNum[payload.Plan],
      },
    });

    clients.forEach((client) => {
      if (client.clientType !== payload.DeviceID) return;
      client.send(
        JSON.stringify({
          Event: "ctrl",
          Type: "prog",
          Param: {
            DeviceID: payload.DeviceID,
            Plan: dayToNum[payload.Plan],
          },
        })
      );
    });
  } catch (error) {
    console.error("Error in downloadRequestHandler:", error);
    clients.forEach((client) => {
      if (client.clientType !== payload.DeviceID) {
        client.send(
          JSON.stringify({
            event: "error",
            message: "An unexpected error occurred during download request.",
          })
        );
      }
    });
  }
});

exports.downloadHandler = catchAsync(async (ws, clients, payload) => {
  try {
    clients.forEach((client) => {
      if (client.clientType === payload.DeviceID) return;
      client.send(
        JSON.stringify({
          event: "download_feedback",
          payload,
        })
      );
    });
  } catch (error) {
    console.error("Error in downloadHandler:", error);
  }
});

const {
  UserDevice,
  UserPhase,
  UserPattern,
  UserPlan,
  UserDeviceState,
  UserDeviceInfo,
} = require("../models/appModel");
const catchAsync = require("../utils/catchAsync");

exports.intersectionControlRequestHandler = catchAsync(
  async (ws, clients, payload) => {
    console.log("Received intersection control request:", payload);

    try {
      const deviceState = await UserDeviceState.findOne({
        DeviceID: payload.DeviceID,
      });

      if (!deviceState) {
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

      // Initialize default values if undefined
      if (deviceState.SignalLevel === undefined) {
        deviceState.SignalLevel = 20;
      }
      if (deviceState.ErrorFlash === undefined) {
        deviceState.ErrorFlash = false;
      }
      if (deviceState.SignalConfig === undefined) {
        deviceState.SignalConfig = "active_low_cp";
      }
      if (deviceState.Reboot === undefined) {
        deviceState.Reboot = false;
      }

      let newActionValue;
      let action = payload.action;

      if (action === "Manual") {
        action = "Auto";
      }

      switch (action) {
        case "Auto":
          newActionValue = !deviceState.Auto;
          deviceState.Auto = newActionValue;
          break;
        case "Hold":
          newActionValue = !deviceState.Hold;
          deviceState.Hold = newActionValue;
          break;
        case "Next":
          newActionValue = !deviceState.Next;
          deviceState.Next = newActionValue;
          break;
        case "Reboot":
          newActionValue = !deviceState.Reboot;
          deviceState.Reboot = newActionValue;
          break;
        case "Power":
          newActionValue =
            payload.Power !== undefined ? payload.Power : !deviceState.Power;
          deviceState.Power = newActionValue;

          if (payload.Power === false) {
            // If the device is powered off, update lastSeen and notify clients

            const device = await UserDevice.updateOne(
              { deviceId: payload.DeviceID },
              { $set: { lastSeen: new Date().toISOString() } }
            );
            console.log(
              "Device powered off:",
              payload.DeviceID,
              new Date().toISOString(),
              device
            );
            const offlineMessage = JSON.stringify({
              event: "device_status",
              source: {
                type: "hardware",
                id: payload.DeviceID,
                status: false,
                lastSeen: new Date().toISOString(),
              },
              timestamp: new Date(),
            });
            clients.forEach((client) => {
              if (
                client.clientType !== payload.DeviceID &&
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
          }
          break;
        case "Reset":
          newActionValue = !deviceState.Reset;
          deviceState.Reset = newActionValue;
          break;
        case "Reset!":
          await UserDevice.deleteOne({ deviceId: payload.DeviceID });
          await UserDeviceState.deleteOne({ DeviceID: payload.DeviceID });
          await UserDeviceInfo.deleteOne({ DeviceID: payload.DeviceID });
          await UserPhase.updateMany(
            { email: payload.email },
            { $pull: { phases: { deviceId: payload.DeviceID } } }
          );
          await UserPattern.updateMany(
            { email: payload.email },
            { $pull: { patterns: { deviceId: payload.DeviceID } } }
          );
          await UserPlan.updateMany(
            { email: payload.email },
            { $pull: { plans: { deviceId: payload.DeviceID } } }
          );
          newActionValue = true;
          break;
        case "SignalLevel":
          newActionValue = payload["SignalLevel"];
          if (
            typeof newActionValue !== "number" ||
            newActionValue < 10 ||
            newActionValue > 100
          ) {
            console.error(`Invalid Signal Level value: ${newActionValue}`);
            clients.forEach((client) => {
              if (client.clientType !== payload.DeviceID) {
                client.send(
                  JSON.stringify({
                    event: "error",
                    message: `Invalid Signal Level value: ${newActionValue}. Must be a number between 10 and 100.`,
                  })
                );
              }
            });
            return;
          }
          deviceState.SignalLevel = newActionValue;
          break;
        case "ErrorFlash":
          newActionValue =
            payload.ErrorFlash !== undefined
              ? payload.ErrorFlash
              : !deviceState.ErrorFlash;
          deviceState.ErrorFlash = newActionValue;
          break;
        default:
          console.error(`Unknown action: ${payload.action}`);
          clients.forEach((client) => {
            if (client.clientType !== payload.DeviceID) {
              client.send(
                JSON.stringify({
                  event: "error",
                  message: `Unknown action: ${payload.action}`,
                })
              );
            }
          });
          return;
      }

      // Save device state only if not a Hard Reset
      if (action !== "Reset!") {
        await deviceState.save();
      }

      // Broadcast to clients
      clients.forEach((client) => {
        if (client.clientType !== payload.DeviceID) return;
        client.send(
          JSON.stringify({
            Event: "ctrl",
            Type: "state",
            Param: {
              DeviceID: payload.DeviceID,
              [action]: `${newActionValue}`,
            },
          })
        );
      });

      // Send success feedback to the client
      clients.forEach((client) => {
        if (client.clientType !== payload.DeviceID) {
          client.send(
            JSON.stringify({
              event: "intersection_control_success",
              action: action,
              value: newActionValue,
            })
          );
        }
      });
    } catch (error) {
      console.error("Error in intersectionControlRequestHandler:", error);
      clients.forEach((client) => {
        if (client.clientType !== payload.DeviceID) {
          client.send(
            JSON.stringify({
              event: "error",
              message:
                "An unexpected error occurred during intersection control request.",
            })
          );
        }
      });
    }
  }
);

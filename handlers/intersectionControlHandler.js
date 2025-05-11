const { UserDeviceState } = require("../models/appModel");
const catchAsync = require("../utils/catchAsync");

// This function handles the intersection control request from the client
// It updates the device state based on the action received in the payload
exports.intersectionControlRequestHandler = catchAsync(
  async (ws, clients, payload) => {
    // console.log("Received intersection request data from Client", payload);

    const deviceState = await UserDeviceState.findOne({
      DeviceID: payload.DeviceID,
    });

    if (!deviceState) {
      console.error(`Device with ID ${payload.DeviceID} not found.`);
      return;
    }

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
        break;
      case "Reset":
        newActionValue = !deviceState.Reset;
        deviceState.Reset = newActionValue;
        break;
      case "SignalLevel":
        newActionValue = payload["SignalLevel"];
        if (
          typeof newActionValue !== "number" ||
          newActionValue < 10 ||
          newActionValue > 100
        ) {
          console.error(`Invalid Signal Level value: ${newActionValue}`);
          return;
        }
        console.log("Signal Level", newActionValue);
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
        return;
    }

    await deviceState.save();

    clients.forEach((client) => {
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
  }
);

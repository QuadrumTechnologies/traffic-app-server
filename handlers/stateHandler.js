const { UserDeviceState } = require("../models/appModel");
const catchAsync = require("../utils/catchAsync");

exports.stateDataRequestHandler = catchAsync(async (ws, clients, payload) => {
  try {
    if (!payload.DeviceID) {
      console.error("Missing DeviceID in state request.");
      return;
    }
    clients.forEach((client) => {
      if (client.clientType === payload.DeviceID) {
        client.send(
          JSON.stringify({
            Event: "ctrl",
            Type: "state",
            Param: {
              DeviceID: payload.DeviceID,
            },
          })
        );
      }
    });
  } catch (error) {
    console.error("Error in stateDataRequestHandler:", error);
  }
});

exports.deviceStateHandler = catchAsync(async (ws, clients, payload) => {
  try {
    const {
      DeviceID,
      Auto,
      Power,
      Next,
      Hold,
      Reset,
      Reboot,
      SignalLevel,
      ErrorFlash,
      SignalConfig,
    } = payload || {};

    if (!DeviceID) {
      console.error("Missing DeviceID in state data.");
      return;
    }

    let deviceState = await UserDeviceState.findOne({ DeviceID });

    if (deviceState) {
      deviceState.Auto = Auto === "true";
      deviceState.Power = Power === "true";
      deviceState.Next = Next === "true";
      deviceState.Hold = Hold === "true";
      deviceState.Reset = Reset === "true";
      deviceState.Reboot = Reboot === "true";
      deviceState.SignalLevel =
        SignalLevel !== undefined
          ? Number(SignalLevel)
          : deviceState.SignalLevel;
      deviceState.ErrorFlash = ErrorFlash === "true";
      deviceState.SignalConfig = SignalConfig || deviceState.SignalConfig;
      await deviceState.save();
    } else {
      deviceState = await UserDeviceState.create({
        DeviceID,
        Auto: Auto === "true",
        Power: Power === "true",
        Next: Next === "true",
        Hold: Hold === "true",
        Reset: Reset === "true",
        Reboot: Reboot === "true",
        SignalLevel: SignalLevel !== undefined ? Number(SignalLevel) : 20,
        ErrorFlash: ErrorFlash === "true",
        SignalConfig: SignalConfig || "",
      });
    }

    clients.forEach((client) => {
      if (client.clientType !== DeviceID) {
        client.send(
          JSON.stringify({
            event: "state_feedback",
            payload,
          })
        );
      }
    });
  } catch (error) {
    console.error("Error in deviceStateHandler:", error);
  }
});

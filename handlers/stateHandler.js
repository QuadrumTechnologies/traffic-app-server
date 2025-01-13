const { UserDeviceState } = require("../models/appModel");
const catchAsync = require("../utils/catchAsync");

exports.stateDataRequestHandler = catchAsync(async (ws, clients, payload) => {
  console.log("Received state request data from Client", payload);
  return clients.forEach((client) => {
    if (client.clientType !== payload.DeviceID) return;
    client.send(
      JSON.stringify({
        Event: "ctrl",
        Type: "state",
        Param: {
          DeviceID: payload.DeviceID,
        },
      })
    );
  });
});

exports.deviceStateHandler = catchAsync(async (ws, clients, payload) => {
  console.log("Received State data from Hardware", payload);

  const { DeviceID, Auto, Power, Next, Hold, Reset, Restart } = payload || {};

  if (!DeviceID) {
    return;
  }

  let deviceState = await UserDeviceState.findOne({ DeviceID });

  if (deviceState) {
    (deviceState.Auto = Auto === "true" ? true : false),
      (deviceState.Power = Power === "true" ? true : false),
      (deviceState.Next = Next === "true" ? true : false),
      (deviceState.Hold = Hold === "true" ? true : false),
      (deviceState.Reset = Reset === "true" ? true : false),
      (deviceState.Restart = Restart === "true" ? true : false),
      await deviceState.save();
  } else {
    deviceState = await UserDeviceState.create({
      DeviceID,
      Auto: Auto === "true" ? true : false,
      Power: Power === "true" ? true : false,
      Next: Next === "true" ? true : false,
      Hold: Hold === "true" ? true : false,
      Reset: Reset === "true" ? true : false,
      Restart: Restart === "true" ? true : false,
    });
  }
  return clients.forEach((client) => {
    if (client.clientType === payload.DeviceID) return;
    client.send(
      JSON.stringify({
        event: "state_feedback",
        payload,
      })
    );
  });
});

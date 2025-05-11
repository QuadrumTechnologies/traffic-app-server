const { UserDeviceInfo } = require("../models/appModel");
const catchAsync = require("../utils/catchAsync");

exports.infoDataRequestHandler = catchAsync(async (ws, clients, payload) => {
  // console.log("Received info request data from Client", payload);
  return clients.forEach((client) => {
    if (client.clientType !== payload.DeviceID) return;
    client.send(
      JSON.stringify({
        Event: "ctrl",
        Type: "info",
        Param: {
          DeviceID: payload.DeviceID,
          Rtc: Math.floor(Date.now() / 1000 + 3600),
        },
      })
    );
  });
});

exports.infoDataHandler = catchAsync(async (ws, clients, payload) => {
  console.log("Received info data from Hardware", payload);
  const { DeviceID, Rtc, Plan, Period } = payload || {};

  const North = {
    Bat: payload?.North?.Bat ?? null,
    Temp: payload?.North?.Temp ?? null,
  };
  const East = {
    Bat: payload?.East?.Bat ?? null,
    Temp: payload?.East?.Temp ?? null,
  };
  const West = {
    Bat: payload?.West?.Bat ?? null,
    Temp: payload?.West?.Temp ?? null,
  };
  const South = {
    Bat: payload?.South?.Bat ?? null,
    Temp: payload?.South?.Temp ?? null,
  };
  const CommunicationFrequency = payload?.CommunicationFrequency ?? null;
  const CommunicationChannel = payload?.CommunicationChannel ?? null;
  const JunctionId = payload?.JunctionId ?? null;
  const JunctionPassword = payload?.JunctionPassword ?? null;

  if (!DeviceID) {
    return;
  }

  const currentTime = Math.floor(Date.now() / 1000 + 3600);
  const timeDifference = currentTime - Rtc;

  if (timeDifference > 60 || timeDifference < -60) {
    clients.forEach((client) => {
      if (client.clientType === DeviceID) {
        client.send(
          JSON.stringify({
            Event: "ctrl",
            Type: "info",
            Param: {
              DeviceID: payload.DeviceID,
              Rtc: currentTime,
            },
          })
        );
      }
    });
    return;
  }

  let deviceInfo = await UserDeviceInfo.findOne({ DeviceID });

  if (deviceInfo) {
    deviceInfo.North = North;
    deviceInfo.East = East;
    deviceInfo.West = West;
    deviceInfo.South = South;
    deviceInfo.Rtc = Rtc;
    deviceInfo.Plan = Plan;
    deviceInfo.Period = Period;
    deviceInfo.JunctionId = JunctionId || deviceInfo.JunctionId;
    deviceInfo.JunctionPassword =
      JunctionPassword || deviceInfo.JunctionPassword;
    deviceInfo.CommunicationFrequency =
      CommunicationFrequency || deviceInfo.CommunicationFrequency;
    deviceInfo.CommunicationChannel =
      CommunicationChannel || deviceInfo.CommunicationChannel;
    await deviceInfo.save();
  } else {
    deviceInfo = await UserDeviceInfo.create({
      DeviceID,
      North,
      East,
      West,
      South,
      Rtc,
      Plan,
      Period,
      JunctionId: payload?.JunctionId,
      JunctionPassword: payload?.JunctionPassword,
      CommunicationFrequency: CommunicationFrequency || "",
      CommunicationChannel: CommunicationChannel || "",
    });
  }

  return clients.forEach((client) => {
    if (client.clientType === payload.DeviceID) return;
    client.send(
      JSON.stringify({
        event: "info_feedback",
        payload,
      })
    );
  });
});

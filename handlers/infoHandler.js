const { UserDeviceInfo } = require("../models/appModel");
const catchAsync = require("../utils/catchAsync");

exports.infoDataRequestHandler = catchAsync(async (ws, clients, payload) => {
  try {
    if (!payload.DeviceID) {
      console.error("Missing DeviceID in info request.");
      return;
    }
    clients.forEach((client) => {
      if (client.clientType === payload.DeviceID) {
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
      }
    });
  } catch (error) {
    console.error("Error in infoDataRequestHandler:", error);
  }
});

exports.infoDataHandler = catchAsync(async (ws, clients, payload) => {
  try {
    const { DeviceID, Rtc, Plan, Period } = payload || {};

    if (!DeviceID) {
      console.error("Missing DeviceID in info data.");
      return;
    }

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

    clients.forEach((client) => {
      if (client.clientType !== payload.DeviceID) {
        client.send(
          JSON.stringify({
            event: "info_feedback",
            payload,
          })
        );
      }
    });
  } catch (error) {
    console.error("Error in infoDataHandler:", error);
  }
});

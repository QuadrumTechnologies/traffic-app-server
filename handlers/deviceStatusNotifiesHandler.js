const { WebSocket } = require("ws");
const { UserDeviceState, UserDevice } = require("../models/appModel");
const catchAsync = require("../utils/catchAsync");

const setDeviceOffline = catchAsync(async (deviceId, wss, timeoutMap) => {
  const currentTime = new Date().toISOString();
  console.log(
    "🐦‍🔥🐦‍🔥 Setting device offline:",
    deviceId,
    "at",
    currentTime
  );
  try {
    const deviceState = await UserDeviceState.findOne({ DeviceID: deviceId });
    if (deviceState) {
      deviceState.Power = false;
      await deviceState.save();
    }

    const userDevice = await UserDevice.findOneAndUpdate(
      { deviceId },
      { $set: { lastSeen: currentTime } },
      { new: true }
    );
    const deviceOwnerEmail = userDevice?.email;

    const offlineMessage = JSON.stringify({
      event: "device_status",
      source: {
        type: "hardware",
        id: deviceId,
        status: false,
        lastSeen: currentTime,
      },
      timestamp: currentTime,
    });

    wss.clients.forEach((client) => {
      if (
        client.readyState === WebSocket.OPEN &&
        client.clientType !== deviceId &&
        client.clientType === "web_app"
      ) {
        if (client.isAdmin || client.userEmail === deviceOwnerEmail) {
          client.send(offlineMessage);
          console.log(
            "Sent offline message to client:",
            client.userEmail,
            userDevice.lastSeen
          );
        }
      }
    });

    clearTimeout(timeoutMap.get(deviceId));
    timeoutMap.delete(deviceId);

    console.log(`Device ${deviceId} set to offline at ${currentTime}`);
  } catch (error) {
    console.error(`Error setting device ${deviceId} offline:`, error);
  }
});

const setDeviceOnline = catchAsync(async (deviceId, wss, timeoutMap) => {
  const currentTime = new Date().toISOString();

  try {
    const deviceState = await UserDeviceState.findOne({ DeviceID: deviceId });
    if (deviceState) {
      deviceState.Power = true;
      await deviceState.save();
    }

    const userDevice = await UserDevice.findOneAndUpdate(
      { deviceId },
      { $set: { lastSeen: null } },
      { new: true }
    );
    const deviceOwnerEmail = userDevice?.email;

    const onlineMessage = JSON.stringify({
      event: "device_status",
      source: {
        type: "hardware",
        id: deviceId,
        status: true,
        lastSeen: null,
      },
      timestamp: currentTime,
    });

    wss.clients.forEach((client) => {
      if (
        client.readyState === WebSocket.OPEN &&
        client.clientType !== deviceId &&
        client.clientType === "web_app"
      ) {
        if (client.isAdmin || client.userEmail === deviceOwnerEmail) {
          console.log("Sending online status to client:", client.userEmail);
          client.send(onlineMessage);
        }
      }
    });

    // Clear any existing timeout and set new one to go offline later
    clearTimeout(timeoutMap.get(deviceId));
    const timeoutId = setTimeout(
      () => setDeviceOffline(deviceId, wss, timeoutMap),
      11000
    );
    timeoutMap.set(deviceId, timeoutId);

    console.log(`Device ${deviceId} set to online at ${currentTime}`);
  } catch (error) {
    console.error(`Error setting device ${deviceId} online:`, error);
  }
});

module.exports = {
  setDeviceOnline,
  setDeviceOffline,
};

const { WebSocket } = require("ws");
const { UserDeviceState, UserDevice } = require("../models/appModel");
const catchAsync = require("../utils/catchAsync");
const { isDemoDevice, isDemoAccount } = require("../utils/demo");

// Dashboards told about a device going on or offline: Quadrum admins, its
// owner, and (for the demo junction) demo visitors.
function hearsAbout(client, deviceId, ownerEmail) {
  if (client.isAdmin || (ownerEmail && client.userEmail === ownerEmail)) return true;
  return isDemoDevice(deviceId) && isDemoAccount(client.account);
}

// Controllers online now, so a junction list can show it from the start
// instead of waiting for the next ping.
const onlineNow = new Set();
const isDeviceOnline = (deviceId) => onlineNow.has(deviceId);

const setDeviceOffline = catchAsync(async (deviceId, wss, timeoutMap) => {
  onlineNow.delete(deviceId);
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
        if (hearsAbout(client, deviceId, deviceOwnerEmail)) {
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
  onlineNow.add(deviceId);
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
        if (hearsAbout(client, deviceId, deviceOwnerEmail)) {
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
  isDeviceOnline,
};

const { UserDeviceState, UserDevice } = require("../models/appModel");
const catchAsync = require("../utils/catchAsync");

exports.setDeviceOnline = catchAsync(async (deviceId, wss, timeoutMap) => {
  const currentTime = new Date().toISOString();

  try {
    // Update device state to online
    const deviceState = await UserDeviceState.findOne({ DeviceID: deviceId });
    if (deviceState) {
      deviceState.Power = true;
      await deviceState.save();
    }

    // Update UserDevice lastSeen to null (online)
    const userDevice = await UserDevice.findOneAndUpdate(
      { deviceId },
      { $set: { lastSeen: null } },
      { new: true }
    );
    const deviceOwnerEmail = userDevice?.email;

    // Notify frontend clients
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
        // Send to admins or user who owns the device
        if (client.isAdmin || client.userEmail === deviceOwnerEmail) {
          console.log("Sending online status to client:", client.userEmail);
          client.send(onlineMessage);
        }
      }
    });

    // Clear any existing timeout and set new one
    clearTimeout(timeoutMap.get(deviceId));
    const timeoutId = setTimeout(
      () => setDeviceOffline(deviceId, wss, timeoutMap),
      30000
    );
    timeoutMap.set(deviceId, timeoutId);

    console.log(`Device ${deviceId} set to online at ${currentTime}`);
  } catch (error) {
    console.error(`Error setting device ${deviceId} online:`, error);
  }
});

exports.setDeviceOffline = catchAsync(async (deviceId, wss, timeoutMap) => {
  const currentTime = new Date().toISOString();

  try {
    // Update device state to offline
    const deviceState = await UserDeviceState.findOne({ DeviceID: deviceId });
    if (deviceState) {
      deviceState.Power = false;
      await deviceState.save();
    }

    // Update UserDevice lastSeen timestamp
    const userDevice = await UserDevice.findOneAndUpdate(
      { deviceId },
      { $set: { lastSeen: currentTime } },
      { new: true }
    );
    const deviceOwnerEmail = userDevice?.email;

    // Notify frontend clients
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
          console.log("Sending offline message to client:", client.userEmail);
        }
      }
    });

    // Clear the timeout
    clearTimeout(timeoutMap.get(deviceId));
    timeoutMap.delete(deviceId);

    console.log(`Device ${deviceId} set to offline at ${currentTime}`);
  } catch (error) {
    console.error(`Error setting device ${deviceId} offline:`, error);
  }
});

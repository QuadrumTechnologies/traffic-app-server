const { WebSocket } = require("ws");
const { UserDeviceState, UserDevice } = require("../models/appModel");
const { isDemoDevice, isDemoAccount } = require("../utils/demo");
const { deviceRecord } = require("../utils/deviceAccess");

// Online and offline status of controllers.
//
// A controller pings every 6 s. It counts as offline once nothing has been
// heard from it for DEVICE_OFFLINE_MS (default 20 s, about three missed pings),
// so one late or lost ping on a mobile link doesn't make a junction flicker.
//
// The offline timer is reset the moment a ping arrives, before any database
// work, so a slow reply from the database can't make a live controller look
// offline. The database is written, the log line printed and dashboards told
// only when the status changes; while a controller stays online, dashboards
// get a reminder every STATUS_REFRESH_MS so a page that missed a change catches
// up.
const OFFLINE_AFTER_MS = Math.max(
  7000,
  Number(process.env.DEVICE_OFFLINE_MS) || 20000
);
const STATUS_REFRESH_MS = 30000;

const onlineNow = new Set(); // controllers online now
const lastHeard = new Map(); // deviceId -> time of its last ping (ms)
const lastTold = new Map(); // deviceId -> when dashboards were last told (ms)
const pending = new Map(); // deviceId -> its status writes, run one at a time

const isDeviceOnline = (deviceId) => onlineNow.has(deviceId);

// Dashboards told about a device going on or offline: Quadrum admins, its
// owner, and (for the demo junction) demo visitors.
function hearsAbout(client, deviceId, ownerEmail) {
  if (client.isAdmin || (ownerEmail && client.userEmail === ownerEmail)) return true;
  return isDemoDevice(deviceId) && isDemoAccount(client.account);
}

// Store a device's status, one write at a time per device, so an "offline"
// write can't land after the "online" write that followed it. Each write stores
// the status at the time it runs, so a quick off-and-on ends with the right
// answer.
function save(deviceId) {
  const run = (pending.get(deviceId) || Promise.resolve())
    .then(async () => {
      const online = onlineNow.has(deviceId);
      await UserDeviceState.updateOne(
        { DeviceID: deviceId },
        { $set: { Power: online } }
      );
      await UserDevice.updateOne(
        { deviceId },
        { $set: { lastSeen: online ? null : seenAt(deviceId) } }
      );
    })
    .catch((error) =>
      console.error(`Saving status of ${deviceId} failed:`, error.message)
    );
  pending.set(deviceId, run);
  run.then(() => {
    if (pending.get(deviceId) === run) pending.delete(deviceId);
  });
  return run;
}

const seenAt = (deviceId) =>
  new Date(lastHeard.get(deviceId) || Date.now()).toISOString();

// Tell the dashboards allowed to see the device its current status. Doesn't
// wait for the database writes, so dashboards hear straight away.
async function tell(deviceId, wss) {
  try {
    const record = await deviceRecord(deviceId);
    const ownerEmail = record ? record.ownerEmail : null;
    const online = onlineNow.has(deviceId);
    const message = JSON.stringify({
      event: "device_status",
      source: {
        type: "hardware",
        id: deviceId,
        status: online,
        lastSeen: online ? null : seenAt(deviceId),
      },
      timestamp: new Date().toISOString(),
    });
    lastTold.set(deviceId, Date.now());
    wss.clients.forEach((client) => {
      if (
        client.readyState === WebSocket.OPEN &&
        client.clientType === "web_app" &&
        hearsAbout(client, deviceId, ownerEmail)
      ) {
        client.send(message);
      }
    });
  } catch (error) {
    console.error(`Telling dashboards about ${deviceId} failed:`, error.message);
  }
}

function publish(deviceId, wss, changed) {
  return Promise.all([tell(deviceId, wss), changed ? save(deviceId) : null]);
}

function setDeviceOffline(deviceId, wss, timeoutMap) {
  clearTimeout(timeoutMap.get(deviceId));
  timeoutMap.delete(deviceId);
  if (!onlineNow.delete(deviceId)) return Promise.resolve();

  const heard = lastHeard.get(deviceId);
  const quietFor = heard ? Math.round((Date.now() - heard) / 1000) : "?";
  console.log(`Device ${deviceId} offline (nothing heard for ${quietFor} s)`);
  return publish(deviceId, wss, true);
}

// Called for every ping and when a controller identifies. Returns at once;
// the database work runs in the background.
function setDeviceOnline(deviceId, wss, timeoutMap) {
  const now = Date.now();
  lastHeard.set(deviceId, now);

  clearTimeout(timeoutMap.get(deviceId));
  timeoutMap.set(
    deviceId,
    setTimeout(() => setDeviceOffline(deviceId, wss, timeoutMap), OFFLINE_AFTER_MS)
  );

  if (!onlineNow.has(deviceId)) {
    onlineNow.add(deviceId);
    console.log(`Device ${deviceId} online`);
    return publish(deviceId, wss, true);
  }
  if (now - (lastTold.get(deviceId) || 0) >= STATUS_REFRESH_MS) {
    lastTold.set(deviceId, now); // claim the slot now, so pings don't pile up behind a slow database
    return publish(deviceId, wss, false);
  }
  return Promise.resolve();
}

module.exports = {
  setDeviceOnline,
  setDeviceOffline,
  isDeviceOnline,
  OFFLINE_AFTER_MS,
};

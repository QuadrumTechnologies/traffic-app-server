const { AdminDevice } = require("../models/adminAppModel");
const { UserDevice } = require("../models/appModel");

// Owner and department of a device, cached briefly: devices report every few
// seconds and each report is fanned out to the dashboards allowed to see it.
const CACHE_MS = 30 * 1000;
const cache = new Map();

async function deviceRecord(deviceId) {
  if (!deviceId) return null;
  const hit = cache.get(deviceId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.record;

  const [userDevice, adminDevice] = await Promise.all([
    UserDevice.findOne({ deviceId }).lean(),
    AdminDevice.findOne({ deviceId }).lean(),
  ]);
  const record = {
    known: Boolean(adminDevice),
    department: adminDevice ? adminDevice.deviceDepartment : null,
    ownerEmail: userDevice ? userDevice.email : null,
    allowAdminSupport: userDevice ? userDevice.allowAdminSupport !== false : true,
    secretKey: userDevice ? userDevice.secretKey : null,
  };
  cache.set(deviceId, { at: Date.now(), record });
  return record;
}

function forgetDevice(deviceId) {
  cache.delete(deviceId);
}

// Can this account see the device, or (control: true) operate it?
// - A user: they own it.
// - An admin: it belongs to their department. To operate a device that a user
//   owns, the owner must have allowed admin support.
async function canAccessDevice(account, deviceId, { control = false } = {}) {
  if (!account || !account.user || !deviceId) return false;
  const record = await deviceRecord(deviceId);
  if (!record) return false;

  if (!account.isAdmin) {
    return (
      Boolean(record.ownerEmail) &&
      record.ownerEmail.toLowerCase() === String(account.user.email).toLowerCase()
    );
  }

  if (!record.known || record.department !== account.user.department) {
    return false;
  }
  return control ? record.allowAdminSupport : true;
}

module.exports = { deviceRecord, forgetDevice, canAccessDevice };

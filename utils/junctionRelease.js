const { UserDevice, UserPhase, UserPattern, UserPlan } = require("../models/appModel");
const { AdminDevice } = require("../models/adminAppModel");
const { forgetDevice } = require("./deviceAccess");

// What happens to a junction when it leaves someone's account.
//
// A person's link to a junction (UserDevice) can be:
//   - active: theirs to watch and operate;
//   - held: moved to trash (kept 30 days) or recalled by Quadrum (kept 7 days),
//     after which the nightly job releases it.
//
// The saved timing (phases, patterns, plans) belongs with the junction, not
// the person. When an account is removed, its timing moves to the Quadrum pool
// of the junction's department ("pool:<department>"), tagged by junction as
// before, so nothing is lost and Quadrum admins can hand it on later.

const DAY_MS = 24 * 60 * 60 * 1000;
const TRASH_KEEP_MS = 30 * DAY_MS;
const RECALL_KEEP_MS = 7 * DAY_MS;

const LIBRARY = [
  { Model: UserPhase, field: "phases" },
  { Model: UserPattern, field: "patterns" },
  { Model: UserPlan, field: "plans" },
];

function poolKey(department) {
  return `pool:${department}`;
}

function sameEmail(a, b) {
  return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
}

function isHeld(link) {
  return Boolean(link && (link.isTrash || link.isRecalled));
}

// When a held link is released: the earlier of its recall and trash dates.
function releaseAt(link) {
  const dates = [];
  if (link.isRecalled && link.recallAt) dates.push(new Date(link.recallAt));
  if (link.isTrash && link.deleteAt) dates.push(new Date(link.deleteAt));
  if (dates.length === 0) return null;
  return new Date(Math.min(...dates.map((d) => d.getTime())));
}

function describeLink(link) {
  return {
    deviceId: link.deviceId,
    reason: link.isRecalled ? "recalled" : "trash",
    releaseAt: releaseAt(link),
  };
}

function plain(item) {
  return typeof item.toObject === "function"
    ? item.toObject({ flattenMaps: true })
    : { ...item };
}

// Move every phase, pattern and plan saved under `email` into the pool of each
// junction's department. Items for a junction Quadrum doesn't know go to
// `fallbackDepartment`. Returns counts per kind and the departments used.
async function moveLibraryToPool(email, fallbackDepartment) {
  const counts = { phases: 0, patterns: 0, plans: 0 };
  const sources = [];
  const deviceIds = new Set();

  for (const { Model, field } of LIBRARY) {
    const doc = await Model.findOne({ email });
    const items = doc && Array.isArray(doc[field]) ? doc[field] : [];
    sources.push({ Model, field, doc, items });
    items.forEach((item) => item.deviceId && deviceIds.add(item.deviceId));
  }

  const departmentOf = new Map();
  for (const deviceId of deviceIds) {
    const device = await AdminDevice.findOne({ deviceId }).lean();
    departmentOf.set(deviceId, (device && device.deviceDepartment) || fallbackDepartment);
  }

  const departments = new Set();
  for (const { Model, field, doc, items } of sources) {
    if (!doc || items.length === 0) continue;
    const byPool = new Map();
    items.forEach((item) => {
      const department = departmentOf.get(item.deviceId) || fallbackDepartment;
      const key = poolKey(department);
      departments.add(department);
      if (!byPool.has(key)) byPool.set(key, []);
      byPool.get(key).push(plain(item));
    });
    // Copy into the pool first, then empty the person's record: if anything
    // fails in between, the timing exists twice rather than not at all.
    for (const [key, moving] of byPool) {
      let pool = await Model.findOne({ email: key });
      if (!pool) pool = new Model({ email: key, [field]: [] });
      moving.forEach((item) => pool[field].push(item));
      await pool.save();
    }
    doc[field] = [];
    await doc.save();
    counts[field] = items.length;
  }

  return { counts, departments: [...departments] };
}

// Junctions bought under `email` in this department go back to stock.
async function returnPurchasesToStock(email, department) {
  const devices = await AdminDevice.find({ deviceDepartment: department });
  const restocked = [];
  for (const device of devices) {
    const status = device.deviceStatus || {};
    if (status.status === "purchased" && sameEmail(status.ownerEmail, email)) {
      device.deviceStatus = { status: "available" };
      await device.save();
      forgetDevice(device.deviceId);
      restocked.push(device.deviceId);
    }
  }
  return restocked;
}

async function deleteLink(link) {
  await UserDevice.deleteOne({ _id: link._id });
  forgetDevice(link.deviceId);
}

// Links whose trash or recall period has ended.
async function expiredLinks(now = new Date()) {
  return UserDevice.find({
    $or: [
      { isRecalled: true, recallAt: { $lte: now } },
      { isTrash: true, deleteAt: { $lte: now } },
    ],
  }).lean();
}

module.exports = {
  DAY_MS,
  TRASH_KEEP_MS,
  RECALL_KEEP_MS,
  poolKey,
  sameEmail,
  isHeld,
  releaseAt,
  describeLink,
  moveLibraryToPool,
  returnPurchasesToStock,
  deleteLink,
  expiredLinks,
};

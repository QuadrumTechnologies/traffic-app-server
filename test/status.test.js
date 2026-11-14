// Run: node test/status.test.js   (about 50 s; uses fake models, no database)
// Online/offline status: timer reset on every ping before any database work,
// database written and dashboards told only on change, no crash for a device
// without an owner, writes land in order when the database is slow.
const path = require("path");
const ROOT = process.argv[2] || path.resolve(__dirname, "..");
const { makeModel } = require("./fakes");
process.env.DEVICE_OFFLINE_MS = "7000";
const UserDevice = makeModel("UserDevice"), AdminDevice = makeModel("AdminDevice");
const UserDeviceState = makeModel("UserDeviceState");
function inject(rel, exp) { const f = require.resolve(path.join(ROOT, rel)); require.cache[f] = { id: f, filename: f, loaded: true, exports: exp }; }
inject("models/appModel.js", { UserDevice, UserDeviceState, UserDeviceInfo: makeModel("I") });
inject("models/adminAppModel.js", { AdminDevice });
const WebSocket = require(path.join(ROOT, "node_modules/ws"));
const status = require(path.join(ROOT, "handlers/deviceStatusNotifiesHandler.js"));
const access = require(path.join(ROOT, "utils/deviceAccess.js"));
let failures = 0;
const check = (name, ok, extra = "") => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " | " + extra : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const client = (props) => ({ readyState: WebSocket.OPEN, clientType: "web_app", got: [], send(m) { this.got.push(JSON.parse(m)); }, ...props });

(async () => {
  const errors = []; const origErr = console.error; console.error = (...a) => { errors.push(a.join(" ")); origErr(...a); };
  await AdminDevice.create({ deviceId: "OWNED-1", deviceDepartment: "x" });
  await AdminDevice.create({ deviceId: "LONE-2", deviceDepartment: "x" });
  await UserDevice.create({ deviceId: "OWNED-1", email: "owner@example.com", lastSeen: "old" });
  await UserDeviceState.create({ DeviceID: "OWNED-1", Power: false });
  const admin = client({ isAdmin: true }), owner = client({ userEmail: "owner@example.com" }), other = client({ userEmail: "other@example.com" });
  const wss = { clients: new Set([admin, owner, other]) };
  const tm = new Map();

  check("offline window from DEVICE_OFFLINE_MS", status.OFFLINE_AFTER_MS === 7000, status.OFFLINE_AFTER_MS);

  // 1. First ping: online, written once, owner and admin told, others not.
  await status.setDeviceOnline("OWNED-1", wss, tm);
  check("online after first ping", status.isDeviceOnline("OWNED-1"));
  check("Power true stored", UserDeviceState.store[0].Power === true);
  check("lastSeen cleared", UserDevice.store[0].lastSeen === null);
  check("admin told", admin.got.length === 1 && admin.got[0].source.status === true);
  check("owner told", owner.got.length === 1);
  check("other user not told", other.got.length === 0);

  // 2. Pings while online: no writes, no messages.
  const writesBefore = (UserDeviceState.calls || 0) + (UserDevice.calls || 0);
  for (let i = 0; i < 5; i++) { await status.setDeviceOnline("OWNED-1", wss, tm); await sleep(200); }
  check("no writes for repeat pings", (UserDeviceState.calls || 0) + (UserDevice.calls || 0) === writesBefore);
  check("no messages for repeat pings", admin.got.length === 1);

  // 3. Slow database: pings keep it online even when writes take longer than the window.
  UserDeviceState.writeDelayMs = 9000; UserDevice.writeDelayMs = 9000;
  status.setDeviceOnline("LONE-2", wss, tm); // unowned device, like the demo junction
  const t0 = Date.now(); let flipped = false;
  while (Date.now() - t0 < 10000) { status.setDeviceOnline("LONE-2", wss, tm); await sleep(2000); if (!status.isDeviceOnline("LONE-2")) flipped = true; }
  check("stays online while pinging, database slow", !flipped && status.isDeviceOnline("LONE-2"));
  UserDeviceState.writeDelayMs = 0; UserDevice.writeDelayMs = 0;

  // 4. Silence: offline after the window, lastSeen = last ping, no crash without an owner.
  const lastPing = Date.now(); status.setDeviceOnline("LONE-2", wss, tm);
  await sleep(6000);
  check("still online before the window", status.isDeviceOnline("LONE-2"));
  await sleep(1500);
  check("offline after the window", !status.isDeviceOnline("LONE-2"));
  await sleep(300);
  const off = admin.got.filter((m) => m.source.id === "LONE-2" && m.source.status === false);
  check("admin told LONE-2 is offline", off.length === 1, JSON.stringify(off[0] && off[0].source));
  check("lastSeen is the last ping", off[0] && Math.abs(new Date(off[0].source.lastSeen).getTime() - lastPing) < 1000);
  check("no errors logged", errors.length === 0, errors.join(" / ").slice(0, 200));

  // 5. Quick off-and-on with a slow database ends with the right answer stored.
  UserDeviceState.writeDelayMs = 400;
  status.setDeviceOffline("OWNED-1", wss, tm);
  status.setDeviceOnline("OWNED-1", wss, tm);
  await sleep(2500);
  UserDeviceState.writeDelayMs = 0;
  check("ends online after off-and-on", status.isDeviceOnline("OWNED-1") && UserDeviceState.store[0].Power === true && UserDevice.store[0].lastSeen === null);

  // 6. Refresh while online: dashboards reminded after 30 s, without writes.
  access.forgetDevice("OWNED-1");
  const told = owner.got.length, w = (UserDeviceState.calls || 0) + (UserDevice.calls || 0);
  const t1 = Date.now();
  while (Date.now() - t1 < 31500) { status.setDeviceOnline("OWNED-1", wss, tm); await sleep(3000); }
  check("one reminder in 30 s", owner.got.length - told === 1, owner.got.length - told);
  check("reminder made no writes", (UserDeviceState.calls || 0) + (UserDevice.calls || 0) === w);

  tm.forEach((t) => clearTimeout(t));
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
})();

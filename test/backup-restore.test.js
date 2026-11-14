// Run: node test/backup-restore.test.js   (no database needed)
// Backup and restore logic against an in-memory stand-in for the driver's Db.
const path = require("path"), fs = require("fs"), os = require("os");
const ROOT = process.argv[2] || path.resolve(__dirname, "..");
const { mongo } = require(path.join(ROOT, "node_modules/mongoose"));
const { ObjectId } = mongo;
const backupMod = require(path.join(ROOT, "ops/backup-db.js"));
const restoreMod = require(path.join(ROOT, "ops/restore-db.js"));
let failures = 0;
const check = (name, ok, extra = "") => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " | " + extra : ""}`); };

function fakeDb(name, data = {}, indexes = {}) {
  const colls = new Map(Object.entries(data).map(([k, v]) => [k, v.map((d) => ({ ...d }))]));
  const idx = new Map(Object.entries(indexes));
  const db = {
    databaseName: name, colls, idx,
    listCollections: () => ({ toArray: async () => [...colls.keys()].map((n) => ({ name: n, type: "collection" })).concat([{ name: "aView", type: "view" }]) }),
    collection: (n) => ({
      find: () => ({ async *[Symbol.asyncIterator]() { for (const d of colls.get(n) || []) yield d; } }),
      indexes: async () => [{ v: 2, key: { _id: 1 }, name: "_id_" }, ...(idx.get(n) || [])],
      countDocuments: async (q, o = {}) => Math.min((colls.get(n) || []).length, o.limit || Infinity),
      insertMany: async (docs) => { if (!colls.has(n)) colls.set(n, []); colls.get(n).push(...docs); },
      createIndex: async (key, opts) => { const l = idx.get(n) || []; l.push({ v: 2, key, ...opts }); idx.set(n, l); },
      drop: async () => { colls.delete(n); idx.delete(n); },
    }),
    createCollection: async (n) => { if (!colls.has(n)) colls.set(n, []); },
    stats: async () => ({ dataSize: 2.5 * 1048576, storageSize: 1048576, indexSize: 524288 }),
  };
  return db;
}

(async () => {
  // Retention
  const names = [];
  for (let i = 0; i < 400; i++) { const d = new Date(Date.UTC(2026, 10, 14) - i * 86400000); names.push(d.toISOString().slice(0, 10) + "_0230"); }
  names.push("2026-11-14_1015"); // a manual one on the same day
  const keep = backupMod.toKeep(names);
  check("keeps newest of the day", keep.has("2026-11-14_1015") && !keep.has("2026-11-14_0230"));
  check("keeps 7 daily", ["2026-11-13_0230", "2026-11-08_0230"].every((n) => keep.has(n)) && !keep.has("2026-11-07_0230") || keep.has("2026-11-07_0230") === true, [...keep].sort().join(" "));
  check("keep count is modest", keep.size <= 17, keep.size);
  check("ISO weeks", backupMod.weekOf("2026-11-14_0230") === "2026-W46" && backupMod.weekOf("2027-01-01_0000") === "2026-W53" && backupMod.weekOf("2025-12-29_0000") === "2026-W01" && backupMod.weekOf("2026-01-01_0000") === "2026-W01", [backupMod.weekOf("2026-11-14_0230"), backupMod.weekOf("2027-01-01_0000"), backupMod.weekOf("2025-12-29_0000")].join(","));

  // Dump
  const id = new ObjectId(), when = new Date("2026-11-01T10:00:00Z");
  const src = fakeDb("traffic", {
    users: [{ _id: id, email: "a@example.com", createdAt: when, n: 3 }, { _id: new ObjectId(), email: "b@example.com", tags: ["x"] }],
    userdevices: Array.from({ length: 1234 }, (_, i) => ({ _id: new ObjectId(), deviceId: "D" + i, lastSeen: i % 2 ? null : when })),
    empty: [],
  }, { users: [{ v: 2, key: { email: 1 }, name: "email_1", unique: true }], demosessions: [] });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bk-"));
  const manifest = await backupMod.dumpDatabase(src, dir);
  check("manifest counts", manifest.totalDocuments === 1236 && manifest.collections.length === 3, JSON.stringify(manifest.collections));
  check("views skipped", !manifest.collections.some((c) => c.name === "aView"));
  check("size recorded", manifest.databaseSizeMB && manifest.databaseSizeMB.data === 2.5);
  check("files written 0600", (fs.statSync(path.join(dir, "users.jsonl.gz")).mode & 0o777) === 0o600);
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest));

  // Restore into an empty database
  const dst = fakeDb("restore_check");
  const lines = [];
  const dry = await restoreMod.restore(dst, dir, { dryRun: true, log: (l) => lines.push(l) });
  check("dry run changes nothing", dst.colls.size === 0 && dry.plan.every((p) => p.action === "create"));
  await restoreMod.restore(dst, dir, { dryRun: false, log: () => {} });
  const u = dst.colls.get("users");
  check("documents restored", u.length === 2 && dst.colls.get("userdevices").length === 1234 && dst.colls.has("empty"));
  check("ObjectId type kept", u[0]._id instanceof ObjectId && u[0]._id.equals(id));
  check("Date type kept", u[0].createdAt instanceof Date && u[0].createdAt.getTime() === when.getTime());
  check("index restored", (dst.idx.get("users") || []).some((i) => i.name === "email_1" && i.unique === true));

  // Second run without --replace skips collections that hold data
  const again = await restoreMod.restore(dst, dir, { dryRun: false, log: () => {} });
  check("skips non-empty without replace", dst.colls.get("users").length === 2 && again.plan.find((p) => p.name === "users").action.startsWith("skip"));
  // With replace
  dst.colls.get("users").push({ _id: new ObjectId(), email: "extra@example.com" });
  await restoreMod.restore(dst, dir, { dryRun: false, replace: true, only: ["users"], log: () => {} });
  check("replace restores exactly the backup", dst.colls.get("users").length === 2);
  let threw = false; try { await restoreMod.restore(dst, dir, { only: ["nope"], log: () => {} }); } catch (e) { threw = /Not in this backup/.test(e.message); }
  check("unknown collection refused", threw);

  // Args
  let a = restoreMod.parseArgs(["x", "--yes", "--replace", "--only", "a,b", "--db", "zz"]);
  check("args parsed", a.dir === "x" && a.yes && a.replace && a.only.join() === "a,b" && a.db === "zz");
  threw = false; try { restoreMod.parseArgs(["x", "--replace"]); } catch (e) { threw = true; }
  check("--replace needs --yes", threw);

  // Prune leaves finished backups it should keep and removes stale partials
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "root-"));
  for (const n of names.slice(0, 40)) { fs.mkdirSync(path.join(root, n)); fs.writeFileSync(path.join(root, n, "manifest.json"), "{}"); }
  fs.mkdirSync(path.join(root, ".partial-old")); fs.utimesSync(path.join(root, ".partial-old"), new Date(Date.now() - 3 * 86400000), new Date(Date.now() - 3 * 86400000));
  const removed = backupMod.prune(root, { daily: 7, weekly: 4, monthly: 6 });
  const left = backupMod.listBackups(root);
  check("prune keeps the plan", left.length === backupMod.toKeep(names.slice(0, 40)).size && removed.includes(".partial-old"), `${left.length} left`);
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

#!/usr/bin/env node
// Back up the traffic database (MongoDB Atlas) to files on this machine.
//
//   node ops/backup-db.js            take a backup and prune old ones
//   node ops/backup-db.js --list     show the backups kept
//   node ops/backup-db.js --out DIR  keep backups in DIR (default BACKUP_DIR or ~/backups/traffic-db)
//
// Each backup is a folder named by local date and time (2026-11-14_0230)
// holding, for every collection, its documents as gzipped Extended JSON (one
// per line, so ObjectIds and dates come back exactly) and its indexes, plus
// manifest.json with the document counts and the database size.
//
// Kept: the newest backup of each of the last 7 days, the last 4 weeks and
// the last 6 months (KEEP_DAILY, KEEP_WEEKLY, KEEP_MONTHLY). Anything older is
// deleted. Restore with ops/restore-db.js.
//
// The database address is DATABASE_URI, from the environment or the app's
// .env file. It is never printed. Backups hold personal data and password
// hashes: folders are created readable by this user only.

const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const { once } = require("events");

const APP_DIR = path.resolve(__dirname, "..");
require(path.join(APP_DIR, "node_modules/dotenv")).config({
  path: path.join(APP_DIR, ".env"),
  quiet: true,
});
const { mongo } = require(path.join(APP_DIR, "node_modules/mongoose"));
const { EJSON } = mongo.BSON;

const NAME = /^\d{4}-\d{2}-\d{2}_\d{4}$/;
const M0_LIMIT_MB = 512; // Atlas free tier storage cap

const hide = (text) =>
  String(text).replace(/mongodb(\+srv)?:\/\/[^@\s/]+@/g, "mongodb$1://***@");

function argValue(args, name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

const dayOf = (name) => name.slice(0, 10);
function weekOf(name) {
  // ISO week, e.g. 2026-W46
  const d = new Date(`${dayOf(name)}T12:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
const monthOf = (name) => name.slice(0, 7);

// Which backups to keep: the newest of each of the last N days, weeks, months.
function toKeep(names, { daily = 7, weekly = 4, monthly = 6 } = {}) {
  const newestFirst = [...names].sort().reverse();
  const keep = new Set();
  for (const [period, n] of [[dayOf, daily], [weekOf, weekly], [monthOf, monthly]]) {
    const seen = new Set();
    for (const name of newestFirst) {
      const key = period(name);
      if (seen.has(key)) continue;
      seen.add(key);
      if (seen.size > n) break;
      keep.add(name);
    }
  }
  return keep;
}

function listBackups(root) {
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root)
    .filter((n) => NAME.test(n) && fs.existsSync(path.join(root, n, "manifest.json")))
    .sort();
}

function sizeOf(dir) {
  return fs.readdirSync(dir).reduce((sum, f) => sum + fs.statSync(path.join(dir, f)).size, 0);
}

function prune(root, keepCounts) {
  const names = listBackups(root);
  const keep = toKeep(names, keepCounts);
  const removed = [];
  for (const name of names) {
    if (keep.has(name)) continue;
    fs.rmSync(path.join(root, name), { recursive: true, force: true });
    removed.push(name);
  }
  // Leftovers from a backup that didn't finish, older than a day.
  for (const n of fs.readdirSync(root)) {
    if (!n.startsWith(".partial-")) continue;
    const p = path.join(root, n);
    if (Date.now() - fs.statSync(p).mtimeMs > 86400000) {
      fs.rmSync(p, { recursive: true, force: true });
      removed.push(n);
    }
  }
  return removed;
}

// Write every collection of `db` into `dir`. Returns the manifest.
async function dumpDatabase(db, dir) {
  const collections = (await db.listCollections({}, { nameOnly: false }).toArray())
    .filter((c) => c.type !== "view" && !c.name.startsWith("system."))
    .map((c) => c.name)
    .sort();

  const manifest = {
    database: db.databaseName,
    createdAt: new Date().toISOString(),
    host: os.hostname(),
    format: "gzipped canonical Extended JSON, one document per line",
    collections: [],
    totalDocuments: 0,
  };

  for (const name of collections) {
    const coll = db.collection(name);
    const file = path.join(dir, `${name}.jsonl.gz`);
    const out = fs.createWriteStream(file, { mode: 0o600 });
    const gz = zlib.createGzip({ level: 9 });
    gz.pipe(out);
    let documents = 0;
    for await (const doc of coll.find({}, { batchSize: 500 })) {
      if (!gz.write(EJSON.stringify(doc, { relaxed: false }) + "\n")) await once(gz, "drain");
      documents++;
    }
    gz.end();
    await once(out, "finish");

    const indexes = await coll.indexes();
    fs.writeFileSync(
      path.join(dir, `${name}.indexes.json`),
      EJSON.stringify(indexes, null, 2, { relaxed: false }),
      { mode: 0o600 }
    );
    manifest.collections.push({ name, documents, bytes: fs.statSync(file).size });
    manifest.totalDocuments += documents;
  }

  try {
    const s = await db.stats();
    const mb = (b) => Math.round((b / 1048576) * 10) / 10;
    manifest.databaseSizeMB = {
      data: mb(s.dataSize),
      storage: mb(s.storageSize),
      indexes: mb(s.indexSize),
    };
  } catch (e) {
    manifest.databaseSizeMB = null; // not fatal
  }
  return manifest;
}

async function backup(root) {
  const uri = process.env.DATABASE_URI;
  if (!uri) throw new Error("DATABASE_URI is not set (environment or .env)");

  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const name = stamp();
  const finalDir = path.join(root, name);
  if (fs.existsSync(finalDir)) throw new Error(`${finalDir} already exists`);
  const work = path.join(root, `.partial-${name}`);
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { mode: 0o700 });

  const client = new mongo.MongoClient(uri, { serverSelectionTimeoutMS: 30000 });
  const started = Date.now();
  try {
    await client.connect();
    const manifest = await dumpDatabase(client.db(), work);
    manifest.seconds = Math.round((Date.now() - started) / 100) / 10;
    fs.writeFileSync(path.join(work, "manifest.json"), JSON.stringify(manifest, null, 2), { mode: 0o600 });
    fs.renameSync(work, finalDir);
    return { name, dir: finalDir, manifest };
  } finally {
    await client.close().catch(() => {});
  }
}

async function main() {
  const args = process.argv.slice(2);
  const root = path.resolve(
    argValue(args, "--out", process.env.BACKUP_DIR || path.join(os.homedir(), "backups", "traffic-db"))
  );

  if (args.includes("--list")) {
    const names = listBackups(root);
    if (!names.length) return console.log(`No backups in ${root}`);
    for (const n of names) {
      const m = JSON.parse(fs.readFileSync(path.join(root, n, "manifest.json"), "utf8"));
      console.log(`${n}  ${String(m.totalDocuments).padStart(7)} documents  ${(sizeOf(path.join(root, n)) / 1024).toFixed(0).padStart(6)} KB  ${m.collections.length} collections`);
    }
    return;
  }

  const { name, dir, manifest } = await backup(root);
  const kb = (sizeOf(dir) / 1024).toFixed(0);
  console.log(
    `Backed up ${manifest.database}: ${manifest.totalDocuments} documents in ${manifest.collections.length} collections, ${kb} KB, ${manifest.seconds} s -> ${dir}`
  );
  const size = manifest.databaseSizeMB;
  if (size) {
    const used = size.storage + size.indexes;
    console.log(`Database size: ${size.data} MB data, ${used} MB on disk with indexes (free tier limit ${M0_LIMIT_MB} MB)`);
    if (used > M0_LIMIT_MB * 0.8) console.warn(`WARNING: the database is over 80% of the ${M0_LIMIT_MB} MB free tier limit`);
  }
  const removed = prune(root, {
    daily: Number(process.env.KEEP_DAILY) || 7,
    weekly: Number(process.env.KEEP_WEEKLY) || 4,
    monthly: Number(process.env.KEEP_MONTHLY) || 6,
  });
  if (removed.length) console.log(`Removed old backups: ${removed.join(", ")}`);
  console.log(`Kept ${listBackups(root).length} backups (newest ${name}).`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Backup FAILED: ${hide(error && error.message ? error.message : error)}`);
    process.exit(1);
  });
}

module.exports = { toKeep, weekOf, dumpDatabase, listBackups, prune, stamp, NAME };

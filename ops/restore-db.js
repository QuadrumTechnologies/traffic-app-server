#!/usr/bin/env node
// Restore a backup made by ops/backup-db.js.
//
//   node ops/restore-db.js <backup folder>                  dry run: says what it would do
//   node ops/restore-db.js <backup folder> --yes            fill empty or missing collections
//   node ops/restore-db.js <backup folder> --yes --replace  also drop and refill collections that hold data
//
//   --only a,b       restore just these collections
//   --db NAME        restore into this database (default: the one in the address)
//   --uri-env NAME   read the address from this environment variable (default DATABASE_URI)
//   --live           needed with --replace when the target is the database the API uses
//
// Before replacing anything the API uses: stop it (sudo systemctl stop
// traffic-api), take a fresh backup, restore, then start it again.
// The address is never printed.

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const readline = require("readline");

const APP_DIR = path.resolve(__dirname, "..");
require(path.join(APP_DIR, "node_modules/dotenv")).config({
  path: path.join(APP_DIR, ".env"),
  quiet: true,
});
const { mongo } = require(path.join(APP_DIR, "node_modules/mongoose"));
const { EJSON } = mongo.BSON;

const BATCH = 500;
const hide = (text) =>
  String(text).replace(/mongodb(\+srv)?:\/\/[^@\s/]+@/g, "mongodb$1://***@");

function parseArgs(argv) {
  const opts = { dir: null, yes: false, replace: false, live: false, only: null, db: null, uriEnv: "DATABASE_URI" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--yes") opts.yes = true;
    else if (a === "--replace") opts.replace = true;
    else if (a === "--live") opts.live = true;
    else if (a === "--only") opts.only = String(argv[++i] || "").split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--db") opts.db = argv[++i];
    else if (a === "--uri-env") opts.uriEnv = argv[++i];
    else if (a.startsWith("--")) throw new Error(`Unknown option ${a}`);
    else if (!opts.dir) opts.dir = a;
    else throw new Error(`Unexpected argument ${a}`);
  }
  if (!opts.dir) throw new Error("Give the backup folder, e.g. ~/backups/traffic-db/2026-11-14_0230");
  if (opts.replace && !opts.yes) throw new Error("--replace only makes sense with --yes");
  return opts;
}

async function* readDocs(file) {
  const lines = readline.createInterface({
    input: fs.createReadStream(file).pipe(zlib.createGunzip()),
    crlfDelay: Infinity,
  });
  for await (const line of lines) if (line.trim()) yield EJSON.parse(line, { relaxed: false });
}

// Plan and (unless dryRun) carry out the restore into `db`.
// `live` is true when `db` is the database the API uses.
async function restore(db, dir, { only = null, replace = false, dryRun = true, live = false, log = console.log } = {}) {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  const wanted = manifest.collections.filter((c) => !only || only.includes(c.name));
  if (only) {
    const missing = only.filter((n) => !manifest.collections.some((c) => c.name === n));
    if (missing.length) throw new Error(`Not in this backup: ${missing.join(", ")}`);
  }
  const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
  const plan = [];
  for (const c of wanted) {
    const present = existing.has(c.name);
    const count = present ? await db.collection(c.name).countDocuments({}, { limit: 1 }) : 0;
    let action;
    if (!present) action = "create";
    else if (count === 0) action = "fill";
    else action = replace ? "replace" : "skip (has data; use --replace)";
    plan.push({ name: c.name, documents: c.documents, action });
  }

  log(`${dryRun ? "Dry run: would restore" : "Restoring"} backup of ${manifest.database} from ${manifest.createdAt} into ${db.databaseName}${live ? " (the database the API uses)" : ""}`);
  for (const p of plan) log(`  ${p.name.padEnd(28)} ${String(p.documents).padStart(7)} documents  ${p.action}`);
  if (dryRun) {
    log("Nothing changed. Add --yes to restore.");
    return { plan, restored: [] };
  }

  const restored = [];
  for (const p of plan) {
    if (p.action.startsWith("skip")) continue;
    const coll = db.collection(p.name);
    if (p.action === "replace") await coll.drop();

    let batch = [];
    let inserted = 0;
    for await (const doc of readDocs(path.join(dir, `${p.name}.jsonl.gz`))) {
      batch.push(doc);
      if (batch.length >= BATCH) {
        await coll.insertMany(batch, { ordered: false });
        inserted += batch.length;
        batch = [];
      }
    }
    if (batch.length) {
      await coll.insertMany(batch, { ordered: false });
      inserted += batch.length;
    }
    if (!inserted && p.action === "create") await db.createCollection(p.name).catch(() => {});

    const indexFile = path.join(dir, `${p.name}.indexes.json`);
    const indexes = fs.existsSync(indexFile) ? EJSON.parse(fs.readFileSync(indexFile, "utf8"), { relaxed: false }) : [];
    for (const ix of indexes) {
      if (ix.name === "_id_") continue;
      const { key, v, ns, background, ...options } = ix;
      try {
        await coll.createIndex(key, options);
      } catch (e) {
        log(`  warning: index ${ix.name} on ${p.name}: ${e.message}`);
      }
    }
    if (inserted !== p.documents) log(`  warning: ${p.name}: expected ${p.documents} documents, inserted ${inserted}`);
    log(`  ${p.name}: ${inserted} documents restored`);
    restored.push({ name: p.name, inserted });
  }
  return { plan, restored };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const dir = path.resolve(opts.dir.replace(/^~(?=$|\/)/, require("os").homedir()));
  if (!fs.existsSync(path.join(dir, "manifest.json"))) throw new Error(`${dir} is not a finished backup (no manifest.json)`);

  const uri = process.env[opts.uriEnv];
  if (!uri) throw new Error(`${opts.uriEnv} is not set (environment or .env)`);
  const appUri = process.env.DATABASE_URI;

  const client = new mongo.MongoClient(uri, { serverSelectionTimeoutMS: 30000 });
  await client.connect();
  try {
    const db = opts.db ? client.db(opts.db) : client.db();
    let live = false;
    if (appUri) {
      const appDbName = new mongo.MongoClient(appUri).db().databaseName;
      const sameCluster = uri === appUri || opts.uriEnv === "DATABASE_URI";
      live = sameCluster && db.databaseName === appDbName;
    }
    if (live && opts.replace && opts.yes && !opts.live) {
      throw new Error(
        `${db.databaseName} is the database the API uses. To replace its collections, stop the API, take a fresh backup, and add --live.`
      );
    }
    await restore(db, dir, { only: opts.only, replace: opts.replace, dryRun: !opts.yes, live });
  } finally {
    await client.close().catch(() => {});
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Restore FAILED: ${hide(error && error.message ? error.message : error)}`);
    process.exit(1);
  });
}

module.exports = { restore, parseArgs, readDocs };

// db.js keeps trying to reach the database instead of giving up after one
// failure (the API used to stay up without listening after a failed boot).
// Run: node test/db-retry.test.js
const assert = require("assert");
const path = require("path");

const ROOT = path.join(__dirname, "..");
process.env.DB_RETRY_FIRST_MS = "5";
process.env.DB_RETRY_MAX_MS = "20";

// A stand-in for mongoose: fails a set number of times, then connects.
let failuresLeft = 0;
let calls = 0;
const fakeMongoose = {
  connect: async () => {
    calls++;
    if (failuresLeft > 0) {
      failuresLeft--;
      throw new Error("querySrv ETIMEOUT _mongodb._tcp.example.mongodb.net");
    }
  },
};
const mongoosePath = require.resolve("mongoose", { paths: [ROOT] });
require.cache[mongoosePath] = { id: mongoosePath, filename: mongoosePath, loaded: true, exports: fakeMongoose };

const connectToMongoDB = require(path.join(ROOT, "db.js"));

(async () => {
  const log = console.log;
  const lines = [];
  console.log = (...args) => lines.push(args.join(" "));
  try {
    // Connects on the first try: one call, nothing logged.
    failuresLeft = 0;
    calls = 0;
    await connectToMongoDB();
    assert.strictEqual(calls, 1);
    assert.strictEqual(lines.length, 0);

    // Fails three times, then connects: four calls, each failure logged.
    failuresLeft = 3;
    calls = 0;
    await connectToMongoDB();
    assert.strictEqual(calls, 4);
    assert.strictEqual(lines.filter((l) => l.includes("Connection to MongoDB failed")).length, 3);
    assert.ok(lines.some((l) => l.includes("Connected to MongoDB on attempt 4.")));

    // With a limit, it gives up and rejects with the last error.
    failuresLeft = 5;
    calls = 0;
    await assert.rejects(connectToMongoDB({ retries: 2 }), /ETIMEOUT/);
    assert.strictEqual(calls, 2);
  } finally {
    console.log = log;
  }
  console.log("db retry: all checks passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

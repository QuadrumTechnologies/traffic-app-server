const mongoose = require("mongoose");

const DATABASE_URI = process.env.DATABASE_URI;

// At boot the network or DNS may not be ready yet. On 15 Nov 2026, after a
// reboot, the first try failed with "querySrv ETIMEOUT" and the API stayed up
// without listening until it was restarted by hand. So keep trying, with a
// growing wait, and resolve as soon as the database answers.
const FIRST_WAIT_MS = Number(process.env.DB_RETRY_FIRST_MS) || 2000;
const MAX_WAIT_MS = Number(process.env.DB_RETRY_MAX_MS) || 30000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = async function connectToMongoDB({ retries = Infinity } = {}) {
  let wait = FIRST_WAIT_MS;
  for (let attempt = 1; ; attempt++) {
    try {
      await mongoose.connect(DATABASE_URI);
      if (attempt > 1) console.log(`Connected to MongoDB on attempt ${attempt}.`);
      return;
    } catch (error) {
      if (attempt >= retries) throw error;
      console.log(
        `${error.message || error} Connection to MongoDB failed (attempt ${attempt}); trying again in ${Math.round(wait / 100) / 10} s.`
      );
      await sleep(wait);
      wait = Math.min(MAX_WAIT_MS, wait * 2);
    }
  }
};

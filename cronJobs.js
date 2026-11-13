const cron = require("node-cron");
const { expiredLinks, deleteLink } = require("./utils/junctionRelease");

// Each night, release junction links whose trash period (30 days) or recall
// notice (7 days) has ended. deleteAt and recallAt hold the moment of release:
// they are set to "now + period" when the junction is moved to trash or
// recalled, so they are compared with the current time as they are.
// (Until Nov 2026 the job added the period a second time: trash lasted 60
// days and a recall 14, not what the dashboard and the emails said.)
const deleteExpiredDevices = async (now = new Date()) => {
  try {
    const links = await expiredLinks(now);
    for (const link of links) {
      await deleteLink(link);
    }
    if (links.length > 0) {
      console.log(
        `Released ${links.length} junction link(s): ${links
          .map((l) => `${l.deviceId} (${l.isRecalled ? "recalled" : "trash"})`)
          .join(", ")}`
      );
    }
    return links.map((l) => l.deviceId);
  } catch (error) {
    console.error("Error releasing expired junction links:", error);
    return [];
  }
};

// Every midnight.
cron.schedule("0 0 * * *", () => deleteExpiredDevices());

console.log("Cron job for releasing expired junction links scheduled.");

module.exports = deleteExpiredDevices;

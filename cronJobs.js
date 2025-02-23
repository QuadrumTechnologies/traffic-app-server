const cron = require("node-cron");
const { UserDevice } = require("./models/appModel");

const deleteExpiredDevices = async () => {
  const now = new Date();

  try {
    // Delete devices older than 7 days (admin recall)
    await UserDevice.deleteMany({
      isRecalled: true,
      recallAt: { $lte: new Date(now - 7 * 24 * 60 * 60 * 1000) },
    });

    // Delete devices older than 30 days (user deletion)
    await UserDevice.deleteMany({
      isTrash: true,
      deleteAt: { $lte: new Date(now - 30 * 24 * 60 * 60 * 1000) },
    });

    console.log("Expired devices deleted successfully.");
  } catch (error) {
    console.error("Error deleting expired devices:", error);
  }
};

// Schedule the cron job to run every midnight
cron.schedule("0 0 * * *", deleteExpiredDevices);

console.log("Cron job for deleting expired devices scheduled.");

module.exports = deleteExpiredDevices;

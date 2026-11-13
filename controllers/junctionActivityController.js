const catchAsync = require("../utils/catchAsync");
const { AuditLog } = require("../models/auditModel");

// What happened at a junction: commands, manual control, timing sent.
// GET /api/v1/junctions/:deviceID/activity (owner or department admin).
exports.getJunctionActivity = catchAsync(async (req, res) => {
  const { deviceID } = req.params;
  const entries = await AuditLog.find({ deviceId: deviceID })
    .sort({ timestamp: -1 })
    .limit(50)
    .lean();
  res.status(200).json({
    status: "success",
    data: {
      activity: entries.map((e) => ({
        at: e.timestamp,
        who: e.endpoint === "system" ? null : e.actorName || e.email,
        quadrum: e.userType === "admin",
        text: e.reason,
        ok: e.status === "success",
      })),
    },
  });
});

const mongoose = require("mongoose");

// Remote manual control of a junction, held by one person at a time.
// Kept in the database so a restart of the API doesn't forget that a junction
// was left in manual control (the controller stays in manual while it is
// connected, until it is told to return to its plan).
const controlLeaseSchema = new mongoose.Schema({
  deviceId: { type: String, required: true, unique: true },
  holderEmail: { type: String, required: true },
  holderName: { type: String, default: "" },
  // "admin" | "operator" for client accounts, "quadrum" for Quadrum admins.
  holderRole: { type: String, required: true },
  reason: { type: String, required: true, maxlength: 200 },
  idleMinutes: { type: Number, required: true },
  startedAt: { type: Date, required: true },
  lastActionAt: { type: Date, required: true },
  hardEndsAt: { type: Date, required: true },
});

const ControlLease = mongoose.model("ControlLease", controlLeaseSchema);

module.exports = { ControlLease };

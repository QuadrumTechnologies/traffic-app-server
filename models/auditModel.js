const mongoose = require("mongoose");

const auditLogSchema = new mongoose.Schema({
  userType: {
    type: String,
    enum: ["user", "admin"],
    required: true,
  },
  email: {
    type: String,
    required: true,
  },
  endpoint: {
    type: String,
    required: true,
  },
  reason: {
    type: String,
    required: true,
  },
  status: {
    type: String,
    enum: ["success", "failure"],
    required: true,
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
});
const AuditLog = mongoose.model("AuditLog", auditLogSchema);
module.exports = { AuditLog };

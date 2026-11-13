const mongoose = require("mongoose");

// Someone without an account asking for access, a demo, a quote or a
// partnership, from the dashboard's "Request access" page.
const accessRequestSchema = new mongoose.Schema(
  {
    purpose: {
      type: String,
      enum: ["demo", "access", "buy", "partner"],
      required: true,
    },
    company: { type: String, trim: true, maxlength: 120 },
    name: { type: String, trim: true, maxlength: 80 },
    email: { type: String, trim: true, lowercase: true, maxlength: 120 },
    phone: { type: String, trim: true, maxlength: 20 },
    // What they bought, as typed (device IDs from the label or an order
    // reference), plus any device IDs recognised in it.
    devices: { type: String, trim: true, maxlength: 300 },
    deviceIds: [{ type: String }],
    message: { type: String, trim: true, maxlength: 1000 },
    status: {
      type: String,
      enum: ["new", "approved", "declined"],
      default: "new",
    },
    handledBy: String,
    handledAt: Date,
    note: { type: String, trim: true, maxlength: 500 },
    invitedRole: String,
  },
  { timestamps: true }
);

accessRequestSchema.index({ email: 1, createdAt: -1 });
accessRequestSchema.index({ status: 1, createdAt: -1 });

const AccessRequest = mongoose.model("AccessRequest", accessRequestSchema);

module.exports = { AccessRequest };

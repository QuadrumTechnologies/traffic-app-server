const mongoose = require("mongoose");

// A demo session: 24 hours on the demo junction for one visitor. MongoDB
// deletes it when expiresAt passes (TTL index); the nightly job does too.
const demoSessionSchema = new mongoose.Schema(
  {
    contact: { type: String, required: true },
    contactType: { type: String, enum: ["email", "phone"], required: true },
    name: { type: String, default: "" },
    company: { type: String, default: "" },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
  },
  { timestamps: true }
);

// A lead: one per email or phone, kept after its sessions expire, so Quadrum
// can follow up. Quadrum gets a daily summary, not one email per visitor.
const demoLeadSchema = new mongoose.Schema(
  {
    contact: { type: String, required: true, unique: true },
    contactType: { type: String, enum: ["email", "phone"], required: true },
    name: { type: String, default: "" },
    company: { type: String, default: "" },
    starts: { type: Number, default: 0 },
    firstAt: { type: Date },
    lastAt: { type: Date, index: true },
  },
  { timestamps: true }
);

const DemoSession = mongoose.model("DemoSession", demoSessionSchema);
const DemoLead = mongoose.model("DemoLead", demoLeadSchema);

module.exports = { DemoSession, DemoLead };

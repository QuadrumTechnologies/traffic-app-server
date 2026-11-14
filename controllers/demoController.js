const jwt = require("jsonwebtoken");
const catchAsync = require("../utils/catchAsync");
const Email = require("../utils/email");
const { DemoSession, DemoLead } = require("../models/demoModel");
const { DEMO_DEVICE_ID, DEMO_SESSION_HOURS, demoUser } = require("../utils/demo");

// "Try the demo": a visitor leaves an email address or a phone number and is
// in straight away, for 24 hours, on the shared demo junction only. No
// password, no account. Each start is saved as a lead; Quadrum gets one
// summary a day (see cronJobs.js).

const PER_CONTACT_PER_DAY = 5;
const NOTIFY_TO = () => process.env.ACCESS_REQUESTS_TO || "hello@quadrumtechnologies.com";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function text(value, max) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

// One field takes either: an email address, or a phone number.
function contactOf(raw) {
  const value = text(raw, 120);
  if (!value) return { error: "Enter your email address or phone number." };
  if (value.includes("@")) {
    const email = value.toLowerCase();
    return EMAIL_RE.test(email) ? { contact: email, contactType: "email" } : { error: "Check the email address." };
  }
  if (!/^[+0-9 ()-]{7,20}$/.test(value)) {
    return { error: "Enter a valid email address or phone number, for example +234 803 000 0000." };
  }
  const digits = value.replace(/[^0-9]/g, "");
  if (digits.length < 7 || digits.length > 15) {
    return { error: "Enter a valid email address or phone number, for example +234 803 000 0000." };
  }
  return { contact: (value.trim().startsWith("+") ? "+" : "") + digits, contactType: "phone" };
}

function signDemoToken(session) {
  return jwt.sign({ id: String(session._id), demo: true }, process.env.JWT_SECRET, {
    expiresIn: `${DEMO_SESSION_HOURS}h`,
  });
}

function presentUser(session) {
  const u = demoUser(session);
  return {
    _id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    isDemo: true,
    demoExpiresAt: u.demoExpiresAt,
  };
}

exports.startDemo = catchAsync(async (req, res) => {
  const body = req.body || {};
  // Bots fill the hidden field; they get a normal-looking answer and nothing else.
  if (text(body.website, 200)) {
    return res.status(201).json({ status: "success", message: "Demo started.", data: {} });
  }
  const parsed = contactOf(body.contact || body.email || body.phone);
  if (parsed.error) return res.status(400).json({ status: "error", message: parsed.error });

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recent = await DemoSession.countDocuments({ contact: parsed.contact, createdAt: { $gte: since } });
  if (recent >= PER_CONTACT_PER_DAY) {
    return res.status(429).json({
      status: "error",
      message: "You've started the demo several times today. Ask us for a guided demo instead.",
    });
  }

  const now = new Date();
  const name = text(body.name, 80);
  const company = text(body.company, 120);
  const session = await DemoSession.create({
    contact: parsed.contact,
    contactType: parsed.contactType,
    name,
    company,
    expiresAt: new Date(now.getTime() + DEMO_SESSION_HOURS * 60 * 60 * 1000),
  });

  const lead = await DemoLead.findOne({ contact: parsed.contact });
  if (lead) {
    lead.starts = (lead.starts || 0) + 1;
    lead.lastAt = now;
    if (name) lead.name = name;
    if (company) lead.company = company;
    await lead.save();
  } else {
    await DemoLead.create({
      contact: parsed.contact,
      contactType: parsed.contactType,
      name,
      company,
      starts: 1,
      firstAt: now,
      lastAt: now,
    });
  }

  res.status(201).json({
    status: "success",
    message: "Demo started.",
    data: {
      user: presentUser(session),
      token: signDemoToken(session),
      tokenExpiresIn: DEMO_SESSION_HOURS,
      deviceId: DEMO_DEVICE_ID,
    },
  });
});

// Quadrum admins: demo visitors, most recent first.
exports.listDemoLeads = catchAsync(async (req, res) => {
  const leads = await DemoLead.find({}).sort({ lastAt: -1 }).limit(200).lean();
  res.status(200).json({
    status: "success",
    data: {
      leads: leads.map((l) => ({
        contact: l.contact,
        contactType: l.contactType,
        name: l.name,
        company: l.company,
        starts: l.starts,
        firstAt: l.firstAt,
        lastAt: l.lastAt,
      })),
    },
  });
});

// The daily summary to hello@: who started the demo in the last 24 hours.
async function sendDemoSummary(now = new Date()) {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const leads = await DemoLead.find({ lastAt: { $gte: since } }).sort({ lastAt: -1 }).lean();
  if (!leads.length) return 0;
  try {
    await new Email({ email: NOTIFY_TO(), name: "Quadrum" }).sendDemoSummary(leads, since);
  } catch (error) {
    console.error("Demo summary email failed:", error.message);
  }
  return leads.length;
}

// MongoDB's TTL index removes expired sessions within a minute or so; this
// covers databases where the index isn't there yet.
async function removeExpiredDemoSessions(now = new Date()) {
  try {
    const result = await DemoSession.deleteMany({ expiresAt: { $lte: now } });
    return (result && result.deletedCount) || 0;
  } catch (error) {
    console.error("Removing expired demo sessions failed:", error.message);
    return 0;
  }
}

exports.sendDemoSummary = sendDemoSummary;
exports.removeExpiredDemoSessions = removeExpiredDemoSessions;
exports._contactOf = contactOf;

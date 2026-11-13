const catchAsync = require("../utils/catchAsync");
const Email = require("../utils/email");
const { AccessRequest } = require("../models/accessRequestModel");
const { AuditLog } = require("../models/auditModel");
const { inviteAccount } = require("./adminUsersController");

// Request access (public) and the Requests panel (Quadrum admins).

const PURPOSES = {
  demo: "Try the demo",
  access: "Access for junctions we bought",
  buy: "Buy or get a quote",
  partner: "Partner or integration",
};
const PER_EMAIL_PER_DAY = 3;
const NOTIFY_TO = () => process.env.ACCESS_REQUESTS_TO || "hello@quadrumtechnologies.com";

function text(value, max) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

// Device IDs on the label are 12 hex characters, e.g. CC7B5CBB1938.
function deviceIdsIn(textValue) {
  const found = String(textValue || "").toUpperCase().match(/\b[0-9A-F]{12}\b/g) || [];
  return [...new Set(found)].slice(0, 20);
}

function validate(body) {
  const input = {
    purpose: text(body.purpose, 20),
    company: text(body.company, 120),
    name: text(body.name, 80),
    email: text(body.email, 120).toLowerCase(),
    phone: text(body.phone, 20),
    devices: text(body.devices, 300),
    message: text(body.message, 1000),
  };
  if (!PURPOSES[input.purpose]) {
    return { error: "Choose what you need." };
  }
  if (input.email && !/^\S+@\S+\.\S+$/.test(input.email)) {
    return { error: "Enter a valid email address." };
  }
  if (input.phone && !/^[+0-9 ()-]{7,20}$/.test(input.phone)) {
    return { error: "Enter a valid phone number, for example +234 803 000 0000." };
  }
  if (input.purpose === "demo") {
    // A demo needs only a way to reach the person.
    if (!input.email && !input.phone) {
      return { error: "Enter your email address or phone number." };
    }
  } else {
    if (input.name.length < 2) return { error: "Enter your name." };
    if (input.company.length < 2) return { error: "Enter your company or organisation." };
    if (!input.email) return { error: "Enter your email address." };
  }
  input.deviceIds = deviceIdsIn(input.devices);
  return { input };
}

function present(r) {
  return {
    id: String(r._id),
    purpose: r.purpose,
    purposeLabel: PURPOSES[r.purpose] || r.purpose,
    company: r.company || "",
    name: r.name || "",
    email: r.email || "",
    phone: r.phone || "",
    devices: r.devices || "",
    deviceIds: r.deviceIds || [],
    message: r.message || "",
    status: r.status,
    createdAt: r.createdAt,
    handledBy: r.handledBy || null,
    handledAt: r.handledAt || null,
    note: r.note || "",
    invitedRole: r.invitedRole || null,
  };
}

async function audit(req, reason, status = "success") {
  try {
    await AuditLog.create({
      userType: "admin",
      email: req.user.email,
      endpoint: `${req.method} ${req.originalUrl}`,
      reason,
      status,
    });
  } catch (error) {
    console.error("Audit log write failed:", error.message);
  }
}

// POST /api/v1/access-requests (no sign-in)
exports.createRequest = catchAsync(async (req, res) => {
  const body = req.body || {};
  // Hidden field that people never see: bots fill it in. Answer as if it
  // worked and keep nothing.
  if (text(body.website, 200)) {
    return res.status(201).json({ status: "success", message: "Thanks. We'll be in touch." });
  }

  const { input, error } = validate(body);
  if (error) {
    return res.status(400).json({ status: "error", message: error });
  }

  if (input.email) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recent = await AccessRequest.countDocuments({ email: input.email, createdAt: { $gte: since } });
    if (recent >= PER_EMAIL_PER_DAY) {
      return res.status(429).json({
        status: "error",
        message: "We already have your requests from today. We'll reply soon.",
      });
    }
  }

  const request = await AccessRequest.create({ ...input, status: "new" });

  // Emails are best effort: the request is saved either way.
  try {
    await new Email({ email: NOTIFY_TO(), name: "Quadrum" }).sendAccessRequestNotice(present(request));
  } catch (e) {
    console.error("Access request notice failed:", e.message);
  }
  if (input.email) {
    try {
      await new Email({ email: input.email, name: input.name || "there" }).sendAccessRequestReceived(present(request));
    } catch (e) {
      console.error("Access request confirmation failed:", e.message);
    }
  }

  const reply =
    input.purpose === "demo"
      ? "Thanks. We'll set up your demo and contact you shortly."
      : "Thanks. We'll reply within one working day.";
  return res.status(201).json({ status: "success", message: reply });
});

// GET /api/v1/admin/access-requests?status=new|all
exports.listRequests = catchAsync(async (req, res) => {
  const status = String(req.query.status || "all");
  const filter = ["new", "approved", "declined"].includes(status) ? { status } : {};
  const requests = await AccessRequest.find(filter).sort({ createdAt: -1 }).limit(200).lean();
  return res.status(200).json({
    status: "success",
    data: { requests: requests.map(present) },
  });
});

// PATCH /api/v1/admin/access-requests/:id
//   { action: "approve", role }  invites the person (client admin by default)
//   { action: "decline", note }  optional note emailed to them
exports.updateRequest = catchAsync(async (req, res) => {
  const request = await AccessRequest.findById(req.params.id);
  if (!request) {
    return res.status(404).json({ status: "error", message: "No such request." });
  }
  if (request.status !== "new") {
    return res.status(409).json({
      status: "error",
      message: `This request was already ${request.status}${request.handledBy ? ` by ${request.handledBy}` : ""}.`,
    });
  }
  const action = String((req.body && req.body.action) || "");

  if (action === "approve") {
    if (!request.email) {
      return res.status(400).json({
        status: "error",
        message: "This request has no email address. Contact them by phone, then invite them from Users.",
      });
    }
    const role = String(req.body.role || "admin");
    const name = request.name || request.email.split("@")[0];
    const { statusCode, body } = await inviteAccount(req, { name, email: request.email, role });
    // An existing account is fine: the request is answered either way.
    if (statusCode !== 201 && !(statusCode === 409 && /already has an account/.test(body.message))) {
      return res.status(statusCode).json(body);
    }
    request.status = "approved";
    request.invitedRole = statusCode === 201 ? role : null;
    request.handledBy = req.user.email;
    request.handledAt = new Date();
    await request.save();
    await audit(req, `Approved access request from ${request.email}${statusCode === 201 ? `, invited as ${role}` : " (account already existed)"}`);
    return res.status(200).json({
      status: "success",
      message:
        statusCode === 201
          ? `Approved. ${body.message}`
          : `Approved. ${request.email} already had an account, so no invitation was sent.`,
      data: { request: present(request), user: body.data ? body.data.user : null },
    });
  }

  if (action === "decline") {
    request.status = "declined";
    request.note = text(req.body.note, 500);
    request.handledBy = req.user.email;
    request.handledAt = new Date();
    await request.save();
    let emailed = false;
    if (request.email && request.note) {
      try {
        await new Email({ email: request.email, name: request.name || "there" }).sendAccessRequestDeclined(request.note);
        emailed = true;
      } catch (e) {
        console.error("Decline email failed:", e.message);
      }
    }
    await audit(req, `Declined access request from ${request.email || request.phone}`);
    return res.status(200).json({
      status: "success",
      message: emailed ? "Declined. Your note was emailed to them." : "Declined.",
      data: { request: present(request) },
    });
  }

  return res.status(400).json({ status: "error", message: "Choose approve or decline." });
});

exports.PURPOSES = PURPOSES;

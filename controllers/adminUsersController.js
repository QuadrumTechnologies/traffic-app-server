const crypto = require("crypto");
const catchAsync = require("../utils/catchAsync");
const Email = require("../utils/email");
const User = require("../models/userModel");
const AdminUser = require("../models/adminUserModel");
const { UserDevice, UserPhase, UserPattern, UserPlan } = require("../models/appModel");
const { AdminDevice } = require("../models/adminAppModel");
const { AuditLog } = require("../models/auditModel");
const {
  isHeld,
  describeLink,
  sameEmail,
  moveLibraryToPool,
  returnPurchasesToStock,
  deleteLink,
} = require("../utils/junctionRelease");

// People and roles (Users page). Quadrum admins see and manage every client
// account; organisations come later.

const ROLES = ["admin", "operator", "viewer"];
const ROLE_LABELS = {
  admin: "a client admin",
  operator: "an operator",
  viewer: "a viewer",
};
const INVITE_VALID_MS = 3 * 24 * 60 * 60 * 1000;

function statusOf(user) {
  if (user.active === false) return "paused";
  if (!user.lastLoginAt && user.invitedAt) return "invited";
  return "active";
}

// What a person holds: active junctions, junctions on their way out (in trash
// or recalled, with the release date), junctions bought under their email in
// this department, and how much saved timing they have.
function emptySummary() {
  return { junctions: 0, held: [], purchases: [], library: { phases: 0, patterns: 0, plans: 0 } };
}

async function summaries(department) {
  const byEmail = new Map();
  const get = (email) => {
    const key = String(email || "").trim().toLowerCase();
    if (!byEmail.has(key)) byEmail.set(key, emptySummary());
    return byEmail.get(key);
  };

  const links = await UserDevice.find({}).lean();
  links.forEach((link) => {
    const s = get(link.email);
    if (isHeld(link)) s.held.push(describeLink(link));
    else s.junctions += 1;
  });

  const devices = await AdminDevice.find({ deviceDepartment: department }).lean();
  devices.forEach((device) => {
    const status = device.deviceStatus || {};
    if (status.status === "purchased" && status.ownerEmail) {
      get(status.ownerEmail).purchases.push(device.deviceId);
    }
  });

  for (const [Model, field] of [[UserPhase, "phases"], [UserPattern, "patterns"], [UserPlan, "plans"]]) {
    const docs = await Model.find({}).lean();
    docs.forEach((doc) => {
      if (String(doc.email).startsWith("pool:")) return;
      get(doc.email).library[field] += (doc[field] || []).length;
    });
  }
  return (email) => byEmail.get(String(email || "").trim().toLowerCase()) || emptySummary();
}

async function summaryFor(user, department) {
  return (await summaries(department))(user.email);
}

function present(user, summary = emptySummary()) {
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role || "admin",
    status: statusOf(user),
    verified: Boolean(user.verified),
    lastLoginAt: user.lastLoginAt || null,
    invitedAt: user.invitedAt || null,
    invitedBy: user.invitedBy || null,
    pausedAt: user.pausedAt || null,
    pausedBy: user.pausedBy || null,
    junctions: summary.junctions,
    held: summary.held,
    purchases: summary.purchases,
    library: summary.library,
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

// A password nobody knows: invited people choose theirs from the emailed link.
function placeholderPassword() {
  return `Qt-${crypto.randomBytes(18).toString("base64url")}9!`;
}

exports.listUsers = catchAsync(async (req, res) => {
  const users = await User.find({}).select("+active +verified").sort({ name: 1 });
  const summaryOf = await summaries(req.user.department);
  const admins = await AdminUser.find({}).sort({ name: 1 });

  return res.status(200).json({
    status: "success",
    data: {
      users: users.map((u) => present(u, summaryOf(u.email))),
      admins: admins.map((a) => ({
        id: String(a._id),
        name: a.name,
        email: a.email,
        department: a.department,
        lastLoginAt: a.lastLoginAt || null,
        isYou: String(a._id) === String(req.user._id),
      })),
    },
  });
});

// Create an invited account and email the set-password link. Shared by the
// Invite form and by approving an access request. Returns { statusCode, body }.
async function inviteAccount(req, input) {
  const name = String(input.name || "").trim();
  const email = String(input.email || "").trim().toLowerCase();
  const role = String(input.role || "operator");

  if (!name || !/^\S+@\S+\.\S+$/.test(email)) {
    return { statusCode: 400, body: { status: "error", message: "Enter the person's name and email address." } };
  }
  if (!ROLES.includes(role)) {
    return { statusCode: 400, body: { status: "error", message: "Choose a role: admin, operator or viewer." } };
  }
  if (await User.findOne({ email })) {
    return { statusCode: 409, body: { status: "error", message: `${email} already has an account.` } };
  }
  if (await AdminUser.findOne({ email })) {
    return { statusCode: 409, body: { status: "error", message: `${email} is a Quadrum admin account.` } };
  }

  const password = placeholderPassword();
  const user = new User({
    name,
    email,
    password,
    confirmPassword: password,
    role,
    verified: false,
    invitedAt: new Date(),
    invitedBy: req.user.email,
  });
  const token = user.genPasswordResetToken(INVITE_VALID_MS);
  await user.save();

  const url = `${process.env.CLIENT_URL}/reset_password/${token}`;
  try {
    await new Email(user, url).sendInvite(ROLE_LABELS[role]);
  } catch (error) {
    console.error("Invite email failed:", error.message);
    await User.findByIdAndDelete(user._id);
    await audit(req, `Invite to ${email} failed: email not sent`, "failure");
    return {
      statusCode: 502,
      body: {
        status: "error",
        message: `The invitation email to ${email} couldn't be sent, so no account was created. Try again later.`,
      },
    };
  }

  await audit(req, `Invited ${email} as ${role}`);
  const saved = await User.findById(user._id).select("+active +verified");
  return {
    statusCode: 201,
    body: {
      status: "success",
      message: `Invitation sent to ${email}.`,
      data: { user: present(saved) },
    },
  };
}
exports.inviteAccount = inviteAccount;

exports.inviteUser = catchAsync(async (req, res) => {
  const { statusCode, body } = await inviteAccount(req, req.body || {});
  return res.status(statusCode).json(body);
});

exports.updateUser = catchAsync(async (req, res) => {
  const user = await User.findById(req.params.id).select("+active +verified");
  if (!user) {
    return res.status(404).json({ status: "error", message: "No such account." });
  }

  const changes = [];
  if (req.body.role !== undefined) {
    if (!ROLES.includes(req.body.role)) {
      return res.status(400).json({ status: "error", message: "Choose a role: admin, operator or viewer." });
    }
    if ((user.role || "admin") !== req.body.role) {
      changes.push(`role ${user.role || "admin"} → ${req.body.role}`);
      user.role = req.body.role;
    }
  }
  if (req.body.active !== undefined) {
    if (typeof req.body.active !== "boolean") {
      return res.status(400).json({ status: "error", message: "active must be true or false." });
    }
    if (user.active !== req.body.active) {
      user.active = req.body.active;
      if (req.body.active) {
        changes.push("resumed");
        user.pausedAt = undefined;
        user.pausedBy = undefined;
      } else {
        changes.push("paused");
        user.pausedAt = new Date();
        user.pausedBy = req.user.email;
      }
    }
  }
  if (changes.length === 0) {
    return res.status(200).json({
      status: "success",
      message: "Nothing to change.",
      data: { user: present(user, await summaryFor(user, req.user.department)) },
    });
  }

  await user.save({ validateBeforeSave: false });
  await audit(req, `${user.email}: ${changes.join(", ")}`);
  return res.status(200).json({
    status: "success",
    message: `${user.name}: ${changes.join(", ")}.`,
    data: { user: present(user, await summaryFor(user, req.user.department)) },
  });
});

exports.sendPasswordReset = catchAsync(async (req, res) => {
  const user = await User.findById(req.params.id).select("+active +verified");
  if (!user) {
    return res.status(404).json({ status: "error", message: "No such account." });
  }
  if (user.active === false) {
    return res.status(409).json({ status: "error", message: `${user.name}'s account is paused. Resume it first.` });
  }

  // An invited person who never signed in gets a fresh invitation instead.
  const isInvite = !user.lastLoginAt && Boolean(user.invitedAt);
  const token = user.genPasswordResetToken(isInvite ? INVITE_VALID_MS : undefined);
  await user.save({ validateBeforeSave: false });
  const url = `${process.env.CLIENT_URL}/reset_password/${token}`;
  try {
    if (isInvite) {
      await new Email(user, url).sendInvite(ROLE_LABELS[user.role || "admin"]);
    } else {
      await new Email(user, url).sendPasswordReset();
    }
  } catch (error) {
    console.error("Reset email failed:", error.message);
    user.passwordResetToken = undefined;
    user.passwordResetTokenExpiresIn = undefined;
    await user.save({ validateBeforeSave: false });
    await audit(req, `${isInvite ? "Invitation" : "Password reset"} for ${user.email} failed: email not sent`, "failure");
    return res.status(502).json({ status: "error", message: `The email to ${user.email} couldn't be sent. Try again later.` });
  }

  await audit(req, `${isInvite ? "Re-sent invitation" : "Sent password reset"} to ${user.email}`);
  return res.status(200).json({
    status: "success",
    message: isInvite
      ? `A new invitation was sent to ${user.email}.`
      : `A password reset link was sent to ${user.email}. It works for 1 hour.`,
  });
});

// Remove an account. Refused while the person still has active junctions.
// Junctions in trash or recalled are released at once. Their saved timing is
// not deleted: it moves to Quadrum's pool with the junctions. With
// returnToStock, junctions bought under their email go back to "available".
exports.removeUser = catchAsync(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) {
    return res.status(404).json({ status: "error", message: "No such account." });
  }
  const links = (await UserDevice.find({}).lean()).filter((l) => sameEmail(l.email, user.email));
  const active = links.filter((l) => !isHeld(l));
  if (active.length > 0) {
    const n = active.length;
    return res.status(409).json({
      status: "error",
      message: `${user.name} still has ${n} active junction${n === 1 ? "" : "s"} (${active
        .map((l) => l.deviceId)
        .join(", ")}). Recall ${n === 1 ? "it" : "them"} first, or pause the account instead.`,
    });
  }
  const returnToStock =
    (req.body && req.body.returnToStock === true) || req.query?.returnToStock === "1";

  const kept = await moveLibraryToPool(user.email, req.user.department);
  for (const link of links) await deleteLink(link);
  const restocked = returnToStock ? await returnPurchasesToStock(user.email, req.user.department) : [];

  await Promise.all([
    UserPhase.deleteMany({ email: user.email }),
    UserPattern.deleteMany({ email: user.email }),
    UserPlan.deleteMany({ email: user.email }),
  ]);
  await User.findByIdAndDelete(user._id);

  const released = links.map((l) => l.deviceId);
  const { phases, patterns, plans } = kept.counts;
  const keptText =
    phases + patterns + plans > 0
      ? `Kept in Quadrum's pool: ${phases} phase${phases === 1 ? "" : "s"}, ${patterns} pattern${patterns === 1 ? "" : "s"}, ${plans} plan${plans === 1 ? "" : "s"}.`
      : "";
  await audit(
    req,
    [
      `Removed ${user.email}`,
      released.length ? `released ${released.join(", ")}` : "",
      phases + patterns + plans > 0 ? `timing to pool (${phases}/${patterns}/${plans})` : "",
      restocked.length ? `back in stock ${restocked.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("; ")
  );
  return res.status(200).json({
    status: "success",
    message: [
      `${user.name}'s account was removed.`,
      released.length ? `Released ${released.join(", ")}.` : "",
      keptText,
      restocked.length ? `Back in stock: ${restocked.join(", ")}.` : "",
    ]
      .filter(Boolean)
      .join(" "),
    data: { released, kept: kept.counts, restocked },
  });
});

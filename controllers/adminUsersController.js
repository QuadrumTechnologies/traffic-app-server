const crypto = require("crypto");
const catchAsync = require("../utils/catchAsync");
const Email = require("../utils/email");
const User = require("../models/userModel");
const AdminUser = require("../models/adminUserModel");
const { UserDevice, UserPhase, UserPattern, UserPlan } = require("../models/appModel");
const { AuditLog } = require("../models/auditModel");

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

function present(user, deviceCount) {
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
    junctions: deviceCount || 0,
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
  const counts = await UserDevice.aggregate([
    { $group: { _id: { $toLower: "$email" }, n: { $sum: 1 } } },
  ]);
  const devicesByEmail = new Map(counts.map((c) => [c._id, c.n]));
  const admins = await AdminUser.find({}).sort({ name: 1 });

  return res.status(200).json({
    status: "success",
    data: {
      users: users.map((u) => present(u, devicesByEmail.get(String(u.email).toLowerCase()))),
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

exports.inviteUser = catchAsync(async (req, res) => {
  const name = String(req.body.name || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();
  const role = String(req.body.role || "operator");

  if (!name || !/^\S+@\S+\.\S+$/.test(email)) {
    return res.status(400).json({ status: "error", message: "Enter the person's name and email address." });
  }
  if (!ROLES.includes(role)) {
    return res.status(400).json({ status: "error", message: "Choose a role: admin, operator or viewer." });
  }
  if (await User.findOne({ email })) {
    return res.status(409).json({ status: "error", message: `${email} already has an account.` });
  }
  if (await AdminUser.findOne({ email })) {
    return res.status(409).json({ status: "error", message: `${email} is a Quadrum admin account.` });
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
    return res.status(502).json({
      status: "error",
      message: `The invitation email to ${email} couldn't be sent, so no account was created. Try again later.`,
    });
  }

  await audit(req, `Invited ${email} as ${role}`);
  const saved = await User.findById(user._id).select("+active +verified");
  return res.status(201).json({
    status: "success",
    message: `Invitation sent to ${email}.`,
    data: { user: present(saved, 0) },
  });
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
    return res.status(200).json({ status: "success", message: "Nothing to change.", data: { user: present(user) } });
  }

  await user.save({ validateBeforeSave: false });
  await audit(req, `${user.email}: ${changes.join(", ")}`);
  const junctions = await UserDevice.countDocuments({ email: user.email });
  return res.status(200).json({
    status: "success",
    message: `${user.name}: ${changes.join(", ")}.`,
    data: { user: present(user, junctions) },
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

exports.removeUser = catchAsync(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) {
    return res.status(404).json({ status: "error", message: "No such account." });
  }
  const junctions = await UserDevice.countDocuments({ email: user.email });
  if (junctions > 0) {
    return res.status(409).json({
      status: "error",
      message: `${user.name} still has ${junctions} junction${junctions === 1 ? "" : "s"}. Move or recall ${junctions === 1 ? "it" : "them"} first, or pause the account instead.`,
    });
  }

  await Promise.all([
    UserPhase.deleteMany({ email: user.email }),
    UserPattern.deleteMany({ email: user.email }),
    UserPlan.deleteMany({ email: user.email }),
  ]);
  await User.findByIdAndDelete(user._id);
  await audit(req, `Removed ${user.email}`);
  return res.status(200).json({ status: "success", message: `${user.name}'s account was removed.` });
});

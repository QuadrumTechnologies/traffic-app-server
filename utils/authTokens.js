const jwt = require("jsonwebtoken");
const User = require("../models/userModel");
const AdminUser = require("../models/adminUserModel");

// Users and admins sign in with tokens signed by the same JWT_SECRET, and a
// token only carries the account id. Look the id up in both collections.
// Returns { user, isAdmin } for an active account, or null.
async function resolveToken(token) {
  if (!token) return null;

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    return null;
  }
  if (!decoded || !decoded.id) return null;

  const user = await User.findById(decoded.id).select("+active");
  if (user) {
    return user.active === false ? null : { user, isAdmin: false };
  }

  const admin = await AdminUser.findById(decoded.id).select("+active");
  if (admin) {
    return admin.active === false ? null : { user: admin, isAdmin: true };
  }

  return null;
}

function tokenFromRequest(req) {
  const header = req.headers.authorization;
  if (header && header.startsWith("Bearer ")) return header.split(" ")[1];
  return req.cookies ? req.cookies.jwt : undefined;
}

module.exports = { resolveToken, tokenFromRequest };

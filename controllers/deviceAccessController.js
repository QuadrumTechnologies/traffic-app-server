const catchAsync = require("../utils/catchAsync");
const { resolveToken, tokenFromRequest } = require("../utils/authTokens");
const { canAccessDevice } = require("../utils/deviceAccess");

// Accepts a signed-in user or a signed-in admin.
exports.authenticateAny = catchAsync(async (req, res, next) => {
  const account = await resolveToken(tokenFromRequest(req));
  if (!account) {
    return res.status(401).json({
      status: "error",
      message: "Please log in to continue.",
    });
  }
  if (account.isDemo && req.method !== "GET") {
    return res.status(403).json({ status: "error", message: "That isn't part of the demo." });
  }
  req.user = account.user;
  req.isAdmin = account.isAdmin;
  next();
});

// Only the device's owner, or an admin of its department, gets through.
exports.requireDeviceAccess = (paramName) =>
  catchAsync(async (req, res, next) => {
    const deviceId = req.params[paramName];
    const allowed = await canAccessDevice(
      { user: req.user, isAdmin: req.isAdmin },
      deviceId
    );
    if (!allowed) {
      return res.status(403).json({
        status: "error",
        message: `You don't have access to device ${deviceId}.`,
      });
    }
    next();
  });

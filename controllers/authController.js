const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const catchAsync = require("../utils/catchAsync");
const AppError = require("../utils/appError");
const Email = require("../utils/email");
const User = require("../models/userModel");

const signToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN,
  });

const createSendToken = (user, statusCode, req, res) => {
  const token = signToken(user._id);

  const cookieOptions = {
    expires: new Date(
      Date.now() + process.env.JWT_COOKIE_EXPIRES_IN * 60 * 60 * 1000
    ),
    httpOnly: true,
  };

  if (process.env.NODE_ENV === "production") {
    cookieOptions.secure = true;
    cookieOptions.sameSite = "strict";
  }

  res.cookie("jwt", token, cookieOptions);

  user.password = undefined;
  user.verified = undefined;
  user.__v = undefined;

  return res.status(statusCode).json({
    status: "success",
    message: "User logged in successfully.",
    data: {
      user,
      token,
      tokenExpiresIn: process.env.JWT_COOKIE_EXPIRES_IN,
    },
  });
};

const sendVerificationEmail = async (user, req, res) => {
  const emailVerificationToken = user.genEmailVerificationToken();
  await user.save({ validateBeforeSave: false });

  const emailVerificationUrl = `${process.env.CLIENT_URL}/verify_email/${emailVerificationToken}`;

  try {
    await new Email(user, emailVerificationUrl).sendEmailVerification();
    return res.status(201).json({
      status: "success",
      message: `A verification email has been sent to ${user.email}. Please check your inbox to verify your account.`,
    });
  } catch (error) {
    console.error("Error sending verification email:", error);
    await User.findByIdAndDelete(user._id);
    return res.status(500).json({
      status: "error",
      message: `Failed to send verification email to ${user.email}. Please try signing up again later.`,
    });
  }
};

exports.authenticateUser = catchAsync(async (req, res, next) => {
  console.log("Authenticating user");
  let token;

  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    token = authHeader.split(" ")[1];
  } else {
    token = req.cookies.jwt;
  }

  if (!token) {
    return res.status(401).json({
      status: "error",
      message: "No authentication token provided. Please log in to continue.",
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const currentUser = await User.findById(decoded.id);
    if (!currentUser) {
      return res.status(401).json({
        status: "error",
        message: "The user associated with this token no longer exists.",
      });
    }
    console.log("Current user:", currentUser.email);

    req.user = currentUser;
    next();
  } catch (error) {
    return res.status(401).json({
      status: "error",
      message: "Invalid authentication token. Please log in again.",
    });
  }
});

exports.signup = catchAsync(async (req, res, next) => {
  console.log("Signing up user:", req.body.email);

  const checkUser = await User.findOne({ email: req.body.email });
  if (checkUser) {
    return res.status(400).json({
      status: "error",
      message: `A user with the email ${req.body.email} already exists. Please use a different email or log in.`,
    });
  }

  const unverifiedUser = await User.create({
    name: req.body.name,
    title: req.body.title,
    email: req.body.email,
    password: req.body.password,
    confirmPassword: req.body.confirmPassword,
  });

  return await sendVerificationEmail(unverifiedUser, req, res);
});

exports.verifyEmail = catchAsync(async (req, res, next) => {
  const { emailVerificationToken } = req.params;
  const hashedToken = crypto
    .createHash("sha256")
    .update(emailVerificationToken)
    .digest("hex");

  const unverifiedUser = await User.findOne({
    emailVerificationToken: hashedToken,
    emailVerificationTokenExpiresIn: { $gt: Date.now() },
  });

  if (!unverifiedUser) {
    const userToDelete = await User.findOne({
      emailVerificationToken: hashedToken,
    });
    if (userToDelete) await User.findByIdAndDelete(userToDelete._id);
    return res.status(400).json({
      status: "error",
      message:
        "The email verification link is invalid or has expired. Please sign up again to receive a new link.",
    });
  }

  unverifiedUser.verified = true;
  unverifiedUser.emailVerificationToken = undefined;
  unverifiedUser.emailVerificationTokenExpiresIn = undefined;
  await unverifiedUser.save({ validateBeforeSave: false });

  return res.status(200).json({
    status: "success",
    message: "Email verified successfully. You can now log in to your account.",
  });
});

exports.login = catchAsync(async (req, res, next) => {
  const { email, password: claimedCorrectPassword } = req.body;

  if (!email || !claimedCorrectPassword) {
    return res.status(400).json({
      status: "error",
      message: "Please provide both email and password to log in.",
    });
  }

  const claimedUser = await User.findOne({ email }).select(
    "+password +verified +active"
  );
  if (
    !claimedUser ||
    !(await claimedUser.correctPassword(claimedCorrectPassword)) ||
    !claimedUser.active
  ) {
    return res.status(400).json({
      status: "error",
      message:
        "Incorrect email or password, or account is deactivated. Please check your credentials and try again.",
    });
  }

  if (!claimedUser.verified) {
    return res.status(400).json({
      status: "error",
      message:
        "Your email is not verified. Please check your inbox for the verification email.",
    });
  }

  createSendToken(claimedUser, 200, req, res);
});

exports.forgotPassword = catchAsync(async (req, res, next) => {
  const { email } = req.body;
  const user = await User.findOne({ email });

  if (!user) {
    return res.status(404).json({
      status: "error",
      message: `No user found with the email ${email}. Please check the email and try again.`,
    });
  }

  if (
    user.passwordResetToken &&
    user.passwordResetTokenExpiresIn > Date.now()
  ) {
    return res.status(400).json({
      status: "error",
      message:
        "A password reset link has already been sent. Please check your email or try again later.",
    });
  }

  const resetToken = user.genPasswordResetToken();
  await user.save({ validateBeforeSave: false });

  const resetPasswordUrl = `${process.env.CLIENT_URL}/reset_password/${resetToken}`;

  try {
    await new Email(user, resetPasswordUrl).sendPasswordReset();
    return res.status(200).json({
      status: "success",
      message: `A password reset link has been sent to ${user.email}. Please check your inbox.`,
    });
  } catch (error) {
    user.passwordResetToken = undefined;
    user.passwordResetTokenExpiresIn = undefined;
    await user.save({ validateBeforeSave: false });
    return res.status(500).json({
      status: "error",
      message: `Failed to send password reset email to ${user.email}. Please try again later.`,
    });
  }
});

exports.resetPassword = catchAsync(async (req, res, next) => {
  const { token } = req.params;
  const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

  const user = await User.findOne({
    passwordResetToken: hashedToken,
    passwordResetTokenExpiresIn: { $gt: Date.now() },
  });

  if (!user) {
    return res.status(400).json({
      status: "error",
      message:
        "The password reset token is invalid or has expired. Please request a new reset link.",
    });
  }

  const { password, confirmPassword } = req.body;
  if (!password || !confirmPassword) {
    return res.status(400).json({
      status: "error",
      message: "Please provide both new password and confirm password.",
    });
  }

  user.password = password;
  user.confirmPassword = confirmPassword;
  user.passwordResetToken = undefined;
  user.passwordResetTokenExpiresIn = undefined;
  await user.save();

  try {
    await new Email(
      user,
      `${process.env.CLIENT_URL}/login`
    ).sendPasswordResetSuccess();
    return res.status(200).json({
      status: "success",
      message:
        "Password reset successfully. You can now log in with your new password.",
    });
  } catch (error) {
    return res.status(500).json({
      status: "error",
      message:
        "Password reset successful, but failed to send confirmation email. You can now log in with your new password.",
    });
  }
});

exports.deactivateAccount = catchAsync(async (req, res, next) => {
  const { email } = req.body;
  const user = await User.findOne({ email });

  if (!user) {
    return res.status(404).json({
      status: "error",
      message: `No user found with the email ${email}. Please check the email and try again.`,
    });
  }

  user.active = false;
  await user.save();
  return res.status(200).json({
    status: "success",
    message: "Account deactivated successfully. You can reactivate it anytime.",
  });
});

exports.updatePassword = catchAsync(async (req, res, next) => {
  const { email, oldPassword, newPassword, confirmNewPassword } = req.body;

  if (!email || !oldPassword || !newPassword || !confirmNewPassword) {
    return res.status(400).json({
      status: "error",
      message:
        "Please provide email, old password, new password, and confirm new password.",
    });
  }

  const user = await User.findOne({ email }).select("+password");
  if (!user) {
    return res.status(404).json({
      status: "error",
      message: `No user found with the email ${email}. Please check the email and try again.`,
    });
  }

  if (!(await user.correctPassword(oldPassword))) {
    return res.status(401).json({
      status: "error",
      message: "The provided old password is incorrect. Please try again.",
    });
  }

  user.password = newPassword;
  user.confirmPassword = confirmNewPassword;
  await user.save({ validateBeforeSave: true });

  createSendToken(user, 200, req, res);
});

exports.reactivateAccount = catchAsync(async (req, res, next) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      status: "error",
      message:
        "Please provide both email and password to reactivate your account.",
    });
  }

  const user = await User.findOne({ email }).select("+password");
  if (!user) {
    return res.status(404).json({
      status: "error",
      message: `No user found with the email ${email}. Please check the email and try again.`,
    });
  }

  if (!(await user.correctPassword(password))) {
    return res.status(401).json({
      status: "error",
      message: "Incorrect password. Please try again.",
    });
  }

  user.active = true;
  await user.save();
  return res.status(200).json({
    status: "success",
    message: "Account reactivated successfully. You can now log in.",
  });
});

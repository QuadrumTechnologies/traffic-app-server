const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const validator = require("validator");
const { isPasswordValid } = require("../utils/validators");

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, "Name is required"],
  },
  email: {
    type: String,
    required: [true, "Email is required"],
    unique: true,
    lowercase: true,
    validate: [validator.isEmail, "Email is not valid"],
  },
  password: {
    type: String,
    required: [true, "Password is required"],
    min: [8, "MinLength should be 8"],
    validate: {
      validator: function () {
        return isPasswordValid(this.password); // False triggers an error
      },
      message:
        "Password must include a number, an alphabet character, a symbol, and an uppercase letter.",
    },
    select: false, // This doesn't work on create and save
  },
  confirmPassword: {
    type: String,
    required: [true, "Password is required"],
    validate: {
      // Custom validator. works on save and create.
      validator: function (el) {
        return el === this.password;
      },
      message: "Passwords does not match",
    },
    select: false,
  },
  verified: {
    type: Boolean,
    default: false,
    select: false,
  },
  active: {
    type: Boolean,
    default: true,
    select: false,
  },

  // What the account may do with the junctions it can see:
  //   admin    - everything, including adding junctions to the account
  //   operator - commands and timing changes
  //   viewer   - watch only
  // Accounts created before roles existed have no value and are treated as
  // admin, which is what they could do before.
  role: {
    type: String,
    enum: ["admin", "operator", "viewer"],
  },
  lastLoginAt: Date,
  invitedAt: Date,
  invitedBy: String,
  // Set when a Quadrum admin pauses the account (active: false).
  pausedAt: Date,
  pausedBy: String,

  passwordChangedAt: Date,
  passwordResetToken: String,
  passwordResetTokenExpiresIn: String,
  emailVerificationToken: String,
  emailVerificationTokenExpiresIn: String,
});

userSchema.pre("save", async function (next) {
  // Prevents the confirmPassword from entering DB
  this.confirmPassword = undefined;

  // If password path/field is unmodified (create or save) returns
  if (!this.isModified("password")) return next();

  // Salts and Hashes the password
  const hashedPassword = await bcrypt.hash(this.password, 12);
  this.password = hashedPassword;

  next();
});

// Update the passwordModifiedAt after password change
userSchema.pre("save", function (next) {
  if (!this.isModified("password") || this.isNew) return next();
  this.passwordChangedAt = Date.now() - 1000; // setting it to 1 sec in the past cause the actual saving might happen after jwt is issued
  next();
});

// Generates Email Verification token
userSchema.methods.genEmailVerificationToken = function () {
  const emailVerificationToken = crypto.randomBytes(32).toString("hex");
  this.emailVerificationToken = crypto
    .createHash("sha256")
    .update(emailVerificationToken)
    .digest("hex");
  this.emailVerificationTokenExpiresIn = Date.now() + 60 * 60 * 1000;
  return emailVerificationToken;
};

// Generates password reset token
// validForMs: 1 hour for a reset; invitations use longer (see adminUsersController).
userSchema.methods.genPasswordResetToken = function (validForMs = 60 * 60 * 1000) {
  const resetToken = crypto.randomBytes(32).toString("hex");
  this.passwordResetToken = crypto
    .createHash("sha256")
    .update(resetToken)
    .digest("hex");
  this.passwordResetTokenExpiresIn = Date.now() + validForMs;
  return resetToken;
};

userSchema.methods.effectiveRole = function () {
  return this.role || "admin";
};

userSchema.methods.correctPassword = async function (claimedPassword) {
  return await bcrypt.compare(claimedPassword, this.password);
};

const User = mongoose.model("User", userSchema);

module.exports = User;

const express = require("express");
const adminAuthController = require("../controllers/adminAuthController");
const {
  forgotPasswordValidator,
  resetPasswordValidator,
} = require("../utils/validators");

const router = express.Router();

// Normal Users Auth Routes
router.post("/signup", adminAuthController.signup);
router.post("/signin", adminAuthController.login);
router.patch(
  "/verifyEmail/:emailVerificationToken",
  adminAuthController.verifyEmail
);
router.post(
  "/forgotPassword",
  forgotPasswordValidator,
  adminAuthController.forgotPassword
);
router.patch(
  "/resetPassword/:token",
  resetPasswordValidator,
  adminAuthController.resetPassword
);

router.patch("/updatePassword", adminAuthController.updatePassword);

router.patch("/deactivateAccount", adminAuthController.deactivateAccount);

router.patch("/reactivateAccount", adminAuthController.reactivateAccount);

module.exports = router;

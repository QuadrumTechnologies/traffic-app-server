const express = require("express");
const authController = require("../controllers/authController");
const {
  forgotPasswordValidator,
  resetPasswordValidator,
} = require("../utils/validators");

const router = express.Router();

// Normal Users Auth Routes
router.post("/signup", authController.signup);
router.post("/signin", authController.login);
router.patch(
  "/verifyEmail/:emailVerificationToken",
  authController.verifyEmail
);
router.post(
  "/forgotPassword",
  forgotPasswordValidator,
  authController.forgotPassword
);
router.patch(
  "/resetPassword/:token",
  resetPasswordValidator,
  authController.resetPassword
);

router.patch("/updatePassword", authController.updatePassword);

router.patch("/deactivateAccount", authController.deactivateAccount);

router.patch("/reactivateAccount", authController.reactivateAccount);

module.exports = router;

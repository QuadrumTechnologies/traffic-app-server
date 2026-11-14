const express = require("express");
const rateLimit = require("express-rate-limit");
const demo = require("../controllers/demoController");
const { authenticateAdminUser } = require("../controllers/adminAuthController");

// Public: "Try the demo". Ten starts an hour from one network.
const publicRouter = express.Router();
const startLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: "error",
    message: "Too many demo starts from your network. Try again in an hour.",
  },
});
publicRouter.post("/start", startLimiter, demo.startDemo);

// Quadrum admins: who tried the demo.
const adminRouter = express.Router();
adminRouter.use(authenticateAdminUser);
adminRouter.get("/", demo.listDemoLeads);

module.exports = { publicRouter, adminRouter };

const express = require("express");
const rateLimit = require("express-rate-limit");
const accessRequests = require("../controllers/accessRequestController");
const { authenticateAdminUser } = require("../controllers/adminAuthController");

// Public: the Request access form. Five requests an hour from one address.
const publicRouter = express.Router();
const requestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: "error",
    message: "Too many requests from your network. Try again in an hour.",
  },
});
publicRouter.post("/", requestLimiter, accessRequests.createRequest);

// Quadrum admins: the Requests panel on the Users page.
const adminRouter = express.Router();
adminRouter.use(authenticateAdminUser);
adminRouter.get("/", accessRequests.listRequests);
adminRouter.patch("/:id", accessRequests.updateRequest);

module.exports = { publicRouter, adminRouter };

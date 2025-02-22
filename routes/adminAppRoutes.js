const express = require("express");
const router = express.Router();
const adminAppController = require("../controllers/adminAppController");
const { authenticateAdminUser } = require("../controllers/adminAuthController");

router.use(authenticateAdminUser);

router.post("/devices", adminAppController.addDeviceByAdminHandler);
router.delete(
  "/devices/:deviceId",
  adminAppController.deleteDeviceByAdminHandler
);
router.get(
  "/devices/:deviceDepartment",
  adminAppController.getAllDeviceByAdminHandler
);
router.post(
  "/confirm-password",
  adminAppController.confirmAdminPasswordHandler
);

module.exports = router;

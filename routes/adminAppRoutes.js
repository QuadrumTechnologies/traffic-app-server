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
router.patch(
  "/devices/:deviceId/status",
  adminAppController.updateDeviceStatusByAdminHandler
);
router.patch(
  "/devices/:deviceId/availability",
  adminAppController.restoreUserDeviceByAdminHandler
);

router.patch(
  "/devices/:deviceId/recall",
  adminAppController.recallUserDeviceByAdminHandler
);
router.patch(
  "/devices/:deviceId/assign",
  adminAppController.assignDeviceByAdminHandler
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

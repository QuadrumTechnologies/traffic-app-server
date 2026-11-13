const express = require("express");
const router = express.Router();
const adminAppController = require("../controllers/adminAppController");
const { authenticateAdminUser } = require("../controllers/adminAuthController");
const { AdminDevice } = require("../models/adminAppModel");

router.use(authenticateAdminUser);

// An admin works only on devices of their own department.
router.param("deviceId", async (req, res, next, deviceId) => {
  try {
    const device = await AdminDevice.findOne({ deviceId }).lean();
    if (device && device.deviceDepartment !== req.user.department) {
      return res.status(403).json({
        status: "error",
        message: `Device ${deviceId} belongs to another department.`,
      });
    }
    next();
  } catch (error) {
    next(error);
  }
});
router.param("deviceDepartment", (req, res, next, deviceDepartment) => {
  if (deviceDepartment !== req.user.department) {
    return res.status(403).json({
      status: "error",
      message: "You can only list devices of your own department.",
    });
  }
  next();
});

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

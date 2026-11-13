const express = require("express");
const router = express.Router();
const appController = require("../controllers/appController");

const { authenticateUser } = require("../controllers/authController");
const {
  authenticateAny,
  requireDeviceAccess,
} = require("../controllers/deviceAccessController");

// Junction info and state: the device's owner, or an admin of its department.
router.get(
  "/info/:deviceID",
  authenticateAny,
  requireDeviceAccess("deviceID"),
  appController.getDeviceInfoByDeviceIDHandler
);
router.get(
  "/state/:deviceID",
  authenticateAny,
  requireDeviceAccess("deviceID"),
  appController.getDeviceStateByDeviceIDHandler
);

// Junction link details: the owner, or an admin of the junction's department
// (without the device key).
router.get(
  "/user-devices/:deviceID",
  authenticateAny,
  requireDeviceAccess("deviceID"),
  appController.getDeviceFullDetailsByDeviceIDHandler
);

router.use(authenticateUser);

// Roles (see models/userModel.js): viewers read; operators change timing;
// admins also add, remove and share junctions.
const { roleOf } = require("../utils/deviceAccess");
const allow = (...roles) => (req, res, next) => {
  const role = roleOf(req.user);
  if (roles.includes(role)) return next();
  return res.status(403).json({
    status: "error",
    message:
      role === "viewer"
        ? "Your account can view junctions but not change them. Ask your admin if you need more."
        : "Only a client admin can do this. Ask your admin.",
  });
};
const OPERATE = allow("admin", "operator");
const OWN = allow("admin");

// The :email segment is kept for older dashboards; the signed-in user is used.
router.get("/devices/:deviceId/:email", appController.getDeviceDetailById);

router.post("/devices", OWN, appController.addDeviceByUserHandler);
router.get("/devices", appController.getAllDeviceByUserHandler);
router.patch(
  "/devices/:deviceId/availability",
  OWN,
  appController.deleteOrRestoreDeviceHandler
);

router.post("/phases", OPERATE, appController.addPhaseByUserHandler);
router.get("/phases", appController.getAllPhaseByUserHandler);
router.patch("/phases/:phaseId/:email", OPERATE, appController.updatePhaseByUserHandler);
router.delete("/phases/all/:email", OPERATE, appController.deleteAllPhasesByUserHandler);
router.delete(
  "/phases/:phaseId/:email",
  OPERATE,
  appController.deletePhaseByUserHandler
);

router.post("/patterns", OPERATE, appController.addPatternByUserHandler);
router.get("/patterns", appController.getAllPatternsByUserHandler);
router.delete(
  "/patterns/all/:email",
  OPERATE,
  appController.deleteAllPatternsByUserHandler
);
router.delete(
  "/patterns/:patternName/:email",
  OPERATE,
  appController.deletePatternByUserHandler
);
router.put(
  "/patterns/:patternName/:email",
  OPERATE,
  appController.editPatternByUserHandler
);

router.post("/plans", OPERATE, appController.addPlanByUserHandler);
router.put("/plans", OPERATE, appController.updatePlanByUserHandler);
router.get("/plans", appController.getAllPlansByUserHandler);
router.delete("/plans/all/:email", OPERATE, appController.deleteAllPlansByUserHandler);
router.delete("/plans/:planId/:email", OPERATE, appController.deletePlanByUserHandler);

router.post("/confirm-password", appController.confirmPasswordHandler);

router.patch(
  "/user-devices/:deviceID",
  OWN,
  appController.updateAllowAdminSupportHandler
);

module.exports = router;

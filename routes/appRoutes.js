const express = require("express");
const router = express.Router();
const appController = require("../controllers/appController");

const { authenticateUser } = require("../controllers/authController");

router.get("/devices/:deviceId/:email", appController.getDeviceDetailById);
router.get("/info/:deviceID", appController.getDeviceInfoByDeviceIDHandler);
router.get("/state/:deviceID", appController.getDeviceStateByDeviceIDHandler);

router.use(authenticateUser);

router.post("/devices", appController.addDeviceByUserHandler);
router.get("/devices", appController.getAllDeviceByUserHandler);
router.patch(
  "/devices/:deviceId/availability",
  appController.deleteOrRestoreDeviceHandler
);

router.post("/phases", appController.addPhaseByUserHandler);
router.get("/phases", appController.getAllPhaseByUserHandler);
router.patch("/phases/:phaseId/:email", appController.updatePhaseByUserHandler);
router.delete("/phases/all/:email", appController.deleteAllPhasesByUserHandler);
router.delete(
  "/phases/:phaseId/:email",
  appController.deletePhaseByUserHandler
);

router.post("/patterns", appController.addPatternByUserHandler);
router.get("/patterns", appController.getAllPatternsByUserHandler);
router.delete(
  "/patterns/all/:email",
  appController.deleteAllPatternsByUserHandler
);
router.delete(
  "/patterns/:patternName/:email",
  appController.deletePatternByUserHandler
);
router.put(
  "/patterns/:patternName/:email",
  appController.editPatternByUserHandler
);

router.post("/plans", appController.addPlanByUserHandler);
router.put("/plans", appController.updatePlanByUserHandler);
router.get("/plans", appController.getAllPlansByUserHandler);
router.delete("/plans/all/:email", appController.deleteAllPlansByUserHandler);
router.delete("/plans/:planId/:email", appController.deletePlanByUserHandler);

router.post("/confirm-password", appController.confirmPasswordHandler);

router.get(
  "/user-devices/:deviceID",
  appController.getDeviceFullDetailsByDeviceIDHandler
);
router.patch(
  "/user-devices/:deviceID",
  appController.updateAllowAdminSupportHandler
);

module.exports = router;

const express = require("express");
const router = express.Router();
const appController = require("../controllers/appController");

router.post("/devices", appController.addDeviceByUserHandler);
router.get("/devices/:email", appController.getAllDeviceByUserHandler);
router.get("/devices/:deviceId/:userEmail", appController.getDeviceDetailById);

router.post("/phases", appController.addPhaseByUserHandler);
router.get("/phases/:email", appController.getAllPhaseByUserHandler);
router.delete(
  "/phases/:phaseId/:email",
  appController.deletePhaseByUserHandler
);

router.post("/patterns", appController.addPatternByUserHandler);
router.get("/patterns/:email", appController.getAllPatternsByUserHandler);
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
router.get("/plans/:email", appController.getAllPlansByUserHandler);
router.delete("/plans/:planId/:email", appController.deletePlanByUserHandler);

router.post("/confirm-password", appController.confirmPasswordHandler);

router.get("/info/:deviceID", appController.getDeviceInfoByDeviceIDHandler);
router.get("/state/:deviceID", appController.getDeviceStateByDeviceIDHandler);

module.exports = router;

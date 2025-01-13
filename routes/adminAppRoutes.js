const express = require("express");
const router = express.Router();
const adminAppController = require("../controllers/adminAppController");

router.post("/devices", adminAppController.addDeviceByAdminHandler);
router.get(
  "/devices/:deviceDepartment",
  adminAppController.getAllDeviceByAdminHandler
);

module.exports = router;

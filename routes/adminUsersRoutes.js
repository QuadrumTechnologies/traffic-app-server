const express = require("express");
const router = express.Router();
const adminUsersController = require("../controllers/adminUsersController");
const { authenticateAdminUser } = require("../controllers/adminAuthController");

// People and roles: Quadrum admins only.
router.use(authenticateAdminUser);

router.get("/", adminUsersController.listUsers);
router.post("/", adminUsersController.inviteUser);
router.patch("/:id", adminUsersController.updateUser);
router.post("/:id/reset-password", adminUsersController.sendPasswordReset);
router.delete("/:id", adminUsersController.removeUser);

module.exports = router;

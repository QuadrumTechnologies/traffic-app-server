const { AdminDevice } = require("../models/adminAppModel");
const AdminUser = require("../models/adminUserModel");
const { UserDevice, UserDeviceInfo } = require("../models/appModel");
const { AuditLog } = require("../models/auditModel");
const User = require("../models/userModel");
const catchAsync = require("../utils/catchAsync");
const Email = require("../utils/email");

exports.confirmAdminPasswordHandler = catchAsync(async (req, res) => {
  const { password, reason } = req.body;

  if (!reason) {
    return res.status(400).json({
      message: "Reason for password confirmation is required.",
    });
  }

  const user = await AdminUser.findOne({ email: req.user.email }).select(
    "+password"
  );

  if (!user) {
    await AuditLog.create({
      userType: "admin",
      email,
      endpoint: "/admin/confirm-password",
      reason,
      status: "failure",
    });
    return res.status(404).json({
      message: "User not found.",
    });
  }

  const isPasswordCorrect = await user.correctPassword(password);

  if (!isPasswordCorrect) {
    await AuditLog.create({
      userType: "admin",
      email,
      endpoint: "/admin/confirm-password",
      reason,
      status: "failure",
    });
    return res.status(401).json({
      message: "Incorrect password.",
    });
  }

  await AuditLog.create({
    userType: "admin",
    email,
    endpoint: "/admin/confirm-password",
    reason,
    status: "success",
  });

  res.status(200).json({
    message: "Password confirmed.",
  });
});

exports.addDeviceByAdminHandler = catchAsync(async (req, res, next) => {
  console.log("Adding device", req.body);
  const {
    deviceId,
    deviceType,
    adminEmail,
    deviceStatus,
    ownerEmail,
    purchasedDate,
  } = req.body;

  if (!deviceId || !deviceType || !adminEmail) {
    return res.status(400).json({ message: "All fields are required." });
  }

  const existingDevice = await AdminDevice.findOne({ deviceId: deviceId });

  if (existingDevice) {
    return res.status(400).json({ message: "Device already exists." });
  }
  const department = adminEmail.slice(0, adminEmail.indexOf("@"));

  if (deviceStatus.value === "purchased" && (!ownerEmail || !purchasedDate)) {
    return res.status(400).json({
      message:
        "Owner email and purchase date are required for purchased devices.",
    });
  }

  const newDevice = await AdminDevice.create({
    deviceId,
    deviceType,
    adminEmail,
    deviceDepartment: department,
    deviceStatus: {
      status: deviceStatus.value,
      ownerEmail: deviceStatus.value === "purchased" ? ownerEmail : "",
      purchaseDate: deviceStatus.value === "purchased" ? purchasedDate : null,
    },
  });

  res.status(201).json({
    message: "Device added successfully",
    data: newDevice,
  });
});

exports.getAllDeviceByAdminHandler = catchAsync(async (req, res, next) => {
  console.log("Getting all devices", req.params);

  const { deviceDepartment } = req.params;

  // Fetch all admin devices in the specified department
  const adminDevices = await AdminDevice.find({
    deviceDepartment: deviceDepartment,
  }).lean();

  // Fetch corresponding user devices and device info by matching deviceId
  const devicesWithUserDataAndInfo = await Promise.all(
    adminDevices.map(async (adminDevice) => {
      const userDevice = await UserDevice.findOne({
        deviceId: adminDevice.deviceId,
      }).lean();
      const info = await UserDeviceInfo.findOne({
        DeviceID: adminDevice.deviceId,
      }).lean();
      return {
        ...adminDevice,
        userDevice: userDevice || null,
        info: info || null,
      };
    })
  );

  return res.status(200).json({
    message: "Devices fetched successfully.",
    devices: devicesWithUserDataAndInfo,
  });
});

exports.deleteDeviceByAdminHandler = catchAsync(async (req, res, next) => {
  console.log("Deleting device", req.params);
  const { deviceId } = req.params;

  if (!deviceId) {
    return res.status(400).json({ message: "Device ID is required." });
  }

  // Check if the device exists in AdminDevice
  const existingDevice = await AdminDevice.findOne({ deviceId });
  if (!existingDevice) {
    return res.status(404).json({ message: "Device not found." });
  }

  // Delete device from AdminDevice collection
  await AdminDevice.deleteOne({ deviceId });

  // Delete device from UserDevice collection
  await UserDevice.deleteOne({ deviceId });

  res.status(200).json({
    message: "Device deleted successfully.",
  });
});

exports.updateDeviceStatusByAdminHandler = catchAsync(
  async (req, res, next) => {
    console.log("Updating device status", req.params);
    const { deviceId } = req.params;
    const { status } = req.body;

    if (!deviceId) {
      return res.status(400).json({ message: "Device ID is required." });
    }

    // Validate status
    const validStatuses = ["active", "disabled", "recalled", "deleted"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: "Invalid status provided." });
    }

    // Check if the device exists
    const existingDevice = await UserDevice.findOne({ deviceId });

    if (!existingDevice) {
      return res.status(404).json({ message: "Device not found." });
    }

    // Ensure that device is recalled before deletion
    if (!existingDevice?.isTrash && status === "deleted") {
      return res
        .status(404)
        .json({ message: "Please recall device before deletion." });
    }

    // Update the device status
    existingDevice.status = status;
    await existingDevice.save();

    res.status(200).json({
      message: `Device status updated to ${status}.`,
    });
  }
);

exports.restoreUserDeviceByAdminHandler = catchAsync(async (req, res) => {
  console.log("Restoring device availability", req.params, req.body);
  const { deviceId } = req.params;
  const restoreDevice = req.body.restore === true;

  const device = await UserDevice.findOne({ deviceId: deviceId });
  if (!device) {
    return res.status(404).json({
      message: "Device not found.",
    });
  }

  device.isTrash = restoreDevice ? false : true;
  device.deleteAt = restoreDevice ? null : new Date();

  await device.save();

  try {
    const user = await User.findOne({ email: device.email });
    const email = new Email(user);
    if (restoreDevice) {
      await email.sendDeviceRestoredNotification();
    }
  } catch (error) {
    console.log("Error sending email:", error);
  }

  res.status(200).json({
    message: `Device ${restoreDevice ? "restored" : "deleted"} successfully.`,
    data: device,
  });
});

exports.recallUserDeviceByAdminHandler = catchAsync(async (req, res) => {
  console.log("Recalling device", req.params, req.body);
  const { deviceId } = req.params;
  const { recall } = req.body;

  const device = await UserDevice.findOne({ deviceId });
  if (!device) {
    return res.status(404).json({ message: "Device not found." });
  }

  if (recall) {
    device.isRecalled = true;
    device.recallAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    device.status = "recalled";
  } else {
    device.isRecalled = false;
    device.recallAt = null;
    device.status = "active";
  }

  await device.save();

  // The current date
  const recallDate = new Date();
  const autodeleteAt = new Date(recallDate);
  autodeleteAt.setDate(autodeleteAt.getDate() + 7);

  try {
    const user = await User.findOne({ email: device.email });
    const email = new Email(user);
    if (recall) {
      await email.sendDeviceRecallNotification({
        deviceId: deviceId,
        autodeleteAt: autodeleteAt.toISOString(),
      });
    } else {
      await email.sendDeviceUnRecallNotification({
        deviceId: deviceId,
      });
    }
  } catch (error) {
    console.log("Error sending email:", error);
  }

  res.status(200).json({
    message: "Device has been recalled and will be deleted in 7 days.",
    data: device,
  });
});

exports.assignDeviceByAdminHandler = catchAsync(async (req, res, next) => {
  console.log("Assigning device", req.body);
  const { deviceId, deviceStatus, ownerEmail, purchasedDate } = req.body;

  if (!deviceId || !deviceStatus || !ownerEmail || !purchasedDate) {
    return res.status(400).json({ message: "All fields are required." });
  }

  const unassignedDevice = await AdminDevice.findOne({ deviceId: deviceId });

  if (!unassignedDevice) {
    return res.status(400).json({ message: "Device does not exists." });
  }

  const user = await User.findOne({ email: ownerEmail });
  if (!user) {
    return res.status(404).json({ message: "Email not found." });
  }

  unassignedDevice.deviceStatus = {
    status: deviceStatus,
    ownerEmail,
    purchaseDate: purchasedDate,
  };
  unassignedDevice.save();

  const email = new Email(user);
  await email.sendDeviceAssignmentNotification({
    deviceId: deviceId,
  });

  res.status(201).json({
    message: "Device assigned successfully",
    data: unassignedDevice,
  });
});

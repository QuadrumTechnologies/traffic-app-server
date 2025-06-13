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
      status: "error",
      message: "Reason for password confirmation is required.",
    });
  }

  const user = await AdminUser.findOne({ email: req.user.email }).select(
    "+password"
  );
  if (!user) {
    await AuditLog.create({
      userType: "admin",
      email: req.user.email,
      endpoint: "/admin/confirm-password",
      reason,
      status: "failure",
    });
    return res.status(404).json({
      status: "error",
      message: "User not found.",
    });
  }

  const isPasswordCorrect = await user.correctPassword(password);
  if (!isPasswordCorrect) {
    await AuditLog.create({
      userType: "admin",
      email: req.user.email,
      endpoint: "/admin/confirm-password",
      reason,
      status: "failure",
    });
    return res.status(401).json({
      status: "error",
      message: "Incorrect password.",
    });
  }

  await AuditLog.create({
    userType: "admin",
    email: req.user.email,
    endpoint: "/admin/confirm-password",
    reason,
    status: "success",
  });

  res.status(200).json({
    status: "success",
    message: "Password confirmed successfully.",
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
    return res.status(400).json({
      status: "error",
      message: "All fields (deviceId, deviceType, adminEmail) are required.",
    });
  }

  const existingDevice = await AdminDevice.findOne({ deviceId });
  if (existingDevice) {
    return res.status(400).json({
      status: "error",
      message: `Device with ID ${deviceId} already exists.`,
    });
  }

  const department = adminEmail.slice(0, adminEmail.indexOf("@"));
  if (deviceStatus.value === "purchased" && (!ownerEmail || !purchasedDate)) {
    return res.status(400).json({
      status: "error",
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
    status: "success",
    message: `Device with ID ${deviceId} added successfully.`,
    data: newDevice,
  });
});

exports.getAllDeviceByAdminHandler = catchAsync(async (req, res, next) => {
  console.log("Getting all devices", req.params);
  const { deviceDepartment } = req.params;

  const adminDevices = await AdminDevice.find({ deviceDepartment }).lean();
  if (adminDevices.length === 0) {
    return res.status(200).json({
      status: "success",
      message: `No devices found for department ${deviceDepartment}.`,
      data: { devices: [] },
    });
  }

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

  res.status(200).json({
    status: "success",
    message: `Devices fetched successfully for department ${deviceDepartment}.`,
    data: { devices: devicesWithUserDataAndInfo },
  });
});

exports.deleteDeviceByAdminHandler = catchAsync(async (req, res, next) => {
  console.log("Deleting device", req.params);
  const { deviceId } = req.params;

  if (!deviceId) {
    return res.status(400).json({
      status: "error",
      message: "Device ID is required.",
    });
  }

  const existingDevice = await AdminDevice.findOne({ deviceId });
  if (!existingDevice) {
    return res.status(404).json({
      status: "error",
      message: `Device with ID ${deviceId} not found.`,
    });
  }

  await AdminDevice.deleteOne({ deviceId });
  await UserDevice.deleteOne({ deviceId });

  res.status(200).json({
    status: "success",
    message: `Device with ID ${deviceId} deleted successfully.`,
  });
});

exports.updateDeviceStatusByAdminHandler = catchAsync(
  async (req, res, next) => {
    console.log("Updating device status", req.params);
    const { deviceId } = req.params;
    const { status } = req.body;

    if (!deviceId) {
      return res.status(400).json({
        status: "error",
        message: "Device ID is required.",
      });
    }

    const validStatuses = ["active", "disabled", "recalled", "deleted"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        status: "error",
        message: `Invalid status provided. Valid options are: ${validStatuses.join(
          ", "
        )}.`,
      });
    }

    const existingDevice = await UserDevice.findOne({ deviceId });
    if (!existingDevice) {
      return res.status(404).json({
        status: "error",
        message: `Device with ID ${deviceId} not found.`,
      });
    }

    if (!existingDevice.isTrash && status === "deleted") {
      return res.status(400).json({
        status: "error",
        message: "Please recall device before deletion.",
      });
    }

    existingDevice.status = status;
    await existingDevice.save();

    res.status(200).json({
      status: "success",
      message: `Device with ID ${deviceId} status updated to ${status}.`,
      data: existingDevice,
    });
  }
);

exports.restoreUserDeviceByAdminHandler = catchAsync(async (req, res) => {
  console.log("Restoring device availability", req.params, req.body);
  const { deviceId } = req.params;
  const restoreDevice = req.body.restore === true;

  const device = await UserDevice.findOne({ deviceId });
  if (!device) {
    return res.status(404).json({
      status: "error",
      message: `Device with ID ${deviceId} not found.`,
    });
  }

  device.isTrash = restoreDevice ? false : true;
  device.deleteAt = restoreDevice ? null : new Date();

  await device.save();

  try {
    const user = await User.findOne({ email: device.email });
    if (user) {
      const email = new Email(user);
      if (restoreDevice) {
        await email.sendDeviceRestoredNotification();
      }
    }
  } catch (error) {
    console.error(`Error sending email for device ${deviceId}:`, error);
  }

  res.status(200).json({
    status: "success",
    message: `Device with ID ${deviceId} ${
      restoreDevice ? "restored" : "moved to trash"
    } successfully.`,
    data: device,
  });
});

exports.recallUserDeviceByAdminHandler = catchAsync(async (req, res) => {
  console.log("Recalling device", req.params, req.body);
  const { deviceId } = req.params;
  const { recall } = req.body;

  const device = await UserDevice.findOne({ deviceId });
  if (!device) {
    return res.status(404).json({
      status: "error",
      message: `Device with ID ${deviceId} not found.`,
    });
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

  const recallDate = new Date();
  const autodeleteAt = new Date(recallDate);
  autodeleteAt.setDate(autodeleteAt.getDate() + 7);

  try {
    const user = await User.findOne({ email: device.email });
    if (user) {
      const email = new Email(user);
      if (recall) {
        await email.sendDeviceRecallNotification({
          deviceId,
          autodeleteAt: autodeleteAt.toISOString(),
        });
      } else {
        await email.sendDeviceUnRecallNotification({ deviceId });
      }
    }
  } catch (error) {
    console.error(`Error sending email for device ${deviceId}:`, error);
  }

  res.status(200).json({
    status: "success",
    message: `Device with ID ${deviceId} ${
      recall ? "recalled and scheduled for deletion in 7 days" : "unrecalled"
    }.`,
    data: device,
  });
});

exports.assignDeviceByAdminHandler = catchAsync(async (req, res, next) => {
  console.log("Assigning device", req.body);
  const { deviceId, deviceStatus, ownerEmail, purchasedDate } = req.body;

  if (!deviceId || !deviceStatus || !ownerEmail || !purchasedDate) {
    return res.status(400).json({
      status: "error",
      message:
        "All fields (deviceId, deviceStatus, ownerEmail, purchasedDate) are required.",
    });
  }

  const unassignedDevice = await AdminDevice.findOne({ deviceId });
  if (!unassignedDevice) {
    return res.status(404).json({
      status: "error",
      message: `Device with ID ${deviceId} does not exist.`,
    });
  }

  const user = await User.findOne({ email: ownerEmail });
  if (!user) {
    return res.status(404).json({
      status: "error",
      message: `User with email ${ownerEmail} not found.`,
    });
  }

  unassignedDevice.deviceStatus = {
    status: deviceStatus,
    ownerEmail,
    purchaseDate: purchasedDate,
  };
  await unassignedDevice.save();

  try {
    const email = new Email(user);
    await email.sendDeviceAssignmentNotification({ deviceId });
  } catch (error) {
    console.error(
      `Error sending assignment email for device ${deviceId}:`,
      error
    );
  }

  res.status(201).json({
    status: "success",
    message: `Device with ID ${deviceId} assigned successfully to ${ownerEmail}.`,
    data: unassignedDevice,
  });
});

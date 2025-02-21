const { AdminDevice } = require("../models/adminAppModel");
const AdminUser = require("../models/adminUserModel");
const { UserDevice } = require("../models/appModel");

const catchAsync = require("../utils/catchAsync");

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
  });

  // Fetch corresponding user devices by matching deviceId
  const devicesWithUserData = await Promise.all(
    adminDevices.map(async (adminDevice) => {
      const userDevice = await UserDevice.findOne({
        deviceId: adminDevice.deviceId,
      });
      return {
        ...adminDevice.toObject(),
        userDevice, // Add user device data to admin device object
      };
    })
  );

  return res.status(200).json({
    message: "Devices fetched successfully.",
    devices: devicesWithUserData,
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

exports.confirmAdminPasswordHandler = catchAsync(async (req, res) => {
  const { email, password } = req.body;

  const user = await AdminUser.findOne({ email }).select("+password");

  if (!user) {
    return res.status(404).json({
      message: "User not found.",
    });
  }

  const isPasswordCorrect = await user.correctPassword(password);

  if (!isPasswordCorrect) {
    return res.status(401).json({
      message: "Incorrect password.",
    });
  }

  res.status(200).json({
    message: "Password confirmed.",
  });
});

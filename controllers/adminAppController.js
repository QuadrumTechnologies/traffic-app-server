const { AdminDevice } = require("../models/adminAppModel");
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

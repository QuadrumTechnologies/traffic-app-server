const { AdminDevice } = require("../models/adminAppModel");
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
  const start = adminEmail.lastIndexOf("@") + 1;
  const end = adminEmail.indexOf(".", start);
  const department = adminEmail.slice(start, end);

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
  console.log("Getting all devices");
  const { deviceDeparment } = req.params;
  const devices = await AdminDevice.find({ deviceDeparment });
  return res.status(200).json({
    devices,
  });
});

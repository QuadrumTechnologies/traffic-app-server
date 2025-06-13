const { AdminDevice } = require("../models/adminAppModel");
const {
  UserDevice,
  UserPhase,
  UserPattern,
  UserPlan,
  UserDeviceState,
  UserDeviceInfo,
} = require("../models/appModel");
const { AuditLog } = require("../models/auditModel");
const User = require("../models/userModel");
const catchAsync = require("../utils/catchAsync");
const Email = require("../utils/email");
const { generateSecretKey } = require("../utils/misc");

exports.getDeviceDetailById = catchAsync(async (req, res, next) => {
  console.log("Getting device detail by user");
  const { deviceId, email } = req.params;

  const existingDevice = await AdminDevice.findOne({ deviceId });
  if (!existingDevice) {
    return res.status(400).json({
      status: "error",
      message: `Invalid Device ID: ${deviceId}.`,
    });
  }
  if (existingDevice.deviceStatus.status !== "purchased") {
    return res.status(400).json({
      status: "error",
      message: `Device with ID ${deviceId} has not been purchased.`,
    });
  }

  if (
    existingDevice.deviceStatus.ownerEmail &&
    existingDevice.deviceStatus.ownerEmail.toLowerCase() !== email.toLowerCase()
  ) {
    return res.status(403).json({
      status: "error",
      message: `You are not authorized to access device with ID ${deviceId}.`,
    });
  }

  const device = {
    type: existingDevice.deviceType,
    id: existingDevice.deviceId,
    department: existingDevice.deviceDepartment,
  };

  res.status(200).json({
    status: "success",
    message: `Device details for ID ${deviceId} fetched successfully.`,
    data: device,
  });
});

exports.addDeviceByUserHandler = catchAsync(async (req, res, next) => {
  console.log("Adding device by user", req.user.email);
  const { deviceId, deviceType } = req.body;

  if (!deviceId || !deviceType || !req.user.email) {
    return res.status(400).json({
      status: "error",
      message: "All fields (deviceId, deviceType, email) are required.",
    });
  }

  const existingDevice = await UserDevice.findOne({ deviceId });
  const recognizedDevice = await AdminDevice.findOne({ deviceId });

  if (!recognizedDevice) {
    return res.status(400).json({
      status: "error",
      message: `Device with ID ${deviceId} is not recognized by admin.`,
    });
  }

  if (existingDevice) {
    return res.status(400).json({
      status: "error",
      message: `Device with ID ${deviceId} already exists.`,
    });
  }

  const secretKey = generateSecretKey();
  const newDevice = await UserDevice.create({
    deviceId,
    deviceType,
    email: req.user.email,
    secretKey,
  });

  res.status(201).json({
    status: "success",
    message: `Device with ID ${deviceId} added successfully.`,
    data: { ...newDevice.toObject(), secretKey: undefined },
  });
});

exports.getAllDeviceByUserHandler = catchAsync(async (req, res, next) => {
  console.log("Getting all devices by user", req.user.email);

  const devices = await UserDevice.find({
    email: req.user.email,
    isTrash: false,
  }).lean();
  if (devices.length === 0) {
    return res.status(200).json({
      status: "success",
      message: "No devices found for this user.",
      data: { devices: [] },
    });
  }

  const devicesWithInfo = await Promise.all(
    devices.map(async (device) => {
      const info = await UserDeviceInfo.findOne({
        DeviceID: device.deviceId,
      }).lean();
      return { ...device, info: info || null };
    })
  );

  res.status(200).json({
    status: "success",
    message: "Devices fetched successfully for this user.",
    data: { devices: devicesWithInfo },
  });
});

exports.addPhaseByUserHandler = catchAsync(async (req, res, next) => {
  console.log("Adding Phase by user", req.body);
  const { phaseName, phaseData, deviceId } = req.body;

  if (!deviceId) {
    return res.status(400).json({
      status: "error",
      message: "Device ID is required.",
    });
  }

  const userPhase = await UserPhase.findOne({ email: req.user.email });
  if (userPhase) {
    const existingPhase = userPhase.phases.find(
      (phase) => phase.name === phaseName && phase.deviceId === deviceId
    );
    if (existingPhase) {
      return res.status(400).json({
        status: "error",
        message: `Phase '${phaseName}' already exists for device ${deviceId}.`,
      });
    }
  }

  const phase = { name: phaseName, data: phaseData, deviceId };
  const updatedPhase = await UserPhase.findOneAndUpdate(
    { email: req.user.email },
    { $push: { phases: phase } },
    { upsert: true, new: true }
  );

  res.status(201).json({
    status: "success",
    message: `Phase '${phaseName}' added successfully for device ${deviceId}.`,
    data: updatedPhase.phases[updatedPhase.phases.length - 1],
  });
});

exports.getAllPhaseByUserHandler = catchAsync(async (req, res, next) => {
  console.log("Getting Phase by user", req.user);
  const phases = await UserPhase.findOne({ email: req.user.email });

  if (!phases || phases.phases.length === 0) {
    return res.status(200).json({
      status: "success",
      message: "No phases found for this user.",
      data: { phases: [] },
    });
  }

  res.status(200).json({
    status: "success",
    message: "Phases fetched successfully.",
    data: phases,
  });
});

exports.deletePhaseByUserHandler = catchAsync(async (req, res) => {
  console.log("Deleting phase by user", req.params);
  const { phaseId } = req.params;

  const updatedUser = await UserPhase.findOneAndUpdate(
    { email: req.user.email },
    { $pull: { phases: { _id: phaseId } } },
    { new: true }
  );

  if (!updatedUser) {
    return res.status(404).json({
      status: "error",
      message: "Phase not found or you don't have permission to delete it.",
    });
  }

  res.status(200).json({
    status: "success",
    message: "Phase deleted successfully.",
  });
});

exports.deleteAllPhasesByUserHandler = catchAsync(async (req, res) => {
  console.log("Deleting all phases for user", req.params);
  const { email } = req.params;

  if (!email) {
    return res.status(400).json({
      status: "error",
      message: "Email is required to delete all phases.",
    });
  }

  const updatedUser = await UserPhase.findOneAndUpdate(
    { email },
    { $set: { phases: [] } },
    { new: true }
  );

  if (!updatedUser) {
    return res.status(404).json({
      status: "error",
      message: "No phases found for this user.",
    });
  }

  res.status(200).json({
    status: "success",
    message: "All phases deleted successfully.",
  });
});

exports.addPatternByUserHandler = catchAsync(async (req, res) => {
  console.log("Adding pattern by user", req.body);
  const {
    name,
    configuredPhases,
    blinkEnabled,
    blinkTimeRedToGreen,
    blinkTimeGreenToRed,
    amberEnabled,
    amberDurationRedToGreen,
    amberDurationGreenToRed,
    deviceId,
  } = req.body;

  if (!deviceId) {
    return res.status(400).json({
      status: "error",
      message: "Device ID is required.",
    });
  }

  const user = await UserPhase.findOne({ email: req.user.email });
  if (!user) {
    return res.status(404).json({
      status: "error",
      message: "User not found.",
    });
  }

  const existingPattern = await UserPattern.findOne({
    email: req.user.email,
    "patterns.name": name,
    "patterns.deviceId": deviceId,
  });
  if (existingPattern) {
    return res.status(400).json({
      status: "error",
      message: `Pattern '${name}' already exists for device ${deviceId}.`,
    });
  }

  const pattern = {
    name,
    blinkEnabled,
    blinkTimeRedToGreen,
    blinkTimeGreenToRed,
    amberEnabled,
    amberDurationRedToGreen,
    amberDurationGreenToRed,
    configuredPhases: configuredPhases.map((phase, index) => ({
      name: phase.name,
      phaseId: phase.id,
      signalString: phase.signalString,
      duration: phase.duration,
      id: index,
      deviceId,
    })),
    deviceId,
  };

  await UserPattern.findOneAndUpdate(
    { email: req.user.email },
    { $push: { patterns: pattern } },
    { upsert: true }
  );

  res.status(201).json({
    status: "success",
    message: `Pattern '${name}' added successfully for device ${deviceId}.`,
  });
});

exports.getAllPatternsByUserHandler = catchAsync(async (req, res, next) => {
  console.log("Getting all patterns by user", req.user);
  const userPatterns = await UserPattern.findOne({ email: req.user.email });

  if (!userPatterns || userPatterns.patterns.length === 0) {
    return res.status(200).json({
      status: "success",
      message: "No patterns found for this user.",
      data: { patterns: [] },
    });
  }

  const populatedPatterns = userPatterns.patterns.map((pattern) => ({
    name: pattern.name,
    blinkEnabled: pattern.blinkEnabled,
    blinkTimeRedToGreen: pattern.blinkTimeRedToGreen,
    blinkTimeGreenToRed: pattern.blinkTimeGreenToRed,
    amberEnabled: pattern.amberEnabled,
    amberDurationRedToGreen: pattern.amberDurationRedToGreen,
    amberDurationGreenToRed: pattern.amberDurationGreenToRed,
    configuredPhases: pattern.configuredPhases.map((phase) => ({
      name: phase.name,
      phaseId: phase.phaseId,
      signalString: phase.signalString,
      duration: phase.duration,
      id: phase.id,
    })),
  }));

  res.status(200).json({
    status: "success",
    message: "Patterns fetched successfully.",
    data: { patterns: populatedPatterns },
  });
});

exports.deletePatternByUserHandler = catchAsync(async (req, res) => {
  console.log("Deleting pattern by user", req.params);
  const { patternName } = req.params;

  const updatedUser = await UserPattern.findOneAndUpdate(
    { email: req.user.email },
    { $pull: { patterns: { name: patternName } } },
    { new: true }
  );

  if (!updatedUser) {
    return res.status(404).json({
      status: "error",
      message: "Pattern not found or you don't have permission to delete it.",
    });
  }

  res.status(200).json({
    status: "success",
    message: `Pattern '${patternName}' deleted successfully.`,
  });
});

exports.deleteAllPatternsByUserHandler = catchAsync(async (req, res) => {
  console.log("Deleting all patterns for user", req.params);

  const { email } = req.params;

  if (!email) {
    return res.status(400).json({
      status: "error",
      message: "Email is required to delete all patterns.",
    });
  }

  const updatedUser = await UserPattern.findOneAndUpdate(
    { email },
    { $set: { patterns: [] } },
    { new: true }
  );

  if (!updatedUser) {
    return res.status(404).json({
      status: "error",
      message: "No patterns found for this user.",
    });
  }

  res.status(200).json({
    status: "success",
    message: "All patterns deleted successfully.",
  });
});

exports.editPatternByUserHandler = catchAsync(async (req, res) => {
  console.log("Editing pattern by user", req.params, req.body);
  const { patternName } = req.params;
  const { configuredPhases } = req.body;

  const patternToUpdate = await UserPattern.findOneAndUpdate(
    { email: req.user.email, "patterns.name": patternName },
    { $set: { "patterns.$.configuredPhases": configuredPhases } },
    { new: true }
  );

  if (!patternToUpdate) {
    return res.status(404).json({
      status: "error",
      message: "Pattern not found or you don't have permission to edit it.",
    });
  }

  res.status(200).json({
    status: "success",
    message: `Pattern '${patternName}' updated successfully.`,
    data: patternToUpdate,
  });
});

exports.addPlanByUserHandler = catchAsync(async (req, res) => {
  console.log("Adding or updating plan by user", req.body);
  const { id, name, schedule, dayType, customDate, deviceId } = req.body;

  if (!deviceId) {
    return res.status(400).json({
      status: "error",
      message: "Device ID is required.",
    });
  }

  let userPlan = await UserPlan.findOne({ email: req.user.email });
  if (!userPlan) {
    userPlan = new UserPlan({ email: req.user.email, plans: [] });
  }

  const existingPlanIndex = userPlan.plans.findIndex(
    (plan) => plan.name === name && plan.deviceId === deviceId
  );

  const newPlan = { id, name, dayType, schedule, customDate, deviceId };

  if (existingPlanIndex !== -1) {
    userPlan.plans[existingPlanIndex] = newPlan;
    await userPlan.save();
    res.status(200).json({
      status: "success",
      message: `Plan '${name}' overwritten successfully for device ${deviceId}.`,
      data: newPlan,
    });
  } else {
    userPlan.plans.push(newPlan);
    await userPlan.save();
    res.status(201).json({
      status: "success",
      message: `Plan '${name}' added successfully for device ${deviceId}.`,
      data: newPlan,
    });
  }
});

exports.updatePlanByUserHandler = catchAsync(async (req, res) => {
  console.log("Newly updating plan by user", req.body.data);
  const { id, name, data, dayType, customDate } = req.body;

  const user = await UserPhase.findOne({ email: req.user.email });
  if (!user) {
    return res.status(404).json({
      status: "error",
      message: "User not found.",
    });
  }

  for (const pattern of data) {
    const {
      name: patternName,
      config: {
        configuredPhases,
        blinkEnabled,
        blinkTimeRedToGreen,
        blinkTimeGreenToRed,
        amberEnabled,
        amberDurationRedToGreen,
        amberDurationGreenToRed,
      },
    } = pattern;

    const newPattern = {
      name: patternName,
      blinkEnabled,
      blinkTimeRedToGreen,
      blinkTimeGreenToRed,
      amberEnabled,
      amberDurationRedToGreen,
      amberDurationGreenToRed,
      configuredPhases: configuredPhases.map((phase, index) => ({
        name: phase.name,
        phaseId: phase.id,
        signalString: phase.signalString,
        duration: phase.duration,
        id: index,
      })),
    };

    await UserPattern.findOneAndUpdate(
      { email: req.user.email },
      { $push: { patterns: newPattern } },
      { upsert: true }
    );
  }

  function generateTimeSegments() {
    const segments = [];
    segments.push("00:00");
    let hour = 0;
    let minute = 31;
    while (hour < 24) {
      const time = `${hour.toString().padStart(2, "0")}:${minute
        .toString()
        .padStart(2, "0")}`;
      segments.push(time);
      minute += 30;
      if (minute >= 60) {
        minute -= 60;
        hour += 1;
      }
      if (hour >= 24) break;
    }
    return segments;
  }
  const timeSegments = generateTimeSegments();

  const generateSchedule = (plan) => {
    const schedule = {};
    timeSegments.forEach((segment) => {
      const matchingEntry = plan.find((entry) => entry.period === segment);
      schedule[segment] = matchingEntry
        ? { value: matchingEntry.name.toLowerCase(), label: matchingEntry.name }
        : null;
    });
    return schedule;
  };

  const newSchedule = generateSchedule(data);

  let userPlan = await UserPlan.findOne({ email: req.user.email });
  if (!userPlan) {
    userPlan = new UserPlan({ email: req.user.email, plans: [] });
  }

  const existingPlanIndex = userPlan.plans.findIndex(
    (plan) => plan.name.toLowerCase() === name.toLowerCase()
  );

  const newPlan = { id, name, dayType, schedule: newSchedule, customDate };

  if (existingPlanIndex !== -1) {
    userPlan.plans[existingPlanIndex] = newPlan;
    await userPlan.save();
    res.status(200).json({
      status: "success",
      message: `Plan '${name}' overwritten successfully.`,
      data: newPlan,
    });
  } else {
    userPlan.plans.push(newPlan);
    await userPlan.save();
    res.status(201).json({
      status: "success",
      message: `Plan '${name}' added successfully.`,
      data: newPlan,
    });
  }
});

exports.getAllPlansByUserHandler = catchAsync(async (req, res, next) => {
  console.log("Getting all plans by user", req.user);
  const userPlan = await UserPlan.findOne({ email: req.user.email });

  if (!userPlan || userPlan.plans.length === 0) {
    return res.status(200).json({
      status: "success",
      message: "No plans found for this user.",
      data: { plans: [] },
    });
  }

  res.status(200).json({
    status: "success",
    message: "Plans fetched successfully.",
    data: { plans: userPlan.plans },
  });
});

exports.deletePlanByUserHandler = catchAsync(async (req, res) => {
  console.log("Deleting plan by user", req.params);
  const { planId } = req.params;

  const userPlan = await UserPlan.findOne({ email: req.user.email });
  const planIndex = userPlan.plans.findIndex((plan) => plan.id === planId);

  if (planIndex === -1) {
    return res.status(404).json({
      status: "error",
      message: "Plan not found for this user.",
    });
  }

  userPlan.plans.splice(planIndex, 1);
  await userPlan.save();

  res.status(200).json({
    status: "success",
    message: "Plan deleted successfully.",
  });
});

exports.deleteAllPlansByUserHandler = catchAsync(async (req, res) => {
  console.log("Deleting all plans for user", req.params.email);
  const { email } = req.params;

  if (!email) {
    return res.status(400).json({
      status: "error",
      message: "Email is required to delete all plans.",
    });
  }

  const updatedUser = await UserPlan.findOneAndUpdate(
    { email },
    { $set: { plans: [] } },
    { new: true }
  );

  if (!updatedUser) {
    return res.status(404).json({
      status: "error",
      message: "No plans found for this user.",
    });
  }

  res.status(200).json({
    status: "success",
    message: "All plans deleted successfully.",
  });
});

exports.confirmPasswordHandler = catchAsync(async (req, res) => {
  console.log("Confirming password by user", req.body);
  const { password, reason } = req.body;

  if (!reason) {
    return res.status(400).json({
      status: "error",
      message: "Reason for password confirmation is required.",
    });
  }

  const user = await User.findOne({ email: req.user.email }).select(
    "+password"
  );
  if (!user) {
    await AuditLog.create({
      userType: "user",
      email: req.user.email,
      endpoint: "/confirm-password",
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
      userType: "user",
      email: req.user.email,
      endpoint: "/confirm-password",
      reason,
      status: "failure",
    });
    return res.status(401).json({
      status: "error",
      message: "Incorrect password.",
    });
  }

  await AuditLog.create({
    userType: "user",
    email: req.user.email,
    endpoint: "/confirm-password",
    reason,
    status: "success",
  });

  res.status(200).json({
    status: "success",
    message: "Password confirmed successfully.",
  });
});

exports.getDeviceInfoByDeviceIDHandler = catchAsync(async (req, res) => {
  const { deviceID } = req.params;

  const info = await UserDeviceInfo.findOne({ DeviceID: deviceID });
  if (!info) {
    return res.status(404).json({
      status: "error",
      message: `Device info for ID ${deviceID} does not exist.`,
    });
  }

  res.status(200).json({
    status: "success",
    message: `Device info for ID ${deviceID} fetched successfully.`,
    data: info,
  });
});

exports.getDeviceStateByDeviceIDHandler = catchAsync(async (req, res) => {
  const { deviceID } = req.params;

  const state = await UserDeviceState.findOne({ DeviceID: deviceID });
  if (!state) {
    return res.status(404).json({
      status: "error",
      message: `Device state for ID ${deviceID} not found.`,
    });
  }

  res.status(200).json({
    status: "success",
    message: `Device state for ID ${deviceID} fetched successfully.`,
    data: state,
  });
});

exports.getDeviceFullDetailsByDeviceIDHandler = catchAsync(async (req, res) => {
  console.log("Getting device full details by device ID", req.params);
  const { deviceID } = req.params;

  const device = await UserDevice.findOne({ deviceId: deviceID });
  if (!device) {
    return res.status(404).json({
      status: "error",
      message: `Device with ID ${deviceID} not found.`,
    });
  }

  res.status(200).json({
    status: "success",
    message: `Full details for device with ID ${deviceID} fetched successfully.`,
    data: device,
  });
});

exports.updateAllowAdminSupportHandler = catchAsync(async (req, res) => {
  console.log("Updating allowAdminSupport", req.params, req.body);
  const { deviceID } = req.params;
  const { allowAdminSupport } = req.body;

  const device = await UserDevice.findOne({ deviceId: deviceID });
  if (!device) {
    return res.status(404).json({
      status: "error",
      message: `Device with ID ${deviceID} not found.`,
    });
  }

  device.allowAdminSupport = allowAdminSupport;
  await device.save();

  res.status(200).json({
    status: "success",
    message: `Admin support status for device with ID ${deviceID} updated successfully.`,
    data: device,
  });
});

exports.deleteOrRestoreDeviceHandler = catchAsync(async (req, res) => {
  console.log("Updating device availability", req.params, req.body);
  const { deviceId } = req.params;
  const restoreDevice = req.body.restore === true;

  const device = await UserDevice.findOne({ deviceId });
  if (!device) {
    return res.status(404).json({
      status: "error",
      message: `Device with ID ${deviceId} not found.`,
    });
  }

  if (restoreDevice) {
    device.isTrash = false;
    device.deleteAt = null;
  } else {
    device.isTrash = true;
    device.deleteAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  }

  await device.save();

  try {
    const user = await User.findOne({ email: device.email });
    if (user) {
      const email = new Email(user);
      if (!restoreDevice) {
        await email.sendDeviceDeletedNotification();
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

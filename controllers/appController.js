const { AdminDevice } = require("../models/adminAppModel");
const {
  UserDevice,
  UserPhase,
  UserPattern,
  UserPlan,
  UserDeviceState,
  UserDeviceInfo,
} = require("../models/appModel");
const User = require("../models/userModel");
const catchAsync = require("../utils/catchAsync");
const Email = require("../utils/email");
const { generateSecretKey } = require("../utils/misc");

exports.getDeviceDetailById = catchAsync(async (req, res, next) => {
  console.log("Getting device detail by user");
  const { deviceId, email } = req.params;

  const existingDevice = await AdminDevice.findOne({ deviceId: deviceId });

  if (!existingDevice) {
    return res.status(400).json({ message: "Invalid Device ID" });
  }
  if (existingDevice.deviceStatus.status !== "purchased") {
    return res.status(400).json({ message: "Device has not been purchased." });
  }

  if (
    existingDevice.deviceStatus.ownerEmail &&
    existingDevice.deviceStatus.ownerEmail.toLowerCase() !== email.toLowerCase()
  ) {
    return res
      .status(403)
      .json({ message: "You are not authorized to add this device." });
  }
  const device = {
    type: existingDevice.deviceType,
    id: existingDevice.deviceId,
    department: existingDevice.deviceDepartment,
  };

  res.status(200).json({
    message: "Valid Device ID",
    device,
  });
});

exports.addDeviceByUserHandler = catchAsync(async (req, res, next) => {
  console.log("Adding device by user", req.user.email);
  const { deviceId, deviceType } = req.body;

  if (!deviceId || !deviceType || !req.user.email) {
    return res.status(400).json({ message: "All fields are required." });
  }

  const existingDevice = await UserDevice.findOne({ deviceId: deviceId });

  const recognizedDevice = await AdminDevice.findOne({ deviceId });

  if (!recognizedDevice) {
    return res.status(400).json({ message: "Device is not recognized" });
  }

  if (existingDevice) {
    return res.status(400).json({ message: "Device already exist." });
  }
  const secretKey = generateSecretKey();
  const newDevice = await UserDevice.create({
    deviceId,
    deviceType,
    email: req.user.email,
    secretKey,
  });

  res.status(201).json({
    message: "Device added successfully",
    data: {
      ...newDevice.toObject(),
      secretKey: undefined,
    },
  });
});

exports.getAllDeviceByUserHandler = catchAsync(async (req, res, next) => {
  console.log("Getting all devices by user", req.user.email);

  // Fetch devices for the user
  const devices = await UserDevice.find({
    email: req.user.email,
    isTrash: false,
  }).lean();

  // Fetch device info for each device
  const devicesWithInfo = await Promise.all(
    devices.map(async (device) => {
      const info = await UserDeviceInfo.findOne({
        DeviceID: device.deviceId,
      }).lean();
      return {
        ...device,
        info: info || null,
      };
    })
  );

  return res.status(200).json({
    devices: devicesWithInfo,
  });
});

exports.addPhaseByUserHandler = catchAsync(async (req, res, next) => {
  console.log("Adding Phase by user", req.body);

  const { phaseName, phaseData } = req.body;

  // Check if phases already exist for the user
  const userPhase = await UserPhase.findOne({ email: req.user.email });

  // Check for existing phase name
  if (userPhase) {
    const existingPhase = userPhase.phases.find(
      (phase) => phase.name === phaseName
    );

    if (existingPhase) {
      return res.status(400).json({
        message: `Phase with name "${phaseName}" already exists!`,
      });
    }
  }

  const phase = {
    name: phaseName,
    data: phaseData,
  };

  const updatedPhase = await UserPhase.findOneAndUpdate(
    { email: req.user.email },
    { $push: { phases: phase } },
    { upsert: true, new: true }
  );

  res.status(201).json({
    message: `Phase ${phaseName} added successfully!`,
    phase: updatedPhase.phases[updatedPhase.phases.length - 1],
  });
});

exports.getAllPhaseByUserHandler = catchAsync(async (req, res, next) => {
  console.log("Getting Phase by user", req.params);

  const phases = await UserPhase.findOne({ email: req.user.email });
  if (!phases || phases.length === 0) {
    return res.status(404).json({
      message: "No phase found for this user",
    });
  }
  res.status(200).json({
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
      message: "Phase not found or you don't have permission to delete it.",
    });
  }

  res.status(204).json({ message: "Phase successfully deleted." });
});

exports.deleteAllPhasesByUserHandler = catchAsync(async (req, res) => {
  console.log("Deleting all phases for user", req.params.email);
  const { email } = req.params;

  // Ensure the authenticated user matches the email in the request
  if (email !== req.user.email) {
    return res.status(403).json({
      message: "You are not authorized to delete phases for this user.",
    });
  }

  const updatedUser = await UserPhase.findOneAndUpdate(
    { email },
    { $set: { phases: [] } },
    { new: true }
  );

  if (!updatedUser) {
    return res.status(404).json({
      message: "No phases found for this user.",
    });
  }

  res.status(200).json({
    message: "All phases successfully deleted.",
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
  } = req.body;

  // Ensure the user exists
  const user = await UserPhase.findOne({ email: req.user.email });
  if (!user) {
    return res.status(404).json({ message: "User not found!" });
  }

  // Ensure no duplicate pattern name
  const existingPattern = await UserPattern.findOne({
    email: req.user.email,
    "patterns.name": name,
  });

  if (existingPattern) {
    return res.status(400).json({
      message: `Pattern name "${name}" already exists!`,
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
    })),
  };

  // Add the pattern to the database
  await UserPattern.findOneAndUpdate(
    { email: req.user.email },
    { $push: { patterns: pattern } },
    { upsert: true }
  );

  res.status(201).json({
    message: `Pattern "${name}" added successfully!`,
  });
});

exports.getAllPatternsByUserHandler = catchAsync(async (req, res, next) => {
  console.log("Getting all patterns by user", req.params);

  // Find user pattern by email
  const userPatterns = await UserPattern.findOne({ email: req.user.email });

  if (!userPatterns) {
    return res.status(404).json({ message: "No pattern found for this user" });
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
    data: {
      patterns: populatedPatterns,
    },
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
      message: "Pattern not found or you don't have permission to delete it.",
    });
  }

  res.status(204).json({ message: "Pattern successfully deleted." });
});

exports.editPatternByUserHandler = catchAsync(async (req, res) => {
  console.log("Editing pattern by user", req.params, req.body);
  const { patternName } = req.params;
  const { configuredPhases } = req.body;

  const patternToUpdate = await UserPattern.findOneAndUpdate(
    { email: req.user.email, "patterns.name": patternName },
    {
      $set: {
        "patterns.$.configuredPhases": configuredPhases,
      },
    },
    { new: true }
  );

  if (!patternToUpdate) {
    return res.status(404).json({
      message: "Pattern not found or you don't have permission to edit it.",
    });
  }

  res.status(200).json({
    message: `Pattern "${patternName}" updated successfully!`,
    pattern: patternToUpdate,
  });
});

exports.addPlanByUserHandler = catchAsync(async (req, res) => {
  // console.log("Adding or updating plan by user", req.body.schedule);
  const { id, name, schedule, dayType, customDate } = req.body;

  let userPlan = await UserPlan.findOne({ email: req.user.email });
  if (!userPlan) {
    userPlan = new UserPlan({ email: req.user.email, plans: [] });
  }

  const existingPlanIndex = userPlan.plans.findIndex(
    (plan) => plan.name === name
  );

  const newPlan = {
    id,
    name,
    dayType,
    schedule,
    customDate,
  };

  if (existingPlanIndex !== -1) {
    userPlan.plans[existingPlanIndex] = newPlan;
    await userPlan.save();
    res.status(200).json({
      message: `Plan "${name}" has been successfully overwritten!`,
      plan: newPlan,
    });
  } else {
    // Add new plan
    userPlan.plans.push(newPlan);
    await userPlan.save();
    res.status(201).json({
      message: `Plan "${name}" added successfully!`,
      plan: newPlan,
    });
  }
});

exports.updatePlanByUserHandler = catchAsync(async (req, res) => {
  console.log("Newly updating plan by user", req.body.data);

  const { id, name, data, dayType, customDate } = req.body;

  // Create all the pattern
  const user = await UserPhase.findOne({ email: req.user.email });
  if (!user) {
    return res.status(404).json({ message: "User not found!" });
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

    // Add the pattern to the database
    await UserPattern.findOneAndUpdate(
      { email: req.user.email },
      { $push: { patterns: newPattern } },
      { upsert: true }
    );
  }

  // Create th Plan
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
        ? {
            value: matchingEntry.name.toLowerCase(),
            label: matchingEntry.name,
          }
        : null;
    });

    return schedule;
  };

  // Create the new schedule
  const newSchedule = generateSchedule(data);

  let userPlan = await UserPlan.findOne({ email: req.user.email });

  if (!userPlan) {
    userPlan = new UserPlan({ email: req.user.email, plans: [] });
  }

  const existingPlanIndex = userPlan.plans.findIndex(
    (plan) => plan.name.toLowerCase() === name.toLowerCase()
  );

  const newPlan = {
    id,
    name,
    dayType,
    schedule: newSchedule,
    customDate,
  };

  if (existingPlanIndex !== -1) {
    userPlan.plans[existingPlanIndex] = newPlan;
    await userPlan.save();
    res.status(200).json({
      message: `Plan "${name}" has been successfully overwritten!`,
      plan: newPlan,
    });
  } else {
    // Add new plan
    userPlan.plans.push(newPlan);
    await userPlan.save();
    res.status(201).json({
      message: `Plan "${name}" added successfully!`,
      plan: newPlan,
    });
  }
});

exports.getAllPlansByUserHandler = catchAsync(async (req, res, next) => {
  console.log("Getting all plans by user", req.params);

  const userPlan = await UserPlan.findOne({ email: req.user.email });

  if (!userPlan) {
    return res.status(404).json({
      status: "error",
      message: "No plans found for this user.",
    });
  }

  res.status(200).json({
    status: "success",
    data: {
      plans: userPlan.plans,
    },
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
    message: `Plan deleted successfully!`,
  });
});

exports.confirmPasswordHandler = catchAsync(async (req, res) => {
  console.log("Confirming password by user", req.body);
  const { password } = req.body;

  const user = await User.findOne({ email: req.user.email }).select(
    "+password"
  );

  if (!user) {
    return res.status(404).json({
      message: "User not found.",
    });
  }

  const isPasswordCorrect = await user.correctPassword(password);

  if (!isPasswordCorrect) {
    console.log("Incorrect");
    return res.status(401).json({
      message: "Incorrect password.",
    });
  }

  console.log("Correct");

  res.status(200).json({
    message: "Password confirmed.",
  });
});

exports.getDeviceInfoByDeviceIDHandler = catchAsync(async (req, res) => {
  const { deviceID } = req.params;

  const info = await UserDeviceInfo.findOne({ DeviceID: deviceID });

  if (!info) {
    return res.status(404).json({
      message: "Device info doe not exist.",
    });
  }

  res.status(200).json({
    message: "Device info fetched successfully.",
    data: info,
  });
});

exports.getDeviceStateByDeviceIDHandler = catchAsync(async (req, res) => {
  const { deviceID } = req.params;

  const state = await UserDeviceState.findOne({ DeviceID: deviceID });

  if (!state) {
    return res.status(404).json({
      message: "Device state not found.",
    });
  }

  res.status(200).json({
    message: "Device state fetched successfully.",
    data: state,
  });
});

exports.getDeviceFullDetailsByDeviceIDHandler = catchAsync(async (req, res) => {
  console.log("Getting device full details by device ID", req.params);
  const { deviceID } = req.params;

  const device = await UserDevice.findOne({ deviceId: deviceID });

  if (!device) {
    return res.status(404).json({
      message: "Device not found.",
    });
  }

  res.status(200).json({
    message: "Device full details fetched successfully.",
    data: device,
  });
});

exports.updateAllowAdminSupportHandler = catchAsync(async (req, res) => {
  console.log("Updating allowAdminSupport", req.params, req.body);
  const { deviceID } = req.params;
  const { allowAdminSupport } = req.body;

  // Check if the device exists
  const device = await UserDevice.findOne({ deviceId: deviceID });
  if (!device) {
    return res.status(404).json({
      message: "Device not found.",
    });
  }

  device.allowAdminSupport = allowAdminSupport;
  await device.save();

  console.log("Device updated", device);

  res.status(200).json({
    message: "Admin support status updated successfully.",
    data: device,
  });
});

exports.deleteOrRestoreDeviceHandler = catchAsync(async (req, res) => {
  console.log("Updating device availability", req.params, req.body);
  const { deviceId } = req.params;
  const restoreDevice = req.body.restore === true;

  const device = await UserDevice.findOne({ deviceId });
  if (!device) {
    return res.status(404).json({ message: "Device not found." });
  }

  if (restoreDevice) {
    device.isTrash = false;
    device.deleteAt = null;
  } else {
    device.isTrash = true;
    device.deleteAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // Delete after 30 days
  }

  await device.save();

  try {
    const user = await User.findOne({ email: device.email });
    const email = new Email(user);
    if (!restoreDevice) {
      await email.sendDeviceDeletedNotification();
    }
  } catch (error) {
    console.log("Error sending email:", error);
  }

  res.status(200).json({
    message: `Device ${
      restoreDevice ? "restored" : "moved to trash"
    } successfully.`,
    data: device,
  });
});

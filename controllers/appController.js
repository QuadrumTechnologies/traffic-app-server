const { AdminDevice } = require("../models/adminAppModel");
const {
  UserDevice,
  UserPhase,
  UserPattern,
  UserPlan,
  UserDeviceState,
  UserDeviceActivity,
  UserDeviceInfo,
} = require("../models/appModel");
const User = require("../models/userModel");
const catchAsync = require("../utils/catchAsync");
const { generateSecretKey } = require("../utils/misc");

exports.getDeviceDetailById = catchAsync(async (req, res, next) => {
  console.log("Getting device detail by user", req.params);
  const { deviceId, userEmail } = req.params;

  const existingDevice = await AdminDevice.findOne({ deviceId: deviceId });

  if (!existingDevice) {
    return res.status(400).json({ message: "Invalid Device ID" });
  }
  if (existingDevice.deviceStatus.status !== "purchased") {
    return res.status(400).json({ message: "Device has not been purchased." });
  }

  if (
    existingDevice.deviceStatus.ownerEmail &&
    existingDevice.deviceStatus.ownerEmail.toLowerCase() !==
      userEmail.toLowerCase()
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
  console.log("Adding device by user", req.body);
  const { deviceId, deviceType, email } = req.body;

  if (!deviceId || !deviceType || !email) {
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
    email,
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
  console.log("Getting all devices by user");
  const { email } = req.params;
  const devices = await UserDevice.find({ email });

  return res.status(200).json({
    devices,
  });
});

exports.addPhaseByUserHandler = catchAsync(async (req, res, next) => {
  console.log("Adding Phase by user", req.body);

  const { email, phaseName, phaseData } = req.body;

  // Check if phases already exist for the user
  const userPhase = await UserPhase.findOne({ email });

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
    { email },
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

  const { email } = req.params;
  const phases = await UserPhase.findOne({ email });
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
  const { phaseId, email } = req.params;

  const updatedUser = await UserPhase.findOneAndUpdate(
    { email },
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

exports.addPatternByUserHandler = catchAsync(async (req, res) => {
  console.log("Adding pattern by user", req.body);

  const {
    email,
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
  const user = await UserPhase.findOne({ email });
  if (!user) {
    return res.status(404).json({ message: "User not found!" });
  }

  // Ensure no duplicate pattern name
  const existingPattern = await UserPattern.findOne({
    email,
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
    { email },
    { $push: { patterns: pattern } },
    { upsert: true }
  );

  res.status(201).json({
    message: `Pattern "${name}" added successfully!`,
  });
});

exports.getAllPatternsByUserHandler = catchAsync(async (req, res, next) => {
  console.log("Getting all patterns by user", req.params);
  const { email } = req.params;

  // Find user pattern by email
  const userPatterns = await UserPattern.findOne({ email });

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
  const { patternName, email } = req.params;

  const updatedUser = await UserPattern.findOneAndUpdate(
    { email },
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
  const { patternName, email } = req.params;
  const { configuredPhases } = req.body;

  const patternToUpdate = await UserPattern.findOneAndUpdate(
    { email, "patterns.name": patternName },
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
  const { id, name, email, schedule, dayType, customDate } = req.body;

  let userPlan = await UserPlan.findOne({ email });
  if (!userPlan) {
    userPlan = new UserPlan({ email, plans: [] });
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

  const { id, name, email, data, dayType, customDate } = req.body;

  // Create all the pattern
  const user = await UserPhase.findOne({ email });
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
      { email },
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

  let userPlan = await UserPlan.findOne({ email });

  if (!userPlan) {
    userPlan = new UserPlan({ email, plans: [] });
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

  const { email } = req.params;
  const userPlan = await UserPlan.findOne({ email });

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
  const { planId, email } = req.params;

  const userPlan = await UserPlan.findOne({ email });

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
  const { email, password } = req.body;

  const user = await User.findOne({ email }).select("+password");

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

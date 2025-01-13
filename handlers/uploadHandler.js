const { UserPattern } = require("../models/appModel");
const catchAsync = require("../utils/catchAsync");

exports.uploadRequestHandler = catchAsync(async (ws, clients, payload) => {
  console.log("Received upload request data from Client", payload);

  // Find the user's patterns
  const userPatterns = await UserPattern.findOne({ email: payload.email });

  const pattern = userPatterns.patterns.find(
    (p) => p.name === payload.patternName
  );

  // Format the pattern phases
  const patternPhases = pattern?.configuredPhases.map((phase) => ({
    PhaseName: phase.name,
    PhaseId: phase.phaseId,
    SignalString: phase.signalString,
    Duration: phase.duration,
  }));

  // Additional pattern settings
  const patternSettings = {
    BlinkEnabled: pattern.blinkEnabled,
    BlinkTimeRedToGreen: pattern.blinkTimeRedToGreen,
    BlinkTimeGreenToRed: pattern.blinkTimeGreenToRed,
    AmberEnabled: pattern.amberEnabled,
    AmberDurationRedToGreen: pattern.amberDurationRedToGreen,
    AmberDurationGreenToRed: pattern.amberDurationGreenToRed,
  };

  // Generate the pattern strings
  let patternString = "";

  patternPhases.forEach((phase) => {
    // Base signal string with phase duration
    patternString += `*${phase.Duration == 0 ? "X" : phase.Duration}${
      phase.SignalString
    }\n`;

    // If prev signal is not the same with current signal, send blink

    // If BlinkEnabled, toggle between original and modified signal strings
    if (patternSettings.BlinkEnabled) {
      let blinkCount = patternSettings.BlinkTimeGreenToRed;

      for (let i = 0; i < blinkCount; i++) {
        // Blink with X replacing G in SignalString
        const blinkSignalString = phase.SignalString.replace(/G/g, "X");
        patternString += `*X${blinkSignalString}\n`;

        // Back to original signal string
        patternString += `*X${phase.SignalString}\n`;
      }
      if (patternSettings.AmberEnabled) {
        const amberSignalString = phase.SignalString.replace(/G/g, "A");
        patternString += `*${patternSettings.AmberDurationGreenToRed}${amberSignalString}\n`;
      }
    }
  });

  const dayToNum = {
    MONDAY: "0",
    TUESDAY: "1",
    WEDNESDAY: "2",
    THURSDAY: "3",
    FRIDAY: "4",
    SATURDAY: "5",
    SUNDAY: "6",
  };

  console.log("Generated Data:\n", patternString.trim(), {
    Event: "ctrl",
    Type: "program",
    Param: {
      DeviceID: payload.DeviceID,
      Plan: dayToNum[payload.plan],
      Period: payload.timeSegmentString,
      Pattern: patternString.trim(),
    },
  });

  // Send the pattern strings to the hardware
  clients.forEach((client) => {
    // if (client.clientType !== payload.DeviceID) return;
    client.send(
      JSON.stringify({
        Event: "ctrl",
        Type: "prog",
        Param: {
          DeviceID: payload.DeviceID,
          Plan: dayToNum[payload.plan],
          Period: payload.timeSegmentString,
          Pattern: patternString.trim(),
        },
      })
    );
  });
});

exports.uploadHandler = catchAsync(async (ws, clients, payload) => {
  const { DeviceID, Plan, Period } = payload || {};

  const modifiedPeriod = Period?.slice(1, 6);
  const numToDay = {
    0: "MONDAY",
    1: "TUESDAY",
    2: "WEDNESDAY",
    3: "THURSDAY",
    4: "FRIDAY",
    5: "SATURDAY",
    6: "SUNDAY",
  };
  return clients.forEach((client) => {
    if (client.clientType === payload.DeviceID) return;
    client.send(
      JSON.stringify({
        event: "upload_feedback",
        payload: {
          DeviceID,
          Plan: numToDay[Plan],
          Period: modifiedPeriod,
        },
      })
    );
  });
});

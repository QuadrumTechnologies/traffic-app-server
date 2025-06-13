const { UserPattern } = require("../models/appModel");
const catchAsync = require("../utils/catchAsync");

exports.dayToNum = {
  SUNDAY: "0",
  MONDAY: "1",
  TUESDAY: "2",
  WEDNESDAY: "3",
  THURSDAY: "4",
  FRIDAY: "5",
  SATURDAY: "6",
};

exports.numToDay = {
  0: "SUNDAY",
  1: "MONDAY",
  2: "TUESDAY",
  3: "WEDNESDAY",
  4: "THURSDAY",
  5: "FRIDAY",
  6: "SATURDAY",
};

exports.uploadRequestHandler = catchAsync(async (ws, clients, payload) => {
  try {
    if (!payload.email || !payload.patternName || !payload.DeviceID) {
      clients.forEach((client) => {
        if (client.clientType !== payload.DeviceID) {
          client.send(
            JSON.stringify({
              event: "error",
              message: "Missing required fields in upload request.",
            })
          );
        }
      });
      return;
    }

    const userPatterns = await UserPattern.findOne({ email: payload.email });
    if (!userPatterns) {
      clients.forEach((client) => {
        if (client.clientType !== payload.DeviceID) {
          client.send(
            JSON.stringify({
              event: "error",
              message: `No patterns found for user ${payload.email}.`,
            })
          );
        }
      });
      return;
    }

    const pattern = userPatterns.patterns.find(
      (p) => p.name === payload.patternName
    );
    if (!pattern) {
      clients.forEach((client) => {
        if (client.clientType !== payload.DeviceID) {
          client.send(
            JSON.stringify({
              event: "error",
              message: `Pattern '${payload.patternName}' not found for user ${payload.email}.`,
            })
          );
        }
      });
      return;
    }

    const patternPhases = pattern.configuredPhases.map((phase) => ({
      PhaseName: phase.name,
      PhaseId: phase.phaseId,
      SignalString: phase.signalString,
      Duration: phase.duration,
    }));

    const patternSettings = {
      BlinkEnabled: pattern.blinkEnabled,
      BlinkTimeRedToGreen: pattern.blinkTimeRedToGreen,
      BlinkTimeGreenToRed: pattern.blinkTimeGreenToRed,
      AmberEnabled: pattern.amberEnabled,
      AmberDurationRedToGreen: pattern.amberDurationRedToGreen,
      AmberDurationGreenToRed: pattern.amberDurationGreenToRed,
    };

    let patternString = "";
    patternPhases.forEach((phase) => {
      patternString += `*${phase.Duration == 0 ? "X" : phase.Duration}${
        phase.SignalString
      }\n`;
      if (patternSettings.BlinkEnabled) {
        let blinkCount = patternSettings.BlinkTimeGreenToRed;
        for (let i = 0; i < blinkCount; i++) {
          const blinkSignalString = phase.SignalString.replace(/G/g, "X");
          patternString += `*X${blinkSignalString}\n`;
          patternString += `*X${phase.SignalString}\n`;
        }
        if (patternSettings.AmberEnabled) {
          const amberSignalString = phase.SignalString.replace(/G/g, "A");
          patternString += `*${patternSettings.AmberDurationGreenToRed}${amberSignalString}\n`;
        }
      }
    });

    const planValue =
      payload.plan === "CUSTOM" && payload.customDateUnix
        ? payload.customDateUnix
        : exports.dayToNum[payload.plan];

    console.log("Generated Data:\n", patternString.trim(), {
      Event: "ctrl",
      Type: "prog",
      Param: {
        DeviceID: payload.DeviceID,
        Plan: planValue,
        Period: payload.timeSegmentString,
        Pattern: patternString.trim(),
      },
    });

    clients.forEach((client) => {
      if (client.clientType === payload.DeviceID) {
        client.send(
          JSON.stringify({
            Event: "ctrl",
            Type: "prog",
            Param: {
              DeviceID: payload.DeviceID,
              Plan: planValue,
              Period: payload.timeSegmentString,
              Pattern: patternString.trim(),
            },
          })
        );
      }
    });

    clients.forEach((client) => {
      if (client.clientType !== payload.DeviceID) {
        client.send(
          JSON.stringify({
            event: "upload_request_success",
            message: `Upload request for pattern '${payload.patternName}' sent to device ${payload.DeviceID}.`,
          })
        );
      }
    });
  } catch (error) {
    console.error("Error in uploadRequestHandler:", error);
    clients.forEach((client) => {
      if (client.clientType !== payload.DeviceID) {
        client.send(
          JSON.stringify({
            event: "error",
            message: "An unexpected error occurred during upload request.",
          })
        );
      }
    });
  }
});

exports.uploadHandler = catchAsync(async (ws, clients, payload) => {
  try {
    const { DeviceID, Plan, Period } = payload || {};
    const modifiedPeriod = Period?.slice(1, 6);

    clients.forEach((client) => {
      if (client.clientType !== DeviceID) {
        client.send(
          JSON.stringify({
            event: "upload_feedback",
            payload: {
              DeviceID,
              Plan: exports.numToDay[Plan],
              Period: modifiedPeriod,
            },
          })
        );
      }
    });
  } catch (error) {
    console.error("Error in uploadHandler:", error);
  }
});

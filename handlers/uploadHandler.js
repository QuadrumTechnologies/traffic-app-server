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
  console.log("Received upload request:", payload);
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

    let patternString = "";
    pattern.configuredPhases.forEach((phase, index) => {
      // Add main phase
      patternString += `*${phase.duration == 0 ? "X" : phase.duration}${
        phase.signalString
      }\n`;

      // Handle transitions to next phase (if not the last phase)
      if (index < pattern.configuredPhases.length - 1) {
        const nextPhase = pattern.configuredPhases[index + 1];
        const currentSignals = phase.signalString.slice(1, -1); // Remove * and #
        const nextSignals = nextPhase.signalString.slice(1, -1);

        // Generate transition signals
        if (phase.enableBlink) {
          const maxBlinkDelay = Math.max(
            phase.redToGreenDelay,
            phase.greenToRedDelay
          );
          const blinkCycles = Math.ceil(maxBlinkDelay / 0.5);
          for (let i = 0; i < blinkCycles; i++) {
            let blinkSignalString = "";
            for (let j = 0; j < currentSignals.length; j++) {
              const currentState = currentSignals[j];
              const nextState = nextSignals[j];
              if (currentState === "G" && nextState === "R") {
                blinkSignalString += i % 2 === 0 ? "G" : "X";
              } else if (currentState === "R" && nextState === "G") {
                blinkSignalString += i % 2 === 0 ? "R" : "X";
              } else {
                blinkSignalString += currentState;
              }
            }
            patternString += `*X*${blinkSignalString}#\n`;
          }
        }

        if (phase.enableAmber) {
          const maxAmberDelay = Math.max(
            phase.redToGreenAmberDelay,
            phase.greenToRedAmberDelay
          );
          const amberCycles = phase.enableAmberBlink
            ? Math.ceil(maxAmberDelay / 0.5)
            : 1;
          for (let i = 0; i < amberCycles; i++) {
            let amberSignalString = "";
            for (let j = 0; j < currentSignals.length; j++) {
              const currentState = currentSignals[j];
              const nextState = nextSignals[j];
              if (currentState === "G" && nextState === "R") {
                amberSignalString +=
                  phase.enableAmberBlink && i % 2 === 0 ? "A" : "X";
              } else if (currentState === "R" && nextState === "G") {
                amberSignalString +=
                  phase.enableAmberBlink && i % 2 === 0 ? "A" : "X";
              } else {
                amberSignalString +=
                  phase.holdRedSignalOnAmber && currentState === "R"
                    ? "R"
                    : phase.holdGreenSignalOnAmber && currentState === "G"
                    ? "G"
                    : currentState;
              }
            }
            const duration = phase.enableAmberBlink
              ? "X"
              : Math.round(maxAmberDelay);
            patternString += `*${duration}*${amberSignalString}#\n`;
          }
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
            payload: {
              DeviceID: payload.DeviceID,
              Plan: payload.plan,
              Period: payload.timeSegmentString,
              message: `Upload request for pattern '${payload.patternName}' sent to device ${payload.DeviceID}.`,
            },
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
              Plan: exports.numToDay[Plan] || Plan,
              Period: modifiedPeriod,
            },
          })
        );
      }
    });
  } catch (error) {
    console.error("Error in uploadHandler:", error);
    clients.forEach((client) => {
      if (client.clientType !== DeviceID) {
        client.send(
          JSON.stringify({
            event: "upload_feedback",
            payload: {
              DeviceID: payload?.DeviceID,
              Plan: payload?.Plan,
              Period: payload?.Period?.slice(1, 6),
              error: true,
              message: "An unexpected error occurred during upload feedback.",
            },
          })
        );
      }
    });
  }
});

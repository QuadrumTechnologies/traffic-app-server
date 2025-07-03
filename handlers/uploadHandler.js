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

        // Generate transition based on phase configuration
        generateTransition(currentSignals, nextSignals, phase, patternString);
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

function generateTransition(currentSignals, nextSignals, phase, patternString) {
  // Phase 1: Blink Phase (if enabled)
  if (phase.enableBlink) {
    // Determine which signals need to blink and their durations
    for (let i = 0; i < currentSignals.length; i++) {
      const currentState = currentSignals[i];
      const nextState = nextSignals[i];

      let blinkDuration = 0;
      let shouldBlink = false;

      // Determine blink duration based on transition type
      if (currentState === "G" && nextState === "R") {
        blinkDuration = phase.greenToRedDelay || 0;
        shouldBlink = blinkDuration > 0;
      } else if (currentState === "R" && nextState === "G") {
        blinkDuration = phase.redToGreenDelay || 0;
        shouldBlink = blinkDuration > 0;
      }

      if (shouldBlink) {
        // Create blink cycles (0.5s intervals)
        const blinkCycles = Math.ceil(blinkDuration / 0.5);

        for (let cycle = 0; cycle < blinkCycles; cycle++) {
          let blinkSignalString = "";

          for (let j = 0; j < currentSignals.length; j++) {
            const currentSignal = currentSignals[j];
            const nextSignal = nextSignals[j];

            if (j === i && shouldBlink) {
              // This is the signal that should blink
              if (
                (currentSignal === "G" && nextSignal === "R") ||
                (currentSignal === "R" && nextSignal === "G")
              ) {
                blinkSignalString += cycle % 2 === 0 ? currentSignal : "X";
              } else {
                blinkSignalString += currentSignal;
              }
            } else {
              // Keep other signals as they are
              blinkSignalString += currentSignal;
            }
          }

          patternString += `*X*${blinkSignalString}#\n`;
        }
      }
    }
  }

  // Phase 2: Amber Phase (if enabled)
  if (phase.enableAmber) {
    // Determine amber duration based on transition type
    for (let i = 0; i < currentSignals.length; i++) {
      const currentState = currentSignals[i];
      const nextState = nextSignals[i];

      let amberDuration = 0;
      let shouldShowAmber = false;

      if (currentState === "G" && nextState === "R") {
        amberDuration = phase.greenToRedAmberDelay || 0;
        shouldShowAmber = amberDuration > 0;
      } else if (currentState === "R" && nextState === "G") {
        amberDuration = phase.redToGreenAmberDelay || 0;
        shouldShowAmber = amberDuration > 0;
      }

      if (shouldShowAmber) {
        if (phase.enableAmberBlink) {
          // Amber blinks every 0.5s
          const amberCycles = Math.ceil(amberDuration / 0.5);

          for (let cycle = 0; cycle < amberCycles; cycle++) {
            let amberSignalString = "";

            for (let j = 0; j < currentSignals.length; j++) {
              const currentSignal = currentSignals[j];
              const nextSignal = nextSignals[j];

              if (j === i && shouldShowAmber) {
                // This signal should show amber
                if (
                  (currentSignal === "G" && nextSignal === "R") ||
                  (currentSignal === "R" && nextSignal === "G")
                ) {
                  // Check if we should hold the original signal
                  let baseSignal = "X";
                  if (phase.holdRedSignalOnAmber && currentSignal === "R") {
                    baseSignal = "R";
                  } else if (
                    phase.holdGreenSignalOnAmber &&
                    currentSignal === "G"
                  ) {
                    baseSignal = "G";
                  }

                  // Add amber (blinking or steady)
                  if (cycle % 2 === 0) {
                    amberSignalString += baseSignal === "X" ? "A" : baseSignal;
                  } else {
                    amberSignalString += baseSignal;
                  }
                } else {
                  amberSignalString += currentSignal;
                }
              } else {
                amberSignalString += currentSignal;
              }
            }

            patternString += `*X*${amberSignalString}#\n`;
          }
        } else {
          // Amber steady (non-blinking)
          let amberSignalString = "";

          for (let j = 0; j < currentSignals.length; j++) {
            const currentSignal = currentSignals[j];
            const nextSignal = nextSignals[j];

            if (j === i && shouldShowAmber) {
              if (
                (currentSignal === "G" && nextSignal === "R") ||
                (currentSignal === "R" && nextSignal === "G")
              ) {
                // Check if we should hold the original signal
                let baseSignal = "X";
                if (phase.holdRedSignalOnAmber && currentSignal === "R") {
                  baseSignal = "R";
                } else if (
                  phase.holdGreenSignalOnAmber &&
                  currentSignal === "G"
                ) {
                  baseSignal = "G";
                }

                amberSignalString += baseSignal === "X" ? "A" : baseSignal;
              } else {
                amberSignalString += currentSignal;
              }
            } else {
              amberSignalString += currentSignal;
            }
          }

          const duration = Math.round(amberDuration);
          patternString += `*${duration}*${amberSignalString}#\n`;
        }
      }
    }
  }
}

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

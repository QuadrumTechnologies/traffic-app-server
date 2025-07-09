const { UserPattern, UserPhase } = require("../models/appModel");
const catchAsync = require("../utils/catchAsync");
const util = require("util");
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
      (p) => p.name.toLowerCase() === payload.patternName.toLowerCase()
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

    // Fetch full phase details using _id or name
    const patternPhases = [];
    try {
      const userPhaseDocs = await UserPhase.aggregate([
        { $match: { email: payload?.email } },
        { $unwind: "$phases" }, // Flatten the phases array
        {
          $match: {
            $or: pattern.configuredPhases.map((phase) => ({
              $or: [{ "phases._id": phase._id }, { "phases.name": phase.name }],
            })),
          },
        },
        // Return only the phase documents
        { $replaceRoot: { newRoot: "$phases" } },
      ]);

      // Map results to patternPhases, preserving order of pattern.configuredPhases
      for (const phase of pattern.configuredPhases) {
        const matchedPhase = userPhaseDocs.find(
          (p) =>
            p._id.toString() === phase._id.toString() ||
            p.name.toLowerCase() === phase.name.toLowerCase()
        );
        if (matchedPhase) {
          patternPhases.push({
            ...matchedPhase,
            duration: phase.duration,
            // index: phase.index,
            // phaseId: phase.phaseId,
            // signalString: phase.signalString,
          });
        } else {
          console.warn(
            `Phase not found for _id: ${phase._id} or name: ${phase.name}`
          );
        }
      }
    } catch (error) {
      console.error("Error querying phases:", error);
    }

    if (patternPhases.length === 0) {
      clients.forEach((client) => {
        if (client.clientType !== payload.DeviceID) {
          client.send(
            JSON.stringify({
              event: "error",
              message: `No valid phases found for pattern '${payload.patternName}'.`,
            })
          );
        }
      });
      return;
    }

    let patternString = "";
    patternPhases.forEach((phase, index) => {
      // Add main phase
      patternString += `*${phase.duration == 0 ? "X" : phase.duration}${
        phase.data
      }\n`;

      // Handle transitions to next phase (if not the last phase)
      if (index < patternPhases.length - 1) {
        const nextPhase = patternPhases[index + 1];
        const currentSignals = phase.data.slice(1, -1); // Remove * and #
        const nextSignals = nextPhase.data.slice(1, -1);

        // Generate transition based on phase configuration
        patternString += generateTransition(currentSignals, nextSignals, phase);
      }
    });

    const planValue =
      payload.plan === "CUSTOM" && payload.customDateUnix
        ? payload.customDateUnix
        : exports.dayToNum[payload.plan];

    console.log(
      "Generated Data:\n",
      util.inspect(
        {
          Param: {
            DeviceID: payload.DeviceID,
            Plan: planValue,
            Period: payload.timeSegmentString,
            Pattern: patternString.trim(),
            // payload,
            // patternPhases,
          },
        },
        { showHidden: false, depth: null, colors: true }
      )
    );

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

function generateTransition(currentSignals, nextSignals, phase) {
  let transitionString = "";

  // Determine if any signals are transitioning and require blink or amber phases
  let hasRedToGreen = false;
  let hasGreenToRed = false;
  for (let i = 0; i < currentSignals.length; i++) {
    if (currentSignals[i] === "R" && nextSignals[i] === "G") {
      hasRedToGreen = true;
    } else if (currentSignals[i] === "G" && nextSignals[i] === "R") {
      hasGreenToRed = true;
    }
  }

  // Calculate maximum durations for blink and amber phases
  const maxBlinkDuration = phase.enableBlink
    ? Math.max(
        hasRedToGreen ? phase.redToGreenDelay || 0 : 0,
        hasGreenToRed ? phase.greenToRedDelay || 0 : 0
      )
    : 0;
  const maxAmberDuration = phase.enableAmber
    ? Math.max(
        hasRedToGreen ? phase.redToGreenAmberDelay || 0 : 0,
        hasGreenToRed ? phase.greenToRedAmberDelay || 0 : 0
      )
    : 0;

  // Phase 1: Blink Phase (only if enabled and at least one non-zero delay)
  if (phase.enableBlink && maxBlinkDuration > 0) {
    const blinkCycles = Math.ceil(maxBlinkDuration / 0.5);

    for (let cycle = 0; cycle < blinkCycles; cycle++) {
      let blinkSignalString = "";

      for (let i = 0; i < currentSignals.length; i++) {
        const currentState = currentSignals[i];
        const nextState = nextSignals[i];
        let shouldBlink = false;
        let blinkDuration = 0;

        if (currentState === "R" && nextState === "G") {
          blinkDuration = phase.redToGreenDelay || 0;
          shouldBlink = cycle < Math.ceil(blinkDuration / 0.5);
        } else if (currentState === "G" && nextState === "R") {
          blinkDuration = phase.greenToRedDelay || 0;
          shouldBlink = cycle < Math.ceil(blinkDuration / 0.5);
        }

        blinkSignalString += shouldBlink
          ? cycle % 2 === 0
            ? currentState
            : "X"
          : currentState;
      }

      transitionString += `*X*${blinkSignalString}#\n`;
    }
  }

  // Phase 2: Amber Phase (only if enabled and at least one non-zero delay)
  if (phase.enableAmber && maxAmberDuration > 0) {
    const amberCycles = Math.ceil(maxAmberDuration / 0.5);

    for (let cycle = 0; cycle < amberCycles; cycle++) {
      let amberSignalString = "";

      for (let i = 0; i < currentSignals.length; i++) {
        const currentState = currentSignals[i];
        const nextState = nextSignals[i];
        let shouldShowAmber = false;
        let amberDuration = 0;

        if (currentState === "R" && nextState === "G") {
          amberDuration = phase.redToGreenAmberDelay || 0;
          shouldShowAmber = cycle < Math.ceil(amberDuration / 0.5);
        } else if (currentState === "G" && nextState === "R") {
          amberDuration = phase.greenToRedAmberDelay || 0;
          shouldShowAmber = cycle < Math.ceil(amberDuration / 0.5);
        }

        if (shouldShowAmber) {
          let baseSignal = "X";
          if (phase.holdRedSignalOnAmber && currentState === "R") {
            baseSignal = "R";
          } else if (phase.holdGreenSignalOnAmber && currentState === "G") {
            baseSignal = "G";
          }

          if (phase.enableAmberBlink) {
            amberSignalString +=
              cycle % 2 === 0 && baseSignal === "X" ? "A" : baseSignal;
          } else {
            amberSignalString += baseSignal === "X" ? "A" : baseSignal;
          }
        } else {
          amberSignalString += currentState;
        }
      }

      transitionString += `*X*${amberSignalString}#\n`;
    }
  }

  return transitionString;
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

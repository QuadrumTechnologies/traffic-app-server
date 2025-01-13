const catchAsync = require("../utils/catchAsync");

exports.manualControlHandler = catchAsync(async (ws, clients, payload) => {
  console.log("Received manual ctrl from client", payload);

  // Generate the main phase signal
  const {
    duration,
    signalString,
    initialSignalStrings,
    blinkEnabled,
    blinkTimeGreenToRed,
    amberEnabled,
    amberDurationGreenToRed,
  } = payload;

  const phaseSignal = `*X${initialSignalStrings}`;

  // Send the initial phase signal to the clients
  clients.forEach((client) => {
    // if (client.clientType !== payload.DeviceID) return;
    client.send(
      JSON.stringify({
        Event: "ctrl",
        Type: "sign",
        Param: {
          DeviceID: payload.DeviceID,
          Phase: phaseSignal,
        },
      })
    );
  });

  // Wait for 1s before proceeding to the blink logic
  setTimeout(() => {
    if (blinkEnabled) {
      const blinkIterations = 2 * blinkTimeGreenToRed;
      const blinkInterval = 500;
      for (let i = 0; i < blinkIterations; i++) {
        let blinkPhase;
        if (i % 2 === 0) {
          blinkPhase = `*X${initialSignalStrings.replace(/G/g, "X")}`;
        } else {
          blinkPhase = `*X${initialSignalStrings}`;
        }
        setTimeout(() => {
          clients.forEach((client) => {
            // if (client.clientType !== payload.DeviceID) return;
            client.send(
              JSON.stringify({
                Event: "ctrl",
                Type: "sign",
                Param: {
                  DeviceID: payload.DeviceID,
                  Phase: blinkPhase,
                },
              })
            );
          });
        }, i * blinkInterval);
      }

      // Handle amber logic only after the blink phase completes
      setTimeout(() => {
        if (amberEnabled) {
          const amberPhase = `*${amberDurationGreenToRed}${initialSignalStrings.replace(
            /G/g,
            "A"
          )}`;

          clients.forEach((client) => {
            // if (client.clientType !== payload.DeviceID) return;
            client.send(
              JSON.stringify({
                Event: "ctrl",
                Type: "sign",
                Param: {
                  DeviceID: payload.DeviceID,
                  Phase: amberPhase,
                },
              })
            );
          });
        }
      }, blinkIterations * blinkInterval); // Wait for blink phase to complete before sending amber

      // Send the new phase signal to the clients after blink and amber
      setTimeout(() => {
        const newPhaseSignal = `*${duration}${signalString}`;
        clients.forEach((client) => {
          //   if (client.clientType !== payload.DeviceID) return;
          client.send(
            JSON.stringify({
              Event: "ctrl",
              Type: "sign",
              Param: {
                DeviceID: payload.DeviceID,
                Phase: newPhaseSignal,
              },
            })
          );
        });
      }, blinkIterations * blinkInterval + amberDurationGreenToRed * 1000);
    } else if (amberEnabled) {
      // Send amber phase immediately if blink is not enabled
      const amberPhase = `*${amberDurationGreenToRed}${initialSignalStrings.replace(
        /G/g,
        "A"
      )}`;
      clients.forEach((client) => {
        // if (client.clientType !== payload.DeviceID) return;
        client.send(
          JSON.stringify({
            Event: "ctrl",
            Type: "sign",
            Param: {
              DeviceID: payload.DeviceID,
              Phase: amberPhase,
            },
          })
        );
      });

      // Send the new phase signal to the clients after amber
      setTimeout(() => {
        const newPhaseSignal = `*${duration}${signalString}`;
        clients.forEach((client) => {
          //   if (client.clientType !== payload.DeviceID) return;
          client.send(
            JSON.stringify({
              Event: "ctrl",
              Type: "sign",
              Param: {
                DeviceID: payload.DeviceID,
                Phase: newPhaseSignal,
              },
            })
          );
        });
      }, amberDurationGreenToRed * 1000);
    }
  }, 1000);
});

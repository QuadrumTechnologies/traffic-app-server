const catchAsync = require("../utils/catchAsync");

exports.manualControlHandler = catchAsync(async (ws, clients, payload) => {
  try {
    const {
      duration,
      signalString,
      initialSignalStrings,
      blinkEnabled,
      blinkTimeGreenToRed,
      amberEnabled,
      amberDurationGreenToRed,
    } = payload;

    if (!duration || !signalString || !initialSignalStrings) {
      clients.forEach((client) => {
        if (client.clientType !== payload.DeviceID) {
          client.send(
            JSON.stringify({
              event: "error",
              message: "Missing required fields in manual control request.",
            })
          );
        }
      });
      return;
    }

    const phaseSignal = `*X${initialSignalStrings}`;

    clients.forEach((client) => {
      if (client.clientType === payload.DeviceID) {
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
      }
    });

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
              if (client.clientType === payload.DeviceID) {
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
              }
            });
          }, i * blinkInterval);
        }

        setTimeout(() => {
          if (amberEnabled) {
            const amberPhase = `*${amberDurationGreenToRed}${initialSignalStrings.replace(
              /G/g,
              "A"
            )}`;
            clients.forEach((client) => {
              if (client.clientType === payload.DeviceID) {
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
              }
            });
          }
        }, blinkIterations * blinkInterval);

        setTimeout(() => {
          const newPhaseSignal = `*${duration}${signalString}`;
          clients.forEach((client) => {
            if (client.clientType === payload.DeviceID) {
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
            }
          });
        }, blinkIterations * blinkInterval + amberDurationGreenToRed * 1000);
      } else if (amberEnabled) {
        const amberPhase = `*${amberDurationGreenToRed}${initialSignalStrings.replace(
          /G/g,
          "A"
        )}`;
        clients.forEach((client) => {
          if (client.clientType === payload.DeviceID) {
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
          }
        });

        setTimeout(() => {
          const newPhaseSignal = `*${duration}${signalString}`;
          clients.forEach((client) => {
            if (client.clientType === payload.DeviceID) {
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
            }
          });
        }, amberDurationGreenToRed * 1000);
      } else {
        const newPhaseSignal = `*${duration}${signalString}`;
        clients.forEach((client) => {
          if (client.clientType === payload.DeviceID) {
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
          }
        });
      }
    }, 1000);
  } catch (error) {
    console.error("Error in manualControlHandler:", error);
    clients.forEach((client) => {
      if (client.clientType !== payload.DeviceID) {
        client.send(
          JSON.stringify({
            event: "error",
            message:
              "An unexpected error occurred during manual control request.",
          })
        );
      }
    });
  }
});

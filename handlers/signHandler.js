const catchAsync = require("../utils/catchAsync");

exports.signalDataHandler = catchAsync(async (ws, clients, payload) => {
  try {
    clients.forEach((client) => {
      if (client.clientType !== payload.DeviceID) {
        client.send(
          JSON.stringify({
            event: "sign_feedback",
            payload,
          })
        );
      }
    });
  } catch (error) {
    console.error("Error in signalDataHandler:", error);
  }
});

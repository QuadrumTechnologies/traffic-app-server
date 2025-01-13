const catchAsync = require("../utils/catchAsync");

exports.signalDataHandler = catchAsync(async (ws, clients, payload) => {
  console.log("Received signal data from Hardware", payload);
  return clients.forEach((client) => {
    if (client.clientType === payload.DeviceID) return;
    client.send(
      JSON.stringify({
        event: "sign_feedback",
        payload,
      })
    );
  });
});

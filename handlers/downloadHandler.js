const catchAsync = require("../utils/catchAsync");

exports.downloadRequestHandler = catchAsync(async (ws, clients, payload) => {
  console.log("Received download request data from Client", payload);

  const dayToNum = {
    MONDAY: "0",
    TUESDAY: "1",
    WEDNESDAY: "2",
    THURSDAY: "3",
    FRIDAY: "4",
    SATURDAY: "5",
    SUNDAY: "6",
  };

  console.log("Download", {
    Event: "ctrl",
    Type: "prog",
    Param: {
      DeviceID: payload.DeviceID,
      Plan: dayToNum[payload.Plan],
    },
  });

  // Send the pattern strings to the hardware
  clients.forEach((client) => {
    if (client.clientType !== payload.DeviceID) return;
    client.send(
      JSON.stringify({
        Event: "ctrl",
        Type: "prog",
        Param: {
          DeviceID: payload.DeviceID,
          Plan: dayToNum[payload.Plan],
        },
      })
    );
  });
});

exports.downloadHandler = catchAsync(async (ws, clients, payload) => {
  return clients.forEach((client) => {
    if (client.clientType === payload.DeviceID) return;
    client.send(
      JSON.stringify({
        event: "download_feedback",
        payload,
      })
    );
  });
});

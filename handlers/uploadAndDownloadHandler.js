const catchAsync = require("../utils/catchAsync");
const { downloadHandler } = require("./downloadHandler");
const { uploadHandler } = require("./uploadHandler");

exports.uploadAndDownloadHandler = catchAsync(async (ws, clients, payload) => {
  if (payload.Program) {
    console.log("Received download response data from Hardware", payload);
    downloadHandler(ws, clients, payload);
  } else {
    console.log("Received upload response data from Hardware", payload);
    uploadHandler(ws, clients, payload);
  }
});

const crypto = require("crypto");

exports.generateSecretKey = () => {
  return crypto.randomBytes(32).toString("hex");
};

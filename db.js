const mongoose = require("mongoose");

const DATABASE_URI = process.env.DATABASE_URI;

module.exports = async function () {
  await mongoose.connect(DATABASE_URI);
};

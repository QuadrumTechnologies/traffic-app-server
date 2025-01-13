const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// Define schema for Lecturer
const adminDeviceSchema = new Schema({
  deviceId: {
    type: String,
    required: [true, "Device ID is required"],
  },
  deviceType: {
    type: String,
    enum: ["QT-TSLC"],
    required: [true, "Device Type is required"],
  },
  deviceDepartment: {
    type: String,
    required: [true, "Device Department is required"],
  },
  adminEmail: {
    type: String,
    required: [true, "Email of admin is required "],
  },

  deviceStatus: {
    status: {
      type: String,
      enum: {
        values: ["available", "purchased"],
        message:
          '{VALUE} is not a valid status. Status must be either "available" or "purchased".',
      },
      required: [true, "Device status is required"],
    },
    ownerEmail: {
      type: String,
      required: function () {
        return this.deviceStatus.status === "purchased";
      },
      validate: {
        validator: function (v) {
          return (
            this.deviceStatus.status !== "purchased" || /^\S+@\S+\.\S+$/.test(v)
          );
        },
        message: (props) => `${props.value} is not a valid email address`,
      },
    },
    purchaseDate: {
      type: Date,
      required: function () {
        return this.deviceStatus.status === "purchased";
      },
      validate: {
        validator: function (v) {
          return (
            this.deviceStatus.status !== "purchased" ||
            (v instanceof Date && !isNaN(v))
          );
        },
        message: (props) => `${props.value} is not a valid date`,
      },
    },
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  modifiedAt: {
    type: Date,
  },
  modifiedBy: {
    type: String,
  },
});

// // Create models
const AdminDevice = mongoose.model("AdminDevice", adminDeviceSchema);

module.exports = {
  AdminDevice,
};

const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// Define schema for UserDevice
const userDeviceSchema = new Schema({
  deviceId: {
    type: String,
    required: [true, "Device ID is required"],
  },
  secretKey: {
    type: String,
    required: [true, "Device Secret Key is required"],
  },
  deviceType: {
    type: String,
    enum: ["QT-TSLC"],
    required: [true, "Device Type is required"],
  },
  email: {
    type: String,
    required: [true, "Email of admin is required"],
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  status: {
    type: String,
    enum: ["active", "disabled", "recalled", "deleted"],
    default: "active",
  },
  allowAdminSupport: { type: Boolean, default: true },
  isTrash: { type: Boolean, default: false },
  deleteAt: { type: Date, default: null },
  isRecalled: { type: Boolean, default: false },
  recallAt: { type: Date, default: null },
  lastSeen: { type: Date, default: null },
});

const userPhaseSchema = new Schema({
  email: { type: String, required: true },
  phases: [
    {
      _id: { type: Schema.Types.ObjectId, auto: true },
      name: { type: String, required: true },
      data: { type: String, required: true },
      deviceId: { type: String, required: true },
      enableBlink: { type: Boolean, default: false },
      redToGreenDelay: { type: Number, min: 0, max: 5, default: 0 },
      greenToRedDelay: { type: Number, min: 0, max: 5, default: 0 },
      enableAmber: { type: Boolean, default: true },
      enableAmberBlink: { type: Boolean, default: false },
      redToGreenAmberDelay: { type: Number, min: 0, max: 5, default: 0 },
      greenToRedAmberDelay: { type: Number, min: 0, max: 5, default: 0 },
      holdRedSignalOnAmber: { type: Boolean, default: false },
      holdGreenSignalOnAmber: { type: Boolean, default: false },
    },
  ],
});

const userPatternSchema = new Schema({
  email: { type: String, required: true },
  patterns: [
    {
      name: { type: String, required: true },
      configuredPhases: [
        {
          name: { type: String, required: true },
          phaseId: { type: String, required: true },
          signalString: { type: String, required: true },
          duration: { type: Number, required: true },
          index: { type: Number, required: true },
          _id: { type: String, required: true },
          deviceId: { type: String, required: true },
        },
      ],
      deviceId: { type: String, required: true },
    },
  ],
});

const userPlanSchema = new Schema(
  {
    email: { type: String, required: true },
    plans: [
      {
        id: { type: String, required: true },
        name: { type: String, required: true },
        dayType: { type: String, required: true },
        schedule: {
          type: Map,
          of: new Schema(
            {
              value: { type: String, required: true },
              label: { type: String, required: true },
            },
            { _id: false }
          ),
        },
        customDate: { type: Date, default: null },
        deviceId: { type: String, required: true },
      },
    ],
  },
  { timestamps: true }
);

const userDeviceStateSchema = new Schema({
  DeviceID: { type: String, required: true },
  Auto: {
    type: Boolean,
    required: true,
  },
  Power: {
    type: Boolean,
    required: true,
  },
  Next: {
    type: Boolean,
    required: true,
  },
  Hold: {
    type: Boolean,
    required: true,
  },
  Reset: {
    type: Boolean,
    required: true,
  },
  Reboot: {
    type: Boolean,
    required: true,
  },
  SignalLevel: {
    type: Number,
    required: true,
  },
  ErrorFlash: {
    type: Boolean,
    required: true,
  },
  SignalConfig: {
    type: String,
    required: true,
  },
});

const userDeviceInfoSchema = new Schema({
  DeviceID: { type: String, required: true },
  North: {
    Bat: { type: String },
    Temp: { type: String },
  },
  East: {
    Bat: { type: String },
    Temp: { type: String },
  },
  West: {
    Bat: { type: String },
    Temp: { type: String },
  },
  South: {
    Bat: { type: String },
    Temp: { type: String },
  },
  Rtc: { type: String, required: true },
  Plan: { type: String, required: true },
  Period: { type: String, required: true },
  JunctionId: { type: String, required: true },
  JunctionPassword: { type: String, required: true },
  CommunicationFrequency: {
    type: String,
    required: true,
  },
  CommunicationChannel: {
    type: String,
    required: true,
  },
});

// Create models
const UserDevice = mongoose.model("UserDevice", userDeviceSchema);
const UserPhase = mongoose.model("UserPhase", userPhaseSchema);
const UserPattern = mongoose.model("UserPattern", userPatternSchema);
const UserPlan = mongoose.model("UserPlan", userPlanSchema);
const UserDeviceState = mongoose.model(
  "UserDeviceState",
  userDeviceStateSchema
);
const UserDeviceInfo = mongoose.model("UserDeviceInfo", userDeviceInfoSchema);

module.exports = {
  UserDevice,
  UserPhase,
  UserPattern,
  UserPlan,
  UserDeviceState,
  UserDeviceInfo,
};

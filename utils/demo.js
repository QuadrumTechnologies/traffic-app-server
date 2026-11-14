// The demo: one shared simulated junction that anyone can try from the
// website ("Try the demo"), without an account and without touching a live
// junction. See handlers/demoJunction.js for the simulated controller and
// controllers/demoController.js for demo sessions.

const DEMO_DEVICE_ID = String(process.env.DEMO_DEVICE_ID || "DEMO-JUNCTION").toUpperCase();
// Its own department, so it never shows in Quadrum's stock or a client's list.
const DEMO_DEPARTMENT = "demo";
const DEMO_JUNCTION_NAME = "Demo Junction";
// Manual control on the demo junction ends after 2 minutes without action,
// so a visitor who walks away doesn't leave it stuck for the next one.
const DEMO_IDLE_MINUTES = 2;
const DEMO_SESSION_HOURS = 24;

function isDemoDevice(deviceId) {
  return String(deviceId || "").toUpperCase() === DEMO_DEVICE_ID;
}

// What a demo session looks like to the rest of the API: an operator of the
// demo junction only. The address can never receive mail (.invalid).
function demoUser(session) {
  const id = String(session._id);
  return {
    _id: session._id,
    id,
    name: "Demo visitor",
    email: `demo-${id}@demo.invalid`,
    role: "operator",
    isDemo: true,
    department: DEMO_DEPARTMENT,
    verified: true,
    active: true,
    demoExpiresAt: session.expiresAt,
  };
}

function isDemoAccount(account) {
  return Boolean(account && (account.isDemo || (account.user && account.user.isDemo)));
}

// The demo plan, as on the dashboard's example timing diagram: four stages,
// the amber is the last 3 s of a stage. Signal strings: per approach N, E, S,
// W a letter per head (left, straight, right, bike, pedestrian, spare).
function signalString(green) {
  const heads = ["left", "straight", "right", "bike", "pedestrian"];
  return (
    "*" +
    ["N", "E", "S", "W"]
      .map((a) => a + heads.map((h) => ((green[a] || {})[h] ? "G" : "R")).join("") + "R")
      .join("") +
    "#"
  );
}

const DEMO_PHASES = [
  { name: "N–S ahead", duration: 24, signalString: signalString({ N: { straight: 1 }, S: { straight: 1 } }) },
  { name: "N–S left", duration: 10, signalString: signalString({ N: { left: 1 }, S: { left: 1 } }) },
  { name: "E–W ahead", duration: 20, signalString: signalString({ E: { straight: 1 }, W: { straight: 1 } }) },
  { name: "E–W left", duration: 10, signalString: signalString({ E: { left: 1 }, W: { left: 1 } }) },
];
const DEMO_AMBER_S = 3;

// The junction as GET /devices lists it for a demo session.
function demoDeviceListing(info) {
  return {
    _id: "demo",
    deviceId: DEMO_DEVICE_ID,
    deviceType: "QT-TSLC",
    email: "demo",
    status: "active",
    allowAdminSupport: false,
    isTrash: false,
    lastSeen: null,
    demo: true,
    info: info || null,
  };
}

// The demo plan as GET /patterns returns patterns, for the timing diagram.
function demoPatterns() {
  return [
    {
      name: "Demo plan",
      deviceId: DEMO_DEVICE_ID,
      configuredPhases: DEMO_PHASES.map((p, index) => ({
        name: p.name,
        phaseId: `demo-${index + 1}`,
        signalString: p.signalString,
        duration: p.duration,
        index,
        enableAmber: true,
        greenToRedAmberDelay: DEMO_AMBER_S,
      })),
    },
  ];
}

module.exports = {
  DEMO_DEVICE_ID,
  DEMO_DEPARTMENT,
  DEMO_JUNCTION_NAME,
  DEMO_IDLE_MINUTES,
  DEMO_SESSION_HOURS,
  DEMO_PHASES,
  DEMO_AMBER_S,
  isDemoDevice,
  isDemoAccount,
  demoUser,
  demoDeviceListing,
  demoPatterns,
  signalString,
};

const EventEmitter = require("events");
const WebSocket = require("ws");
const { AdminDevice } = require("../models/adminAppModel");
const { forgetDevice } = require("../utils/deviceAccess");
const {
  DEMO_DEVICE_ID,
  DEMO_DEPARTMENT,
  DEMO_JUNCTION_NAME,
  DEMO_PHASES,
  DEMO_AMBER_S,
} = require("../utils/demo");

// The demo junction: a simulated TSLC 2.0 controller inside the API.
//
// It connects to this server's own WebSocket hub the way a real controller
// does: it identifies, pings every 6 s, reports its info every 10 s, sends its
// signal string on every change and answers state queries. Commands from the
// dashboard reach it as the same "ctrl" messages a controller gets. So the
// junction page, explicit commands, the manual-control lease and the activity
// list all run through the real code, and nothing reaches hardware.
//
// It behaves like the 2024 firmware where the dashboard can see it:
// - Auto runs the four-stage demo plan; the last 3 s of a stage are amber.
// - Manual (Auto=false) holds the current stage; Next moves on through amber
//   and holds the next stage.
// - Hold adds 10 s to the current stage, Next ends it early (both only
//   outside amber; Next only with 5 s or more left), in Auto.
// - Power=false turns the lamps dark; Restart drops off and comes back.

const PING_MS = 6000;
const INFO_MS = 10000;
const SIGN_REFRESH_MS = 2000;
const TICK_MS = 250;
const RESTART_MS = 4000;

// A socket that is not a network connection: the hub's messages to the
// controller go to `deliver`, and the controller's messages are emitted as
// "message" events, as the ws library does for a real socket.
class LoopbackSocket extends EventEmitter {
  constructor(deliver) {
    super();
    this.readyState = WebSocket.OPEN;
    this.clientType = null;
    this._deliver = deliver;
  }
  send(data) {
    if (this.readyState !== WebSocket.OPEN) return;
    const text = typeof data === "string" ? data : String(data);
    setImmediate(() => this._deliver(text));
  }
  ping() {}
  pong() {}
  close() {
    if (this.readyState === WebSocket.CLOSED) return;
    this.readyState = WebSocket.CLOSED;
    this.emit("close");
  }
  terminate() {
    this.close();
  }
}

// The signal string while a stage's green movements turn amber: a movement
// green now and not green in the next stage shows A.
function amberString(from, to) {
  const a = String(from);
  const b = String(to);
  let out = "";
  for (let i = 0; i < a.length; i++) out += a[i] === "G" && b[i] !== "G" ? "A" : a[i];
  return out;
}
const DARK = DEMO_PHASES[0].signalString.replace(/[RAG]/g, "X");

// The controller's signal logic, without timers or sockets, so it can be
// tested with a fake clock.
function createController(phases = DEMO_PHASES, amberS = DEMO_AMBER_S) {
  const s = {
    auto: true,
    power: true,
    index: 0,
    greenEndsAt: null, // Auto: when the current stage's green part ends
    amberEndsAt: 0, // while amber: when the next stage starts
  };
  const greenMs = (i) => Math.max(1, phases[i].duration - amberS) * 1000;
  const next = (i) => (i + 1) % phases.length;

  function start(t) {
    s.index = 0;
    s.amberEndsAt = 0;
    s.greenEndsAt = t + greenMs(0);
  }

  function advance(t) {
    // Catch up on whole stages if the clock jumped (a paused process).
    for (let guard = 0; guard < 50; guard++) {
      if (s.amberEndsAt && t >= s.amberEndsAt) {
        const at = s.amberEndsAt;
        s.index = next(s.index);
        s.amberEndsAt = 0;
        s.greenEndsAt = s.auto ? at + greenMs(s.index) : null;
        continue;
      }
      if (s.auto && !s.amberEndsAt && s.greenEndsAt !== null && t >= s.greenEndsAt) {
        s.amberEndsAt = s.greenEndsAt + amberS * 1000;
        continue;
      }
      break;
    }
  }

  function display(t) {
    advance(t);
    if (!s.power) return { phase: DARK, countdown: s.auto ? "0" : "X" };
    const here = phases[s.index].signalString;
    const phase = s.amberEndsAt ? amberString(here, phases[next(s.index)].signalString) : here;
    if (!s.auto) {
      return { phase, countdown: s.amberEndsAt ? String(Math.max(0, Math.ceil((s.amberEndsAt - t) / 1000))) : "X" };
    }
    const endsAt = s.amberEndsAt || s.greenEndsAt + amberS * 1000;
    return { phase, countdown: String(Math.max(0, Math.ceil((endsAt - t) / 1000))) };
  }

  // One key per message, as the firmware reads them.
  function command(param, t) {
    advance(t);
    const on = (v) => String(v) === "true";
    if ("Auto" in param) {
      const auto = on(param.Auto);
      if (auto && !s.auto) {
        s.auto = true;
        if (!s.amberEndsAt) s.greenEndsAt = t + greenMs(s.index);
      } else if (!auto && s.auto) {
        s.auto = false;
        s.greenEndsAt = null; // the stage holds (an amber in progress finishes first)
      }
      return "auto";
    }
    if ("Next" in param) {
      if (!on(param.Next) || s.amberEndsAt) return "next-ignored";
      if (!s.auto) {
        s.amberEndsAt = t + amberS * 1000;
        return "next";
      }
      if (s.greenEndsAt - t + amberS * 1000 >= 5000) {
        s.greenEndsAt = t;
        advance(t);
        return "next";
      }
      return "next-ignored";
    }
    if ("Hold" in param) {
      if (on(param.Hold) && s.auto && !s.amberEndsAt) s.greenEndsAt += 10000;
      return "hold";
    }
    if ("Power" in param) {
      s.power = on(param.Power);
      return "power";
    }
    if ("Restart" in param) return on(param.Restart) ? "restart" : "none";
    if ("Reset" in param) return "reset";
    return "query";
  }

  function state() {
    return {
      Auto: s.auto ? "true" : "false",
      Power: s.power ? "true" : "false",
      Next: "false",
      Hold: "false",
      Reboot: "false",
      Reset: "false",
      // Required by the stored record; the API's own default for outputs.
      SignalConfig: "active_low_cp",
      SignalLevel: "20",
      ErrorFlash: "false",
    };
  }

  function reboot(t) {
    s.auto = true;
    s.power = true;
    start(t);
  }

  return { s, start, display, command, state, reboot };
}

// Readings that drift slowly, like a cabinet in the afternoon sun.
function readings(t) {
  const wave = (period, phase) => Math.sin((t / period) * 2 * Math.PI + phase);
  const reading = (k) => ({
    Bat: (13.35 + 0.08 * wave(17 * 60000, k) + 0.01 * k).toFixed(2),
    Temp: (34 + 2.5 * wave(23 * 60000, k * 0.7) + 0.4 * k).toFixed(1),
  });
  return { North: reading(0), East: reading(1), South: reading(2), West: reading(3) };
}

let running = null;

// Starts the demo junction on the given hub. Safe to call once per process.
async function start({ wss, now = Date.now } = {}) {
  if (running || !wss) return running;
  try {
    const known = await AdminDevice.findOne({ deviceId: DEMO_DEVICE_ID });
    if (!known) {
      await AdminDevice.create({
        deviceId: DEMO_DEVICE_ID,
        deviceType: "QT-TSLC",
        deviceDepartment: DEMO_DEPARTMENT,
        adminEmail: "demo@quadrumtechnologies.com",
        deviceStatus: { status: "available" },
      });
    }
  } catch (error) {
    console.error("Demo junction: could not register the device:", error.message);
    return null;
  }
  // A lookup made before the device existed may be cached as unknown.
  forgetDevice(DEMO_DEVICE_ID);

  const ctl = createController();
  ctl.start(now());
  const timers = [];
  let socket = null;
  let lastSign = "";
  let lastSignAt = 0;

  const emit = (type, param) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    const body = JSON.stringify({ Event: "data", Type: type, Param: Object.assign({ DeviceID: DEMO_DEVICE_ID }, param) });
    socket.emit("message", Buffer.from(body));
  };
  const info = () =>
    emit("info", Object.assign(
      {
        Rtc: Math.floor(now() / 1000 + 3600),
        Plan: "1",
        Period: "00:00-23:59",
        JunctionId: DEMO_JUNCTION_NAME,
        // Required by the stored record. The password is a placeholder: the
        // demo junction has none, and the API never sends it to browsers.
        JunctionPassword: "demo",
        CommunicationFrequency: "433",
        CommunicationChannel: "1",
      },
      readings(now())
    ));
  const sign = (force) => {
    const t = now();
    const { phase, countdown } = ctl.display(t);
    const key = `${phase}|${countdown === "X" ? "X" : ""}`;
    if (!force && key === lastSign && t - lastSignAt < SIGN_REFRESH_MS) return;
    lastSign = key;
    lastSignAt = t;
    emit("sign", { Countdown: countdown, Phase: phase });
  };

  function onCtrl(text) {
    let msg;
    try {
      msg = JSON.parse(text);
    } catch (error) {
      return;
    }
    if (!msg || msg.Event !== "ctrl") return;
    const param = Object.assign({}, msg.Param);
    delete param.DeviceID;
    if (msg.Type === "info") {
      info();
      return;
    }
    if (msg.Type !== "state") return;
    const what = ctl.command(param, now());
    if (what === "query") emit("state", ctl.state());
    else if (what === "restart") restart();
    else sign(true);
  }

  async function connect() {
    socket = new LoopbackSocket(onCtrl);
    wss.clients.add(socket);
    socket.on("close", () => wss.clients.delete(socket));
    wss.emit("connection", socket, { headers: {}, socket: { remoteAddress: "127.0.0.1" } });
    await identify(socket);
  }

  // Reports count only after the hub has accepted the identify; until then it
  // tries again every few seconds, as a controller does after a refusal.
  async function identify(sock) {
    for (let attempt = 0; sock.readyState === WebSocket.OPEN && sock.clientType !== DEMO_DEVICE_ID; attempt++) {
      if (attempt > 0) forgetDevice(DEMO_DEVICE_ID);
      emit("identify", { SecretKey: "" });
      for (let i = 0; i < 40 && sock.clientType !== DEMO_DEVICE_ID; i++) {
        await new Promise((r) => setTimeout(r, 50));
      }
      if (sock.clientType !== DEMO_DEVICE_ID) await new Promise((r) => setTimeout(r, attempt < 3 ? 1000 : 5000));
    }
    // A first state report, so the junction page has the mode from the start.
    emit("state", ctl.state());
    sign(true);
  }

  function restart() {
    if (socket) socket.close();
    socket = null;
    setTimeout(() => {
      ctl.reboot(now());
      connect().catch((e) => console.error("Demo junction: reconnect failed:", e.message));
    }, RESTART_MS);
  }

  await connect();
  const every = (ms, fn) => {
    const id = setInterval(() => {
      try {
        fn();
      } catch (error) {
        console.error("Demo junction:", error.message);
      }
    }, ms);
    if (id.unref) id.unref();
    timers.push(id);
  };
  every(PING_MS, () => socket && socket.readyState === WebSocket.OPEN && socket.emit("ping", Buffer.from(DEMO_DEVICE_ID)));
  every(INFO_MS, info);
  every(TICK_MS, () => sign(false));
  console.log(`Demo junction ${DEMO_DEVICE_ID} is running.`);

  running = {
    ctl,
    stop() {
      timers.forEach(clearInterval);
      if (socket) socket.close();
      running = null;
    },
  };
  return running;
}

module.exports = { start, createController, amberString, LoopbackSocket };

const WebSocket = require("ws");
const { ControlLease } = require("../models/controlLeaseModel");
const { AuditLog } = require("../models/auditModel");
const { roleOf } = require("../utils/deviceAccess");

// Junction commands from the dashboard (event "junction_command").
//
// - Every command is explicit ("manual_on", not "toggle Auto") and carries an
//   id. The dashboard is told "sent", then "confirmed" when the controller's
//   own state report shows the change, or "no_reply" after 10 s.
// - Commands are refused while the controller is offline.
// - Manual control is a lease: one holder, a reason, an inactivity timeout
//   (15 min by default) and a 2-hour limit. When it ends the controller is
//   told to return to its plan. The 2024 firmware stays in manual while it
//   is connected, so the API has to end it.
// - Maintenance (restart, lamps, settings reset) is for client admins and
//   Quadrum admins, with the junction ID typed as confirmation.
// - Everything is written to the audit log with the junction's ID.

const IDLE_CHOICES = [5, 15, 30, 60];
const DEFAULT_IDLE = 15;
const HARD_LIMIT_MS = 2 * 60 * 60 * 1000;
const WARN_BEFORE_MS = 2 * 60 * 1000;
const HOLDER_GONE_MS = 60 * 1000;
const DEVICE_GONE_MS = 60 * 1000;
// The two delays can be shortened for tests through the environment.
const REPLY_TIMEOUT_MS = Number(process.env.JUNCTION_REPLY_TIMEOUT_MS) || 10 * 1000;
const RESTART_TIMEOUT_MS = 90 * 1000;
const QUERY_DELAY_MS = Number(process.env.JUNCTION_QUERY_DELAY_MS) || 1200;
const LOOP_MS = 5 * 1000;

const COMMANDS = {
  manual_on: { needs: "operate" },
  keep_control: { needs: "holder" },
  hold: { needs: "holder", param: { Hold: "true" } },
  next: { needs: "holder", param: { Next: "true" } },
  manual_off: { needs: "end" },
  restart: { needs: "maintain", param: { Restart: "true" }, confirm: true },
  lamps_off: { needs: "maintain", param: { Power: "false" }, confirm: true },
  lamps_on: { needs: "maintain", param: { Power: "true" } },
  reset_config: { needs: "maintain", param: { Reset: "true" }, confirm: true },
};

let ctx = null; // { wss, audienceFor }
const leases = new Map(); // deviceId -> lease
const pending = new Map(); // deviceId -> [{ id, ws, command, expect, done, timer, text }]
const holderSeenAt = new Map(); // deviceId -> ms
const deviceSeenAt = new Map(); // deviceId -> ms
const warnedFor = new Map(); // deviceId -> lastActionAt (ms) already warned about
let loop = null;

const now = () => Date.now();
const clock = (ms) =>
  new Date(ms).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: process.env.TIMEZONE || "Africa/Lagos",
  });

function actorOf(ws) {
  const { user, isAdmin } = ws.account;
  return {
    email: String(user.email || "").toLowerCase(),
    name: user.name || user.email,
    role: isAdmin ? "quadrum" : roleOf(user),
    isAdmin: Boolean(isAdmin),
  };
}

const ROLE_WORD = { admin: "client admin", operator: "operator", quadrum: "Quadrum", viewer: "viewer" };

// A client admin can end or take over from an operator or Quadrum; Quadrum
// can from an operator. Nobody overrides a client admin.
function canOverride(actor, lease) {
  if (actor.role === "admin") return lease.holderRole === "operator" || lease.holderRole === "quadrum";
  if (actor.role === "quadrum") return lease.holderRole === "operator";
  return false;
}

function send(ws, message) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}

function deviceSocket(deviceId) {
  if (!ctx) return null;
  let found = null;
  ctx.wss.clients.forEach((client) => {
    if (client.clientType === deviceId && client.readyState === WebSocket.OPEN) found = client;
  });
  return found;
}

function toDevice(deviceId, param) {
  const socket = deviceSocket(deviceId);
  if (!socket) return false;
  socket.send(JSON.stringify({ Event: "ctrl", Type: "state", Param: Object.assign({ DeviceID: deviceId }, param) }));
  return true;
}

function queryState(deviceId, delay = QUERY_DELAY_MS) {
  setTimeout(() => toDevice(deviceId, {}), delay);
}

async function toWatchers(deviceId, message) {
  if (!ctx) return;
  const audience = await ctx.audienceFor(deviceId);
  audience.forEach((client) => {
    if (client.clientType === "web_app") send(client, message);
  });
}

function presentLease(lease) {
  if (!lease) return null;
  return {
    holderName: lease.holderName,
    holderEmail: lease.holderEmail,
    holderRole: lease.holderRole,
    reason: lease.reason,
    idleMinutes: lease.idleMinutes,
    startedAt: new Date(lease.startedAt).toISOString(),
    lastActionAt: new Date(lease.lastActionAt).toISOString(),
    idleEndsAt: new Date(lease.lastActionAt + lease.idleMinutes * 60000).toISOString(),
    hardEndsAt: new Date(lease.hardEndsAt).toISOString(),
  };
}

function leaseMessage(deviceId, message) {
  return { event: "control_lease", DeviceID: deviceId, lease: presentLease(leases.get(deviceId)), message: message || null };
}

async function audit(entry) {
  try {
    await AuditLog.create(
      Object.assign({ userType: "user", endpoint: "ws junction_command", status: "success" }, entry)
    );
  } catch (error) {
    console.error("Audit log write failed:", error.message);
  }
}

async function auditActor(actor, deviceId, reason, status = "success") {
  await audit({
    userType: actor.isAdmin ? "admin" : "user",
    email: actor.email,
    actorName: actor.name,
    deviceId,
    reason,
    status,
  });
}

async function saveLease(lease) {
  leases.set(lease.deviceId, lease);
  try {
    await ControlLease.findOneAndUpdate(
      { deviceId: lease.deviceId },
      {
        deviceId: lease.deviceId,
        holderEmail: lease.holderEmail,
        holderName: lease.holderName,
        holderRole: lease.holderRole,
        reason: lease.reason,
        idleMinutes: lease.idleMinutes,
        startedAt: new Date(lease.startedAt),
        lastActionAt: new Date(lease.lastActionAt),
        hardEndsAt: new Date(lease.hardEndsAt),
      },
      { upsert: true }
    );
  } catch (error) {
    console.error("Saving the manual-control lease failed:", error.message);
  }
}

async function dropLease(deviceId) {
  leases.delete(deviceId);
  holderSeenAt.delete(deviceId);
  warnedFor.delete(deviceId);
  try {
    await ControlLease.deleteOne({ deviceId });
  } catch (error) {
    console.error("Deleting the manual-control lease failed:", error.message);
  }
}

// Ends a lease: tells the controller to return to its plan and everyone
// watching why. Used for timeouts, disconnections and the holder's own choice.
async function endLease(deviceId, why, { by = null, tellDevice = true } = {}) {
  const lease = leases.get(deviceId);
  if (!lease) return;
  await dropLease(deviceId);
  if (tellDevice && toDevice(deviceId, { Auto: "true" })) queryState(deviceId);
  const text = by ? `Manual control ended by ${by.name}: ${why}` : `Manual control ended: ${why}`;
  await toWatchers(deviceId, leaseMessage(deviceId, `${text}. The junction is back on its plan.`));
  if (by) await auditActor(by, deviceId, text);
  else
    await audit({
      userType: lease.holderRole === "quadrum" ? "admin" : "user",
      email: lease.holderEmail,
      actorName: lease.holderName,
      endpoint: "system",
      deviceId,
      reason: text,
    });
}

// A command waits for the controller's report. expect(state) decides from a
// state report; restart waits for the controller to identify again.
function track(deviceId, entry) {
  const list = pending.get(deviceId) || [];
  entry.timer = setTimeout(() => settle(deviceId, entry, "no_reply"), entry.timeout || REPLY_TIMEOUT_MS);
  list.push(entry);
  pending.set(deviceId, list);
}

function settle(deviceId, entry, status, message) {
  const list = pending.get(deviceId) || [];
  const i = list.indexOf(entry);
  if (i === -1) return;
  list.splice(i, 1);
  clearTimeout(entry.timer);
  const text =
    message ||
    (status === "confirmed"
      ? entry.confirmedText
      : entry.command === "restart"
      ? "The controller hasn't come back yet. It may still be restarting; check again in a minute."
      : "No reply from the controller after 10 s. The screen shows what it last reported.");
  send(entry.ws, { event: "command_status", id: entry.id, DeviceID: deviceId, command: entry.command, status, message: text });
}

// From the controller.
function onDeviceState(deviceId, state) {
  deviceSeenAt.set(deviceId, now());
  const list = (pending.get(deviceId) || []).slice();
  list.forEach((entry) => {
    if (entry.expect && entry.expect(state || {})) settle(deviceId, entry, "confirmed");
  });
}

async function onDeviceIdentify(deviceId) {
  deviceSeenAt.set(deviceId, now());
  (pending.get(deviceId) || []).slice().forEach((entry) => {
    if (entry.command === "restart") settle(deviceId, entry, "confirmed", "The controller restarted and is back online.");
  });
  // After a reconnection the 2024 firmware has gone back to its plan by itself
  // (it only stays in manual while it is connected).
  if (leases.has(deviceId)) {
    await endLease(deviceId, "the controller reconnected and is running its plan again");
  }
}

function onDeviceActivity(deviceId) {
  deviceSeenAt.set(deviceId, now());
}

// For a page that has just opened a junction.
function sendLease(ws, deviceId) {
  send(ws, leaseMessage(deviceId));
}

function refused(ws, id, deviceId, command, message) {
  send(ws, { event: "command_status", id, DeviceID: deviceId, command, status: "refused", message });
}

async function handleCommand(ws, audience, payload) {
  const deviceId = String(payload.DeviceID || "");
  const id = String(payload.id || `${now()}`);
  const command = String(payload.command || "");
  const spec = COMMANDS[command];
  if (!spec) return refused(ws, id, deviceId, command, "Unknown command.");
  const actor = actorOf(ws);
  const lease = leases.get(deviceId) || null;
  const isHolder = Boolean(lease) && lease.holderEmail === actor.email;

  if (spec.needs === "maintain" && !(actor.role === "admin" || actor.role === "quadrum")) {
    return refused(ws, id, deviceId, command, "Only a client admin or Quadrum can do this.");
  }
  if (spec.needs === "operate" && !["admin", "operator", "quadrum"].includes(actor.role)) {
    return refused(ws, id, deviceId, command, "Your account can view this junction but not operate it.");
  }
  if (spec.needs === "holder" && !isHolder) {
    return refused(
      ws, id, deviceId, command,
      lease ? `${lease.holderName} has manual control. Only the holder can do this.` : "Take manual control first."
    );
  }
  if (spec.needs === "end" && !lease) {
    return refused(ws, id, deviceId, command, "The junction isn't in manual control from the dashboard.");
  }
  if (spec.needs === "end" && !isHolder && !canOverride(actor, lease)) {
    return refused(ws, id, deviceId, command, `${lease.holderName} has manual control. Ask them to return it.`);
  }
  if (spec.confirm && String(payload.confirm || "").trim().toUpperCase() !== deviceId.toUpperCase()) {
    return refused(ws, id, deviceId, command, `Type the junction ID (${deviceId}) to confirm.`);
  }
  if (!deviceSocket(deviceId)) {
    return refused(ws, id, deviceId, command, "The controller is offline. Commands are off until it reconnects.");
  }

  const t = now();

  if (command === "manual_on") {
    const reason = String(payload.reason || "").trim().slice(0, 200);
    if (reason.length < 3) return refused(ws, id, deviceId, command, "Say why you're taking manual control.");
    const minutes = IDLE_CHOICES.includes(Number(payload.minutes)) ? Number(payload.minutes) : DEFAULT_IDLE;
    let takeover = null;
    if (lease && !isHolder) {
      if (!canOverride(actor, lease)) {
        return refused(
          ws, id, deviceId, command,
          `${lease.holderName} has manual control until ${clock(Math.min(lease.lastActionAt + lease.idleMinutes * 60000, lease.hardEndsAt))}. Ask them to return it.`
        );
      }
      takeover = lease;
    }
    const next = {
      deviceId,
      holderEmail: actor.email,
      holderName: actor.name,
      holderRole: actor.role,
      reason,
      idleMinutes: minutes,
      startedAt: isHolder ? lease.startedAt : t,
      lastActionAt: t,
      hardEndsAt: isHolder ? lease.hardEndsAt : t + HARD_LIMIT_MS,
    };
    await saveLease(next);
    holderSeenAt.set(deviceId, t);
    toDevice(deviceId, { Auto: "false" });
    queryState(deviceId);
    track(deviceId, {
      id, ws, command,
      expect: (s) => String(s.Auto) === "false",
      confirmedText: `The controller is in manual control. It returns to its plan after ${minutes} min without action.`,
    });
    send(ws, { event: "command_status", id, DeviceID: deviceId, command, status: "sent", message: "Sending to the controller…" });
    const text = takeover
      ? `Took over manual control from ${takeover.holderName} for ${minutes} min: ${reason}`
      : `Took manual control for ${minutes} min: ${reason}`;
    await toWatchers(deviceId, leaseMessage(deviceId, `${actor.name} ${text.charAt(0).toLowerCase()}${text.slice(1)}`));
    await auditActor(actor, deviceId, text);
    return;
  }

  if (command === "keep_control") {
    lease.lastActionAt = t;
    await saveLease(lease);
    warnedFor.delete(deviceId);
    send(ws, {
      event: "command_status", id, DeviceID: deviceId, command, status: "confirmed",
      message: `You keep manual control until ${clock(Math.min(t + lease.idleMinutes * 60000, lease.hardEndsAt))} unless you act again.`,
    });
    await toWatchers(deviceId, leaseMessage(deviceId));
    return;
  }

  if (command === "manual_off") {
    const by = isHolder ? actor : actor;
    const why = isHolder ? "returned to the plan" : `ended ${lease.holderName}'s manual control`;
    track(deviceId, { id, ws, command, expect: (s) => String(s.Auto) === "true", confirmedText: "The controller is running its plan again." });
    send(ws, { event: "command_status", id, DeviceID: deviceId, command, status: "sent", message: "Sending to the controller…" });
    await endLease(deviceId, why, { by });
    return;
  }

  // hold, next, restart, lamps, reset
  if (lease && isHolder) {
    lease.lastActionAt = t;
    await saveLease(lease);
    warnedFor.delete(deviceId);
  }
  toDevice(deviceId, spec.param);
  const texts = {
    hold: ["Held the current stage for 10 s more", "The controller added 10 s to the current stage."],
    next: ["Asked for the next stage", "The controller accepted it. It moves on unless the stage has less than 5 s left or is in amber."],
    restart: ["Restarted the controller", null],
    lamps_off: ["Turned the lamps off", "The lamps are off."],
    lamps_on: ["Turned the lamps on", "The lamps are on."],
    reset_config: ["Reset the controller's settings to factory values", "The controller reset its settings."],
  };
  const [logText, confirmedText] = texts[command];
  if (command === "restart") {
    // The controller drops off and identifies again when it's back.
    track(deviceId, { id, ws, command, expect: null, timeout: RESTART_TIMEOUT_MS, confirmedText: "The controller restarted and is back online." });
    send(ws, { event: "command_status", id, DeviceID: deviceId, command, status: "sent", message: "Restarting. The controller drops off for a moment." });
  } else {
    queryState(deviceId);
    const expect =
      command === "lamps_off" ? (s) => String(s.Power) === "false"
      : command === "lamps_on" ? (s) => String(s.Power) === "true"
      : () => true; // any report after the command: it was received and processed in order
    track(deviceId, { id, ws, command, expect, confirmedText });
    send(ws, { event: "command_status", id, DeviceID: deviceId, command, status: "sent", message: "Sending to the controller…" });
  }
  if (lease && isHolder) await toWatchers(deviceId, leaseMessage(deviceId));
  await auditActor(actor, deviceId, logText);
}

// Timeouts, warnings and disconnections, every few seconds.
async function tick() {
  const t = now();
  for (const lease of Array.from(leases.values())) {
    const { deviceId } = lease;
    const idleEnd = lease.lastActionAt + lease.idleMinutes * 60000;
    if (t >= lease.hardEndsAt) {
      await endLease(deviceId, "it reached the 2-hour limit");
      continue;
    }
    if (t >= idleEnd) {
      await endLease(deviceId, `no action for ${lease.idleMinutes} min`);
      continue;
    }
    if (deviceSocket(deviceId)) {
      deviceSeenAt.set(deviceId, t);
    } else if (t - (deviceSeenAt.get(deviceId) || lease.lastActionAt) >= DEVICE_GONE_MS) {
      // Offline, it returns to its plan by itself; nothing to send.
      await endLease(deviceId, "the controller went offline and returns to its plan by itself", { tellDevice: false });
      continue;
    }
    let holderOnline = false;
    if (ctx) {
      ctx.wss.clients.forEach((client) => {
        if (
          client.clientType === "web_app" &&
          client.readyState === WebSocket.OPEN &&
          client.account &&
          String(client.account.user.email || "").toLowerCase() === lease.holderEmail
        ) {
          holderOnline = true;
        }
      });
    }
    if (holderOnline) holderSeenAt.set(deviceId, t);
    else if (t - (holderSeenAt.get(deviceId) || t) >= HOLDER_GONE_MS) {
      await endLease(deviceId, `${lease.holderName}'s dashboard closed`);
      continue;
    }
    if (idleEnd - t <= WARN_BEFORE_MS && warnedFor.get(deviceId) !== lease.lastActionAt) {
      warnedFor.set(deviceId, lease.lastActionAt);
      await toWatchers(deviceId, {
        event: "control_lease_warning",
        DeviceID: deviceId,
        holderEmail: lease.holderEmail,
        endsAt: new Date(idleEnd).toISOString(),
        message: `Manual control ends at ${clock(idleEnd)} unless ${lease.holderName} acts or keeps control.`,
      });
    }
  }
}

async function init({ wss, audienceFor }) {
  ctx = { wss, audienceFor };
  try {
    const saved = await ControlLease.find({}).lean();
    saved.forEach((l) => {
      leases.set(l.deviceId, {
        deviceId: l.deviceId,
        holderEmail: l.holderEmail,
        holderName: l.holderName,
        holderRole: l.holderRole,
        reason: l.reason,
        idleMinutes: l.idleMinutes,
        startedAt: new Date(l.startedAt).getTime(),
        lastActionAt: new Date(l.lastActionAt).getTime(),
        hardEndsAt: new Date(l.hardEndsAt).getTime(),
      });
      // Give holders and controllers a moment to reconnect after a restart.
      holderSeenAt.set(l.deviceId, now());
      deviceSeenAt.set(l.deviceId, now());
    });
    if (saved.length) console.log(`Manual-control leases restored: ${saved.map((l) => l.deviceId).join(", ")}`);
  } catch (error) {
    console.error("Loading manual-control leases failed:", error.message);
  }
  clearInterval(loop);
  loop = setInterval(() => tick().catch((e) => console.error("Lease check failed:", e.message)), LOOP_MS);
  if (loop.unref) loop.unref();
}

module.exports = {
  init,
  handleCommand,
  onDeviceState,
  onDeviceIdentify,
  onDeviceActivity,
  sendLease,
  tick,
  _state: { leases, pending, holderSeenAt, deviceSeenAt },
  ROLE_WORD,
};

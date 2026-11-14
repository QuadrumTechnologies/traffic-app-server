#!/usr/bin/env node
// Email an operations alert to the Quadrum team, using the API's own mail
// settings from .env.
//
//   echo "what happened" | node ops/notify.js "subject"
//
// Goes to OPS_ALERT_TO, else ACCESS_REQUESTS_TO, else hello@quadrumtechnologies.com.
// Called by quadrum-alert (ops/alert.sh); see DEPLOY.md.

const os = require("os");
const path = require("path");

const APP_DIR = path.resolve(__dirname, "..");
require(path.join(APP_DIR, "node_modules/dotenv")).config({
  path: path.join(APP_DIR, ".env"),
  quiet: true,
});
const Email = require(path.join(APP_DIR, "utils/email"));

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);

async function readStdin() {
  if (process.stdin.isTTY) return "";
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  return text;
}

async function main() {
  const subject = process.argv[2] || "Alert";
  const body = (await readStdin()).slice(0, 20000);
  const to =
    process.env.OPS_ALERT_TO ||
    process.env.ACCESS_REQUESTS_TO ||
    "hello@quadrumtechnologies.com";
  const html =
    `<p style="font:15px/1.5 sans-serif"><strong>${esc(subject)}</strong></p>` +
    (body ? `<pre style="font:12px/1.45 monospace;white-space:pre-wrap;background:#f6f6f6;padding:12px;border-radius:6px">${esc(body)}</pre>` : "") +
    `<p style="font:12px sans-serif;color:#777">Sent by the traffic API's ops tools on ${esc(os.hostname())} at ${new Date().toISOString()}. See DEPLOY.md in traffic-app-server.</p>`;
  await new Email({ email: to, name: "Quadrum team" }, null).send(html, `[Quadrum ops] ${subject}`);
  console.log("Alert sent.");
}

main().catch((error) => {
  console.error(`Alert NOT sent: ${error.message}`);
  process.exit(1);
});

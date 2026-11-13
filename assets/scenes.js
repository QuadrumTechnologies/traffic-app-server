/* Three animated scenes for the Products section, drawn in SVG:
   1. A four-phase cycle running at a junction (what the TSLC controller does today).
   2. Detection, actuation and red-light enforcement on one approach.
   3. A control room: identification, safety and revenue on one screen.
   Each scene runs only while visible, has a Pause button, and starts paused
   when the visitor prefers reduced motion. Drivers keep to the right. */
(() => {
  "use strict";
  const NS = "http://www.w3.org/2000/svg";
  const REDUCE = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  const C = {
    bg: "#0d1115", block: "#13181e", asphalt: "#1c2128", line: "#2a3038",
    mark: "#cfd5db", dim: "#59616b", red: "#ec5a4c", amber: "#f3b42a",
    green: "#36c07a", teal: "#4cc6d4", ink: "#eef2f5", muted: "#a3abb5", off: "#262b32",
  };
  const CAR_COLORS = ["#d7dde3", "#9fb7c9", "#d9c38f", "#c99b95", "#a7c7a2", "#b9a6cf", "#e6e1d6", "#8ea0ad"];

  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  // Keep " · " separators from collapsing in SVG text.
  const T = (s) => String(s).replace(/ · /g, "\u00a0·\u00a0");
  function txt(parent, x, y, s, attrs) {
    const t = el("text", Object.assign({ x, y }, attrs || {}), parent);
    t.textContent = T(s);
    return t;
  }
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (list) => list[Math.floor(Math.random() * list.length)];

  // Sample an SVG path every 2 px so cars can be placed without layout calls.
  function samplePath(svg, d) {
    const p = el("path", { d, fill: "none", stroke: "none" }, svg);
    const len = p.getTotalLength();
    const pts = [];
    for (let s = 0; s <= len; s += 2) {
      const a = p.getPointAtLength(s);
      const b = p.getPointAtLength(Math.min(len, s + 2));
      const c = s + 2 > len ? p.getPointAtLength(Math.max(0, s - 2)) : a;
      const ang = s + 2 > len ? Math.atan2(a.y - c.y, a.x - c.x) : Math.atan2(b.y - a.y, b.x - a.x);
      pts.push({ x: a.x, y: a.y, a: (ang * 180) / Math.PI });
    }
    p.remove();
    return { len, at: (s) => pts[Math.max(0, Math.min(pts.length - 1, Math.round(s / 2)))] };
  }

  function makeCar(layer, color) {
    const g = el("g", {}, layer);
    el("rect", { x: -9.5, y: -5.2, width: 19, height: 10.4, rx: 2.6, fill: color }, g);
    el("rect", { x: 1.5, y: -4.2, width: 4.2, height: 8.4, rx: 1.2, fill: "#1f262e", opacity: 0.85 }, g);
    el("rect", { x: -7.5, y: -4.2, width: 3, height: 8.4, rx: 1, fill: "#1f262e", opacity: 0.6 }, g);
    el("circle", { cx: 9, cy: -3.3, r: 1.2, fill: "#fff3c4" }, g);
    el("circle", { cx: 9, cy: 3.3, r: 1.2, fill: "#fff3c4" }, g);
    return g;
  }

  // Lane traffic: cars follow each other along a path and stop at the stop
  // line unless their signal allows them through.
  function laneTraffic(svg, layer, lanes, opts) {
    const o = Object.assign({ vmax: 170, acc: 280, gap: 27 }, opts || {});
    lanes.forEach((l) => {
      l.path = samplePath(svg, l.d);
      l.cars = [];
      l.timer = rand(0, l.every[1]);
    });
    function spawn(l, extra) {
      const last = l.cars[l.cars.length - 1];
      if (last && last.s < o.gap + 6) return null;
      const car = Object.assign({ s: 0, v: o.vmax * 0.8, g: makeCar(layer, pick(CAR_COLORS)), vmax: o.vmax, obeys: true }, extra || {});
      l.cars.push(car);
      return car;
    }
    function step(dt, signal) {
      lanes.forEach((l) => {
        l.timer -= dt;
        if (l.timer <= 0) {
          spawn(l);
          l.timer = rand(l.every[0], l.every[1]);
        }
        const state = signal(l.group);
        for (let i = 0; i < l.cars.length; i++) {
          const car = l.cars[i];
          let limit = Infinity;
          if (i > 0) limit = l.cars[i - 1].s - o.gap;
          if (car.obeys && car.s <= l.stop) {
            const mustStop = state === "R" || (state === "A" && l.stop - car.s > 26);
            if (mustStop) limit = Math.min(limit, l.stop);
          }
          car.v = Math.min(car.vmax, car.v + o.acc * dt);
          // Brake smoothly towards the limit.
          const room = limit - car.s;
          if (room < 60) car.v = Math.min(car.v, Math.max(0, room) * 3.2);
          let next = car.s + car.v * dt;
          if (next > limit) {
            next = Math.max(car.s, limit);
            car.v = 0;
          }
          if (car.onCross && car.s < l.stop && next >= l.stop) car.onCross(car, l);
          car.s = next;
        }
        while (l.cars.length && l.cars[0].s > l.path.len) {
          l.cars.shift().g.remove();
        }
      });
    }
    function render() {
      lanes.forEach((l) => {
        l.cars.forEach((car) => {
          const p = l.path.at(car.s - 9);
          car.g.setAttribute("transform", `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)}) rotate(${p.a.toFixed(1)})`);
        });
      });
    }
    return { step, render, spawn, lanes };
  }

  // Runs a scene while it is on screen and playing; the button pauses it.
  function runner(figure, svg, step, render) {
    const button = figure.querySelector(".scene-play");
    let playing = !REDUCE;
    let visible = false;
    let last = 0;
    let raf = 0;
    const loop = (t) => {
      const dt = Math.min(0.05, Math.max(0, (t - last) / 1000));
      last = t;
      step(dt);
      render();
      raf = requestAnimationFrame(loop);
    };
    const sync = () => {
      cancelAnimationFrame(raf);
      if (playing && visible) {
        last = performance.now();
        raf = requestAnimationFrame(loop);
      }
      if (button) {
        button.textContent = T(playing ? "Pause" : "Play");
        button.setAttribute("aria-pressed", String(!playing));
      }
    };
    if (button) button.addEventListener("click", () => { playing = !playing; sync(); });
    if ("IntersectionObserver" in window) {
      new IntersectionObserver((entries) => { visible = entries[0].isIntersecting; sync(); }, { threshold: 0.1 }).observe(svg);
    } else {
      visible = true;
    }
    render();
    sync();
  }

  function signalHead(parent, x, y, label) {
    const g = el("g", { transform: `translate(${x} ${y})` }, parent);
    el("rect", { x: -8, y: -24, width: 16, height: 48, rx: 4, fill: "#090c0f", stroke: "#3a414a", "stroke-width": 1 }, g);
    const lamps = {
      R: el("circle", { cx: 0, cy: -15, r: 5, fill: C.off }, g),
      A: el("circle", { cx: 0, cy: 0, r: 5, fill: C.off }, g),
      G: el("circle", { cx: 0, cy: 15, r: 5, fill: C.off }, g),
    };
    const arrowBox = el("rect", { x: -8, y: 27, width: 16, height: 14, rx: 3, fill: "#090c0f", stroke: "#3a414a", "stroke-width": 1 }, g);
    const arrow = el("path", { d: "M5 34 H-3 M-3 34 l3.5 -3.5 M-3 34 l3.5 3.5", stroke: C.off, "stroke-width": 2.2, "stroke-linecap": "round", fill: "none" }, g);
    if (label) txt(g, 0, 54, label, { "text-anchor": "middle", class: "scene-small" });
    void arrowBox;
    return {
      set(main, left) {
        lamps.R.setAttribute("fill", main === "R" ? C.red : C.off);
        lamps.A.setAttribute("fill", main === "A" ? C.amber : C.off);
        lamps.G.setAttribute("fill", main === "G" ? C.green : C.off);
        arrow.setAttribute("stroke", left === "G" ? C.green : left === "A" ? C.amber : C.off);
      },
    };
  }

  function drawJunctionBase(svg, box, opts) {
    // box: {x1,x2,y1,y2}; roads run the full width and height.
    const { x1, x2, y1, y2 } = box;
    el("rect", { x: 0, y: 0, width: 800, height: 450, fill: C.bg }, svg);
    const corners = [
      [0, 0, x1 - 6, y1 - 6], [x2 + 6, 0, 800 - x2 - 6, y1 - 6],
      [0, y2 + 6, x1 - 6, 450 - y2 - 6], [x2 + 6, y2 + 6, 800 - x2 - 6, 450 - y2 - 6],
    ];
    corners.forEach(([x, y, w, h]) => el("rect", { x, y, width: w, height: h, rx: 14, fill: C.block }, svg));
    el("rect", { x: x1, y: 0, width: x2 - x1, height: 450, fill: C.asphalt }, svg);
    el("rect", { x: 0, y: y1, width: 800, height: y2 - y1, fill: C.asphalt }, svg);
    void opts;
  }

  function dash(svg, x1, y1, x2, y2, solid) {
    el("line", { x1, y1, x2, y2, stroke: C.mark, "stroke-width": 1.6, "stroke-dasharray": solid ? "none" : "10 10", opacity: 0.7 }, svg);
  }

  function zebra(svg, x, y, w, h, vertical) {
    const n = vertical ? Math.floor(h / 9) : Math.floor(w / 9);
    for (let i = 0; i < n; i++) {
      if (vertical) el("rect", { x, y: y + i * 9 + 1, width: w, height: 5, fill: C.mark, opacity: 0.55 }, svg);
      else el("rect", { x: x + i * 9 + 1, y, width: 5, height: h, fill: C.mark, opacity: 0.55 }, svg);
    }
  }

  /* ---------------- Scene 1: a four-phase cycle ---------------- */
  function sceneCycle(figure) {
    const host = figure.querySelector(".scene-svg");
    const svg = el("svg", { viewBox: "0 0 800 450", role: "img", "aria-label": figure.dataset.label || "" }, host);
    const box = { x1: 330, x2: 470, y1: 155, y2: 295 };
    drawJunctionBase(svg, box);
    // Centre lines, lane lines, stop lines, crossings.
    [[400, 0, 400, 125], [400, 325, 400, 450]].forEach(([a, b, c, d]) => { dash(svg, a - 1.5, b, c - 1.5, d, true); dash(svg, a + 1.5, b, c + 1.5, d, true); });
    [[0, 225, 300, 225], [500, 225, 800, 225]].forEach(([a, b, c, d]) => { dash(svg, a, b - 1.5, c, d - 1.5, true); dash(svg, a, b + 1.5, c, d + 1.5, true); });
    dash(svg, 365, 0, 365, 125); dash(svg, 435, 0, 435, 125); dash(svg, 365, 325, 365, 450); dash(svg, 435, 325, 435, 450);
    dash(svg, 0, 190, 300, 190); dash(svg, 0, 260, 300, 260); dash(svg, 500, 190, 800, 190); dash(svg, 500, 260, 800, 260);
    el("rect", { x: 330, y: 122, width: 70, height: 4, fill: C.mark }, svg);
    el("rect", { x: 400, y: 324, width: 70, height: 4, fill: C.mark }, svg);
    el("rect", { x: 298, y: 225, width: 4, height: 70, fill: C.mark }, svg);
    el("rect", { x: 498, y: 155, width: 4, height: 70, fill: C.mark }, svg);
    zebra(svg, 333, 131, 134, 20, false);
    zebra(svg, 333, 299, 134, 20, false);
    zebra(svg, 307, 158, 20, 134, true);
    zebra(svg, 473, 158, 20, 134, true);
    // Lane arrows on the approaches.
    const arrows = el("g", { fill: "none", stroke: C.mark, "stroke-width": 2, opacity: 0.55, "stroke-linecap": "round" }, svg);
    el("path", { d: "M347.5 80 v26 m-5 -6 l5 6 l5 -6" }, arrows);
    el("path", { d: "M382.5 80 v14 q0 10 10 10 m-6 -5 l6 5 l-6 5" }, arrows);
    el("path", { d: "M452.5 370 v-26 m-5 6 l5 -6 l5 6" }, arrows);
    el("path", { d: "M417.5 370 v-14 q0 -10 -10 -10 m6 5 l-6 -5 l6 -5" }, arrows);
    el("path", { d: "M240 277.5 h26 m-6 -5 l6 5 l-6 5" }, arrows);
    el("path", { d: "M240 242.5 h14 q10 0 10 -10 m-5 6 l5 -6 l5 6" }, arrows);
    el("path", { d: "M560 172.5 h-26 m6 -5 l-6 5 l6 5" }, arrows);
    el("path", { d: "M560 207.5 h-14 q-10 0 -10 10 m-5 -6 l5 6 l5 -6" }, arrows);

    const cars = el("g", {}, svg);
    const lanes = [
      { group: "SB_A", d: "M347.5 -30 V480", stop: 152, every: [1.5, 3.2] },
      { group: "SB_L", d: "M382.5 -30 V155 C382.5 212 418 242.5 470 242.5 H830", stop: 152, every: [3.6, 6.5] },
      { group: "NB_A", d: "M452.5 480 V-30", stop: 152, every: [1.5, 3.2] },
      { group: "NB_L", d: "M417.5 480 V295 C417.5 238 382 207.5 330 207.5 H-30", stop: 152, every: [3.6, 6.5] },
      { group: "EB_A", d: "M-30 277.5 H830", stop: 326, every: [1.2, 2.8] },
      { group: "EB_L", d: "M-30 242.5 H330 C387 242.5 417.5 212 417.5 155 V-30", stop: 326, every: [3.4, 6.2] },
      { group: "WB_A", d: "M830 172.5 H-30", stop: 326, every: [1.2, 2.8] },
      { group: "WB_L", d: "M830 207.5 H470 C413 207.5 382.5 238 382.5 295 V480", stop: 326, every: [3.4, 6.2] },
    ];
    const traffic = laneTraffic(svg, cars, lanes);

    // Plan as on the hero chart: leading lefts, 120 s, amber 3 s, all-red 2 s.
    const plan = [
      { n: 1, name: "N–S left turn", groups: ["SB_L", "NB_L"], g: 12 },
      { n: 2, name: "N–S through", groups: ["SB_A", "NB_A"], g: 38 },
      { n: 3, name: "E–W left turn", groups: ["EB_L", "WB_L"], g: 12 },
      { n: 4, name: "E–W through", groups: ["EB_A", "WB_A"], g: 38 },
    ];
    const AMBER = 3, ALLRED = 2, SPEED = 6;
    const CYCLE = plan.reduce((a, p) => a + p.g + AMBER + ALLRED, 0);
    let t = 13;

    function phaseAt(time) {
      let acc = 0;
      for (const p of plan) {
        const start = acc;
        acc += p.g + AMBER + ALLRED;
        if (time < acc) {
          const into = time - start;
          const part = into < p.g ? "G" : into < p.g + AMBER ? "A" : "R";
          const left = part === "G" ? p.g - into : part === "A" ? p.g + AMBER - into : p.g + AMBER + ALLRED - into;
          return { p, part, left };
        }
      }
      return { p: plan[0], part: "G", left: plan[0].g };
    }
    function signal(group) {
      const { p, part } = phaseAt(t);
      if (!p.groups.includes(group)) return "R";
      return part;
    }

    // Heads on each approach (near side, right of the driver).
    const heads = {
      SB: signalHead(svg, 312, 82, "N"),
      NB: signalHead(svg, 488, 352, "S"),
      EB: signalHead(svg, 262, 318, "W"),
      WB: signalHead(svg, 538, 106, "E"),
    };

    // Readout and timeline.
    const hud = el("g", { transform: "translate(16 16)" }, svg);
    el("rect", { width: 262, height: 58, rx: 8, fill: "#0b0e12", stroke: C.line }, hud);
    const hud1 = txt(hud, 14, 24, "", { class: "scene-mono scene-teal" });
    const hud2 = txt(hud, 14, 44, "", { class: "scene-text" });
    el("rect", { x: 8, y: 396, width: 784, height: 46, rx: 8, fill: "#0b0e12", opacity: 0.88 }, svg);
    const tl = el("g", { transform: "translate(16 404)" }, svg);
    const W = 768;
    let x = 0;
    plan.forEach((p) => {
      const gw = (p.g / CYCLE) * W, aw = (AMBER / CYCLE) * W, rw = (ALLRED / CYCLE) * W;
      el("rect", { x, y: 10, width: gw, height: 12, fill: C.green, opacity: 0.9 }, tl);
      el("rect", { x: x + gw, y: 10, width: aw, height: 12, fill: C.amber }, tl);
      el("rect", { x: x + gw + aw, y: 10, width: rw, height: 12, fill: C.red, opacity: 0.75 }, tl);
      txt(tl, x + 2, 4, `${p.n} ${p.name}`, { class: "scene-small" });
      x += gw + aw + rw;
    });
    const cursor = el("rect", { x: 0, y: 6, width: 2, height: 20, fill: C.ink }, tl);
    // Cabinet note.
    const cab = el("g", { transform: "translate(560 322)" }, svg);
    el("rect", { width: 34, height: 44, rx: 4, fill: "#2b333d", stroke: "#46505c" }, cab);
    const led = el("circle", { cx: 26, cy: 9, r: 3, fill: C.green }, cab);
    txt(cab, 44, 16, "TSLC 2.0 controller", { class: "scene-text" });
    txt(cab, 44, 34, "runs the plan by itself", { class: "scene-small" });

    function step(dt) {
      t = (t + dt * SPEED) % CYCLE;
      traffic.step(dt, signal);
    }
    function render() {
      const { p, part, left } = phaseAt(t);
      hud1.textContent = T(`PHASE ${p.n} · ${p.name.toUpperCase()}`);
      hud2.textContent = T(`${part === "G" ? "Green" : part === "A" ? "Amber" : "All red"} · ${Math.ceil(left)} s`);
      cursor.setAttribute("x", ((t / CYCLE) * W).toFixed(1));
      const s = (g) => signal(g);
      heads.SB.set(s("SB_A"), s("SB_L") === "R" ? "off" : s("SB_L"));
      heads.NB.set(s("NB_A"), s("NB_L") === "R" ? "off" : s("NB_L"));
      heads.EB.set(s("EB_A"), s("EB_L") === "R" ? "off" : s("EB_L"));
      heads.WB.set(s("WB_A"), s("WB_L") === "R" ? "off" : s("WB_L"));
      led.setAttribute("opacity", Math.floor(performance.now() / 600) % 2 ? 1 : 0.35);
      traffic.render();
    }
    for (let i = 0; i < 900; i++) step(1 / 30); // warm up: queues already formed
    runner(figure, svg, step, render);
  }

  /* ------------- Scene 2: detection, actuation, enforcement ------------- */
  function sceneEnforcement(figure) {
    const host = figure.querySelector(".scene-svg");
    const svg = el("svg", { viewBox: "0 0 800 450", role: "img", "aria-label": figure.dataset.label || "" }, host);
    const box = { x1: 560, x2: 700, y1: 150, y2: 290 };
    drawJunctionBase(svg, box);
    dash(svg, 0, 218.5, 528, 218.5, true); dash(svg, 0, 221.5, 528, 221.5, true);
    dash(svg, 736, 218.5, 800, 218.5, true); dash(svg, 736, 221.5, 800, 221.5, true);
    dash(svg, 0, 185, 528, 185); dash(svg, 0, 255, 528, 255); dash(svg, 736, 185, 800, 185); dash(svg, 736, 255, 800, 255);
    dash(svg, 628.5, 0, 628.5, 128, true); dash(svg, 631.5, 0, 631.5, 128, true);
    dash(svg, 628.5, 312, 628.5, 450, true); dash(svg, 631.5, 312, 631.5, 450, true);
    el("rect", { x: 526, y: 220, width: 4, height: 70, fill: C.mark }, svg);   // eastbound stop line
    el("rect", { x: 730, y: 150, width: 4, height: 70, fill: C.mark }, svg);   // westbound stop line
    el("rect", { x: 560, y: 126, width: 70, height: 4, fill: C.mark }, svg);   // southbound
    el("rect", { x: 630, y: 310, width: 70, height: 4, fill: C.mark }, svg);   // northbound
    zebra(svg, 536, 153, 20, 134, true);
    zebra(svg, 704, 153, 20, 134, true);

    // Detection zone on the eastbound approach.
    const zone = el("g", {}, svg);
    el("rect", { x: 170, y: 222, width: 352, height: 66, fill: C.teal, opacity: 0.08 }, zone);
    el("rect", { x: 170, y: 222, width: 352, height: 66, fill: "none", stroke: C.teal, "stroke-width": 1.2, "stroke-dasharray": "5 5", opacity: 0.7 }, zone);
    txt(zone, 176, 302, "RADAR DETECTION ZONE", { class: "scene-small scene-teal" });
    const sweep = el("rect", { x: 170, y: 222, width: 14, height: 66, fill: C.teal, opacity: 0.18 }, zone);
    // Enforcement zone at the stop line.
    const ezone = el("rect", { x: 520, y: 222, width: 46, height: 66, fill: C.red, opacity: 0.0 }, svg);

    const cars = el("g", {}, svg);
    const lanes = [
      { group: "EW", d: "M-30 237.5 H830", stop: 553, every: [0.9, 2.4] },
      { group: "EW", d: "M-30 272.5 H830", stop: 553, every: [1.0, 2.6] },
      { group: "EW", d: "M830 167.5 H-30", stop: 94, every: [1.3, 3.2] },
      { group: "EW", d: "M830 202.5 H-30", stop: 94, every: [1.4, 3.4] },
      { group: "NS", d: "M577.5 -30 V480", stop: 154, every: [1.6, 3.4] },
      { group: "NS", d: "M612.5 -30 V480", stop: 154, every: [1.8, 3.8] },
      { group: "NS", d: "M647.5 480 V-30", stop: 164, every: [1.6, 3.4] },
      { group: "NS", d: "M682.5 480 V-30", stop: 164, every: [1.8, 3.8] },
    ];
    const traffic = laneTraffic(svg, cars, lanes, { vmax: 160 });
    const boxes = el("g", {}, svg);

    // Pole with radar and camera, south kerb, looking back along the approach.
    const pole = el("g", { transform: "translate(470 318)" }, svg);
    el("circle", { cx: 0, cy: 0, r: 6, fill: "#3a424c", stroke: "#56606c" }, pole);
    el("rect", { x: -26, y: -8, width: 22, height: 14, rx: 3, fill: "#d7dde3" }, pole);
    el("rect", { x: -32, y: -5, width: 7, height: 8, rx: 1.5, fill: "#56606c" }, pole);
    el("rect", { x: 6, y: -7, width: 16, height: 12, rx: 2, fill: "#9fb7c9" }, pole);
    txt(pole, -190, 32, "Radar and ANPR camera", { class: "scene-small" });
    const flash = el("circle", { cx: -30, cy: -2, r: 0, fill: "#fff", opacity: 0 }, pole);

    const head = signalHead(svg, 530, 330, null);

    // HUD: what the detector tells the controller.
    const hud = el("g", { transform: "translate(16 16)" }, svg);
    el("rect", { width: 300, height: 82, rx: 8, fill: "#0b0e12", stroke: C.line }, hud);
    txt(hud, 14, 22, "DETECTOR → CONTROLLER", { class: "scene-mono scene-teal" });
    const h1 = txt(hud, 14, 44, "", { class: "scene-text" });
    const h2 = txt(hud, 14, 64, "", { class: "scene-small" });

    // Evidence card.
    const card = el("g", { transform: "translate(816 18)", opacity: 0 }, svg);
    el("rect", { width: 268, height: 168, rx: 10, fill: "#0b0e12", stroke: C.red, "stroke-width": 1.5 }, card);
    txt(card, 14, 24, "RED-LIGHT VIOLATION", { class: "scene-mono scene-red" });
    el("rect", { x: 14, y: 36, width: 102, height: 30, rx: 4, fill: "#f1f3f5" }, card);
    const plate = txt(card, 65, 57, "", { "text-anchor": "middle", class: "scene-plate" });
    const c1 = txt(card, 126, 50, "", { class: "scene-small" });
    const c2 = txt(card, 126, 64, "", { class: "scene-small" });
    const c3 = txt(card, 14, 90, "", { class: "scene-text" });
    const c4 = txt(card, 14, 110, "", { class: "scene-text" });
    txt(card, 14, 132, "Lamp: red, wired from the controller", { class: "scene-small" });
    txt(card, 14, 150, "2 photos, 4 s video, plate read 98%", { class: "scene-small" });

    const PLATES = ["KJA 482 XY", "ABJ 315 KT", "GWA 207 BD", "FKJ 640 AA", "KUJ 118 EQ"];
    let plateIx = 0;
    // Actuated E–W phase: min 8 s, max 20 s, gap 2 s. Then amber 3, all-red 2,
    // N–S fixed 10 s, amber 3, all-red 2. Times in plan seconds; 3x speed.
    const SPEED = 3;
    let phase = "EW_G", tIn = 0, gapTimer = 0, extended = 0, cardT = 0, flashT = 0, violatorDue = false;

    // Zone: x 170 to 522, that is s 200 to 552 on the eastbound paths.
    function inZone(l) {
      return l.cars.filter((c) => c.s > 200 && c.s < 552);
    }
    function signal(group) {
      if (group === "EW") return phase === "EW_G" ? "G" : phase === "EW_A" ? "A" : "R";
      return phase === "NS_G" ? "G" : phase === "NS_A" ? "A" : "R";
    }
    function onViolation(car) {
      flashT = 0.35;
      cardT = 5.5;
      plate.textContent = T(PLATES[plateIx++ % PLATES.length]);
      const redFor = Math.max(0.6, tIn).toFixed(1);
      const now = new Date();
      c1.textContent = T(now.toTimeString().slice(0, 8));
      c2.textContent = T("Wuse II, Abuja");
      c3.textContent = T(`Crossed ${redFor} s after red`);
      c4.textContent = T(`Speed ${Math.max(52, Math.min(78, Math.round((car.v / 160) * 50)))} km/h`);
      car.flagged = true;
    }
    function step(dtReal) {
      const dt = dtReal * SPEED;
      tIn += dt;
      const queued = inZone(lanes[0]).length + inZone(lanes[1]).length;
      if (phase === "EW_G") {
        gapTimer = queued > 0 ? 0 : gapTimer + dt;
        if (tIn >= 8 && (gapTimer >= 2 || tIn >= 20)) { phase = "EW_A"; tIn = 0; extended = 0; violatorDue = true; }
        else if (tIn >= 8 && queued > 0) extended = tIn - 8;
      } else if (phase === "EW_A" && tIn >= 3) { phase = "EW_R"; tIn = 0; }
      else if (phase === "EW_R" && tIn >= 2) { phase = "NS_G"; tIn = 0; }
      else if (phase === "NS_G" && tIn >= 10) { phase = "NS_A"; tIn = 0; }
      else if (phase === "NS_A" && tIn >= 3) { phase = "NS_R"; tIn = 0; }
      else if (phase === "NS_R" && tIn >= 2) { phase = "EW_G"; tIn = 0; gapTimer = 0; }
      // At amber, one driver in the outer lane speeds up instead of stopping and
      // crosses the stop line about 1 s (plan time) after red.
      if (violatorDue && phase === "EW_A") {
        violatorDue = false;
        const lane = lanes[1];
        const arrive = 1.0 + 0.35; // real seconds: amber (3 plan s) plus a third
        // lane.cars runs front to back, so the first waiting car is nearest the line.
        const front = lane.cars.find((c) => c.s < lane.stop) || null;
        let car = null;
        if (front && lane.stop - front.s > 230) car = front;
        else if (!front) car = traffic.spawn(lane, { s: 0 });
        if (car) {
          const v = Math.min(400, (lane.stop - car.s) / arrive);
          Object.assign(car, { obeys: false, v, vmax: v, onCross: onViolation });
        }
      }
      traffic.step(dtReal, signal);
      if (cardT > 0) cardT -= dtReal;
      if (flashT > 0) flashT -= dtReal;
    }
    let sweepX = 0;
    function render() {
      const queued = inZone(lanes[0]).length + inZone(lanes[1]).length;
      head.set(signal("EW"), "off");
      if (phase === "EW_G") {
        h1.textContent = T(`Vehicles in zone: ${queued} · green ${Math.floor(tIn)} s`);
        h2.textContent = T(tIn < 8 ? "Minimum green 8 s" : extended > 0 && queued ? `Extending: traffic still arriving (max 20 s)` : "Gap out: no vehicle for 2 s");
      } else if (phase.startsWith("EW")) {
        h1.textContent = T(`Vehicles in zone: ${queued} · ${phase === "EW_A" ? "amber" : "all red"}`);
        h2.textContent = T("Camera armed: watching the stop line");
      } else {
        h1.textContent = T(`Vehicles waiting: ${queued} · cross street green`);
        h2.textContent = T("Call placed: the controller will serve this approach next");
      }
      sweepX = (sweepX + 3) % 338;
      sweep.setAttribute("x", 170 + sweepX);
      ezone.setAttribute("opacity", phase === "EW_R" || phase.startsWith("NS") ? 0.1 : 0);
      flash.setAttribute("r", flashT > 0 ? 18 + (0.35 - flashT) * 120 : 0);
      flash.setAttribute("opacity", flashT > 0 ? Math.max(0, flashT / 0.35) : 0);
      const slide = cardT > 0 ? Math.min(1, (5.5 - cardT) * 4, cardT * 3) : 0;
      card.setAttribute("transform", `translate(${816 - slide * 300} 18)`);
      card.setAttribute("opacity", slide);
      // Boxes around detected vehicles.
      while (boxes.firstChild) boxes.firstChild.remove();
      [lanes[0], lanes[1]].forEach((l) => l.cars.forEach((c) => {
        if (c.s < 200 || c.s > 690) return;
        const p = l.path.at(c.s - 9);
        const bad = c.flagged;
        if (!bad && c.s > l.stop + 30) return;
        el("rect", { x: p.x - 13, y: p.y - 9, width: 26, height: 18, rx: 2, fill: "none", stroke: bad ? C.red : C.teal, "stroke-width": 1.2 }, boxes);
        // Speeds only for moving vehicles, so a queue doesn't stack its labels.
        if (bad || c.v > 30) txt(boxes, p.x - 13, p.y - 12, bad ? "red-light" : `${Math.round((c.v / 160) * 52)} km/h`, { class: bad ? "scene-tiny scene-red" : "scene-tiny scene-teal" });
      }));
      traffic.render();
    }
    for (let i = 0; i < 600; i++) step(1 / 30);
    runner(figure, svg, step, render);
  }

  /* ---------------- Scene 3: the control room ---------------- */
  function sceneControlRoom(figure) {
    const host = figure.querySelector(".scene-svg");
    const svg = el("svg", { viewBox: "0 0 800 450", role: "img", "aria-label": figure.dataset.label || "" }, host);
    const defs = el("defs", {}, svg);
    const glow = el("radialGradient", { id: "room-glow", cx: "50%", cy: "30%", r: "70%" }, defs);
    el("stop", { offset: "0%", "stop-color": "#1b3640" }, glow);
    el("stop", { offset: "100%", "stop-color": "#07090c" }, glow);
    el("rect", { width: 800, height: 450, fill: "url(#room-glow)" }, svg);
    el("rect", { x: 0, y: 300, width: 800, height: 150, fill: "#090b0e" }, svg);

    // Video wall.
    const wall = el("g", {}, svg);
    el("rect", { x: 40, y: 26, width: 720, height: 244, rx: 6, fill: "#05070a", stroke: "#2a3038" }, wall);
    const scr = (x, w) => el("rect", { x, y: 34, width: w, height: 228, rx: 3, fill: "#0b1015", stroke: "#1f262e" }, wall);
    scr(48, 232); scr(286, 228); scr(520, 232);

    // Left: map of junctions.
    const map = el("g", {}, svg);
    txt(map, 60, 54, "JUNCTIONS", { class: "scene-mono scene-teal" });
    const online = txt(map, 268, 54, "", { "text-anchor": "end", class: "scene-small" });
    const roads = el("g", { stroke: "#25303a", "stroke-width": 5, "stroke-linecap": "round" }, map);
    [[60, 120, 270, 110], [60, 190, 270, 205], [110, 66, 120, 252], [200, 66, 190, 252], [60, 240, 270, 150]].forEach(([a, b, c, d]) =>
      el("line", { x1: a, y1: b, x2: c, y2: d }, roads));
    el("path", { d: "M60 160 C110 150 150 175 200 160 S260 140 272 146", stroke: "#173447", "stroke-width": 7, fill: "none" }, map);
    const jx = [[114, 118], [196, 113], [117, 194], [192, 203], [242, 159], [88, 228], [158, 214], [236, 112], [146, 119], [72, 186]];
    const dots = jx.map(([x, y]) => el("circle", { cx: x, cy: y, r: 5, fill: C.green }, map));
    const incident = txt(map, 60, 252, "", { class: "scene-small scene-red" });

    // Centre: camera tile and plate reads.
    const cam = el("g", {}, svg);
    txt(cam, 298, 54, "CAMERA · J-07 WUSE II", { class: "scene-mono scene-teal" });
    el("rect", { x: 298, y: 62, width: 204, height: 70, fill: "#151b22" }, cam);
    el("rect", { x: 298, y: 86, width: 204, height: 24, fill: "#202832" }, cam);
    el("line", { x1: 298, y1: 98, x2: 502, y2: 98, stroke: C.mark, "stroke-dasharray": "6 6", opacity: 0.5 }, cam);
    const camCar = el("g", {}, cam);
    el("rect", { x: -11, y: -6, width: 22, height: 12, rx: 3, fill: "#c99b95" }, camCar);
    const camBox = el("rect", { x: -15, y: -10, width: 30, height: 20, fill: "none", stroke: C.teal, "stroke-width": 1.2 }, camCar);
    const camRead = txt(cam, 304, 128, "", { class: "scene-tiny scene-teal" });
    txt(cam, 298, 150, "PLATE READS", { class: "scene-mono scene-teal" });
    const list = el("g", {}, cam);

    // Right: figures.
    const kp = el("g", {}, svg);
    txt(kp, 532, 54, "TODAY", { class: "scene-mono scene-teal" });
    txt(kp, 740, 54, "example figures", { "text-anchor": "end", class: "scene-tiny" });
    const tile = (x, y, label) => {
      const g = el("g", { transform: `translate(${x} ${y})` }, kp);
      el("rect", { width: 104, height: 92, rx: 4, fill: "#111820", stroke: "#1f2a33" }, g);
      txt(g, 10, 20, label, { class: "scene-tiny" });
      return txt(g, 10, 58, "", { class: "scene-kpi" });
    };
    const kViol = tile(532, 66, "Violations");
    const kFine = tile(644, 66, "Fines issued");
    const kWatch = tile(532, 164, "Watchlist hits");
    const kDelay = tile(644, 164, "Average delay");

    // Desk, monitors and operator.
    el("path", { d: "M90 360 Q400 300 710 360 L740 450 H60 Z", fill: "#1a2026", stroke: "#2a3139" }, svg);
    const mon = el("g", { transform: "translate(520 308)" }, svg);
    el("rect", { x: 0, y: 0, width: 150, height: 86, rx: 4, fill: "#0b1015", stroke: "#2f3842" }, mon);
    el("rect", { x: 66, y: 86, width: 18, height: 14, fill: "#2a3139" }, mon);
    const monTitle = txt(mon, 10, 20, "EVIDENCE", { class: "scene-tiny scene-teal" });
    const monPlate = txt(mon, 10, 44, "", { class: "scene-text" });
    const monLine = txt(mon, 10, 62, "", { class: "scene-tiny" });
    const monAct = txt(mon, 10, 78, "", { class: "scene-tiny scene-teal" });
    const mon2 = el("g", { transform: "translate(130 314)" }, svg);
    el("rect", { x: 0, y: 0, width: 136, height: 80, rx: 4, fill: "#0b1015", stroke: "#2f3842" }, mon2);
    el("rect", { x: 59, y: 80, width: 18, height: 12, fill: "#2a3139" }, mon2);
    const spark = el("polyline", { fill: "none", stroke: C.teal, "stroke-width": 1.6 }, mon2);
    txt(mon2, 10, 18, "FLOW, VEH/MIN", { class: "scene-tiny scene-teal" });
    // Operator, seen from behind, with headset.
    const op = el("g", { transform: "translate(400 372)" }, svg);
    el("path", { d: "M-58 78 Q-56 18 0 10 Q56 18 58 78 Z", fill: "#232a33" }, op);
    el("circle", { cx: 0, cy: -10, r: 24, fill: "#2c241f" }, op);
    el("path", { d: "M-24 -14 Q0 -44 24 -14", stroke: "#0e1114", "stroke-width": 4, fill: "none" }, op);
    el("rect", { x: -29, y: -18, width: 8, height: 16, rx: 3, fill: "#0e1114" }, op);
    el("rect", { x: 21, y: -18, width: 8, height: 16, rx: 3, fill: "#0e1114" }, op);

    const ROWS = [
      { plate: "ABJ 315 KT", tag: "", place: "J-07" },
      { plate: "KJA 482 XY", tag: "Red-light", place: "J-07", kind: "fine", detail: "Red-light" },
      { plate: "GWA 207 BD", tag: "", place: "J-12" },
      { plate: "LSD 913 AA", tag: "Watchlist", place: "J-03", kind: "watch", detail: "Stolen (watchlist)" },
      { plate: "FKJ 640 AA", tag: "", place: "J-07" },
      { plate: "KUJ 118 EQ", tag: "Papers", place: "J-12", kind: "fine", detail: "Expired papers" },
      { plate: "ABC 551 RT", tag: "", place: "J-21" },
      { plate: "BWR 774 LK", tag: "Speed", place: "J-03", kind: "fine", detail: "Speed 92 in a 60 zone" },
    ];
    let rowIx = 0, rowT = 0, shown = [], viol = 31, fines = 1550000, watch = 1, delay = 14, camX = 0, flow = [];
    let alertT = 0, incidentT = 0, monT = 0;
    const naira = (n) => "₦" + (n >= 1e6 ? (n / 1e6).toFixed(2) + "m" : Math.round(n / 1000) + "k");
    function addRow() {
      const r = ROWS[rowIx++ % ROWS.length];
      const now = new Date();
      shown.unshift({ ...r, time: now.toTimeString().slice(0, 8), born: performance.now() });
      shown = shown.slice(0, 5);
      if (r.kind === "fine") { viol += 1; fines += 50000; }
      if (r.kind === "watch") { watch += 1; alertT = 4; }
      if (r.kind) {
        monT = 5;
        monTitle.textContent = T(r.kind === "watch" ? "ALERT · POLICE DESK NOTIFIED" : "EVIDENCE · READY TO REVIEW");
        monPlate.textContent = T(r.plate);
        monLine.textContent = T(`${r.detail || r.tag} · ${r.place} · ${now.toTimeString().slice(0, 8)}`);
        monAct.textContent = T(r.kind === "watch" ? "Nearest patrol: 2.1 km" : "Notice drafted for the agency");
      }
    }
    for (let i = 0; i < 5; i++) addRow();
    function step(dt) {
      rowT += dt;
      if (rowT > 1.7) { rowT = 0; addRow(); }
      camX = (camX + dt * 70) % 240;
      if (alertT > 0) alertT -= dt;
      if (monT > 0) monT -= dt;
      incidentT += dt;
      flow.push(12 + 6 * Math.sin(performance.now() / 900) + rand(-2, 2));
      flow = flow.slice(-40);
    }
    function render() {
      const blink = Math.floor(performance.now() / 500) % 2;
      dots.forEach((d, i) => {
        d.setAttribute("fill", i === 4 ? C.amber : i === 7 ? C.red : C.green);
        d.setAttribute("r", i === 7 ? 5 + (blink ? 3 : 0) : 5);
        d.setAttribute("opacity", i === 4 && blink ? 0.5 : 1);
      });
      online.textContent = T("42 of 44 online");
      incident.textContent = T("● J-21: crash reported, all red held");
      incident.setAttribute("opacity", blink ? 1 : 0.6);
      camCar.setAttribute("transform", `translate(${298 + camX - 10} 98)`);
      camBox.setAttribute("stroke", camX > 150 ? C.red : C.teal);
      camRead.textContent = T(camX > 150 ? "KJA 482 XY · red-light" : camX > 60 ? "reading plate…" : "");
      while (list.firstChild) list.firstChild.remove();
      shown.forEach((r, i) => {
        const y = 170 + i * 19;
        const age = (performance.now() - r.born) / 400;
        const g = el("g", { opacity: Math.min(1, age) }, list);
        txt(g, 298, y, r.time, { class: "scene-tiny" });
        txt(g, 352, y, r.plate, { class: "scene-text-sm" });
        if (r.tag) {
          const bad = r.kind === "watch";
          el("rect", { x: 430, y: y - 10, width: 68, height: 13, rx: 3, fill: bad ? C.red : C.amber, opacity: bad && alertT > 0 && blink ? 0.45 : 0.9 }, g);
          txt(g, 434, y, r.tag, { class: "scene-tag" });
        }
      });
      kViol.textContent = T(String(viol));
      kFine.textContent = T(naira(fines));
      kWatch.textContent = T(String(watch));
      kWatch.setAttribute("class", alertT > 0 && blink ? "scene-kpi scene-red" : "scene-kpi");
      kDelay.textContent = T(`−${delay}%`);
      mon.setAttribute("opacity", monT > 0 ? 1 : 0.55);
      const pts = flow.map((v, i) => `${10 + i * 3} ${70 - v * 2}`).join(" ");
      spark.setAttribute("points", pts);
    }
    runner(figure, svg, step, render);
  }

  const SCENES = { cycle: sceneCycle, enforcement: sceneEnforcement, room: sceneControlRoom };
  document.querySelectorAll("figure.scene[data-scene]").forEach((figure) => {
    const make = SCENES[figure.dataset.scene];
    if (make) {
      try { make(figure); } catch (e) { figure.classList.add("scene-failed"); }
    }
  });
})();

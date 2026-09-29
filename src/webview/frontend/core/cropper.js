// Pan / zoom state machine behind the crop editors on the App Icons and Splash Screen tabs.
//
// One `view` ({ s, x, y }: scale percent, pan in percent of the crop square) is what gets drawn.
// Direct manipulation (dragging, sliders) writes it immediately; wheel zoom, presets and keyboard
// nudges move a `target` and let the view ease toward it, so those feel smooth while a drag stays
// glued to the pointer.

import { EDITOR_SQUARE } from "./image-preview.js";

const SNAP_PERCENT = 2.5;
const EASE_MS = 70;
const WHEEL_SENSITIVITY = 0.0018;
const PINCH_WHEEL_SENSITIVITY = 0.01;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/**
 * @param {object} options
 * @param {HTMLCanvasElement} options.canvas    editor canvas; receives pointer, wheel and key input
 * @param {number} options.minScale
 * @param {number} options.maxScale
 * @param {{s:number,x:number,y:number}} options.initial
 * @param {(view, interaction) => void} options.onFrame   redraw everything for `view`
 * @param {() => void} [options.onUserInput]    the user (not a preset) changed the view
 * @param {() => void} [options.onReset]        double-click / "0" key
 */
export function createCropper({ canvas, minScale, maxScale, initial, onFrame, onUserInput, onReset }) {
  const view = { ...initial };
  const target = { ...initial };
  const interaction = { dragging: false, snapX: false, snapY: false };
  const pointers = new Map();
  let drag = null;
  let pinch = null;
  let raf = 0;
  let lastTime = 0;

  const panLimit = (scale) => Math.min(100, 50 + scale / 2 - 10);
  const clampScale = (s) => clamp(s, minScale, maxScale);
  const clampPan = (v, scale) => clamp(v, -panLimit(scale), panLimit(scale));
  const squareSize = () => canvas.clientWidth * EDITOR_SQUARE;

  function tick(now) {
    raf = 0;
    const dt = Math.min(50, lastTime ? now - lastTime : 16);
    lastTime = now;
    const k = 1 - Math.exp(-dt / EASE_MS);
    let moving = false;
    for (const key of ["s", "x", "y"]) {
      const delta = target[key] - view[key];
      if (Math.abs(delta) < (key === "s" ? 0.05 : 0.03)) {
        view[key] = target[key];
      } else {
        view[key] += delta * k;
        moving = true;
      }
    }
    if (!moving && !interaction.dragging) {
      // Land on values the host can reproduce exactly: whole scale percent, tenth-percent pan.
      view.s = target.s = Math.round(target.s);
      view.x = target.x = Math.round(target.x * 10) / 10;
      view.y = target.y = Math.round(target.y * 10) / 10;
    }
    onFrame(view, interaction);
    if (moving) {
      raf = requestAnimationFrame(tick);
    } else {
      lastTime = 0;
    }
  }

  const request = () => { if (!raf) { raf = requestAnimationFrame(tick); } };

  function set(next, { animate = true } = {}) {
    if (next.s !== undefined) { target.s = clampScale(next.s); }
    if (next.x !== undefined) { target.x = clampPan(next.x, target.s); }
    if (next.y !== undefined) { target.y = clampPan(next.y, target.s); }
    target.x = clampPan(target.x, target.s);
    target.y = clampPan(target.y, target.s);
    if (!animate) { Object.assign(view, target); }
    request();
  }

  const userSet = (next, options) => {
    set(next, options);
    onUserInput?.();
  };

  /** Zooms by `factor` keeping the point under (clientX, clientY) fixed, like a map. */
  function zoomAt(factor, clientX, clientY, animate = true) {
    const rect = canvas.getBoundingClientRect();
    const size = squareSize() || 1;
    const px = ((clientX - rect.left) - rect.width / 2) / size * 100;
    const py = ((clientY - rect.top) - rect.height / 2) / size * 100;
    const s = clampScale(target.s * factor);
    const k = s / target.s;
    userSet({ s, x: px - (px - target.x) * k, y: py - (py - target.y) * k }, { animate });
  }

  canvas.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) { return; }
    canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    canvas.focus({ preventScroll: true });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), scale: target.s };
      drag = null;
    } else {
      drag = { x: event.clientX, y: event.clientY, ox: target.x, oy: target.y };
    }
    interaction.dragging = true;
    canvas.classList.add("dragging");
    event.preventDefault();
    request();
  });

  canvas.addEventListener("pointermove", (event) => {
    const known = pointers.get(event.pointerId);
    if (!known) { return; }
    known.x = event.clientX;
    known.y = event.clientY;

    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      zoomAt(clampScale(pinch.scale * (distance / pinch.distance)) / target.s, (a.x + b.x) / 2, (a.y + b.y) / 2, false);
      return;
    }
    if (!drag) { return; }
    const size = squareSize() || 1;
    let x = drag.ox + ((event.clientX - drag.x) / size) * 100;
    let y = drag.oy + ((event.clientY - drag.y) / size) * 100;
    // Shift disables snapping for fine placement.
    interaction.snapX = !event.shiftKey && Math.abs(x) < SNAP_PERCENT;
    interaction.snapY = !event.shiftKey && Math.abs(y) < SNAP_PERCENT;
    if (interaction.snapX) { x = 0; }
    if (interaction.snapY) { y = 0; }
    userSet({ x, y }, { animate: false });
  });

  const release = (event) => {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) { pinch = null; }
    if (pointers.size === 1) {
      const [rest] = [...pointers.values()];
      drag = { x: rest.x, y: rest.y, ox: target.x, oy: target.y };
    }
    if (pointers.size === 0) {
      drag = null;
      interaction.dragging = false;
      interaction.snapX = false;
      interaction.snapY = false;
      canvas.classList.remove("dragging");
      request();
    }
  };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);

  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    const dy = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
    const sensitivity = event.ctrlKey ? PINCH_WHEEL_SENSITIVITY : WHEEL_SENSITIVITY;
    zoomAt(Math.exp(-dy * sensitivity), event.clientX, event.clientY);
  }, { passive: false });

  canvas.addEventListener("dblclick", () => onReset?.());

  canvas.addEventListener("keydown", (event) => {
    const step = event.shiftKey ? 5 : 1;
    const nudges = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (nudges[event.key]) {
      const [dx, dy] = nudges[event.key];
      userSet({ x: target.x + dx, y: target.y + dy });
    } else if (event.key === "+" || event.key === "=") {
      userSet({ s: target.s + step * 2 });
    } else if (event.key === "-" || event.key === "_") {
      userSet({ s: target.s - step * 2 });
    } else if (event.key === "0") {
      onReset?.();
    } else {
      return;
    }
    event.preventDefault();
  });

  return {
    view,
    set,
    /** Same as `set`, but marks the change as user-made (clears "active preset" highlights and the like). */
    userSet,
    refresh: request,
    /** Values to send to the host: whole scale percent, pan rounded to a tenth of a percent. */
    result: () => ({
      scalePercent: Math.round(target.s),
      offsetX: Math.round(target.x * 10) / 10,
      offsetY: Math.round(target.y * 10) / 10,
    }),
  };
}

// Client-side mirror of core/shared/image-compose.ts#composeWorkingImage, so previews redraw
// every animation frame without a round-trip to the extension host.

export const NO_PAN = Object.freeze({ x: 0, y: 0 });

export function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

/** Source rectangle in the preview image's pixels: the visible content when trimming, else the whole image. */
export function sourceRect(img, preview, trim) {
  if (!trim || !preview?.contentBounds) {
    return { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight };
  }
  const b = preview.contentBounds;
  return {
    x: b.x * img.naturalWidth,
    y: b.y * img.naturalHeight,
    w: Math.max(1, b.width * img.naturalWidth),
    h: Math.max(1, b.height * img.naturalHeight),
  };
}

/**
 * Draws the source fit ("contain") into a centered box of `boxSize` inside a `size`-square area at (ox, oy).
 * `pan` shifts it by a percentage of `size` - the same unit `composeWorkingImage` uses on the host.
 */
export function drawContained(ctx, img, rect, size, scalePercent, ox = 0, oy = 0, pan = NO_PAN) {
  const box = size * (scalePercent / 100);
  const ratio = Math.min(box / rect.w, box / rect.h);
  const w = rect.w * ratio;
  const h = rect.h * ratio;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(
    img, rect.x, rect.y, rect.w, rect.h,
    ox + (size - w) / 2 + size * (pan.x / 100),
    oy + (size - h) / 2 + size * (pan.y / 100),
    w, h,
  );
}

/** Renders the composed square (background + foreground) into `canvas` at `size` pixels. */
export function renderComposed(canvas, img, preview, { scalePercent, background, trim, pan }, size) {
  if (canvas.width !== size) { canvas.width = size; canvas.height = size; }
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, size, size);
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, size, size);
  }
  drawContained(ctx, img, sourceRect(img, preview, trim), size, scalePercent, 0, 0, pan);
}

/** White-on-transparent silhouette of the (always transparent-background) composed foreground. */
export function renderSilhouette(canvas, img, preview, { scalePercent, trim, pan }, size) {
  renderComposed(canvas, img, preview, { scalePercent, trim, pan }, size);
  const ctx = canvas.getContext("2d");
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = "source-over";
}

/** Copies `source` into a display canvas sized for its CSS box at device pixel ratio. */
export function blit(target, source) {
  const dpr = window.devicePixelRatio || 1;
  const cssW = target.clientWidth || Number(target.dataset.size) || 64;
  const cssH = target.clientHeight || cssW;
  const w = Math.round(cssW * dpr);
  const h = Math.round(cssH * dpr);
  if (target.width !== w || target.height !== h) { target.width = w; target.height = h; }
  const ctx = target.getContext("2d");
  ctx.clearRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, w, h);
}

/**
 * Scale (percent) at which the artwork's corners just stay inside a circular mask, with a small
 * margin - the shape most Android launchers and the Play Store badge crop to.
 */
export function circleSafeScale(preview, trim) {
  let w = preview?.sourceWidth || 1;
  let h = preview?.sourceHeight || 1;
  if (trim && preview?.contentBounds) {
    w *= preview.contentBounds.width;
    h *= preview.contentBounds.height;
  }
  const aspect = w / h;
  const fw = Math.min(1, aspect);
  const fh = Math.min(1, 1 / aspect);
  return Math.round(92 / Math.hypot(fw, fh));
}

/** Fraction of the source that is empty margin around the visible content (0 = none). */
export function marginFraction(preview) {
  const b = preview?.contentBounds;
  if (!b) { return 0; }
  return 1 - b.width * b.height;
}

/** Wires a range slider, a number box, and optional presets to one value; calls `onChange` on every edit. */
export function bindRange({ slider, number, display, format, onChange, resetValue }) {
  const set = (value, fromUser = true) => {
    const min = Number(slider.min);
    const max = Number(slider.max);
    const v = Math.min(max, Math.max(min, Math.round(Number(value))));
    if (!Number.isFinite(v)) { return; }
    slider.value = String(v);
    if (number && document.activeElement !== number) { number.value = String(v); }
    if (display) { display.textContent = format ? format(v) : String(v); }
    slider.style.setProperty("--fill", `${((v - min) / (max - min)) * 100}%`);
    if (fromUser) { onChange(v); }
  };
  slider.addEventListener("input", () => set(slider.value));
  slider.addEventListener("dblclick", () => set(resetValue));
  number?.addEventListener("input", () => {
    if (number.value !== "") { set(number.value); }
  });
  number?.addEventListener("blur", () => { number.value = slider.value; });
  set(slider.value, false);
  return {
    get: () => Number(slider.value),
    set: (v, fromUser = true) => set(v, fromUser),
    nudge: (delta) => set(Number(slider.value) + delta),
  };
}

/** Fraction of the editor canvas the crop square occupies; the rest shows what falls outside the crop. */
export const EDITOR_SQUARE = 0.74;

let checkerPattern = null;
function checker(ctx, cell) {
  if (!checkerPattern || checkerPattern.cell !== cell) {
    const tile = document.createElement("canvas");
    tile.width = tile.height = cell * 2;
    const t = tile.getContext("2d");
    t.fillStyle = "#3a3a3a";
    t.fillRect(0, 0, cell * 2, cell * 2);
    t.fillStyle = "#2c2c2c";
    t.fillRect(0, 0, cell, cell);
    t.fillRect(cell, cell, cell, cell);
    checkerPattern = { cell, pattern: ctx.createPattern(tile, "repeat") };
  }
  return checkerPattern.pattern;
}

let accentColor = null;
function accent() {
  if (!accentColor) {
    accentColor = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#1976d2";
  }
  return accentColor;
}

/**
 * Paints the crop editor: the artwork at full strength inside the crop square and dimmed where it
 * overflows, so panning and zooming read as moving a picture behind a window.
 * `fill` paints the square (checkerboard when absent), `surround` paints the area around it.
 */
export function paintEditor(canvas, img, rect, { scalePercent, pan, fill, surround, safeZone, snapX, snapY, dragging }) {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 320;
  const cssH = canvas.clientHeight || cssW;
  const w = Math.round(cssW * dpr);
  const h = Math.round(cssH * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, w, h);
  if (surround) {
    ctx.fillStyle = surround;
    ctx.fillRect(0, 0, w, h);
  }

  const side = Math.round(w * EDITOR_SQUARE);
  const x0 = Math.round((w - side) / 2);
  const y0 = Math.round((h - side) / 2);

  ctx.globalAlpha = 0.28;
  drawContained(ctx, img, rect, side, scalePercent, x0, y0, pan);
  ctx.globalAlpha = 1;

  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, y0, side, side);
  ctx.clip();
  ctx.fillStyle = fill || checker(ctx, Math.max(4, Math.round(8 * dpr)));
  ctx.fillRect(x0, y0, side, side);
  drawContained(ctx, img, rect, side, scalePercent, x0, y0, pan);
  ctx.restore();

  const cx = x0 + side / 2;
  const cy = y0 + side / 2;
  const hair = Math.max(1, Math.round(dpr));

  // Every outline is a dark line under a light one, so it stays visible on any fill color.
  const outline = (trace, dash) => {
    ctx.setLineDash(dash ? [5 * dpr, 4 * dpr] : []);
    ctx.lineWidth = hair * 3;
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    trace();
    ctx.stroke();
    ctx.lineWidth = hair;
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    trace();
    ctx.stroke();
    ctx.setLineDash([]);
  };
  outline(() => { ctx.beginPath(); ctx.rect(x0 - 0.5, y0 - 0.5, side + 1, side + 1); }, false);
  if (safeZone) {
    outline(() => { ctx.beginPath(); ctx.arc(cx, cy, side * 0.46, 0, Math.PI * 2); }, true);
  }

  // Center guides: faint while dragging, accent-colored where the artwork has snapped to center.
  const guide = (x1, y1, x2, y2, snapped) => {
    ctx.strokeStyle = snapped ? accent() : "rgba(128,128,128,0.75)";
    ctx.lineWidth = snapped ? hair * 1.5 : hair;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  };
  if (dragging || snapX || snapY) {
    guide(cx, y0, cx, y0 + side, snapX);
    guide(x0, cy, x0 + side, cy, snapY);
  }
}

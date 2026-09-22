// Client-side mirror of core/shared/image-compose.ts#composeWorkingImage, so previews redraw
// every animation frame without a round-trip to the extension host.

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

/** Draws the source fit ("contain") into a centered box of `boxSize` inside a `size`-square area at (ox, oy). */
export function drawContained(ctx, img, rect, size, scalePercent, ox = 0, oy = 0) {
  const box = size * (scalePercent / 100);
  const ratio = Math.min(box / rect.w, box / rect.h);
  const w = rect.w * ratio;
  const h = rect.h * ratio;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h, ox + (size - w) / 2, oy + (size - h) / 2, w, h);
}

/** Renders the composed square (background + foreground) into `canvas` at `size` pixels. */
export function renderComposed(canvas, img, preview, { scalePercent, background, trim }, size) {
  if (canvas.width !== size) { canvas.width = size; canvas.height = size; }
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, size, size);
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, size, size);
  }
  drawContained(ctx, img, sourceRect(img, preview, trim), size, scalePercent);
}

/** White-on-transparent silhouette of the (always transparent-background) composed foreground. */
export function renderSilhouette(canvas, img, preview, { scalePercent, trim }, size) {
  renderComposed(canvas, img, preview, { scalePercent, trim }, size);
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

/** Coalesces bursts of redraw requests (slider drags, wheel) into one draw per animation frame. */
export function frameScheduler(draw) {
  let pending = false;
  return () => {
    if (pending) { return; }
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      draw();
    });
  };
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
    set: (v) => set(v),
    nudge: (delta) => set(Number(slider.value) + delta),
  };
}

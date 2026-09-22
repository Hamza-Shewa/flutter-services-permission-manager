/**
 * Shared raster image loading/compositing primitives, used by both the App
 * Icons and Splash Screen features so they render from one already-tested
 * pipeline instead of two copies: decode a PNG/JPEG/SVG source, cache the
 * decode across repeated live-preview requests, and compose it onto a square
 * working canvas at a chosen scale (with optional zoom-and-crop past 100%)
 * and background color.
 */

import * as fs from "fs";
import * as path from "path";
import { Jimp, cssColorToHex } from "jimp";
import { initWasm, Resvg } from "@resvg/resvg-wasm";

/** Recognized source image formats. */
export type ImageSourceKind = "png" | "jpeg" | "svg";

/**
 * How a source image is composed onto its square working canvas:
 * `scalePercent` (40-200) is how much of the canvas the foreground fills -
 * below 100 that adds padding around it, above 100 it zooms in and crops -
 * and `backgroundColor` (a CSS hex color) fills the canvas outside the
 * foreground, or is left transparent when omitted.
 */
export interface ImageComposeOptions {
  scalePercent?: number;
  backgroundColor?: string;
  /** Crop the source to its visible content first, so the scale is relative to the artwork rather than its padding. */
  trimMargins?: boolean;
}

/** Visible-content rectangle in source pixels. */
export interface ContentBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A downscaled copy of the source plus what the webview needs to render every preview locally
 * (bounds are normalized 0..1 so they apply to the downscaled copy unchanged).
 */
export interface SourcePreview {
  dataUrl: string;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  contentBounds: { x: number; y: number; width: number; height: number };
  hasTransparency: boolean;
  suggestedBackground?: string;
}

/**
 * A minimal structural view of the Jimp instance methods this module uses.
 * Jimp v1's actual return types are deeply generic and re-infer a fresh
 * nominal type at every call site (`new Jimp(...)` vs `Jimp.fromBuffer(...)`
 * are not assignable to each other despite being identical at runtime), so
 * callers work against this narrow structural type instead and cast once at
 * each construction site.
 */
export interface RasterImage {
  readonly width: number;
  readonly height: number;
  bitmap: { data: Buffer | Uint8Array };
  background: number;
  clone(): RasterImage;
  cover(options: { w: number; h: number }): RasterImage;
  contain(options: { w: number; h: number }): RasterImage;
  crop(options: { x: number; y: number; w: number; h: number }): RasterImage;
  resize(options: { w: number; h?: number }): RasterImage;
  composite(source: RasterImage, x: number, y: number): RasterImage;
  scan(x: number, y: number, w: number, h: number, callback: (x: number, y: number, idx: number) => void): RasterImage;
  getBuffer(mime: "image/png"): Promise<Buffer>;
}

const DEFAULT_SCALE_PERCENT = 100;
const MIN_SCALE_PERCENT = 40;
/** 200 lets the foreground overflow the canvas and get cropped - a zoom-in, not just a resize. */
const MAX_SCALE_PERCENT = 200;

export function clampScalePercent(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) { return DEFAULT_SCALE_PERCENT; }
  return Math.min(MAX_SCALE_PERCENT, Math.max(MIN_SCALE_PERCENT, Math.round(value)));
}

export function detectImageSourceKind(filePath: string): ImageSourceKind | undefined {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") { return "png"; }
  if (ext === ".jpg" || ext === ".jpeg") { return "jpeg"; }
  if (ext === ".svg") { return "svg"; }
  return undefined;
}

let resvgInitialization: Promise<void> | undefined;

async function ensureResvgReady(): Promise<void> {
  if (!resvgInitialization) {
    resvgInitialization = (async () => {
      const wasmPath = require.resolve("@resvg/resvg-wasm/index_bg.wasm");
      await initWasm(fs.readFileSync(wasmPath));
    })();
  }
  return resvgInitialization;
}

/**
 * Decodes the source image into a reusable Jimp instance so every target
 * size is cropped/scaled from the same decode. SVGs are rasterized once at a
 * large fixed canvas (bigger than any slot either feature writes) via resvg,
 * then treated identically to a raster source from that point on.
 */
async function loadRasterSource(filePath: string, kind: ImageSourceKind): Promise<RasterImage> {
  if (kind === "svg") {
    await ensureResvgReady();
    const svg = fs.readFileSync(filePath, "utf8");
    const resvg = new Resvg(svg, { fitTo: { mode: "width", value: 1024 } });
    const png = resvg.render().asPng();
    return (await Jimp.fromBuffer(Buffer.from(png))) as unknown as RasterImage;
  }
  return (await Jimp.fromBuffer(fs.readFileSync(filePath))) as unknown as RasterImage;
}

interface CachedSource {
  path: string;
  mtimeMs: number;
  size: number;
  image: RasterImage;
  bounds?: ContentBounds;
}

let sourceCache: CachedSource | undefined;

const ALPHA_THRESHOLD = 8;
/** Per-channel distance from the corner color below which an opaque pixel counts as background. */
const BACKGROUND_TOLERANCE = 24;

function cornerColor(image: RasterImage): [number, number, number, number] {
  const { data } = image.bitmap;
  const w = image.width;
  const h = image.height;
  const corners = [0, (w - 1) * 4, (h - 1) * w * 4, ((h - 1) * w + (w - 1)) * 4];
  const sum = [0, 0, 0, 0];
  for (const idx of corners) {
    for (let c = 0; c < 4; c++) { sum[c] += data[idx + c]; }
  }
  return [sum[0] / 4, sum[1] / 4, sum[2] / 4, sum[3] / 4];
}

function hasAnyTransparency(image: RasterImage): boolean {
  const { data } = image.bitmap;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 250) { return true; }
  }
  return false;
}

/**
 * Bounding box of the visible artwork: non-transparent pixels for a source with alpha, or pixels
 * that differ from the (uniform) corner color for a fully opaque one. Falls back to the whole image.
 */
export function findContentBounds(image: RasterImage): ContentBounds {
  const { data } = image.bitmap;
  const w = image.width;
  const h = image.height;
  const transparent = hasAnyTransparency(image);
  const [br, bg, bb] = cornerColor(image);
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const visible = transparent
        ? data[i + 3] > ALPHA_THRESHOLD
        : Math.abs(data[i] - br) > BACKGROUND_TOLERANCE
          || Math.abs(data[i + 1] - bg) > BACKGROUND_TOLERANCE
          || Math.abs(data[i + 2] - bb) > BACKGROUND_TOLERANCE;
      if (visible) {
        if (x < minX) { minX = x; }
        if (x > maxX) { maxX = x; }
        if (y < minY) { minY = y; }
        if (y > maxY) { maxY = y; }
      }
    }
  }
  if (maxX < 0) {
    return { x: 0, y: 0, width: w, height: h };
  }
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

function toHex(value: number): string {
  return Math.round(value).toString(16).padStart(2, "0");
}

/** For an opaque source with a uniform border, that border color - the natural icon/splash background. */
function suggestBackground(image: RasterImage): string | undefined {
  if (hasAnyTransparency(image)) { return undefined; }
  const [r, g, b] = cornerColor(image);
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function cachedBounds(filePath: string, image: RasterImage): ContentBounds {
  if (sourceCache && sourceCache.path === filePath && sourceCache.image === image) {
    sourceCache.bounds ??= findContentBounds(image);
    return sourceCache.bounds;
  }
  return findContentBounds(image);
}

/** Returns the source itself, or a clone cropped to its visible content when `trim` is set. */
export function prepareForeground(source: RasterImage, trim: boolean, bounds?: ContentBounds): RasterImage {
  const clone = source.clone();
  if (!trim) { return clone; }
  const b = bounds ?? findContentBounds(source);
  if (b.width === source.width && b.height === source.height) { return clone; }
  return clone.crop({ x: b.x, y: b.y, w: b.width, h: b.height });
}

/** Loads the source and returns it already trimmed when requested, reusing the cached bounds. */
export async function loadForeground(filePath: string, kind: ImageSourceKind, trim: boolean): Promise<RasterImage> {
  const source = await loadRasterSourceCached(filePath, kind);
  return prepareForeground(source, trim, trim ? cachedBounds(filePath, source) : undefined);
}

const SOURCE_PREVIEW_MAX = 512;

/** Decodes the source once and returns a downscaled copy plus layout hints for client-side previews. */
export async function generateSourcePreview(filePath: string): Promise<SourcePreview> {
  const kind = detectImageSourceKind(filePath);
  if (!kind) {
    throw new Error("Unsupported file type. Choose a PNG, JPEG, or SVG image.");
  }
  const source = await loadRasterSourceCached(filePath, kind);
  const bounds = cachedBounds(filePath, source);
  const small = source.clone();
  const longest = Math.max(small.width, small.height);
  if (longest > SOURCE_PREVIEW_MAX) {
    const factor = SOURCE_PREVIEW_MAX / longest;
    small.resize({ w: Math.max(1, Math.round(small.width * factor)), h: Math.max(1, Math.round(small.height * factor)) });
  }
  const png = Buffer.from(await small.getBuffer("image/png"));
  return {
    dataUrl: `data:image/png;base64,${png.toString("base64")}`,
    width: small.width,
    height: small.height,
    sourceWidth: source.width,
    sourceHeight: source.height,
    contentBounds: {
      x: bounds.x / source.width,
      y: bounds.y / source.height,
      width: bounds.width / source.width,
      height: bounds.height / source.height,
    },
    hasTransparency: hasAnyTransparency(source),
    suggestedBackground: suggestBackground(source),
  };
}

/** Width/height from a PNG's IHDR chunk, without decoding it. */
export function readPngSize(buffer: Buffer): { width: number; height: number } | undefined {
  if (buffer.length < 24 || buffer.readUInt32BE(0) !== 0x89504e47) { return undefined; }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/**
 * Same as `loadRasterSource`, but skips the disk read + decode (or, for SVG,
 * the WASM rasterization) when the file hasn't changed since the last call -
 * live previews re-request this on every scale/background tweak, and
 * re-decoding an unchanged source on each one is what made that feel slow.
 * Shared across features: picking an icon then switching to the splash tab
 * with the same source file still benefits from the cache.
 */
export async function loadRasterSourceCached(filePath: string, kind: ImageSourceKind): Promise<RasterImage> {
  const stat = fs.statSync(filePath);
  if (sourceCache && sourceCache.path === filePath && sourceCache.mtimeMs === stat.mtimeMs && sourceCache.size === stat.size) {
    return sourceCache.image;
  }
  const image = await loadRasterSource(filePath, kind);
  sourceCache = { path: filePath, mtimeMs: stat.mtimeMs, size: stat.size, image };
  return image;
}

export async function renderSquarePng(source: RasterImage, sizePx: number): Promise<Buffer> {
  const clone = source.clone();
  clone.cover({ w: sizePx, h: sizePx });
  const buffer = await clone.getBuffer("image/png");
  return Buffer.from(buffer);
}

/**
 * Composes the source onto a `canvasSize`-square working canvas: the
 * foreground is fit to `scalePercent`% of the canvas, centered, and the
 * remaining area is filled with `backgroundColor` (or left transparent when
 * omitted). Above 100% the foreground overflows the canvas and is cropped -
 * a zoom, not a resize. The result is already square, so every per-target
 * render after this is a plain downsize, not a crop - a source at 100% with
 * no background that's already square (the common case) renders identically
 * to the source itself.
 */
export function composeWorkingImage(source: RasterImage, scalePercent: number, backgroundColor: string | undefined, canvasSize: number): RasterImage {
  const boxSize = Math.max(1, Math.round(canvasSize * (scalePercent / 100)));
  const foreground = source.clone();
  foreground.background = 0x00000000;
  foreground.contain({ w: boxSize, h: boxSize });

  const canvas = createColorCanvas(canvasSize, canvasSize, backgroundColor);
  const offset = Math.round((canvasSize - boxSize) / 2);
  canvas.composite(foreground, offset, offset);
  return canvas;
}

/** Creates a flat-color (or transparent, if `backgroundColor` is omitted) canvas of the given size, for compositing a foreground onto. */
export function createColorCanvas(width: number, height: number, backgroundColor: string | undefined): RasterImage {
  const color = backgroundColor ? cssColorToHex(backgroundColor) : 0x00000000;
  return new Jimp({ width, height, color }) as unknown as RasterImage;
}

/** Working resolution generated assets are composed at before per-target downsizing; generous enough to stay crisp at 512-1024px slots. */
export const DEFAULT_WORKING_CANVAS_SIZE = 1024;

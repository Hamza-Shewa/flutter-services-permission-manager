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
}

export interface ImagePreview {
  dataUrl: string;
  size: number;
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
}

let sourceCache: CachedSource | undefined;

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

/** Preview thumbnail size; large enough to look crisp in the small mask/mockup previews the UI renders it in. */
export const PREVIEW_SIZE = 256;

/**
 * Renders the source composed onto a `PREVIEW_SIZE` square, as a small PNG
 * data URL the webview can display immediately after picking a source image
 * (or after adjusting scale/background) - before any files are written.
 */
export async function generateSquarePreview(sourcePath: string, compose: ImageComposeOptions = {}): Promise<ImagePreview> {
  const kind = detectImageSourceKind(sourcePath);
  if (!kind) {
    throw new Error("Unsupported file type. Choose a PNG, JPEG, or SVG image.");
  }
  const source = await loadRasterSourceCached(sourcePath, kind);
  const working = composeWorkingImage(source, clampScalePercent(compose.scalePercent), compose.backgroundColor, PREVIEW_SIZE);
  const png = await renderSquarePng(working, PREVIEW_SIZE);
  return { dataUrl: `data:image/png;base64,${png.toString("base64")}`, size: PREVIEW_SIZE };
}

/**
 * Splash screen generation.
 *
 * Given a single source image (PNG, JPEG, or SVG), renders and writes the
 * native splash screen files Android and/or iOS expect, without altering
 * anything else about the project structure:
 *  - Android: writes a transparent-background foreground image to
 *    `res/drawable-*dpi/launch_image.png` at every standard density, and
 *    rewrites both `res/drawable/launch_background.xml` and
 *    `res/drawable-v21/launch_background.xml` (Flutter's default splash
 *    layer-lists) to show it centered over a solid background color -
 *    `res/values{,-night}/styles.xml` already reference `launch_background`
 *    unmodified, so nothing else needs to change. Only touches these files
 *    if they still look like the standard Flutter template; a project with
 *    a hand-customized splash layout is left alone with a clear error
 *    instead of guessing at unfamiliar structure.
 *  - iOS: writes the same foreground image (at 1x/2x/3x) into
 *    `Assets.xcassets/LaunchImage.imageset/`, and rewrites the background
 *    color and image size hint in `Base.lproj/LaunchScreen.storyboard`
 *    (Flutter's default launch storyboard already centers `LaunchImage` via
 *    `contentMode="center"`, so the image is shown at its own point size,
 *    not stretched).
 *
 * Uses the same `ImageComposeOptions` (`scalePercent` + `backgroundColor`)
 * scale/background model as the App Icons feature - see
 * `core/shared/image-compose.ts` - so both share one preview and generation
 * pipeline. Unlike icons, the background here is never baked into the
 * generated image itself: it's written as a native color (Android drawable
 * color, iOS storyboard color) so a non-square screen shows a seamless solid
 * backdrop instead of a visible square tile.
 */

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { toErrorMessage } from "../../core/shared/index.js";
import {
  clampScalePercent,
  composeWorkingImage,
  DEFAULT_WORKING_CANVAS_SIZE,
  detectImageSourceKind,
  loadForeground,
  readPngSize,
  renderSquarePng,
  type ImageComposeOptions,
  type RasterImage,
} from "../../core/shared/image-compose.js";
import type {
  CurrentSplashPreviews,
  GeneratedSplashFile,
  SplashGenerationResult,
  SplashPlatformTarget,
  SplashPreview,
} from "./types.js";

export const detectSplashSourceKind = detectImageSourceKind;
export const clampSplashScalePercent = clampScalePercent;

/** Logo box edge in dp (Android) / pt (iOS) - one value so both platforms show the logo at the same physical size. */
export const DEFAULT_SPLASH_LOGO_SIZE = 200;
const MIN_SPLASH_LOGO_SIZE = 48;
const MAX_SPLASH_LOGO_SIZE = 480;

export function clampSplashLogoSize(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) { return DEFAULT_SPLASH_LOGO_SIZE; }
  return Math.min(MAX_SPLASH_LOGO_SIZE, Math.max(MIN_SPLASH_LOGO_SIZE, Math.round(value)));
}

/** Density -> scale factor relative to mdpi */
const ANDROID_DENSITY_SCALES: Readonly<Record<string, number>> = {
  mdpi: 1,
  hdpi: 1.5,
  xhdpi: 2,
  xxhdpi: 3,
  xxxhdpi: 4,
};

const STANDARD_DENSITIES = Object.keys(ANDROID_DENSITY_SCALES);

function androidAppDirFromManifest(manifestUri: vscode.Uri): string {
  // .../android/app/src/main/AndroidManifest.xml -> .../android/app
  return path.dirname(path.dirname(path.dirname(manifestUri.fsPath)));
}

function normalizeHexColor(hex: string): string {
  const clean = hex.replace(/^#/, "").trim();
  const full = clean.length === 3 ? clean.split("").map((c) => `${c}${c}`).join("") : clean;
  return full.padEnd(6, "0").slice(0, 6).toUpperCase();
}

function hexToUnitRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = normalizeHexColor(hex);
  const num = Number.parseInt(normalized, 16);
  return {
    r: ((num >> 16) & 255) / 255,
    g: ((num >> 8) & 255) / 255,
    b: (num & 255) / 255,
  };
}

async function writeSplashFile(filePath: string, png: Buffer, width: number, height: number, label: string): Promise<GeneratedSplashFile> {
  const uri = vscode.Uri.file(filePath);
  await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(filePath)));
  await vscode.workspace.fs.writeFile(uri, png);
  return { path: vscode.workspace.asRelativePath(uri, false), width, height, label };
}

const BACKGROUND_ITEM_PATTERN = /<item\s+android:drawable="[^"]*"\s*\/>/;
const LAYER_LIST_CLOSE_PATTERN = /<\/layer-list>/;

/** Matches only a live (uncommented) bitmap item that already points at our own resource name, from a previous run - never the default template's commented-out placeholder. */
function ownBitmapItemPattern(resourceName: string): RegExp {
  const escaped = resourceName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`<item>\\s*<bitmap[^>]*android:src="@drawable/${escaped}"[^>]*/>\\s*</item>`);
}

/**
 * Rewrites one `launch_background.xml` layer-list: swaps the background
 * color and inserts (or replaces, if this ran before) a centered bitmap item
 * pointing at `resourceName`. Only proceeds if the file still has the
 * standard Flutter `<layer-list>` shape; throws a clear error otherwise
 * rather than mangling an unfamiliar, hand-customized layout. Never touches
 * Flutter's default commented-out placeholder bitmap block - regex has no
 * notion of XML comments, so trying to strip it out by pattern is a real way
 * to accidentally eat unrelated content between two separate `<!-- -->`
 * blocks; leaving it as inert dead text is completely safe.
 */
function rewriteLaunchBackgroundXml(xml: string, backgroundColorHex: string, resourceName: string): string {
  if (!BACKGROUND_ITEM_PATTERN.test(xml) || !LAYER_LIST_CLOSE_PATTERN.test(xml)) {
    throw new Error("launch_background.xml doesn't match the standard Flutter layer-list format - customize it manually instead.");
  }
  const next = xml.replace(BACKGROUND_ITEM_PATTERN, `<item android:drawable="#${normalizeHexColor(backgroundColorHex)}" />`);
  const bitmapItem = `    <item>\n        <bitmap\n            android:gravity="center"\n            android:src="@drawable/${resourceName}" />\n    </item>\n`;
  const ownPattern = ownBitmapItemPattern(resourceName);
  if (ownPattern.test(next)) {
    return next.replace(ownPattern, bitmapItem.trim());
  }
  return next.replace(LAYER_LIST_CLOSE_PATTERN, `${bitmapItem}</layer-list>`);
}

async function updateLaunchBackgroundFile(filePath: string, backgroundColorHex: string, resourceName: string): Promise<void> {
  if (!fs.existsSync(filePath)) { return; }
  const xml = fs.readFileSync(filePath, "utf8");
  const updated = rewriteLaunchBackgroundXml(xml, backgroundColorHex, resourceName);
  await vscode.workspace.fs.writeFile(vscode.Uri.file(filePath), Buffer.from(updated, "utf8"));
}

export interface AndroidSplashGenerationOptions {
  androidManifestUri: vscode.Uri;
  foreground: RasterImage;
  backgroundColor: string;
  logoSize: number;
}

async function generateAndroidSplash(options: AndroidSplashGenerationOptions): Promise<GeneratedSplashFile[]> {
  const { androidManifestUri, foreground, backgroundColor, logoSize } = options;
  const androidAppDir = androidAppDirFromManifest(androidManifestUri);
  const resDir = path.join(androidAppDir, "src", "main", "res");
  const resourceName = "launch_image";

  const lightPath = path.join(resDir, "drawable", "launch_background.xml");
  const v21Path = path.join(resDir, "drawable-v21", "launch_background.xml");
  if (!fs.existsSync(lightPath) && !fs.existsSync(v21Path)) {
    throw new Error(`No launch_background.xml found under ${path.relative(path.dirname(androidAppDir), resDir)}. Run "flutter create ." once to scaffold the standard Android splash layout first.`);
  }
  await updateLaunchBackgroundFile(lightPath, backgroundColor, resourceName);
  await updateLaunchBackgroundFile(v21Path, backgroundColor, resourceName);

  const files: GeneratedSplashFile[] = [];
  for (const density of STANDARD_DENSITIES) {
    const scale = ANDROID_DENSITY_SCALES[density] ?? 1;
    const sizePx = Math.round(logoSize * scale);
    const png = await renderSquarePng(foreground, sizePx);
    const filePath = path.join(resDir, `drawable-${density}`, `${resourceName}.png`);
    files.push(await writeSplashFile(filePath, png, sizePx, sizePx, "Android"));
  }
  return files;
}

const STORYBOARD_COLOR_PATTERN = /(<color key="backgroundColor"[^>]*\bred=")[^"]*("[^>]*\bgreen=")[^"]*("[^>]*\bblue=")[^"]*("[^>]*\balpha=")[^"]*(")/;
const STORYBOARD_IMAGE_SIZE_PATTERN = /(<image name="LaunchImage"[^>]*\bwidth=")[^"]*("[^>]*\bheight=")[^"]*(")/;

function rewriteLaunchScreenStoryboard(xml: string, backgroundColorHex: string, pointSize: number): string {
  if (!STORYBOARD_COLOR_PATTERN.test(xml) || !STORYBOARD_IMAGE_SIZE_PATTERN.test(xml)) {
    throw new Error("LaunchScreen.storyboard doesn't match the standard Flutter layout - customize it manually instead.");
  }
  const { r, g, b } = hexToUnitRgb(backgroundColorHex);
  let next = xml.replace(STORYBOARD_COLOR_PATTERN, `$1${r}$2${g}$3${b}$4${1}$5`);
  next = next.replace(STORYBOARD_IMAGE_SIZE_PATTERN, `$1${pointSize}$2${pointSize}$3`);
  return next;
}

export interface IOSSplashGenerationOptions {
  iosPlistUri: vscode.Uri;
  foreground: RasterImage;
  backgroundColor: string;
  logoSize: number;
}

async function generateIOSSplash(options: IOSSplashGenerationOptions): Promise<GeneratedSplashFile[]> {
  const { iosPlistUri, foreground, backgroundColor, logoSize } = options;
  const runnerDir = path.dirname(iosPlistUri.fsPath);
  const storyboardPath = path.join(runnerDir, "Base.lproj", "LaunchScreen.storyboard");
  const imageSetDir = path.join(runnerDir, "Assets.xcassets", "LaunchImage.imageset");
  if (!fs.existsSync(storyboardPath)) {
    throw new Error(`No LaunchScreen.storyboard found at ${path.relative(path.dirname(runnerDir), storyboardPath)}. Run "flutter create ." once to scaffold the standard iOS splash layout first.`);
  }

  const storyboardXml = fs.readFileSync(storyboardPath, "utf8");
  const updatedStoryboard = rewriteLaunchScreenStoryboard(storyboardXml, backgroundColor, logoSize);
  await vscode.workspace.fs.writeFile(vscode.Uri.file(storyboardPath), Buffer.from(updatedStoryboard, "utf8"));

  const files: GeneratedSplashFile[] = [];
  const scales: { suffix: string; scale: number }[] = [
    { suffix: "", scale: 1 },
    { suffix: "@2x", scale: 2 },
    { suffix: "@3x", scale: 3 },
  ];
  for (const { suffix, scale } of scales) {
    const sizePx = Math.round(logoSize * scale);
    const png = await renderSquarePng(foreground, sizePx);
    const filePath = path.join(imageSetDir, `LaunchImage${suffix}.png`);
    files.push(await writeSplashFile(filePath, png, sizePx, sizePx, "iOS"));
  }
  return files;
}

export interface GenerateSplashOptions extends ImageComposeOptions {
  sourcePath: string;
  platforms: SplashPlatformTarget;
  androidManifestUri?: vscode.Uri;
  iosPlistUri?: vscode.Uri;
  /** Logo box edge in dp/pt; clamped to 48-480, default 200. */
  logoSize?: number;
}

export async function generateSplash(options: GenerateSplashOptions): Promise<SplashGenerationResult> {
  const { sourcePath, platforms } = options;
  const kind = detectSplashSourceKind(sourcePath);
  if (!kind) {
    return { success: false, message: "Unsupported file type. Choose a PNG, JPEG, or SVG image.", androidFiles: [], iosFiles: [] };
  }
  if (!fs.existsSync(sourcePath)) {
    return { success: false, message: `Source image not found: ${sourcePath}`, androidFiles: [], iosFiles: [] };
  }

  const wantsAndroid = platforms === "android" || platforms === "both";
  const wantsIOS = platforms === "ios" || platforms === "both";

  if (wantsAndroid && !options.androidManifestUri) {
    return { success: false, message: "No AndroidManifest.xml found in this workspace.", androidFiles: [], iosFiles: [] };
  }
  if (wantsIOS && !options.iosPlistUri) {
    return { success: false, message: "No ios/Runner/Info.plist found in this workspace.", androidFiles: [], iosFiles: [] };
  }

  const backgroundColor = options.backgroundColor ?? "#FFFFFF";

  try {
    const source = await loadForeground(sourcePath, kind, !!options.trimMargins);
    const scalePercent = clampSplashScalePercent(options.scalePercent);
    const logoSize = clampSplashLogoSize(options.logoSize);
    // The background is written as a native color, not baked into the image - the foreground is always composed transparent.
    const foreground = composeWorkingImage(source, scalePercent, undefined, DEFAULT_WORKING_CANVAS_SIZE);

    const androidFiles = wantsAndroid
      ? await generateAndroidSplash({ androidManifestUri: options.androidManifestUri!, foreground, backgroundColor, logoSize })
      : [];
    const iosFiles = wantsIOS
      ? await generateIOSSplash({ iosPlistUri: options.iosPlistUri!, foreground, backgroundColor, logoSize })
      : [];

    const parts: string[] = [];
    if (androidFiles.length) { parts.push("Android"); }
    if (iosFiles.length) { parts.push("iOS"); }
    return {
      success: true,
      message: parts.length ? `Generated the ${parts.join(" and ")} splash screen.` : "No splash targets found to generate.",
      androidFiles,
      iosFiles,
    };
  } catch (error) {
    return { success: false, message: `Failed to generate splash screen: ${toErrorMessage(error)}`, androidFiles: [], iosFiles: [] };
  }
}

/** Reads the largest existing candidate PNG (by its real pixel size) as a preview. */
function readLargestExisting(filePaths: string[]): SplashPreview | undefined {
  let best: { bytes: Buffer; width: number; height: number } | undefined;
  for (const filePath of filePaths) {
    if (!fs.existsSync(filePath)) { continue; }
    const bytes = fs.readFileSync(filePath);
    const size = readPngSize(bytes);
    if (size && (!best || size.width > best.width)) {
      best = { bytes, ...size };
    }
  }
  return best
    ? { dataUrl: `data:image/png;base64,${best.bytes.toString("base64")}`, width: best.width, height: best.height }
    : undefined;
}

function getCurrentAndroidSplashPreview(androidManifestUri: vscode.Uri): SplashPreview | undefined {
  const resDir = path.join(androidAppDirFromManifest(androidManifestUri), "src", "main", "res");
  return readLargestExisting(STANDARD_DENSITIES.map((density) => path.join(resDir, `drawable-${density}`, "launch_image.png")));
}

function getCurrentIOSSplashPreview(iosPlistUri: vscode.Uri): SplashPreview | undefined {
  const imageSetDir = path.join(path.dirname(iosPlistUri.fsPath), "Assets.xcassets", "LaunchImage.imageset");
  return readLargestExisting(["LaunchImage.png", "LaunchImage@2x.png", "LaunchImage@3x.png"].map((name) => path.join(imageSetDir, name)));
}

export interface CurrentSplashPreviewOptions {
  androidManifestUri?: vscode.Uri;
  iosPlistUri?: vscode.Uri;
}

/**
 * Reads whatever splash image files already exist for this project, as-is
 * (no resizing or recomposition), so the "before" state can be shown next to
 * the live preview of a newly-picked source image.
 */
export async function getCurrentSplashPreviews(options: CurrentSplashPreviewOptions): Promise<CurrentSplashPreviews> {
  return {
    android: options.androidManifestUri ? getCurrentAndroidSplashPreview(options.androidManifestUri) : undefined,
    ios: options.iosPlistUri ? getCurrentIOSSplashPreview(options.iosPlistUri) : undefined,
  };
}

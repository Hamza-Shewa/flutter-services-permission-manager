/**
 * App icon (launcher icon) generation.
 *
 * Given a single source image (PNG, JPEG, or SVG), renders and writes the
 * icon files Android and/or iOS expect, without altering anything else about
 * the project structure:
 *  - Android launcher: overwrites `ic_launcher.png` (or whatever resource name
 *    `android:icon` points to) in each existing `mipmap-*dpi` folder, falling
 *    back to the standard mdpi..xxxhdpi set for a project that has none yet.
 *  - Android Play Store icon: a single full-color 512x512 PNG written next to
 *    `android/app/`, for uploading to the Play Console listing (never bundled
 *    into the app itself).
 *  - Android notification icons: the status-bar small icon must be a white
 *    silhouette on a transparent background (Android repaints small-icon
 *    pixels white from API 21 on and ignores color) - generated from the
 *    source's alpha channel at `res/drawable-*dpi/ic_notification.png`
 *    (the resource name most Flutter/Firebase notification-icon guides use
 *    for `com.google.firebase.messaging.default_notification_icon`, or for
 *    `flutter_local_notifications`' `AndroidInitializationSettings`).
 *  - OneSignal notification icons: OneSignal's Android SDK picks up two
 *    specific resource names via normal Android resource merging, no manifest
 *    edits required - `ic_stat_onesignal_default` (small icon, same white
 *    silhouette treatment) and `ic_onesignal_large_icon_default` (large icon,
 *    full color, shown in the expanded notification tray).
 *  - iOS: reads `Assets.xcassets/AppIcon.appiconset/Contents.json` and
 *    (re)renders exactly the image slots it declares, at the pixel size each
 *    slot's `size` x `scale` implies, synthesizing a filename (and updating
 *    Contents.json) only for slots that don't have one yet. iOS has no
 *    separate notification icon - it always shows the app's own AppIcon.
 *
 * `IconComposeOptions` (`scalePercent` + `backgroundColor`) control how the
 * source is laid out on the square working canvas before any of the above:
 * see `composeWorkingImage`. They're never applied to the notification
 * silhouette family, which must stay transparent outside its shape.
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
  generateSquarePreview,
  loadRasterSourceCached,
  renderSquarePng,
  type RasterImage,
} from "../../core/shared/image-compose.js";
import type {
  AndroidIconFamilySelection,
  AndroidIconTarget,
  AppIconSetContents,
  AppIconSetImage,
  CurrentIconPreviews,
  GeneratedIconFile,
  IconComposeOptions,
  IconGenerationResult,
  IconPlatformTarget,
  IconPreview,
} from "./types.js";

/** Standard Android launcher icon size (dp) at mdpi baseline density */
const ANDROID_BASE_ICON_SIZE = 48;

/** Android status-bar / small notification icon baseline size (dp) at mdpi - same guideline for the default and OneSignal small icons */
const ANDROID_NOTIFICATION_ICON_SIZE = 24;

/** Android notification large-icon baseline size (dp) at mdpi (Android's and OneSignal's own guideline: 64dp -> 256px at xxxhdpi) */
const ANDROID_LARGE_ICON_SIZE = 64;

/** Google Play Console listing icon: fixed 512x512, not tied to any density */
const PLAY_STORE_ICON_SIZE = 512;

/** Density -> scale factor relative to mdpi */
const ANDROID_DENSITY_SCALES: Readonly<Record<string, number>> = {
  mdpi: 1,
  hdpi: 1.5,
  xhdpi: 2,
  xxhdpi: 3,
  xxxhdpi: 4,
};

const STANDARD_DENSITIES = Object.keys(ANDROID_DENSITY_SCALES);

const MIPMAP_DIR_PATTERN = /^mipmap-(mdpi|hdpi|xhdpi|xxhdpi|xxxhdpi)$/;

export const detectIconSourceKind = detectImageSourceKind;
export const clampIconScalePercent = clampScalePercent;

/**
 * Renders a white-on-transparent silhouette, the shape Android requires for
 * status-bar notification icons: the OS repaints every opaque pixel of a
 * small icon white from API 21 on and ignores its original color, so we
 * paint white ourselves and keep only the source's alpha channel as the
 * shape mask. A source with no transparency (a flat rectangular photo, say)
 * has no shape to extract and renders as a solid white square - callers
 * surface `hasMeaningfulTransparency` so the UI can warn about that.
 */
async function renderNotificationSilhouettePng(source: RasterImage, sizePx: number): Promise<Buffer> {
  const clone = source.clone();
  clone.cover({ w: sizePx, h: sizePx });
  clone.scan(0, 0, clone.width, clone.height, (_x: number, _y: number, idx: number) => {
    clone.bitmap.data[idx] = 255;
    clone.bitmap.data[idx + 1] = 255;
    clone.bitmap.data[idx + 2] = 255;
  });
  const buffer = await clone.getBuffer("image/png");
  return Buffer.from(buffer);
}

/** Whether the source has any non-opaque pixel - a proxy for "has a real shape to silhouette" vs. a flat opaque photo. */
function hasMeaningfulTransparency(source: RasterImage): boolean {
  const { data } = source.bitmap;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 250) { return true; }
  }
  return false;
}

/**
 * Renders the same square crop every generated icon uses, as a small PNG data
 * URL the webview can display immediately after picking a source image -
 * before any files are written - so the user can see how it will look on
 * each platform (the way Xcode previews an AppIcon in its rounded slots).
 */
export async function generateIconPreview(
  sourcePath: string,
  compose: IconComposeOptions = {},
): Promise<IconPreview> {
  return generateSquarePreview(sourcePath, compose);
}

function androidAppDirFromManifest(manifestUri: vscode.Uri): string {
  // .../android/app/src/main/AndroidManifest.xml -> .../android/app
  return path.dirname(path.dirname(path.dirname(manifestUri.fsPath)));
}

function parseAndroidIconResourceName(manifestContent: string | undefined): string {
  const match = manifestContent
    ? /android:icon\s*=\s*"@(?:mipmap|drawable)\/([A-Za-z0-9_]+)"/.exec(manifestContent)
    : null;
  return match?.[1] ?? "ic_launcher";
}

/**
 * Computes the set of Android mipmap targets to (re)write: every
 * `mipmap-*dpi` folder that already exists under `res/`, or the standard
 * mdpi..xxxhdpi set if none exist yet.
 */
export function computeAndroidIconTargets(
  androidAppDir: string,
  resourceName: string,
): AndroidIconTarget[] {
  const resDir = path.join(androidAppDir, "src", "main", "res");
  let densities = Object.keys(ANDROID_DENSITY_SCALES);
  try {
    const existing = fs.readdirSync(resDir).filter((name) => MIPMAP_DIR_PATTERN.test(name));
    if (existing.length) {
      densities = existing.map((name) => MIPMAP_DIR_PATTERN.exec(name)![1]);
    }
  } catch {
    // res/ doesn't exist yet; fall back to the standard density set.
  }
  return densities.map((density) => {
    const scale = ANDROID_DENSITY_SCALES[density] ?? 1;
    const sizePx = Math.round(ANDROID_BASE_ICON_SIZE * scale);
    return {
      density,
      sizePx,
      filePath: path.join(resDir, `mipmap-${density}`, `${resourceName}.png`),
    };
  });
}

/**
 * Computes the standard mdpi..xxxhdpi set of `drawable-*dpi/<resourceName>.png`
 * targets at the given mdpi-baseline size - used for notification icons,
 * which (unlike the launcher icon) always get the full density set so the
 * resource resolves at every device density, matching what Android Studio's
 * own Image Asset tool generates.
 */
function computeAndroidDrawableTargets(
  androidAppDir: string,
  resourceName: string,
  baseSizeDp: number,
): AndroidIconTarget[] {
  const resDir = path.join(androidAppDir, "src", "main", "res");
  return STANDARD_DENSITIES.map((density) => {
    const scale = ANDROID_DENSITY_SCALES[density] ?? 1;
    const sizePx = Math.round(baseSizeDp * scale);
    return {
      density,
      sizePx,
      filePath: path.join(resDir, `drawable-${density}`, `${resourceName}.png`),
    };
  });
}

/** Parses an AppIcon.appiconset "60x60" size string into a pixel-per-point number. */
export function parseAppIconPoints(size: string): number | undefined {
  const match = /^([0-9]+(?:\.[0-9]+)?)x[0-9]+(?:\.[0-9]+)?$/.exec(size.trim());
  return match ? Number(match[1]) : undefined;
}

/** Parses an AppIcon.appiconset "2x" scale string into a multiplier. */
export function parseAppIconScale(scale: string): number | undefined {
  const match = /^([0-9]+(?:\.[0-9]+)?)x$/.exec(scale.trim());
  return match ? Number(match[1]) : undefined;
}

export function synthesizeAppIconFilename(image: AppIconSetImage): string {
  return `Icon-App-${image.size}@${image.scale}.png`;
}

/** Computes the pixel size for a Contents.json image slot, or undefined if unparseable. */
export function computeAppIconPixelSize(image: AppIconSetImage): number | undefined {
  const points = parseAppIconPoints(image.size);
  const scale = parseAppIconScale(image.scale);
  if (!points || !scale) { return undefined; }
  return Math.round(points * scale);
}

async function readAppIconSetContents(contentsPath: string): Promise<AppIconSetContents> {
  const raw = fs.readFileSync(contentsPath, "utf8");
  const parsed = JSON.parse(raw) as AppIconSetContents;
  if (!Array.isArray(parsed.images)) {
    throw new Error(`${contentsPath} has no "images" array.`);
  }
  return parsed;
}

async function writeIconFile(filePath: string, png: Buffer, sizePx: number, label: string): Promise<GeneratedIconFile> {
  const uri = vscode.Uri.file(filePath);
  await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(filePath)));
  await vscode.workspace.fs.writeFile(uri, png);
  return { path: vscode.workspace.asRelativePath(uri, false), width: sizePx, height: sizePx, label };
}

async function generateAndroidDensitySet(
  targets: AndroidIconTarget[],
  source: RasterImage,
  label: string,
  silhouette: boolean,
): Promise<GeneratedIconFile[]> {
  const written: GeneratedIconFile[] = [];
  for (const target of targets) {
    const png = silhouette
      ? await renderNotificationSilhouettePng(source, target.sizePx)
      : await renderSquarePng(source, target.sizePx);
    written.push(await writeIconFile(target.filePath, png, target.sizePx, label));
  }
  return written;
}

export interface AndroidIconGenerationResult {
  files: GeneratedIconFile[];
  hasMeaningfulTransparency: boolean;
}

function resolveAndroidFamilies(selection: AndroidIconFamilySelection | undefined): Required<AndroidIconFamilySelection> {
  return {
    launcher: selection?.launcher ?? true,
    playStore: selection?.playStore ?? true,
    notifications: selection?.notifications ?? true,
  };
}

/**
 * Generates the selected Android icon families from one source image: the
 * launcher icon (every existing `mipmap-*dpi`, or the standard set), a
 * 512x512 Play Store listing icon, and/or notification icons (the default
 * white-silhouette icon plus OneSignal's small (silhouette) + large (color)
 * icons) - whichever `families` opts into (all, by default).
 */
async function generateAndroidIcons(
  androidManifestUri: vscode.Uri,
  androidManifestContent: string | undefined,
  coloredWorking: RasterImage,
  transparentWorking: RasterImage,
  families: AndroidIconFamilySelection | undefined,
): Promise<AndroidIconGenerationResult> {
  const { launcher, playStore, notifications } = resolveAndroidFamilies(families);
  const androidAppDir = androidAppDirFromManifest(androidManifestUri);
  const resourceName = parseAndroidIconResourceName(androidManifestContent);
  const files: GeneratedIconFile[] = [];
  let hasTransparency = true;

  if (launcher) {
    const launcherTargets = computeAndroidIconTargets(androidAppDir, resourceName);
    files.push(...await generateAndroidDensitySet(launcherTargets, coloredWorking, "Launcher", false));
  }

  if (playStore) {
    const playStorePng = await renderSquarePng(coloredWorking, PLAY_STORE_ICON_SIZE);
    files.push(await writeIconFile(
      path.join(path.dirname(androidAppDir), "play_store_icon.png"),
      playStorePng,
      PLAY_STORE_ICON_SIZE,
      "Play Store",
    ));
  }

  if (notifications) {
    const defaultNotificationTargets = computeAndroidDrawableTargets(androidAppDir, "ic_notification", ANDROID_NOTIFICATION_ICON_SIZE);
    files.push(...await generateAndroidDensitySet(defaultNotificationTargets, transparentWorking, "Notification (default)", true));

    const oneSignalSmallTargets = computeAndroidDrawableTargets(androidAppDir, "ic_stat_onesignal_default", ANDROID_NOTIFICATION_ICON_SIZE);
    files.push(...await generateAndroidDensitySet(oneSignalSmallTargets, transparentWorking, "Notification (OneSignal small)", true));

    const oneSignalLargeTargets = computeAndroidDrawableTargets(androidAppDir, "ic_onesignal_large_icon_default", ANDROID_LARGE_ICON_SIZE);
    files.push(...await generateAndroidDensitySet(oneSignalLargeTargets, coloredWorking, "Notification (OneSignal large)", false));

    hasTransparency = hasMeaningfulTransparency(transparentWorking);
  }

  return { files, hasMeaningfulTransparency: hasTransparency };
}

async function generateIOSIcons(iosPlistUri: vscode.Uri, source: RasterImage): Promise<GeneratedIconFile[]> {
  const runnerDir = path.dirname(iosPlistUri.fsPath);
  const appIconSetDir = path.join(runnerDir, "Assets.xcassets", "AppIcon.appiconset");
  const contentsPath = path.join(appIconSetDir, "Contents.json");
  if (!fs.existsSync(contentsPath)) {
    throw new Error(`No AppIcon.appiconset found at ${path.relative(path.dirname(runnerDir), appIconSetDir)}. Run "flutter create ." once to scaffold the standard iOS asset catalog first.`);
  }

  const contents = await readAppIconSetContents(contentsPath);
  let contentsChanged = false;
  const written: GeneratedIconFile[] = [];

  for (const image of contents.images) {
    const sizePx = computeAppIconPixelSize(image);
    if (!sizePx) { continue; }
    if (!image.filename) {
      image.filename = synthesizeAppIconFilename(image);
      contentsChanged = true;
    }
    const png = await renderSquarePng(source, sizePx);
    const filePath = path.join(appIconSetDir, image.filename);
    written.push(await writeIconFile(filePath, png, sizePx, "AppIcon"));
  }

  if (contentsChanged) {
    await vscode.workspace.fs.writeFile(
      vscode.Uri.file(contentsPath),
      Buffer.from(`${JSON.stringify(contents, null, 2)}\n`, "utf8"),
    );
  }

  return written;
}

/** Picks the highest-resolution candidate whose file actually exists on disk. */
function pickLargestExisting(candidates: { filePath: string; sizePx: number }[]): { filePath: string; sizePx: number } | undefined {
  const existing = candidates.filter((candidate) => fs.existsSync(candidate.filePath));
  return existing.reduce<{ filePath: string; sizePx: number } | undefined>(
    (best, candidate) => (!best || candidate.sizePx > best.sizePx ? candidate : best),
    undefined,
  );
}

function readAsDataUrl(filePath: string, sizePx: number): IconPreview {
  return { dataUrl: `data:image/png;base64,${fs.readFileSync(filePath).toString("base64")}`, size: sizePx };
}

/**
 * Reads whichever launcher icon file is already on disk (the largest
 * existing `mipmap-*dpi` density) and returns it unmodified as a preview -
 * so the user can see what's already there before deciding to replace it.
 */
function getCurrentAndroidIconPreview(androidManifestUri: vscode.Uri, androidManifestContent: string | undefined): IconPreview | undefined {
  const androidAppDir = androidAppDirFromManifest(androidManifestUri);
  const resourceName = parseAndroidIconResourceName(androidManifestContent);
  const targets = computeAndroidIconTargets(androidAppDir, resourceName);
  const best = pickLargestExisting(targets);
  return best ? readAsDataUrl(best.filePath, best.sizePx) : undefined;
}

/**
 * Reads whichever AppIcon.appiconset image is already on disk (the largest
 * declared slot that has a file) and returns it unmodified as a preview.
 */
async function getCurrentIOSIconPreview(iosPlistUri: vscode.Uri): Promise<IconPreview | undefined> {
  const runnerDir = path.dirname(iosPlistUri.fsPath);
  const appIconSetDir = path.join(runnerDir, "Assets.xcassets", "AppIcon.appiconset");
  const contentsPath = path.join(appIconSetDir, "Contents.json");
  if (!fs.existsSync(contentsPath)) { return undefined; }

  let contents: AppIconSetContents;
  try {
    contents = await readAppIconSetContents(contentsPath);
  } catch {
    return undefined;
  }

  const candidates = contents.images
    .map((image) => {
      const sizePx = computeAppIconPixelSize(image);
      return image.filename && sizePx ? { filePath: path.join(appIconSetDir, image.filename), sizePx } : undefined;
    })
    .filter((candidate): candidate is { filePath: string; sizePx: number } => !!candidate);

  const best = pickLargestExisting(candidates);
  return best ? readAsDataUrl(best.filePath, best.sizePx) : undefined;
}

export interface CurrentIconPreviewOptions {
  androidManifestUri?: vscode.Uri;
  androidManifestContent?: string;
  iosPlistUri?: vscode.Uri;
}

/**
 * Reads whatever launcher/AppIcon files already exist for this project, as-is
 * (no resizing or recomposition), so the "before" state can be shown next to
 * the live preview of a newly-picked source image.
 */
export async function getCurrentIconPreviews(options: CurrentIconPreviewOptions): Promise<CurrentIconPreviews> {
  const [android, ios] = await Promise.all([
    options.androidManifestUri
      ? Promise.resolve(getCurrentAndroidIconPreview(options.androidManifestUri, options.androidManifestContent)).catch(() => undefined)
      : Promise.resolve(undefined),
    options.iosPlistUri
      ? getCurrentIOSIconPreview(options.iosPlistUri).catch(() => undefined)
      : Promise.resolve(undefined),
  ]);
  return { android, ios };
}

export interface GenerateIconsOptions extends IconComposeOptions {
  sourcePath: string;
  platforms: IconPlatformTarget;
  androidManifestUri?: vscode.Uri;
  androidManifestContent?: string;
  iosPlistUri?: vscode.Uri;
  /** Which Android icon families to write; omitted families default to enabled. */
  androidFamilies?: AndroidIconFamilySelection;
}

export async function generateIcons(options: GenerateIconsOptions): Promise<IconGenerationResult> {
  const { sourcePath, platforms } = options;
  const kind = detectIconSourceKind(sourcePath);
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

  try {
    const source = await loadRasterSourceCached(sourcePath, kind);
    const scalePercent = clampIconScalePercent(options.scalePercent);
    const coloredWorking = composeWorkingImage(source, scalePercent, options.backgroundColor, DEFAULT_WORKING_CANVAS_SIZE);
    const android = wantsAndroid
      ? await generateAndroidIcons(
        options.androidManifestUri!,
        options.androidManifestContent,
        coloredWorking,
        composeWorkingImage(source, scalePercent, undefined, DEFAULT_WORKING_CANVAS_SIZE),
        options.androidFamilies,
      )
      : undefined;
    const androidFiles = android?.files ?? [];
    const iosFiles = wantsIOS
      ? await generateIOSIcons(options.iosPlistUri!, coloredWorking)
      : [];

    const parts: string[] = [];
    if (androidFiles.length) { parts.push(`${androidFiles.length} Android icon(s)`); }
    if (iosFiles.length) { parts.push(`${iosFiles.length} iOS icon(s)`); }
    let message = parts.length ? `Generated ${parts.join(" and ")}.` : "No icon slots found to generate.";
    if (android && !android.hasMeaningfulTransparency) {
      message += " Note: the source image has no transparency, so the notification icons rendered as solid white squares - use a source with a transparent background around the shape for a proper silhouette.";
    }
    return {
      success: true,
      message,
      androidFiles,
      iosFiles,
    };
  } catch (error) {
    return { success: false, message: `Failed to generate icons: ${toErrorMessage(error)}`, androidFiles: [], iosFiles: [] };
  }
}

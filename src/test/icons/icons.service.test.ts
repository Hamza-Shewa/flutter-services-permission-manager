import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { Jimp } from "jimp";
import {
  clampIconScalePercent,
  computeAndroidIconTargets,
  computeAppIconPixelSize,
  detectIconSourceKind,
  generateIcons,
  getCurrentIconPreviews,
  parseAppIconPoints,
  parseAppIconScale,
  synthesizeAppIconFilename,
} from "../../features/icons/icons.service.js";
import {
  clampScalePercent,
  composeWorkingImage,
  findContentBounds,
  generateSourcePreview,
  loadForeground,
  renderSquarePng,
  type RasterImage,
} from "../../core/shared/image-compose.js";

function mkTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const PREVIEW_PX = 256;

async function composePreview(sourcePath: string, options: { scalePercent?: number; backgroundColor?: string; trimMargins?: boolean } = {}) {
  const source = await loadForeground(sourcePath, "png", !!options.trimMargins);
  const working = composeWorkingImage(source, clampScalePercent(options.scalePercent), options.backgroundColor, PREVIEW_PX);
  return Jimp.fromBuffer(await renderSquarePng(working, PREVIEW_PX));
}

/** A transparent canvas with an opaque square of `color` at [x, y, size]. */
async function writePaddedSource(filePath: string, canvas: number, x: number, y: number, size: number, color = 0xff0000ff): Promise<void> {
  const image = new Jimp({ width: canvas, height: canvas, color: 0x00000000 });
  const square = new Jimp({ width: size, height: size, color });
  image.composite(square, x, y);
  await image.write(filePath as `${string}.png`);
}

async function writeSourcePng(filePath: string, size = 32): Promise<void> {
  const image = new Jimp({ width: size, height: size, color: 0xff0000ff });
  await image.write(filePath as `${string}.png`);
}

suite("App icon generation", () => {
  test("detectIconSourceKind recognizes png, jpeg, and svg", () => {
    assert.strictEqual(detectIconSourceKind("icon.png"), "png");
    assert.strictEqual(detectIconSourceKind("ICON.JPG"), "jpeg");
    assert.strictEqual(detectIconSourceKind("logo.jpeg"), "jpeg");
    assert.strictEqual(detectIconSourceKind("mark.svg"), "svg");
    assert.strictEqual(detectIconSourceKind("photo.gif"), undefined);
  });

  test("parseAppIconPoints and parseAppIconScale parse Contents.json fields", () => {
    assert.strictEqual(parseAppIconPoints("60x60"), 60);
    assert.strictEqual(parseAppIconPoints("1024x1024"), 1024);
    assert.strictEqual(parseAppIconPoints("bogus"), undefined);
    assert.strictEqual(parseAppIconScale("2x"), 2);
    assert.strictEqual(parseAppIconScale("1x"), 1);
    assert.strictEqual(parseAppIconScale("bogus"), undefined);
  });

  test("computeAppIconPixelSize multiplies points by scale", () => {
    assert.strictEqual(computeAppIconPixelSize({ idiom: "iphone", size: "60x60", scale: "2x" }), 120);
    assert.strictEqual(computeAppIconPixelSize({ idiom: "ios-marketing", size: "1024x1024", scale: "1x" }), 1024);
    assert.strictEqual(computeAppIconPixelSize({ idiom: "iphone", size: "60x60", scale: "bad" }), undefined);
  });

  test("synthesizeAppIconFilename matches Flutter's own naming convention", () => {
    assert.strictEqual(
      synthesizeAppIconFilename({ idiom: "iphone", size: "60x60", scale: "2x" }),
      "Icon-App-60x60@2x.png",
    );
  });

  test("computeAndroidIconTargets uses only existing mipmap densities", () => {
    const appDir = mkTempDir("fcm-android-targets-");
    fs.mkdirSync(path.join(appDir, "src", "main", "res", "mipmap-hdpi"), { recursive: true });
    fs.mkdirSync(path.join(appDir, "src", "main", "res", "mipmap-xhdpi"), { recursive: true });

    const targets = computeAndroidIconTargets(appDir, "ic_launcher");
    assert.strictEqual(targets.length, 2);
    const hdpi = targets.find((t) => t.density === "hdpi");
    const xhdpi = targets.find((t) => t.density === "xhdpi");
    assert.strictEqual(hdpi?.sizePx, 72);
    assert.strictEqual(xhdpi?.sizePx, 96);
    assert.ok(hdpi?.filePath.endsWith(path.join("mipmap-hdpi", "ic_launcher.png")));
  });

  test("computeAndroidIconTargets falls back to the standard density set when res/ has none yet", () => {
    const appDir = mkTempDir("fcm-android-fallback-");
    const targets = computeAndroidIconTargets(appDir, "ic_launcher");
    const densities = targets.map((t) => t.density).sort();
    assert.deepStrictEqual(densities, ["hdpi", "mdpi", "xhdpi", "xxhdpi", "xxxhdpi"]);
    assert.strictEqual(targets.find((t) => t.density === "mdpi")?.sizePx, 48);
    assert.strictEqual(targets.find((t) => t.density === "xxxhdpi")?.sizePx, 192);
  });

  test("clampIconScalePercent clamps to [40, 200] and defaults to 100", () => {
    assert.strictEqual(clampIconScalePercent(undefined), 100);
    assert.strictEqual(clampIconScalePercent(70), 70);
    assert.strictEqual(clampIconScalePercent(10), 40);
    assert.strictEqual(clampIconScalePercent(150), 150);
    assert.strictEqual(clampIconScalePercent(500), 200);
    assert.strictEqual(clampIconScalePercent(Number.NaN), 100);
  });

  test("composing at 200% zooms in and crops the outer edge away", async () => {
    const workDir = mkTempDir("fcm-preview-zoom-");
    const sourcePath = path.join(workDir, "source.png");
    // A green field with a small red marker in the very corner. At 200% the
    // crop shows only the center half of the source, so the corner marker
    // should fall outside the visible area and disappear.
    const image = new Jimp({ width: 64, height: 64, color: 0x00ff00ff });
    image.scan(0, 0, 6, 6, (_x: number, _y: number, idx: number) => {
      image.bitmap.data[idx] = 255;
      image.bitmap.data[idx + 1] = 0;
      image.bitmap.data[idx + 2] = 0;
      image.bitmap.data[idx + 3] = 255;
    });
    await image.write(sourcePath as `${string}.png`);

    const decoded100 = await composePreview(sourcePath, { scalePercent: 100 });
    const decoded200 = await composePreview(sourcePath, { scalePercent: 200 });

    // At 100%, the whole source is visible, so the corner marker still shows.
    assert.strictEqual(decoded100.getPixelColor(2, 2), 0xff0000ff);
    // At 200%, that corner is cropped out of view - only the green field remains.
    assert.strictEqual(decoded200.getPixelColor(2, 2), 0x00ff00ff);
  });

  test("composing pads with the background color when scaled down", async () => {
    const workDir = mkTempDir("fcm-preview-bg-");
    const sourcePath = path.join(workDir, "source.png");
    await writeSourcePng(sourcePath, 64);

    const decoded = await composePreview(sourcePath, { scalePercent: 50, backgroundColor: "#336699" });

    // Corner is in the padding area at 50% scale -> filled with the chosen background color.
    assert.strictEqual(decoded.getPixelColor(2, 2), 0x336699ff);
    // Center is still the (red) foreground.
    assert.strictEqual(decoded.getPixelColor(PREVIEW_PX / 2, PREVIEW_PX / 2), 0xff0000ff);
  });

  test("composing leaves padding transparent when no background color is given", async () => {
    const workDir = mkTempDir("fcm-preview-transparent-");
    const sourcePath = path.join(workDir, "source.png");
    await writeSourcePng(sourcePath, 64);

    const decoded = await composePreview(sourcePath, { scalePercent: 50 });
    assert.strictEqual(decoded.getPixelColor(2, 2) & 0xff, 0);
  });

  test("composing at 100% with no background reproduces an already-square opaque source", async () => {
    const workDir = mkTempDir("fcm-preview-default-");
    const sourcePath = path.join(workDir, "source.png");
    await writeSourcePng(sourcePath, 64);

    const decoded = await composePreview(sourcePath);
    assert.strictEqual(decoded.getPixelColor(2, 2), 0xff0000ff);
    assert.strictEqual(decoded.getPixelColor(PREVIEW_PX / 2, PREVIEW_PX / 2), 0xff0000ff);
  });

  test("findContentBounds finds the opaque artwork inside transparent padding", async () => {
    const workDir = mkTempDir("fcm-bounds-alpha-");
    const sourcePath = path.join(workDir, "source.png");
    await writePaddedSource(sourcePath, 100, 20, 30, 40);
    const source = (await Jimp.fromBuffer(fs.readFileSync(sourcePath))) as unknown as RasterImage;
    assert.deepStrictEqual(findContentBounds(source), { x: 20, y: 30, width: 40, height: 40 });
  });

  test("findContentBounds treats a uniform opaque border as background", async () => {
    const workDir = mkTempDir("fcm-bounds-opaque-");
    const sourcePath = path.join(workDir, "source.png");
    const image = new Jimp({ width: 80, height: 80, color: 0xffffffff });
    image.composite(new Jimp({ width: 20, height: 10, color: 0x0000ffff }), 30, 35);
    await image.write(sourcePath as `${string}.png`);
    const source = (await Jimp.fromBuffer(fs.readFileSync(sourcePath))) as unknown as RasterImage;
    assert.deepStrictEqual(findContentBounds(source), { x: 30, y: 35, width: 20, height: 10 });
  });

  test("trimMargins scales relative to the artwork instead of the source's padding", async () => {
    const workDir = mkTempDir("fcm-trim-");
    const sourcePath = path.join(workDir, "source.png");
    // A 25%-wide red square centered-ish on a transparent canvas: untrimmed, the corner stays empty.
    await writePaddedSource(sourcePath, 100, 40, 40, 25);

    const untrimmed = await composePreview(sourcePath);
    const trimmed = await composePreview(sourcePath, { trimMargins: true });
    assert.strictEqual(untrimmed.getPixelColor(10, 10) & 0xff, 0);
    // Trimmed at 100%, the artwork fills the canvas edge to edge.
    assert.strictEqual(trimmed.getPixelColor(10, 10) >>> 0, 0xff0000ff);
  });

  test("generateSourcePreview downscales large sources and reports normalized bounds and a suggested background", async () => {
    const workDir = mkTempDir("fcm-source-preview-");
    const sourcePath = path.join(workDir, "source.png");
    const image = new Jimp({ width: 1024, height: 1024, color: 0x112233ff });
    image.composite(new Jimp({ width: 512, height: 512, color: 0xffcc00ff }), 256, 256);
    await image.write(sourcePath as `${string}.png`);

    const preview = await generateSourcePreview(sourcePath);
    assert.strictEqual(preview.width, 512);
    assert.strictEqual(preview.sourceWidth, 1024);
    assert.strictEqual(preview.hasTransparency, false);
    assert.strictEqual(preview.suggestedBackground, "#112233");
    assert.deepStrictEqual(preview.contentBounds, { x: 0.25, y: 0.25, width: 0.5, height: 0.5 });
  });

  test("generateIcons writes Android launcher mipmap PNGs at the correct sizes", async () => {
    const workDir = mkTempDir("fcm-android-gen-");
    const sourcePath = path.join(workDir, "source.png");
    await writeSourcePng(sourcePath);

    const appDir = path.join(workDir, "android", "app");
    fs.mkdirSync(path.join(appDir, "src", "main", "res", "mipmap-mdpi"), { recursive: true });
    fs.mkdirSync(path.join(appDir, "src", "main", "res", "mipmap-xxxhdpi"), { recursive: true });
    const manifestPath = path.join(appDir, "src", "main", "AndroidManifest.xml");
    fs.writeFileSync(manifestPath, "<manifest><application android:icon=\"@mipmap/ic_launcher\"></application></manifest>");

    const result = await generateIcons({
      sourcePath,
      platforms: "android",
      androidManifestUri: vscode.Uri.file(manifestPath),
      androidManifestContent: fs.readFileSync(manifestPath, "utf8"),
    });

    assert.strictEqual(result.success, true, result.message);
    const launcherFiles = result.androidFiles.filter((f) => f.label === "Launcher");
    assert.strictEqual(launcherFiles.length, 2);
    const mdpiFile = path.join(appDir, "src", "main", "res", "mipmap-mdpi", "ic_launcher.png");
    const xxxhdpiFile = path.join(appDir, "src", "main", "res", "mipmap-xxxhdpi", "ic_launcher.png");
    assert.ok(fs.existsSync(mdpiFile));
    assert.ok(fs.existsSync(xxxhdpiFile));
    const decodedMdpi = await Jimp.fromBuffer(fs.readFileSync(mdpiFile));
    const decodedXxxhdpi = await Jimp.fromBuffer(fs.readFileSync(xxxhdpiFile));
    assert.strictEqual(decodedMdpi.width, 48);
    assert.strictEqual(decodedXxxhdpi.width, 192);
  });

  test("generateIcons also writes a Play Store icon and default + OneSignal notification icons", async () => {
    const workDir = mkTempDir("fcm-android-extras-");
    const sourcePath = path.join(workDir, "source.png");
    // A source with real transparency: an opaque circle on a transparent square,
    // so the notification silhouette has an actual shape to extract.
    const image = new Jimp({ width: 64, height: 64, color: 0x00000000 });
    image.scan(0, 0, image.width, image.height, (x: number, y: number, idx: number) => {
      const dx = x - 32;
      const dy = y - 32;
      if (dx * dx + dy * dy <= 28 * 28) {
        image.bitmap.data[idx] = 255;
        image.bitmap.data[idx + 1] = 0;
        image.bitmap.data[idx + 2] = 0;
        image.bitmap.data[idx + 3] = 255;
      }
    });
    await image.write(sourcePath as `${string}.png`);

    const appDir = path.join(workDir, "android", "app");
    const manifestPath = path.join(appDir, "src", "main", "AndroidManifest.xml");
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, "<manifest><application></application></manifest>");

    const result = await generateIcons({
      sourcePath,
      platforms: "android",
      androidManifestUri: vscode.Uri.file(manifestPath),
      androidManifestContent: fs.readFileSync(manifestPath, "utf8"),
    });

    assert.strictEqual(result.success, true, result.message);
    assert.ok(!/no transparency/i.test(result.message), result.message);

    // Play Store icon: single 512x512 file next to android/app/, not inside it.
    const playStoreFiles = result.androidFiles.filter((f) => f.label === "Play Store");
    assert.strictEqual(playStoreFiles.length, 1);
    const playStorePath = path.join(workDir, "android", "play_store_icon.png");
    assert.ok(fs.existsSync(playStorePath));
    const decodedPlayStore = await Jimp.fromBuffer(fs.readFileSync(playStorePath));
    assert.strictEqual(decodedPlayStore.width, 512);
    assert.strictEqual(decodedPlayStore.height, 512);

    // Default notification icon: 5 densities, white silhouette (RGB 255,255,255).
    const defaultNotificationFiles = result.androidFiles.filter((f) => f.label === "Notification (default)");
    assert.strictEqual(defaultNotificationFiles.length, 5);
    const notificationMdpiPath = path.join(appDir, "src", "main", "res", "drawable-mdpi", "ic_notification.png");
    assert.ok(fs.existsSync(notificationMdpiPath));
    const decodedNotification = await Jimp.fromBuffer(fs.readFileSync(notificationMdpiPath));
    assert.strictEqual(decodedNotification.width, 24);
    let sawOpaquePixel = false;
    decodedNotification.scan(0, 0, decodedNotification.width, decodedNotification.height, (_x: number, _y: number, idx: number) => {
      const alpha = decodedNotification.bitmap.data[idx + 3];
      if (alpha > 0) {
        sawOpaquePixel = true;
        assert.strictEqual(decodedNotification.bitmap.data[idx], 255);
        assert.strictEqual(decodedNotification.bitmap.data[idx + 1], 255);
        assert.strictEqual(decodedNotification.bitmap.data[idx + 2], 255);
      }
    });
    assert.ok(sawOpaquePixel, "expected the silhouette to have at least one opaque (white) pixel");

    // OneSignal small icon: same silhouette treatment, SDK's exact expected resource name.
    const oneSignalSmallFiles = result.androidFiles.filter((f) => f.label === "Notification (OneSignal small)");
    assert.strictEqual(oneSignalSmallFiles.length, 5);
    assert.ok(fs.existsSync(path.join(appDir, "src", "main", "res", "drawable-xxxhdpi", "ic_stat_onesignal_default.png")));

    // OneSignal large icon: full color, larger baseline size (64dp -> 256px at xxxhdpi).
    const oneSignalLargeFiles = result.androidFiles.filter((f) => f.label === "Notification (OneSignal large)");
    assert.strictEqual(oneSignalLargeFiles.length, 5);
    const largeXxxhdpiPath = path.join(appDir, "src", "main", "res", "drawable-xxxhdpi", "ic_onesignal_large_icon_default.png");
    assert.ok(fs.existsSync(largeXxxhdpiPath));
    const decodedLarge = await Jimp.fromBuffer(fs.readFileSync(largeXxxhdpiPath));
    assert.strictEqual(decodedLarge.width, 256);
    // Full color (not silhouetted): the red circle's pixel should still be red, not forced white.
    assert.strictEqual(decodedLarge.getPixelColor(128, 128), 0xff0000ff);
  });

  test("generateIcons warns when the source has no transparency to silhouette", async () => {
    const workDir = mkTempDir("fcm-android-opaque-");
    const sourcePath = path.join(workDir, "source.png");
    await writeSourcePng(sourcePath);

    const appDir = path.join(workDir, "android", "app");
    const manifestPath = path.join(appDir, "src", "main", "AndroidManifest.xml");
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, "<manifest><application></application></manifest>");

    const result = await generateIcons({
      sourcePath,
      platforms: "android",
      androidManifestUri: vscode.Uri.file(manifestPath),
      androidManifestContent: fs.readFileSync(manifestPath, "utf8"),
    });

    assert.strictEqual(result.success, true, result.message);
    assert.match(result.message, /no transparency/i);
  });

  test("generateIcons applies scale + background color to full-color icons but keeps notification silhouettes transparent", async () => {
    const workDir = mkTempDir("fcm-android-scale-bg-");
    const sourcePath = path.join(workDir, "source.png");
    await writeSourcePng(sourcePath, 64);

    const appDir = path.join(workDir, "android", "app");
    const manifestPath = path.join(appDir, "src", "main", "AndroidManifest.xml");
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, "<manifest><application></application></manifest>");

    const result = await generateIcons({
      sourcePath,
      platforms: "android",
      androidManifestUri: vscode.Uri.file(manifestPath),
      androidManifestContent: fs.readFileSync(manifestPath, "utf8"),
      scalePercent: 50,
      backgroundColor: "#00ff00",
    });

    assert.strictEqual(result.success, true, result.message);
    // Note: the source has no transparency, but scale<100 still creates padding, so no silhouette warning.
    assert.ok(!/no transparency/i.test(result.message), result.message);

    // Launcher icon: padding corner filled with the chosen background color.
    const launcherPath = path.join(appDir, "src", "main", "res", "mipmap-mdpi", "ic_launcher.png");
    const decodedLauncher = await Jimp.fromBuffer(fs.readFileSync(launcherPath));
    assert.strictEqual(decodedLauncher.getPixelColor(1, 1), 0x00ff00ff);

    // OneSignal large icon (also full-color): same background treatment.
    const largePath = path.join(appDir, "src", "main", "res", "drawable-mdpi", "ic_onesignal_large_icon_default.png");
    const decodedLarge = await Jimp.fromBuffer(fs.readFileSync(largePath));
    assert.strictEqual(decodedLarge.getPixelColor(1, 1), 0x00ff00ff);

    // Default notification icon: padding stays transparent even though a background color was set for the main icon.
    const notificationPath = path.join(appDir, "src", "main", "res", "drawable-mdpi", "ic_notification.png");
    const decodedNotification = await Jimp.fromBuffer(fs.readFileSync(notificationPath));
    assert.strictEqual(decodedNotification.getPixelColor(1, 1) & 0xff, 0);
  });

  test("generateIcons renders every iOS AppIcon.appiconset slot and fills in missing filenames", async () => {
    const workDir = mkTempDir("fcm-ios-gen-");
    const sourcePath = path.join(workDir, "source.png");
    await writeSourcePng(sourcePath);

    const runnerDir = path.join(workDir, "ios", "Runner");
    const appIconSetDir = path.join(runnerDir, "Assets.xcassets", "AppIcon.appiconset");
    fs.mkdirSync(appIconSetDir, { recursive: true });
    const contentsPath = path.join(appIconSetDir, "Contents.json");
    fs.writeFileSync(contentsPath, JSON.stringify({
      images: [
        { idiom: "iphone", size: "20x20", scale: "2x", filename: "existing-20x20@2x.png" },
        { idiom: "ios-marketing", size: "1024x1024", scale: "1x" },
      ],
      info: { version: 1, author: "xcode" },
    }, null, 2));
    const plistPath = path.join(runnerDir, "Info.plist");
    fs.writeFileSync(plistPath, "<plist></plist>");

    const result = await generateIcons({
      sourcePath,
      platforms: "ios",
      iosPlistUri: vscode.Uri.file(plistPath),
    });

    assert.strictEqual(result.success, true, result.message);
    assert.strictEqual(result.iosFiles.length, 2);

    const existingFile = path.join(appIconSetDir, "existing-20x20@2x.png");
    const marketingFile = path.join(appIconSetDir, "Icon-App-1024x1024@1x.png");
    assert.ok(fs.existsSync(existingFile));
    assert.ok(fs.existsSync(marketingFile));
    const decodedExisting = await Jimp.fromBuffer(fs.readFileSync(existingFile));
    const decodedMarketing = await Jimp.fromBuffer(fs.readFileSync(marketingFile));
    assert.strictEqual(decodedExisting.width, 40);
    assert.strictEqual(decodedMarketing.width, 1024);

    const updatedContents = JSON.parse(fs.readFileSync(contentsPath, "utf8"));
    assert.strictEqual(updatedContents.images[1].filename, "Icon-App-1024x1024@1x.png");
    assert.strictEqual(updatedContents.info.author, "xcode");
  });

  test("generateIcons rasterizes an SVG source into square Android PNGs", async () => {
    const workDir = mkTempDir("fcm-svg-gen-");
    const sourcePath = path.join(workDir, "source.svg");
    fs.writeFileSync(sourcePath, '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="blue"/></svg>');

    const appDir = path.join(workDir, "android", "app");
    fs.mkdirSync(path.join(appDir, "src", "main", "res", "mipmap-mdpi"), { recursive: true });
    const manifestPath = path.join(appDir, "src", "main", "AndroidManifest.xml");
    fs.writeFileSync(manifestPath, "<manifest><application></application></manifest>");

    const result = await generateIcons({
      sourcePath,
      platforms: "android",
      androidManifestUri: vscode.Uri.file(manifestPath),
      androidManifestContent: fs.readFileSync(manifestPath, "utf8"),
    });

    assert.strictEqual(result.success, true, result.message);
    const mdpiFile = path.join(appDir, "src", "main", "res", "mipmap-mdpi", "ic_launcher.png");
    assert.ok(fs.existsSync(mdpiFile));
    const decoded = await Jimp.fromBuffer(fs.readFileSync(mdpiFile));
    assert.strictEqual(decoded.width, 48);
    assert.strictEqual(decoded.height, 48);
    // A non-square source is fit (never cropped) into the square canvas: the
    // wide rect's own color shows through the middle, and with no background
    // color set, the letterboxed top/bottom strips stay transparent.
    assert.strictEqual(decoded.getPixelColor(24, 24), 0x0000ffff);
    assert.strictEqual(decoded.getPixelColor(24, 1) & 0xff, 0);
  });

  test("generateSourcePreview keeps a non-square source's aspect ratio", async () => {
    const workDir = mkTempDir("fcm-preview-");
    const sourcePath = path.join(workDir, "source.png");
    const image = new Jimp({ width: 300, height: 150, color: 0x00ff00ff });
    await image.write(sourcePath as `${string}.png`);

    const preview = await generateSourcePreview(sourcePath);
    assert.ok(preview.dataUrl.startsWith("data:image/png;base64,"));
    assert.strictEqual(preview.width, 300);
    assert.strictEqual(preview.height, 150);
  });

  test("generateSourcePreview rejects unsupported file types", async () => {
    await assert.rejects(() => generateSourcePreview("photo.gif"), /Unsupported file type/);
  });

  test("generateIcons reports a clear error for an unsupported file type", async () => {
    const result = await generateIcons({ sourcePath: "photo.gif", platforms: "android" });
    assert.strictEqual(result.success, false);
    assert.match(result.message, /Unsupported file type/);
  });

  test("generateIcons androidFamilies toggles let the user generate only notification icons", async () => {
    const workDir = mkTempDir("fcm-android-families-");
    const sourcePath = path.join(workDir, "source.png");
    await writeSourcePng(sourcePath);

    const appDir = path.join(workDir, "android", "app");
    const manifestPath = path.join(appDir, "src", "main", "AndroidManifest.xml");
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, "<manifest><application></application></manifest>");

    const result = await generateIcons({
      sourcePath,
      platforms: "android",
      androidManifestUri: vscode.Uri.file(manifestPath),
      androidManifestContent: fs.readFileSync(manifestPath, "utf8"),
      androidFamilies: { launcher: false, playStore: false, notifications: true },
    });

    assert.strictEqual(result.success, true, result.message);
    const labels = new Set(result.androidFiles.map((f) => f.label));
    assert.strictEqual(labels.has("Launcher"), false);
    assert.strictEqual(labels.has("Play Store"), false);
    assert.strictEqual(labels.has("Notification (default)"), true);
    assert.strictEqual(labels.has("Notification (OneSignal small)"), true);
    assert.strictEqual(labels.has("Notification (OneSignal large)"), true);
    assert.ok(!fs.existsSync(path.join(appDir, "src", "main", "res", "mipmap-mdpi", "ic_launcher.png")));
    assert.ok(!fs.existsSync(path.join(workDir, "android", "play_store_icon.png")));
    assert.ok(fs.existsSync(path.join(appDir, "src", "main", "res", "drawable-mdpi", "ic_notification.png")));
  });

  test("generateIcons androidFamilies toggles let the user generate launcher + notifications but skip the Play Store icon", async () => {
    const workDir = mkTempDir("fcm-android-families-2-");
    const sourcePath = path.join(workDir, "source.png");
    await writeSourcePng(sourcePath);

    const appDir = path.join(workDir, "android", "app");
    const manifestPath = path.join(appDir, "src", "main", "AndroidManifest.xml");
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, "<manifest><application></application></manifest>");

    const result = await generateIcons({
      sourcePath,
      platforms: "android",
      androidManifestUri: vscode.Uri.file(manifestPath),
      androidManifestContent: fs.readFileSync(manifestPath, "utf8"),
      androidFamilies: { launcher: true, playStore: false, notifications: true },
    });

    assert.strictEqual(result.success, true, result.message);
    const labels = new Set(result.androidFiles.map((f) => f.label));
    assert.strictEqual(labels.has("Launcher"), true);
    assert.strictEqual(labels.has("Play Store"), false);
    assert.strictEqual(labels.has("Notification (default)"), true);
    assert.ok(fs.existsSync(path.join(appDir, "src", "main", "res", "mipmap-mdpi", "ic_launcher.png")));
    assert.ok(!fs.existsSync(path.join(workDir, "android", "play_store_icon.png")));
  });

  test("getCurrentIconPreviews returns undefined when no icons exist yet, and the existing file unmodified once they do", async () => {
    const workDir = mkTempDir("fcm-current-preview-");
    const appDir = path.join(workDir, "android", "app");
    const manifestPath = path.join(appDir, "src", "main", "AndroidManifest.xml");
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, "<manifest><application></application></manifest>");

    const emptyResult = await getCurrentIconPreviews({
      androidManifestUri: vscode.Uri.file(manifestPath),
      androidManifestContent: fs.readFileSync(manifestPath, "utf8"),
    });
    assert.strictEqual(emptyResult.android, undefined);
    assert.strictEqual(emptyResult.ios, undefined);

    // Write an existing launcher icon directly (simulating a real project that already has one).
    const mdpiDir = path.join(appDir, "src", "main", "res", "mipmap-mdpi");
    const xxxhdpiDir = path.join(appDir, "src", "main", "res", "mipmap-xxxhdpi");
    fs.mkdirSync(mdpiDir, { recursive: true });
    fs.mkdirSync(xxxhdpiDir, { recursive: true });
    const mdpiIcon = new Jimp({ width: 48, height: 48, color: 0x123456ff });
    await mdpiIcon.write(path.join(mdpiDir, "ic_launcher.png") as `${string}.png`);
    const xxxhdpiIcon = new Jimp({ width: 192, height: 192, color: 0x654321ff });
    await xxxhdpiIcon.write(path.join(xxxhdpiDir, "ic_launcher.png") as `${string}.png`);

    const withIconResult = await getCurrentIconPreviews({
      androidManifestUri: vscode.Uri.file(manifestPath),
      androidManifestContent: fs.readFileSync(manifestPath, "utf8"),
    });
    assert.ok(withIconResult.android);
    // Picks the largest existing density (xxxhdpi, 192px), not just the first one.
    assert.strictEqual(withIconResult.android?.size, 192);
    const decoded = await Jimp.fromBuffer(Buffer.from(withIconResult.android!.dataUrl.slice("data:image/png;base64,".length), "base64"));
    assert.strictEqual(decoded.width, 192);
    // Returned as-is, not recomposed: matches the file's own color exactly.
    assert.strictEqual(decoded.getPixelColor(96, 96), 0x654321ff);
  });
});

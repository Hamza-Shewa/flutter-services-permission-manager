import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { Jimp } from "jimp";
import {
  clampSplashScalePercent,
  detectSplashSourceKind,
  generateSplash,
  generateSplashPreview,
  getCurrentSplashPreviews,
} from "../../features/splash/splash.service.js";

function mkTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

async function writeSourcePng(filePath: string, size = 64): Promise<void> {
  const image = new Jimp({ width: size, height: size, color: 0xff0000ff });
  await image.write(filePath as `${string}.png`);
}

/** The exact `launch_background.xml` layer-list `flutter create` scaffolds, unmodified. */
const DEFAULT_LAUNCH_BACKGROUND_LIGHT = `<?xml version="1.0" encoding="utf-8"?>
<!-- Modify this file to customize your launch splash screen -->
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:drawable="@android:color/white" />

    <!-- You can insert your own image assets here -->
    <!-- <item>
        <bitmap
            android:gravity="center"
            android:src="@mipmap/launch_image" />
    </item> -->
</layer-list>
`;

const DEFAULT_LAUNCH_BACKGROUND_V21 = `<?xml version="1.0" encoding="utf-8"?>
<!-- Modify this file to customize your launch splash screen -->
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:drawable="?android:colorBackground" />

    <!-- You can insert your own image assets here -->
    <!-- <item>
        <bitmap
            android:gravity="center"
            android:src="@mipmap/launch_image" />
    </item> -->
</layer-list>
`;

/** The exact `LaunchScreen.storyboard` `flutter create` scaffolds, unmodified. */
const DEFAULT_LAUNCH_SCREEN_STORYBOARD = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<document type="com.apple.InterfaceBuilder3.CocoaTouch.Storyboard.XIB" version="3.0" toolsVersion="12121" systemVersion="16G29" targetRuntime="iOS.CocoaTouch" propertyAccessControl="none" useAutolayout="YES" launchScreen="YES" colorMatched="YES" initialViewController="01J-lp-oVM">
    <dependencies>
        <deployment identifier="iOS"/>
        <plugIn identifier="com.apple.InterfaceBuilder.IBCocoaTouchPlugin" version="12089"/>
    </dependencies>
    <scenes>
        <!--View Controller-->
        <scene sceneID="EHf-IW-A2E">
            <objects>
                <viewController id="01J-lp-oVM" sceneMemberID="viewController">
                    <layoutGuides>
                        <viewControllerLayoutGuide type="top" id="Ydg-fD-yQy"/>
                        <viewControllerLayoutGuide type="bottom" id="xbc-2k-c8Z"/>
                    </layoutGuides>
                    <view key="view" contentMode="scaleToFill" id="Ze5-6b-2t3">
                        <autoresizingMask key="autoresizingMask" widthSizable="YES" heightSizable="YES"/>
                        <subviews>
                            <imageView opaque="NO" clipsSubviews="YES" multipleTouchEnabled="YES" contentMode="center" image="LaunchImage" translatesAutoresizingMaskIntoConstraints="NO" id="YRO-k0-Ey4">
                            </imageView>
                        </subviews>
                        <color key="backgroundColor" red="1" green="1" blue="1" alpha="1" colorSpace="custom" customColorSpace="sRGB"/>
                        <constraints>
                            <constraint firstItem="YRO-k0-Ey4" firstAttribute="centerX" secondItem="Ze5-6b-2t3" secondAttribute="centerX" id="1a2-6s-vTC"/>
                            <constraint firstItem="YRO-k0-Ey4" firstAttribute="centerY" secondItem="Ze5-6b-2t3" secondAttribute="centerY" id="4X2-HB-R7a"/>
                        </constraints>
                    </view>
                </viewController>
                <placeholder placeholderIdentifier="IBFirstResponder" id="iYj-Kq-Ea1" userLabel="First Responder" sceneMemberID="firstResponder"/>
            </objects>
            <point key="canvasLocation" x="53" y="375"/>
        </scene>
    </scenes>
    <resources>
        <image name="LaunchImage" width="168" height="185"/>
    </resources>
</document>
`;

function scaffoldAndroidSplash(appDir: string): void {
  const resDir = path.join(appDir, "src", "main", "res");
  fs.mkdirSync(path.join(resDir, "drawable"), { recursive: true });
  fs.mkdirSync(path.join(resDir, "drawable-v21"), { recursive: true });
  fs.writeFileSync(path.join(resDir, "drawable", "launch_background.xml"), DEFAULT_LAUNCH_BACKGROUND_LIGHT);
  fs.writeFileSync(path.join(resDir, "drawable-v21", "launch_background.xml"), DEFAULT_LAUNCH_BACKGROUND_V21);
  const manifestPath = path.join(appDir, "src", "main", "AndroidManifest.xml");
  fs.writeFileSync(manifestPath, "<manifest><application></application></manifest>");
}

function scaffoldIOSSplash(runnerDir: string): void {
  fs.mkdirSync(path.join(runnerDir, "Base.lproj"), { recursive: true });
  fs.mkdirSync(path.join(runnerDir, "Assets.xcassets", "LaunchImage.imageset"), { recursive: true });
  fs.writeFileSync(path.join(runnerDir, "Base.lproj", "LaunchScreen.storyboard"), DEFAULT_LAUNCH_SCREEN_STORYBOARD);
  fs.writeFileSync(path.join(runnerDir, "Info.plist"), "<plist></plist>");
}

suite("Splash screen generation", () => {
  test("detectSplashSourceKind and clampSplashScalePercent match the icons feature's bounds", () => {
    assert.strictEqual(detectSplashSourceKind("logo.png"), "png");
    assert.strictEqual(detectSplashSourceKind("logo.svg"), "svg");
    assert.strictEqual(clampSplashScalePercent(undefined), 100);
    assert.strictEqual(clampSplashScalePercent(500), 200);
    assert.strictEqual(clampSplashScalePercent(1), 40);
  });

  test("generateSplash writes Android launch_image.png at every density and rewrites both launch_background.xml files", async () => {
    const workDir = mkTempDir("fcm-splash-android-");
    const sourcePath = path.join(workDir, "source.png");
    await writeSourcePng(sourcePath);

    const appDir = path.join(workDir, "android", "app");
    scaffoldAndroidSplash(appDir);
    const manifestPath = path.join(appDir, "src", "main", "AndroidManifest.xml");

    const result = await generateSplash({
      sourcePath,
      platforms: "android",
      androidManifestUri: vscode.Uri.file(manifestPath),
      backgroundColor: "#3355FF",
    });

    assert.strictEqual(result.success, true, result.message);
    assert.strictEqual(result.androidFiles.length, 5);

    const resDir = path.join(appDir, "src", "main", "res");
    const mdpiFile = path.join(resDir, "drawable-mdpi", "launch_image.png");
    const xxxhdpiFile = path.join(resDir, "drawable-xxxhdpi", "launch_image.png");
    assert.ok(fs.existsSync(mdpiFile));
    assert.ok(fs.existsSync(xxxhdpiFile));
    const decodedMdpi = await Jimp.fromBuffer(fs.readFileSync(mdpiFile));
    const decodedXxxhdpi = await Jimp.fromBuffer(fs.readFileSync(xxxhdpiFile));
    assert.strictEqual(decodedMdpi.width, 288);
    assert.strictEqual(decodedXxxhdpi.width, 288 * 4);
    // Foreground is composed transparent (no baked background) - it's a real PNG with alpha to spare.
    assert.strictEqual(decodedMdpi.getPixelColor(decodedMdpi.width / 2, decodedMdpi.height / 2) >>> 0, 0xff0000ff);

    const lightXml = fs.readFileSync(path.join(resDir, "drawable", "launch_background.xml"), "utf8");
    const v21Xml = fs.readFileSync(path.join(resDir, "drawable-v21", "launch_background.xml"), "utf8");
    for (const xml of [lightXml, v21Xml]) {
      assert.match(xml, /<item android:drawable="#3355FF" \/>/);
      assert.match(xml, /android:src="@drawable\/launch_image"/);
      // The default template's commented-out placeholder survives untouched, not stripped out via fragile comment matching.
      assert.match(xml, /<!-- You can insert your own image assets here -->/);
      assert.match(xml, /<!-- <item>/);
    }
  });

  test("generateSplash re-run with a new color updates in place instead of duplicating the bitmap item", async () => {
    const workDir = mkTempDir("fcm-splash-idempotent-");
    const sourcePath = path.join(workDir, "source.png");
    await writeSourcePng(sourcePath);

    const appDir = path.join(workDir, "android", "app");
    scaffoldAndroidSplash(appDir);
    const manifestPath = path.join(appDir, "src", "main", "AndroidManifest.xml");
    const androidManifestUri = vscode.Uri.file(manifestPath);

    await generateSplash({ sourcePath, platforms: "android", androidManifestUri, backgroundColor: "#111111" });
    const result = await generateSplash({ sourcePath, platforms: "android", androidManifestUri, backgroundColor: "#222222" });
    assert.strictEqual(result.success, true, result.message);

    const lightXml = fs.readFileSync(path.join(appDir, "src", "main", "res", "drawable", "launch_background.xml"), "utf8");
    assert.match(lightXml, /<item android:drawable="#222222" \/>/);
    // Exactly one live bitmap item referencing our own resource - the second
    // run replaced it in place rather than appending a duplicate. (The
    // default template's dead `<item>...<bitmap` text inside a comment is a
    // separate, harmless match on `@mipmap/launch_image`, not this pattern.)
    assert.strictEqual(lightXml.match(/android:src="@drawable\/launch_image"/g)?.length, 1);
  });

  test("generateSplash reports a clear error when launch_background.xml doesn't exist", async () => {
    const workDir = mkTempDir("fcm-splash-missing-android-");
    const sourcePath = path.join(workDir, "source.png");
    await writeSourcePng(sourcePath);
    const appDir = path.join(workDir, "android", "app");
    const manifestPath = path.join(appDir, "src", "main", "AndroidManifest.xml");
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, "<manifest><application></application></manifest>");

    const result = await generateSplash({
      sourcePath,
      platforms: "android",
      androidManifestUri: vscode.Uri.file(manifestPath),
    });
    assert.strictEqual(result.success, false);
    assert.match(result.message, /No launch_background\.xml found/);
  });

  test("generateSplash writes iOS LaunchImage at 1x/2x/3x and rewrites the storyboard's background color and size", async () => {
    const workDir = mkTempDir("fcm-splash-ios-");
    const sourcePath = path.join(workDir, "source.png");
    await writeSourcePng(sourcePath);

    const runnerDir = path.join(workDir, "ios", "Runner");
    scaffoldIOSSplash(runnerDir);
    const plistPath = path.join(runnerDir, "Info.plist");

    const result = await generateSplash({
      sourcePath,
      platforms: "ios",
      iosPlistUri: vscode.Uri.file(plistPath),
      backgroundColor: "#00FF00",
    });

    assert.strictEqual(result.success, true, result.message);
    assert.strictEqual(result.iosFiles.length, 3);

    const imageSetDir = path.join(runnerDir, "Assets.xcassets", "LaunchImage.imageset");
    const at1x = path.join(imageSetDir, "LaunchImage.png");
    const at3x = path.join(imageSetDir, "LaunchImage@3x.png");
    assert.ok(fs.existsSync(at1x));
    const decoded1x = await Jimp.fromBuffer(fs.readFileSync(at1x));
    const decoded3x = await Jimp.fromBuffer(fs.readFileSync(at3x));
    assert.strictEqual(decoded1x.width, 120);
    assert.strictEqual(decoded3x.width, 360);

    const storyboard = fs.readFileSync(path.join(runnerDir, "Base.lproj", "LaunchScreen.storyboard"), "utf8");
    assert.match(storyboard, /<color key="backgroundColor"[^>]*red="0"[^>]*green="1"[^>]*blue="0"[^>]*alpha="1"/);
    assert.match(storyboard, /<image name="LaunchImage"[^>]*width="120"[^>]*height="120"/);
  });

  test("generateSplash reports a clear error when LaunchScreen.storyboard doesn't exist", async () => {
    const workDir = mkTempDir("fcm-splash-missing-ios-");
    const sourcePath = path.join(workDir, "source.png");
    await writeSourcePng(sourcePath);
    const runnerDir = path.join(workDir, "ios", "Runner");
    fs.mkdirSync(runnerDir, { recursive: true });
    const plistPath = path.join(runnerDir, "Info.plist");
    fs.writeFileSync(plistPath, "<plist></plist>");

    const result = await generateSplash({ sourcePath, platforms: "ios", iosPlistUri: vscode.Uri.file(plistPath) });
    assert.strictEqual(result.success, false);
    assert.match(result.message, /No LaunchScreen\.storyboard found/);
  });

  test("generateSplash 'both' writes Android and iOS together", async () => {
    const workDir = mkTempDir("fcm-splash-both-");
    const sourcePath = path.join(workDir, "source.png");
    await writeSourcePng(sourcePath);

    const appDir = path.join(workDir, "android", "app");
    scaffoldAndroidSplash(appDir);
    const runnerDir = path.join(workDir, "ios", "Runner");
    scaffoldIOSSplash(runnerDir);

    const result = await generateSplash({
      sourcePath,
      platforms: "both",
      androidManifestUri: vscode.Uri.file(path.join(appDir, "src", "main", "AndroidManifest.xml")),
      iosPlistUri: vscode.Uri.file(path.join(runnerDir, "Info.plist")),
    });

    assert.strictEqual(result.success, true, result.message);
    assert.strictEqual(result.androidFiles.length, 5);
    assert.strictEqual(result.iosFiles.length, 3);
  });

  test("generateSplashPreview renders a phone-shaped rectangle with the background color outside the foreground", async () => {
    const workDir = mkTempDir("fcm-splash-preview-");
    const sourcePath = path.join(workDir, "source.png");
    await writeSourcePng(sourcePath, 64);

    const preview = await generateSplashPreview(sourcePath, { backgroundColor: "#3355FF" });
    assert.ok(preview.height > preview.width, "expected a portrait phone-shaped preview");
    const decoded = await Jimp.fromBuffer(Buffer.from(preview.dataUrl.slice("data:image/png;base64,".length), "base64"));
    assert.strictEqual(decoded.width, preview.width);
    assert.strictEqual(decoded.height, preview.height);
    // Corner: background color, not the foreground.
    assert.strictEqual(decoded.getPixelColor(1, 1) >>> 0, 0x3355ffff);
    // Center: the red foreground.
    assert.strictEqual(decoded.getPixelColor(Math.floor(preview.width / 2), Math.floor(preview.height / 2)) >>> 0, 0xff0000ff);
  });

  test("generateSplashPreview leaves the backdrop transparent when no background color is given", async () => {
    const workDir = mkTempDir("fcm-splash-preview-transparent-");
    const sourcePath = path.join(workDir, "source.png");
    await writeSourcePng(sourcePath, 64);

    const preview = await generateSplashPreview(sourcePath);
    const decoded = await Jimp.fromBuffer(Buffer.from(preview.dataUrl.slice("data:image/png;base64,".length), "base64"));
    assert.strictEqual(decoded.getPixelColor(1, 1) & 0xff, 0);
  });

  test("getCurrentSplashPreviews returns undefined when nothing exists yet, and the existing file unmodified once it does", async () => {
    const workDir = mkTempDir("fcm-splash-current-");
    const appDir = path.join(workDir, "android", "app");
    scaffoldAndroidSplash(appDir);
    const manifestUri = vscode.Uri.file(path.join(appDir, "src", "main", "AndroidManifest.xml"));

    const empty = await getCurrentSplashPreviews({ androidManifestUri: manifestUri });
    assert.strictEqual(empty.android, undefined);

    const resDir = path.join(appDir, "src", "main", "res");
    const mdpiDir = path.join(resDir, "drawable-mdpi");
    const xxxhdpiDir = path.join(resDir, "drawable-xxxhdpi");
    fs.mkdirSync(mdpiDir, { recursive: true });
    fs.mkdirSync(xxxhdpiDir, { recursive: true });
    const small = new Jimp({ width: 288, height: 288, color: 0x123456ff });
    await small.write(path.join(mdpiDir, "launch_image.png") as `${string}.png`);
    const large = new Jimp({ width: 1152, height: 1152, color: 0x654321ff });
    await large.write(path.join(xxxhdpiDir, "launch_image.png") as `${string}.png`);

    const withFile = await getCurrentSplashPreviews({ androidManifestUri: manifestUri });
    assert.ok(withFile.android);
    assert.strictEqual(withFile.android?.width, 1152);
    const decoded = await Jimp.fromBuffer(Buffer.from(withFile.android!.dataUrl.slice("data:image/png;base64,".length), "base64"));
    assert.strictEqual(decoded.getPixelColor(1, 1) >>> 0, 0x654321ff);
  });

  test("generateSplash reports a clear error for an unsupported file type", async () => {
    const result = await generateSplash({ sourcePath: "photo.gif", platforms: "android" });
    assert.strictEqual(result.success, false);
    assert.match(result.message, /Unsupported file type/);
  });
});

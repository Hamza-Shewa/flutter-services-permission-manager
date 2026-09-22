/**
 * App icon (launcher icon) management types
 */

/** Which platforms to (re)generate icons for */
export type IconPlatformTarget = "android" | "ios" | "both";

/** Recognized source image formats for icon generation */
export type IconSourceKind = "png" | "jpeg" | "svg";

/**
 * How the source image is composed onto the square icon canvas before any
 * per-target resizing: `scalePercent` (40-100) is how much of the canvas the
 * foreground fills - lower values add padding around it - and
 * `backgroundColor` (a CSS hex color) fills that padding, or is left
 * transparent when omitted. Never applied to notification silhouette icons,
 * which must stay transparent outside the shape regardless of this setting.
 */
export interface IconComposeOptions {
  scalePercent?: number;
  backgroundColor?: string;
  trimMargins?: boolean;
}

/**
 * Which Android icon families to (re)generate. A family omitted (`undefined`)
 * defaults to `true` - existing callers that don't pass this still get
 * everything, matching the prior behavior.
 */
export interface AndroidIconFamilySelection {
  launcher?: boolean;
  playStore?: boolean;
  notifications?: boolean;
}

/** A rendered preview image, as a data URL ready for an `<img src>`. */
export interface IconPreview {
  dataUrl: string;
  size: number;
}

/** The existing on-disk icons for each platform, shown so the user can compare before replacing them. */
export interface CurrentIconPreviews {
  android?: IconPreview;
  ios?: IconPreview;
}

/** A single generated icon file, reported back to the UI */
export interface GeneratedIconFile {
  /** Workspace-relative path */
  path: string;
  width: number;
  height: number;
  /** Human-readable group, e.g. "Launcher", "Play Store", "Notification (OneSignal small)". */
  label: string;
}

/** Result of an icon generation run */
export interface IconGenerationResult {
  success: boolean;
  message: string;
  androidFiles: GeneratedIconFile[];
  iosFiles: GeneratedIconFile[];
}

/** Info about a user-picked source image, sent to the webview for confirmation */
export interface IconSourceInfo {
  path: string;
  fileName: string;
  kind: IconSourceKind;
}

/** A single Android density-specific icon target (mipmap launcher icon or drawable notification icon) */
export interface AndroidIconTarget {
  density: string;
  sizePx: number;
  /** Absolute filesystem path to write the PNG to */
  filePath: string;
}

/** A single iOS/macOS AppIcon.appiconset image slot, from Contents.json */
export interface AppIconSetImage {
  idiom: string;
  size: string;
  scale: string;
  filename?: string;
}

export interface AppIconSetContents {
  images: AppIconSetImage[];
  info?: { version: number; author: string };
  [key: string]: unknown;
}

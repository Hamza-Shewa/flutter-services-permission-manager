/**
 * Splash screen management types
 */

/** Which platforms to (re)generate the splash screen for */
export type SplashPlatformTarget = "android" | "ios" | "both";

/** A single generated splash file, reported back to the UI */
export interface GeneratedSplashFile {
  /** Workspace-relative path */
  path: string;
  width: number;
  height: number;
  /** Human-readable group, e.g. "Android", "iOS". */
  label: string;
}

/** Result of a splash generation run */
export interface SplashGenerationResult {
  success: boolean;
  message: string;
  androidFiles: GeneratedSplashFile[];
  iosFiles: GeneratedSplashFile[];
}

/** A rendered preview image, as a data URL ready for an `<img src>`. */
export interface SplashPreview {
  dataUrl: string;
  width: number;
  height: number;
}

/** The existing on-disk splash screen for each platform, shown so the user can compare before replacing it. */
export interface CurrentSplashPreviews {
  android?: SplashPreview;
  ios?: SplashPreview;
}

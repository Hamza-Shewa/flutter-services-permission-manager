/**
 * MCP tools that convert a project's PNG/JPG/JPEG assets to WebP.
 *
 * The conversion itself is `scripts/convert-images-to-webp.js` (the same script the extension's Assets tab and
 * the command line use). It is split into a read-only preview and an apply step: applying needs the id of a
 * preview made with the same options, and is refused when any image has changed since that preview.
 */

import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { assertSafeRelativePath } from "../../out/features/localization/arb-core.js";

const SCRIPT = fileURLToPath(new URL("../../scripts/convert-images-to-webp.js", import.meta.url));
const PREVIEW_TTL_MS = 15 * 60 * 1000;

const optionsShape = {
  quality: z.number().int().min(1).max(100).optional().describe("Lossy WebP quality, 1-100 (default 85). Ignored with lossless."),
  lossless: z.boolean().optional().describe("Lossless WebP: exact pixels, smaller savings."),
  assetsPath: z.string().optional().describe("Only convert images under this project-relative folder, e.g. assets/images."),
  ignoreAssetDirs: z.array(z.string()).optional().describe("Project-relative asset folders to leave alone."),
  keepOriginals: z
    .boolean()
    .optional()
    .describe("Only write the .webp files next to the originals: nothing is deleted and no reference is rewritten."),
};

export const previewWebpSchema = z.object(optionsShape);
export const applyWebpSchema = z.object({ previewId: z.string().uuid() });

interface WebpOptions {
  quality?: number;
  lossless?: boolean;
  assetsPath?: string;
  ignoreAssetDirs?: string[];
  keepOriginals?: boolean;
}

interface WebpImage {
  path: string;
  status: string;
  reason?: string;
  before?: number;
  after?: number;
}

interface WebpReport {
  totalImages: number;
  converted: number;
  skipped: number;
  failed: number;
  bytesSaved: number;
  rewrittenFiles: string[];
  images: WebpImage[];
}

interface StoredPreview {
  root: string;
  options: WebpOptions;
  fingerprint: string;
  expiresAt: number;
}

const previews = new Map<string, StoredPreview>();

function textResult(value: unknown, isError = false): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], ...(isError ? { isError: true } : {}) };
}

function parseOptions(args: Record<string, unknown>): WebpOptions {
  const options = previewWebpSchema.parse(args);
  if (options.assetsPath) {
    options.assetsPath = assertSafeRelativePath(options.assetsPath, "assetsPath");
  }
  for (const dir of options.ignoreAssetDirs ?? []) {
    assertSafeRelativePath(dir, "ignoreAssetDirs");
  }
  return options;
}

function runScript(root: string, options: WebpOptions, apply: boolean): Promise<WebpReport> {
  const argv = [SCRIPT, "--path", root, "--json"];
  if (apply) {
    argv.push("--apply");
    if (options.keepOriginals) {
      argv.push("--keep-originals");
    }
  }
  if (options.lossless) {
    argv.push("--lossless");
  }
  if (options.quality !== undefined) {
    argv.push("--quality", String(options.quality));
  }
  if (options.assetsPath) {
    argv.push("--assets-path", options.assetsPath);
  }
  for (const dir of options.ignoreAssetDirs ?? []) {
    argv.push("--ignore-asset-dirs", dir);
  }
  return new Promise((resolve, reject) => {
    // execFile with an argument list: no shell on any platform. ELECTRON_RUN_AS_NODE covers a server that
    // VS Code started with its own (Electron) binary.
    execFile(
      process.execPath,
      argv,
      { cwd: root, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, maxBuffer: 50 * 1024 * 1024, timeout: 10 * 60 * 1000 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error((stderr || error.message).trim().split(/\r?\n/)[0] || "WebP conversion failed."));
          return;
        }
        try {
          resolve(JSON.parse(stdout) as WebpReport);
        } catch {
          reject(new Error("The WebP converter returned unreadable output."));
        }
      },
    );
  });
}

/**
 * Identifies what a preview promised: the full per-image outcome (so a changed reference that now blocks an
 * image shows up) plus the size and modification time of every image it intends to convert.
 */
function fingerprintOf(root: string, images: WebpImage[]): string {
  const hash = createHash("sha256");
  hash.update(JSON.stringify(images.map((i) => [i.path, i.status, i.reason ?? "", i.before ?? 0, i.after ?? 0])));
  for (const image of images.filter((i) => i.status === "would-convert").sort((a, b) => a.path.localeCompare(b.path))) {
    const stat = fs.statSync(path.join(root, image.path));
    hash.update(`${image.path}:${stat.size}:${stat.mtimeMs}\n`);
  }
  return hash.digest("hex");
}

export async function previewWebpConversionTool(root: string, args: Record<string, unknown>): Promise<CallToolResult> {
  let options: WebpOptions;
  try {
    options = parseOptions(args);
  } catch (error) {
    return textResult({ ok: false, error: error instanceof Error ? error.message : String(error) }, true);
  }
  const report = await runScript(root, options, false);
  for (const [id, stored] of previews) {
    if (stored.expiresAt < Date.now()) {
      previews.delete(id);
    }
  }
  const previewId = randomUUID();
  previews.set(previewId, { root, options, fingerprint: fingerprintOf(root, report.images), expiresAt: Date.now() + PREVIEW_TTL_MS });
  return textResult({
    ok: true,
    previewId,
    expiresInMinutes: PREVIEW_TTL_MS / 60000,
    summary: {
      totalImages: report.totalImages,
      convertible: report.converted,
      skipped: report.skipped,
      failed: report.failed,
      bytesSaved: report.bytesSaved,
    },
    images: report.images,
    next: report.converted > 0
      ? "Review the images (especially the skipped reasons), then call apply_webp_conversion with previewId. Originals are deleted and references rewritten unless keepOriginals was set."
      : "Nothing can be converted; see the reason for each image.",
  });
}

export async function applyWebpConversionTool(root: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const { previewId } = applyWebpSchema.parse(args);
  const stored = previews.get(previewId);
  if (!stored || stored.root !== root || stored.expiresAt < Date.now()) {
    previews.delete(previewId);
    return textResult({ ok: false, error: "Unknown or expired preview. Run preview_webp_conversion again." }, true);
  }
  previews.delete(previewId); // single use
  // Re-run the dry run so the check covers exactly the images that will be converted now.
  const current = await runScript(root, stored.options, false);
  if (fingerprintOf(root, current.images) !== stored.fingerprint) {
    return textResult({ ok: false, error: "The images or their references changed after the preview. Run preview_webp_conversion again." }, true);
  }
  const report = await runScript(root, stored.options, true);
  return textResult({
    ok: true,
    converted: report.converted,
    skipped: report.skipped,
    failed: report.failed,
    bytesSaved: report.bytesSaved,
    rewrittenFiles: report.rewrittenFiles,
    images: report.images,
    note: stored.options.keepOriginals
      ? "The .webp files were written next to the originals; nothing else changed."
      : "Originals were deleted and references rewritten. Paths built from variables cannot be detected: run flutter analyze, the tests and the app, and review the diff.",
  });
}

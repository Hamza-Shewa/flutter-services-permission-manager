import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { spawnSync } from "node:child_process";

import {
  applySemanticsPreviewToFiles,
  previewSemanticsFixes,
  scanInteractives,
} from "../../out/features/semantics/index.js";
import type {
  InteractiveScannerOptions,
  SemanticsFixRequest,
} from "../../out/features/semantics/types.js";

const scannerOptionsShape = {
  excludedGlobs: z.array(z.string()).optional(),
  customWidgets: z.array(z.string()).optional(),
  callbackNames: z.array(z.string()).optional(),
  ignoredWidgets: z.array(z.string()).optional(),
};

export const scanInteractivesSchema = z.object(scannerOptionsShape);

export const previewSemanticsFixesSchema = z.object({
  requests: z.array(z.object({
    occurrenceId: z.string().min(1),
    identifier: z.string().min(1),
    labelExpression: z.string().optional(),
    hintExpression: z.string().optional(),
  })).min(1),
  ...scannerOptionsShape,
});

export const applySemanticsFixesSchema = z.object({
  previewId: z.string().uuid(),
});

function textResult(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function optionsFrom(args: Record<string, unknown>): InteractiveScannerOptions {
  let defaults: InteractiveScannerOptions = {};
  try {
    defaults = JSON.parse(process.env.FCM_INTERACTIVES_OPTIONS ?? "{}") as InteractiveScannerOptions;
  } catch {
    defaults = {};
  }
  return {
    excludedGlobs: (args.excludedGlobs as string[] | undefined) ?? defaults.excludedGlobs,
    customWidgets: (args.customWidgets as string[] | undefined) ?? defaults.customWidgets,
    callbackNames: (args.callbackNames as string[] | undefined) ?? defaults.callbackNames,
    ignoredWidgets: (args.ignoredWidgets as string[] | undefined) ?? defaults.ignoredWidgets,
  };
}

function ensureIdentifierCompatibility(root: string): void {
  const executable = process.env.FCM_FLUTTER_EXECUTABLE || "flutter";
  const result = spawnSync(executable, ["--version", "--machine"], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error("Flutter 3.19 or newer is required for Semantics.identifier fixes, but the Flutter SDK version could not be verified.");
  }
  const version = String((JSON.parse(result.stdout) as { frameworkVersion?: string }).frameworkVersion ?? "");
  const [major, minor] = version.split(".").map(Number);
  if (!Number.isFinite(major) || !Number.isFinite(minor) || major < 3 || (major === 3 && minor < 19)) {
    throw new Error(`Flutter 3.19 or newer is required for Semantics.identifier fixes; detected ${version || "unknown"}.`);
  }
}

export async function scanInteractivesTool(root: string, args: Record<string, unknown>): Promise<CallToolResult> {
  return textResult(await scanInteractives(root, optionsFrom(args)));
}

export async function previewSemanticsFixesTool(root: string, args: Record<string, unknown>): Promise<CallToolResult> {
  ensureIdentifierCompatibility(root);
  const requests = args.requests as SemanticsFixRequest[];
  return textResult(await previewSemanticsFixes(root, requests, optionsFrom(args)));
}

export async function applySemanticsFixesTool(root: string, args: Record<string, unknown>): Promise<CallToolResult> {
  return textResult(await applySemanticsPreviewToFiles(root, String(args.previewId)));
}

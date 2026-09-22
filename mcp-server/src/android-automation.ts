import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as http from "node:http";
import * as https from "node:https";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { XMLParser } from "fast-xml-parser";
import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { flattenInteractiveFindings, scanInteractives } from "../../out/features/semantics/index.js";
import { checkFlutterVersion, findFlutterExecutable, probeFlutterVersion } from "../../out/core/shared/flutter-locator.js";

const DEFAULT_APPIUM_URL = "http://127.0.0.1:4723";
const MAX_WAIT_MS = 30_000;
const RISK_PATTERN = /(?:^|[._-])(submit|purchase|buy|pay|payment|transfer|delete|remove|permission|confirm|send)(?:$|[._-])/i;
const ELEMENT_KEY = "element-6066-11e4-a52e-4f735466cecf";

interface AutomationSession {
  id: string;
  appiumSessionId: string;
  appiumUrl: string;
  root: string;
  confirmations: Map<string, { identifier: string; action: string; sourceHash: string; expiresAt: number }>;
}

const sessions = new Map<string, AutomationSession>();

export const automationHealthSchema = z.object({
  appiumUrl: z.string().url().optional(),
});

export const startAndroidSessionSchema = z.object({
  appiumUrl: z.string().url().optional(),
  deviceId: z.string().optional(),
  appPath: z.string().optional(),
  appPackage: z.string().optional(),
  appActivity: z.string().optional(),
  noReset: z.boolean().optional(),
});

const sessionShape = { sessionId: z.string().min(1) };
export const inspectRuntimeSchema = z.object(sessionShape);
export const tapRuntimeSchema = z.object({ ...sessionShape, identifier: z.string().min(1), confirmationToken: z.string().optional() });
export const enterRuntimeTextSchema = z.object({ ...sessionShape, identifier: z.string().min(1), text: z.string(), clearFirst: z.boolean().optional() });
export const selectRuntimeOptionSchema = z.object({ ...sessionShape, fieldIdentifier: z.string().min(1), optionIdentifier: z.string().min(1), confirmationToken: z.string().optional() });
export const scrollRuntimeSchema = z.object({ ...sessionShape, containerIdentifier: z.string().min(1), direction: z.enum(["up", "down", "left", "right"]), percent: z.number().min(0.1).max(1).optional() });
export const backRuntimeSchema = z.object(sessionShape);
export const waitRuntimeSchema = z.object({ ...sessionShape, identifier: z.string().min(1), state: z.enum(["present", "absent"]).optional(), timeoutMs: z.number().int().min(100).max(MAX_WAIT_MS).optional() });
export const assertRuntimeSchema = z.object({ ...sessionShape, identifier: z.string().min(1), state: z.enum(["present", "absent", "enabled", "disabled"]) });
export const screenshotRuntimeSchema = z.object(sessionShape);
export const endAndroidSessionSchema = z.object(sessionShape);

function textResult(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function resolveExecutable(name: string, candidates: string[]): string | undefined {
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }
  const result = spawnSync(process.platform === "win32" ? "where" : "which", [name], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim().split(/\r?\n/)[0] : undefined;
}

function sdkRoot(): string | undefined {
  return process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME ||
    (process.platform === "darwin" ? path.join(os.homedir(), "Library", "Android", "sdk") : undefined);
}

function ensureFlutterIdentifierSupport(root: string): string {
  const executable = findFlutterExecutable({ projectRoot: root });
  if (!executable) {
    throw new Error("Flutter 3.19 or newer is required for native semantics identifiers, but no Flutter executable was found.");
  }
  const result = probeFlutterVersion(executable, root);
  if (result.status !== 0) {
    throw new Error("Flutter 3.19 or newer is required, but flutter --version failed.");
  }
  const { ok, version } = checkFlutterVersion(result.stdout);
  if (!ok) {
    throw new Error(`Flutter 3.19 or newer is required for native semantics identifiers; detected ${version || "unknown"}.`);
  }
  return version;
}

async function requestAppium(baseUrl: string, method: string, endpoint: string, body?: unknown): Promise<unknown> {
  const url = new URL(endpoint, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const transport = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const request = transport.request(url, {
      method,
      headers: payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : undefined,
      timeout: 15_000,
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let parsed: unknown;
        try {
          parsed = raw ? JSON.parse(raw) : {};
        } catch {
          reject(new Error(`Appium returned non-JSON data (${response.statusCode}): ${raw.slice(0, 300)}`));
          return;
        }
        if ((response.statusCode ?? 500) >= 400) {
          const message = (parsed as { value?: { message?: string } }).value?.message ?? raw;
          reject(new Error(`Appium request failed (${response.statusCode}): ${message}`));
          return;
        }
        resolve(parsed);
      });
    });
    request.on("timeout", () => request.destroy(new Error("Appium request timed out.")));
    request.on("error", reject);
    if (payload) {
      request.write(payload);
    }
    request.end();
  });
}

function sessionFor(id: string): AutomationSession {
  const session = sessions.get(id);
  if (!session) {
    throw new Error("Unknown or ended Android automation session.");
  }
  return session;
}

async function sourceFor(session: AutomationSession): Promise<string> {
  const result = await requestAppium(session.appiumUrl, "GET", `session/${session.appiumSessionId}/source`) as { value?: string };
  return String(result.value ?? "");
}

function xpathLiteral(value: string): string {
  if (!value.includes("'")) {
    return `'${value}'`;
  }
  if (!value.includes('"')) {
    return `"${value}"`;
  }
  throw new Error("Semantics identifiers containing both quote types are not supported.");
}

async function exactElements(session: AutomationSession, identifier: string): Promise<Array<Record<string, string>>> {
  const result = await requestAppium(session.appiumUrl, "POST", `session/${session.appiumSessionId}/elements`, {
    using: "xpath",
    value: `//*[@resource-id=${xpathLiteral(identifier)}]`,
  }) as { value?: Array<Record<string, string>> };
  return Array.isArray(result.value) ? result.value : [];
}

async function exactElement(session: AutomationSession, identifier: string): Promise<string> {
  const elements = await exactElements(session, identifier);
  if (elements.length === 0) {
    throw new Error(`No runtime element has the exact semantics identifier ${identifier}.`);
  }
  if (elements.length > 1) {
    throw new Error(`Refusing an ambiguous action: ${elements.length} runtime elements share ${identifier}.`);
  }
  const elementId = elements[0][ELEMENT_KEY] ?? elements[0].ELEMENT;
  if (!elementId) {
    throw new Error(`Appium did not return an element ID for ${identifier}.`);
  }
  return elementId;
}

async function clickExact(session: AutomationSession, identifier: string): Promise<void> {
  const element = await exactElement(session, identifier);
  await requestAppium(session.appiumUrl, "POST", `session/${session.appiumSessionId}/element/${element}/click`, {});
}

async function guardRiskyAction(session: AutomationSession, identifier: string, action: string, token?: string): Promise<CallToolResult | undefined> {
  if (!RISK_PATTERN.test(identifier)) {
    return undefined;
  }
  const sourceHash = crypto.createHash("sha256").update(await sourceFor(session)).digest("hex");
  if (token) {
    const pending = session.confirmations.get(token);
    session.confirmations.delete(token);
    if (!pending || pending.identifier !== identifier || pending.action !== action || pending.sourceHash !== sourceHash || pending.expiresAt < Date.now()) {
      throw new Error("The risky-action confirmation token is invalid, expired, already used, or the screen changed.");
    }
    return undefined;
  }
  const confirmationToken = crypto.randomUUID();
  session.confirmations.set(confirmationToken, { identifier, action, sourceHash, expiresAt: Date.now() + 60_000 });
  return textResult({
    status: "confirmation_required",
    action,
    identifier,
    confirmationToken,
    expiresInSeconds: 60,
    message: "Ask the user to confirm this consequential action, then repeat the same call with confirmationToken.",
  });
}

export async function automationHealthTool(args: Record<string, unknown>): Promise<CallToolResult> {
  const sdk = sdkRoot();
  const adb = resolveExecutable(process.platform === "win32" ? "adb.exe" : "adb", [sdk ? path.join(sdk, "platform-tools", process.platform === "win32" ? "adb.exe" : "adb") : ""]);
  const emulator = resolveExecutable(process.platform === "win32" ? "emulator.exe" : "emulator", [sdk ? path.join(sdk, "emulator", process.platform === "win32" ? "emulator.exe" : "emulator") : ""]);
  const appium = resolveExecutable(process.platform === "win32" ? "appium.cmd" : "appium", []);
  const adbResult = adb ? spawnSync(adb, ["devices"], { encoding: "utf8" }) : undefined;
  const devices = adbResult?.status === 0
    ? adbResult.stdout.split(/\r?\n/).slice(1).map((line) => line.trim()).filter((line) => /\tdevice$/.test(line)).map((line) => line.split("\t")[0])
    : [];
  let serverReachable = false;
  try {
    await requestAppium(String(args.appiumUrl ?? DEFAULT_APPIUM_URL), "GET", "status");
    serverReachable = true;
  } catch {
    serverReachable = false;
  }
  let uiAutomator2Installed = false;
  let appiumVersion: string | undefined;
  if (appium) {
    const version = spawnSync(appium, ["--version"], { encoding: "utf8" });
    appiumVersion = version.status === 0 ? version.stdout.trim() : undefined;
    const drivers = spawnSync(appium, ["driver", "list", "--installed", "--json"], { encoding: "utf8" });
    uiAutomator2Installed = drivers.status === 0 && /uiautomator2/i.test(drivers.stdout);
  }
  return textResult({
    ready: !!adb && !!emulator && !!appium && uiAutomator2Installed && devices.length > 0 && serverReachable,
    androidSdkRoot: sdk,
    adb: { found: !!adb, path: adb, devices },
    emulator: { found: !!emulator, path: emulator },
    appium: { found: !!appium, path: appium, version: appiumVersion, serverReachable, uiAutomator2Installed },
    note: "This health check never installs Appium, drivers, SDK components, or starts an emulator.",
  });
}

export async function startAndroidSessionTool(root: string, args: Record<string, unknown>): Promise<CallToolResult> {
  if (!args.appPath && !args.appPackage) {
    throw new Error("Provide appPath for an APK or appPackage for an already-installed app.");
  }
  const flutterVersion = ensureFlutterIdentifierSupport(root);
  const appiumUrl = String(args.appiumUrl ?? DEFAULT_APPIUM_URL);
  const capabilities: Record<string, unknown> = {
    platformName: "Android",
    "appium:automationName": "UiAutomator2",
    "appium:noReset": args.noReset ?? true,
    ...(args.deviceId ? { "appium:udid": args.deviceId } : {}),
    ...(args.appPath ? { "appium:app": path.resolve(String(args.appPath)) } : {}),
    ...(args.appPackage ? { "appium:appPackage": args.appPackage } : {}),
    ...(args.appActivity ? { "appium:appActivity": args.appActivity } : {}),
  };
  const response = await requestAppium(appiumUrl, "POST", "session", { capabilities: { alwaysMatch: capabilities } }) as {
    sessionId?: string;
    value?: { sessionId?: string };
  };
  const appiumSessionId = response.value?.sessionId ?? response.sessionId;
  if (!appiumSessionId) {
    throw new Error("Appium created no session ID.");
  }
  const id = crypto.randomUUID();
  sessions.set(id, { id, appiumSessionId, appiumUrl, root, confirmations: new Map() });
  return textResult({ ok: true, sessionId: id, platform: "Android", automationName: "UiAutomator2", flutterVersion });
}

function collectRuntimeNodes(value: unknown, output: Array<Record<string, unknown>>): void {
  if (Array.isArray(value)) {
    value.forEach((item) => collectRuntimeNodes(item, output));
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  const record = value as Record<string, unknown>;
  if (typeof record["resource-id"] === "string" && record["resource-id"]) {
    output.push({
      identifier: record["resource-id"],
      text: record.text,
      contentDescription: record["content-desc"],
      className: record.class,
      enabled: record.enabled,
      clickable: record.clickable,
      bounds: record.bounds,
    });
  }
  Object.values(record).forEach((item) => collectRuntimeNodes(item, output));
}

export async function inspectRuntimeTool(root: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const session = sessionFor(String(args.sessionId));
  const source = await sourceFor(session);
  const parsed = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "" }).parse(source);
  const nodes: Array<Record<string, unknown>> = [];
  collectRuntimeNodes(parsed, nodes);
  const counts = new Map<string, number>();
  nodes.forEach((node) => counts.set(String(node.identifier), (counts.get(String(node.identifier)) ?? 0) + 1));
  const staticScan = await scanInteractives(root);
  const staticSources = new Map<string, unknown[]>();
  for (const finding of flattenInteractiveFindings(staticScan)) {
    const match = /^(?:r)?(['"])([^$]*)\1$/.exec(finding.semantics.identifierExpression?.trim() ?? "");
    if (match) {
      const list = staticSources.get(match[2]) ?? [];
      list.push(finding.source);
      staticSources.set(match[2], list);
    }
  }
  return textResult({
    nodes: nodes.map((node) => ({ ...node, duplicate: (counts.get(String(node.identifier)) ?? 0) > 1, sourceReferences: staticSources.get(String(node.identifier)) ?? [] })),
    count: nodes.length,
    duplicateIdentifiers: [...counts.entries()].filter(([, count]) => count > 1).map(([identifier, count]) => ({ identifier, count })),
  });
}

export async function tapRuntimeTool(args: Record<string, unknown>): Promise<CallToolResult> {
  const session = sessionFor(String(args.sessionId));
  const identifier = String(args.identifier);
  const confirmation = await guardRiskyAction(session, identifier, "tap", args.confirmationToken as string | undefined);
  if (confirmation) {
    return confirmation;
  }
  await clickExact(session, identifier);
  return textResult({ ok: true, action: "tap", identifier });
}

export async function enterRuntimeTextTool(args: Record<string, unknown>): Promise<CallToolResult> {
  const session = sessionFor(String(args.sessionId));
  const identifier = String(args.identifier);
  const element = await exactElement(session, identifier);
  if (args.clearFirst !== false) {
    await requestAppium(session.appiumUrl, "POST", `session/${session.appiumSessionId}/element/${element}/clear`, {});
  }
  const value = String(args.text ?? "");
  await requestAppium(session.appiumUrl, "POST", `session/${session.appiumSessionId}/element/${element}/value`, { text: value, value: [...value] });
  return textResult({ ok: true, action: "enter_text", identifier, enteredCharacters: [...value].length, value: "[REDACTED]" });
}

export async function selectRuntimeOptionTool(args: Record<string, unknown>): Promise<CallToolResult> {
  const session = sessionFor(String(args.sessionId));
  const fieldIdentifier = String(args.fieldIdentifier);
  const optionIdentifier = String(args.optionIdentifier);
  const confirmation = await guardRiskyAction(session, optionIdentifier, "select_option", args.confirmationToken as string | undefined);
  if (confirmation) {
    return confirmation;
  }
  await clickExact(session, fieldIdentifier);
  await clickExact(session, optionIdentifier);
  return textResult({ ok: true, action: "select_option", fieldIdentifier, optionIdentifier });
}

export async function scrollRuntimeTool(args: Record<string, unknown>): Promise<CallToolResult> {
  const session = sessionFor(String(args.sessionId));
  const identifier = String(args.containerIdentifier);
  const elementId = await exactElement(session, identifier);
  await requestAppium(session.appiumUrl, "POST", `session/${session.appiumSessionId}/execute/sync`, {
    script: "mobile: scrollGesture",
    args: [{ elementId, direction: args.direction, percent: args.percent ?? 0.75 }],
  });
  return textResult({ ok: true, action: "scroll", containerIdentifier: identifier, direction: args.direction });
}

export async function backRuntimeTool(args: Record<string, unknown>): Promise<CallToolResult> {
  const session = sessionFor(String(args.sessionId));
  await requestAppium(session.appiumUrl, "POST", `session/${session.appiumSessionId}/back`, {});
  return textResult({ ok: true, action: "back" });
}

export async function waitRuntimeTool(args: Record<string, unknown>): Promise<CallToolResult> {
  const session = sessionFor(String(args.sessionId));
  const identifier = String(args.identifier);
  const desired = String(args.state ?? "present");
  const timeoutMs = Math.min(MAX_WAIT_MS, Number(args.timeoutMs ?? 10_000));
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const present = (await exactElements(session, identifier)).length > 0;
    if ((desired === "present" && present) || (desired === "absent" && !present)) {
      return textResult({ ok: true, identifier, state: desired });
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out after ${timeoutMs} ms waiting for ${identifier} to be ${desired}.`);
}

export async function assertRuntimeTool(args: Record<string, unknown>): Promise<CallToolResult> {
  const session = sessionFor(String(args.sessionId));
  const identifier = String(args.identifier);
  const desired = String(args.state);
  const elements = await exactElements(session, identifier);
  let matches = desired === "present" ? elements.length === 1 : desired === "absent" ? elements.length === 0 : false;
  if (desired === "enabled" || desired === "disabled") {
    const element = await exactElement(session, identifier);
    const result = await requestAppium(session.appiumUrl, "GET", `session/${session.appiumSessionId}/element/${element}/attribute/enabled`) as { value?: string | boolean };
    const enabled = result.value === true || result.value === "true";
    matches = desired === "enabled" ? enabled : !enabled;
  }
  if (!matches) {
    throw new Error(`Runtime assertion failed: expected ${identifier} to be ${desired}.`);
  }
  return textResult({ ok: true, identifier, state: desired });
}

export async function screenshotRuntimeTool(args: Record<string, unknown>): Promise<CallToolResult> {
  const session = sessionFor(String(args.sessionId));
  const result = await requestAppium(session.appiumUrl, "GET", `session/${session.appiumSessionId}/screenshot`) as { value?: string };
  if (!result.value) {
    throw new Error("Appium returned no screenshot data.");
  }
  return { content: [{ type: "image", data: result.value, mimeType: "image/png" }] };
}

export async function endAndroidSessionTool(args: Record<string, unknown>): Promise<CallToolResult> {
  const session = sessionFor(String(args.sessionId));
  await requestAppium(session.appiumUrl, "DELETE", `session/${session.appiumSessionId}`);
  sessions.delete(session.id);
  return textResult({ ok: true, ended: true, sessionId: session.id });
}

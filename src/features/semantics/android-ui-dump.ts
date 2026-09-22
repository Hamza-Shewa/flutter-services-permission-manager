import { execFile } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { XMLParser } from "fast-xml-parser";

const REMOTE_DUMP_PATH = "/sdcard/flutter-config-manager-window.xml";
const GENERIC_LABELS = new Set([
  "button",
  "check box",
  "checkbox",
  "combo box",
  "dropdown",
  "edit box",
  "floating action button",
  "gesture detector",
  "image button",
  "mobile button",
  "mobile text field",
  "radio button",
  "seek bar",
  "slider",
  "spinner",
  "switch",
  "text button",
  "toggle button",
]);

export interface AndroidDevice {
  id: string;
  state: string;
  description: string;
}

export interface AndroidUiBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface AndroidUiControl {
  type: string;
  identifier: string | null;
  android_class: string;
  label: string | null;
  hint?: string | null;
  actions: string[];
  state: Record<string, boolean>;
  bounds: AndroidUiBounds;
  center: { x: number; y: number };
  audit: {
    identifier: "present" | "missing";
    accessibility: "ready" | "missing" | "generic_label";
  };
  node_path?: string;
  merged_nodes?: {
    identifier_wrapper: string;
    actionable_child: string;
  };
  note?: string;
}

export interface AndroidUiDumpResult {
  schema_version: number;
  captured_at: string;
  source: "adb_uiautomator";
  normalization: {
    merge_identifier_wrappers_with_actionable_children: true;
    include_actionable_nodes_missing_labels_or_identifiers: true;
    separate_embedded_field_actions: true;
  };
  screen: {
    package: string | null;
    activity: string | null;
    device: string;
    model: string | null;
    android_api: number | null;
    rotation: number;
    physical_size: { width: number; height: number };
    density_dpi: number | null;
  };
  summary: {
    primary_controls: number;
    buttons: number;
    input_fields: number;
    embedded_actions: number;
    with_identifier: number;
    without_identifier: number;
    missing_accessibility_labels: number;
    generic_accessibility_labels: number;
    duplicate_identifiers: number;
  };
  controls: AndroidUiControl[];
  embedded_actions: AndroidUiControl[];
}

export interface AndroidUiMetadata {
  deviceId: string;
  model?: string;
  androidApi?: number;
  packageName?: string;
  activity?: string;
  width: number;
  height: number;
  densityDpi?: number;
  rotation?: number;
  capturedAt?: string;
}

interface RawUiNode {
  node?: RawUiNode[];
  index?: string;
  text?: string;
  "resource-id"?: string;
  class?: string;
  package?: string;
  "content-desc"?: string;
  checkable?: string;
  checked?: string;
  clickable?: string;
  enabled?: string;
  focusable?: string;
  focused?: string;
  scrollable?: string;
  "long-clickable"?: string;
  password?: string;
  selected?: string;
  bounds?: string;
  hint?: string;
}

interface FlatUiNode {
  raw: RawUiNode;
  path: string;
  parent?: FlatUiNode;
  children: FlatUiNode[];
  bounds?: AndroidUiBounds;
}

function execute(file: string, args: string[], timeout = 20_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, {
      encoding: "utf8",
      timeout,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        const detail = String(stderr || stdout || error.message).trim();
        reject(new Error(detail || `${path.basename(file)} failed.`));
        return;
      }
      resolve(String(stdout));
    });
  });
}

function expandHome(value: string, home: string, pathApi: typeof path.posix | typeof path.win32): string {
  if (value === "~") { return home; }
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return pathApi.join(home, value.slice(2));
  }
  return value;
}

export function buildAdbCandidates(
  configuredPath?: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home = os.homedir(),
): string[] {
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const executable = platform === "win32" ? "adb.exe" : "adb";
  const sdkRoots = [env.ANDROID_SDK_ROOT, env.ANDROID_HOME].filter((value): value is string => !!value);
  if (platform === "darwin") {
    sdkRoots.push(pathApi.join(home, "Library", "Android", "sdk"));
  } else if (platform === "linux") {
    sdkRoots.push(pathApi.join(home, "Android", "Sdk"));
    sdkRoots.push(pathApi.join(home, "Android", "sdk"));
  } else if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA;
    if (localAppData) { sdkRoots.push(pathApi.join(localAppData, "Android", "Sdk")); }
    const userProfile = env.USERPROFILE;
    if (userProfile) { sdkRoots.push(pathApi.join(userProfile, "AppData", "Local", "Android", "Sdk")); }
  }
  return [...new Set([
    configuredPath ? expandHome(configuredPath, home, pathApi) : "",
    ...sdkRoots.map((root) => pathApi.join(expandHome(root, home, pathApi), "platform-tools", executable)),
    executable,
  ].filter(Boolean))];
}

export async function findAdbExecutable(configuredPath?: string): Promise<string> {
  const failures: string[] = [];
  for (const candidate of buildAdbCandidates(configuredPath)) {
    if (path.isAbsolute(candidate) && !fs.existsSync(candidate)) { continue; }
    try {
      await execute(candidate, ["version"], 5_000);
      return candidate;
    } catch (error) {
      failures.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const configuredHint = configuredPath ? ` The configured path '${configuredPath}' did not work.` : "";
  throw new Error(`ADB was not found.${configuredHint} Install Android SDK Platform-Tools or set flutter-config-manager.android.adbPath. ${failures.join(" ")}`.trim());
}

export async function listAndroidDevices(configuredAdbPath?: string): Promise<{ adbPath: string; devices: AndroidDevice[] }> {
  const adbPath = await findAdbExecutable(configuredAdbPath);
  const output = await execute(adbPath, ["devices", "-l"]);
  const devices = output.split(/\r?\n/).slice(1).map((line) => line.trim()).filter(Boolean).map((line) => {
    const [id = "", state = "unknown", ...description] = line.split(/\s+/);
    return { id, state, description: description.join(" ") };
  });
  return { adbPath, devices };
}

function parseBounds(value?: string): AndroidUiBounds | undefined {
  const match = /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/.exec(value ?? "");
  if (!match) { return undefined; }
  const [, left, top, right, bottom] = match.map(Number);
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function bool(value?: string): boolean {
  return value === "true";
}

function clean(value?: string): string | null {
  const result = (value ?? "")
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/\r/g, "")
    .trim();
  return result || null;
}

function identifier(value?: string): string | null {
  const result = clean(value);
  return result && !result.startsWith("android:") ? result : null;
}

function flattenNodes(nodes: RawUiNode[]): FlatUiNode[] {
  const flattened: FlatUiNode[] = [];
  const visit = (raw: RawUiNode, pathValue: string, parent?: FlatUiNode): FlatUiNode => {
    const node: FlatUiNode = { raw, path: pathValue, parent, children: [], bounds: parseBounds(raw.bounds) };
    flattened.push(node);
    node.children = (raw.node ?? []).map((child, childIndex) => visit(child, `${pathValue}.${child.index ?? childIndex}`, node));
    return node;
  };
  nodes.forEach((node, index) => visit(node, String(node.index ?? index)));
  return flattened;
}

function nearestIdentifierNode(node: FlatUiNode): FlatUiNode | undefined {
  let current: FlatUiNode | undefined = node;
  while (current) {
    if (identifier(current.raw["resource-id"])) {
      if (current === node) { return current; }
      if (current.bounds && node.bounds && contains(current.bounds, node.bounds)) {
        const wrapperArea = current.bounds.width * current.bounds.height;
        const actionArea = node.bounds.width * node.bounds.height;
        if (actionArea > 0 && wrapperArea <= actionArea * 4) { return current; }
      }
    }
    current = current.parent;
  }
  return undefined;
}

function isInput(node: FlatUiNode): boolean {
  return node.raw.class === "android.widget.EditText";
}

function isActionable(node: FlatUiNode): boolean {
  return isInput(node) || bool(node.raw.clickable) || bool(node.raw.checkable) || bool(node.raw["long-clickable"]);
}

function hasActionableDescendant(node: FlatUiNode): boolean {
  return node.children.some((child) => isActionable(child) || hasActionableDescendant(child));
}

function contains(outer: AndroidUiBounds, inner: AndroidUiBounds): boolean {
  return inner.left >= outer.left && inner.top >= outer.top && inner.right <= outer.right && inner.bottom <= outer.bottom;
}

function normalizedFieldText(node: FlatUiNode): { label: string | null; hint: string | null } {
  const directLabel = clean(node.raw["content-desc"]) ?? clean(node.raw.text);
  const lines = (clean(node.raw.hint) ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length && GENERIC_LABELS.has(lines[0].toLowerCase())) { lines.shift(); }
  return {
    label: directLabel ?? lines.shift() ?? null,
    hint: lines.length ? lines.join("\n") : null,
  };
}

function labelFor(node: FlatUiNode, wrapper?: FlatUiNode): string | null {
  return clean(node.raw["content-desc"]) ?? clean(node.raw.text) ??
    clean(wrapper?.raw["content-desc"]) ?? clean(wrapper?.raw.text) ?? clean(node.raw.hint);
}

function controlType(node: FlatUiNode): string {
  const className = node.raw.class ?? "";
  if (isInput(node)) { return "input_field"; }
  if (/CheckBox$/.test(className)) { return "checkbox"; }
  if (/RadioButton$/.test(className)) { return "radio"; }
  if (/Switch$|ToggleButton$/.test(className)) { return "toggle"; }
  if (/SeekBar$/.test(className)) { return "slider"; }
  if (/Spinner$/.test(className)) { return "dropdown"; }
  return "button";
}

function toControl(node: FlatUiNode, wrapper?: FlatUiNode): AndroidUiControl {
  const bounds = node.bounds!;
  const fieldText = isInput(node) ? normalizedFieldText(node) : undefined;
  const label = fieldText?.label ?? labelFor(node, wrapper);
  const id = identifier(node.raw["resource-id"]) ?? identifier(wrapper?.raw["resource-id"]);
  const generic = !!label && GENERIC_LABELS.has(label.toLowerCase());
  const actions = [
    ...(bool(node.raw.clickable) ? ["tap"] : []),
    ...(isInput(node) ? ["enter_text"] : []),
    ...(bool(node.raw["long-clickable"]) ? ["long_press"] : []),
    ...(bool(node.raw.scrollable) ? ["scroll"] : []),
  ];
  return {
    type: controlType(node),
    identifier: id,
    android_class: node.raw.class ?? "android.view.View",
    label,
    ...(isInput(node) ? { hint: fieldText?.hint ?? null } : {}),
    actions: [...new Set(actions)],
    state: {
      enabled: bool(node.raw.enabled),
      focusable: bool(node.raw.focusable),
      ...(isInput(node) ? { password: bool(node.raw.password) } : {}),
    },
    bounds,
    center: { x: Math.floor((bounds.left + bounds.right) / 2), y: Math.floor((bounds.top + bounds.bottom) / 2) },
    audit: {
      identifier: id ? "present" : "missing",
      accessibility: !label ? "missing" : generic ? "generic_label" : "ready",
    },
    node_path: node.path,
    ...(wrapper && wrapper !== node ? {
      merged_nodes: { identifier_wrapper: wrapper.path, actionable_child: node.path },
    } : {}),
  };
}

function parseHierarchy(xml: string): { nodes: FlatUiNode[]; packageName: string | null; rotation: number } {
  const start = xml.indexOf("<?xml");
  if (start < 0) { throw new Error("UIAutomator returned no XML hierarchy. Make sure the device is unlocked and the app is visible."); }
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    parseAttributeValue: false,
    trimValues: false,
    isArray: (name) => name === "node",
  });
  const parsed = parser.parse(xml.slice(start)) as { hierarchy?: { node?: RawUiNode[]; rotation?: string } };
  const roots = parsed.hierarchy?.node ?? [];
  if (!roots.length) { throw new Error("UIAutomator returned an empty hierarchy."); }
  const nodes = flattenNodes(roots);
  return {
    nodes,
    packageName: nodes.map((node) => clean(node.raw.package)).find(Boolean) ?? null,
    rotation: Number(parsed.hierarchy?.rotation ?? 0) || 0,
  };
}

export function normalizeUiAutomatorDump(xml: string, metadata: AndroidUiMetadata): AndroidUiDumpResult {
  const hierarchy = parseHierarchy(xml);
  const inputs = hierarchy.nodes.filter((node) => isInput(node) && !!node.bounds);
  const candidates = hierarchy.nodes.filter((node) => isActionable(node) && !!node.bounds && !hasActionableDescendant(node));
  const embeddedNodes = candidates.filter((node) => !isInput(node) && inputs.some((input) => contains(input.bounds!, node.bounds!)));
  const embeddedNodeSet = new Set(embeddedNodes);
  const primaryNodes = candidates.filter((node) => {
    if (embeddedNodeSet.has(node)) { return false; }
    if (node.raw.class === "android.view.View" && !identifier(node.raw["resource-id"]) && !clean(node.raw["content-desc"]) && !clean(node.raw.text) && !clean(node.raw.hint)) {
      return false;
    }
    return true;
  });
  const controls = primaryNodes.map((node) => {
    const wrapper = nearestIdentifierNode(node);
    const control = toControl(node, wrapper);
    if (control.type === "button" && control.android_class === "android.widget.ImageView" && !control.label) {
      control.note = "Visible image button with no runtime semantics. UIAutomator cannot recover source-only identifiers; rebuild or reinstall the app after adding Semantics.";
    }
    return control;
  });
  const embeddedActions = embeddedNodes.map((node) => {
    const owner = inputs.find((input) => contains(input.bounds!, node.bounds!));
    const control = toControl(node, nearestIdentifierNode(node));
    control.type = "input_accessory";
    control.note = `Embedded action for ${identifier(owner?.raw["resource-id"]) ?? "an input field"}; purpose is statically uncertain.`;
    return control;
  });
  const identifiers = [...controls, ...embeddedActions].map((control) => control.identifier).filter((value): value is string => !!value);
  const counts = new Map<string, number>();
  identifiers.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  return {
    schema_version: 2,
    captured_at: metadata.capturedAt ?? new Date().toISOString(),
    source: "adb_uiautomator",
    normalization: {
      merge_identifier_wrappers_with_actionable_children: true,
      include_actionable_nodes_missing_labels_or_identifiers: true,
      separate_embedded_field_actions: true,
    },
    screen: {
      package: metadata.packageName ?? hierarchy.packageName,
      activity: metadata.activity ?? null,
      device: metadata.deviceId,
      model: metadata.model ?? null,
      android_api: metadata.androidApi ?? null,
      rotation: metadata.rotation ?? hierarchy.rotation,
      physical_size: { width: metadata.width, height: metadata.height },
      density_dpi: metadata.densityDpi ?? null,
    },
    summary: {
      primary_controls: controls.length,
      buttons: controls.filter((control) => control.type === "button").length,
      input_fields: controls.filter((control) => control.type === "input_field").length,
      embedded_actions: embeddedActions.length,
      with_identifier: controls.filter((control) => !!control.identifier).length,
      without_identifier: controls.filter((control) => !control.identifier).length,
      missing_accessibility_labels: controls.filter((control) => control.audit.accessibility === "missing").length,
      generic_accessibility_labels: controls.filter((control) => control.audit.accessibility === "generic_label").length,
      duplicate_identifiers: [...counts.values()].filter((count) => count > 1).length,
    },
    controls,
    embedded_actions: embeddedActions,
  };
}

function yamlScalar(value: unknown): string {
  if (value === null || value === undefined) { return "null"; }
  if (typeof value === "boolean" || typeof value === "number") { return String(value); }
  const text = String(value);
  if (text && !/^[-?:,\[\]{}#&*!|>'"%@`]/.test(text) && !/[\n\r:#]/.test(text) && !/^\s|\s$/.test(text) && !/^[+-]?(?:\d[\d_.]*|\.\d)/.test(text) && !/^(?:null|true|false|yes|no|on|off|~)$/i.test(text)) {
    return text;
  }
  return JSON.stringify(text);
}

function yamlLines(value: unknown, indent = 0): string[] {
  const prefix = " ".repeat(indent);
  if (Array.isArray(value)) {
    if (!value.length) { return [`${prefix}[]`]; }
    return value.flatMap((item) => {
      if (item !== null && typeof item === "object" && !Array.isArray(item)) {
        const entries = Object.entries(item as Record<string, unknown>).filter(([, entry]) => entry !== undefined);
        if (!entries.length) { return [`${prefix}- {}`]; }
        const [[firstKey, firstValue], ...rest] = entries;
        const first = firstValue !== null && typeof firstValue === "object"
          ? [`${prefix}- ${firstKey}:`, ...yamlLines(firstValue, indent + 4)]
          : [`${prefix}- ${firstKey}: ${yamlScalar(firstValue)}`];
        return [...first, ...rest.flatMap(([key, entry]) => entry !== null && typeof entry === "object"
          ? [`${" ".repeat(indent + 2)}${key}:`, ...yamlLines(entry, indent + 4)]
          : [`${" ".repeat(indent + 2)}${key}: ${yamlScalar(entry)}`])];
      }
      if (Array.isArray(item)) {
        return item.length ? [`${prefix}-`, ...yamlLines(item, indent + 2)] : [`${prefix}- []`];
      }
      return [`${prefix}- ${yamlScalar(item)}`];
    });
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).filter(([, entry]) => entry !== undefined).flatMap(([key, entry]) => {
      if (entry !== null && typeof entry === "object") {
        return [`${prefix}${key}:`, ...yamlLines(entry, indent + 2)];
      }
      return [`${prefix}${key}: ${yamlScalar(entry)}`];
    });
  }
  return [`${prefix}${yamlScalar(value)}`];
}

export function serializeAndroidUiDumpYaml(result: AndroidUiDumpResult): string {
  return `${yamlLines(result).join("\n")}\n`;
}

function parseLastNumber(output: string): number | undefined {
  const values = [...output.matchAll(/(\d+)/g)].map((match) => Number(match[1]));
  return values.length ? values[values.length - 1] : undefined;
}

function parseScreenSize(output: string): { width: number; height: number } {
  const matches = [...output.matchAll(/(?:Physical|Override) size:\s*(\d+)x(\d+)/gi)];
  const match = matches[matches.length - 1] ?? /\b(\d+)x(\d+)\b/.exec(output);
  if (!match) { throw new Error(`Could not read the Android screen size from: ${output.trim()}`); }
  return { width: Number(match[1]), height: Number(match[2]) };
}

function parseFocus(output: string): { packageName?: string; activity?: string } {
  const match = /(?:mCurrentFocus|mFocusedApp)[^\n]*\s([A-Za-z0-9._]+)\/([A-Za-z0-9._$]+)/.exec(output);
  return match ? { packageName: match[1], activity: match[2] } : {};
}

export async function captureAndroidUiDump(adbPath: string, deviceId: string): Promise<{ result: AndroidUiDumpResult; yaml: string }> {
  const adbArgs = ["-s", deviceId];
  await execute(adbPath, [...adbArgs, "shell", "uiautomator", "dump", REMOTE_DUMP_PATH], 30_000);
  const [xml, sizeOutput, densityOutput, modelOutput, apiOutput, focusOutput] = await Promise.all([
    execute(adbPath, [...adbArgs, "exec-out", "cat", REMOTE_DUMP_PATH]),
    execute(adbPath, [...adbArgs, "shell", "wm", "size"]),
    execute(adbPath, [...adbArgs, "shell", "wm", "density"]),
    execute(adbPath, [...adbArgs, "shell", "getprop", "ro.product.model"]),
    execute(adbPath, [...adbArgs, "shell", "getprop", "ro.build.version.sdk"]),
    execute(adbPath, [...adbArgs, "shell", "dumpsys", "window"]),
  ]);
  const size = parseScreenSize(sizeOutput);
  const focus = parseFocus(focusOutput);
  const result = normalizeUiAutomatorDump(xml, {
    deviceId,
    model: clean(modelOutput) ?? undefined,
    androidApi: parseLastNumber(apiOutput),
    packageName: focus.packageName,
    activity: focus.activity,
    width: size.width,
    height: size.height,
    densityDpi: parseLastNumber(densityOutput),
  });
  return { result, yaml: serializeAndroidUiDumpYaml(result) };
}

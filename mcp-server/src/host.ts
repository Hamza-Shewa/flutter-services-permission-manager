/**
 * Node host layer for the Flutter Config Manager MCP server.
 *
 * This module is deliberately free of any `vscode` dependency. It resolves the
 * target Flutter project, discovers platform files (AndroidManifest.xml,
 * Info.plist, …), reads/writes their text content, loads the extension's
 * permission/service catalogs, and extracts existing permissions — exactly the
 * job the VS Code extension does with `workspace.service.ts` + `extractor.ts`,
 * but backed by plain `fs` so it can run as a standalone MCP server.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { FILE_PATTERNS } from '../../out/core/constants/index.js';

/** Catalog JSON file names, resolved relative to the extension root. */
const ANDROID_CATALOG = 'categorized-android-permissions.json';
const IOS_CATALOG = 'categorized-ios-permissions.json';
const SERVICES_CONFIG = 'services-config.json';

/** Directories that are never searched for platform/translation files. */
const IGNORED_DIRS = new Set([
  'build',
  '.dart_tool',
  'node_modules',
  '.git',
  'out',
  'dist',
  'coverage',
  '.idea',
  '.vscode',
]);

/** Android permission data structure (subset of the extension's type). */
export interface AndroidPermission {
  permission: string;
  description: string;
  protectionLevel: string;
  constantValue: string;
  category: string;
  apiLevel: number;
  removedIn?: number | null;
  equivalentIosPermissions?: string[];
}

/** iOS permission data structure (subset of the extension's type). */
export interface IOSPermission {
  permission: string;
  description: string;
  type: string;
  category: string;
  value?: string | boolean;
  equivalentAndroidPermissions?: string[];
  podfileMacro?: string;
}

/** iOS permission entry for saving. */
export interface IOSPermissionEntry {
  permission: string;
  value?: string | boolean;
  type?: string;
  podfileMacro?: string;
}

/** A discovered platform file with its workspace-relative path + content. */
export interface PlatformFile {
  /** Key into FILE_PATTERNS, e.g. "ANDROID_MANIFEST". */
  kind: string;
  /** Workspace-relative POSIX path, e.g. "android/app/src/main/AndroidManifest.xml". */
  relativePath: string;
  /** Absolute path on disk. */
  absolutePath: string;
  /** File text content (loaded lazily by the host, cached here). */
  content?: string;
}

/** Basic info about the resolved Flutter project. */
export interface ProjectInfo {
  rootPath: string;
  projectName?: string;
  isFlutter: boolean;
  files: PlatformFile[];
}

/**
 * Turn a VS Code style glob (e.g. `android/app/src/main/AndroidManifest.xml`
 * with a `**` prefix, or `ios/Runner/*.entitlements`) into a RegExp matched
 * against a workspace-relative POSIX path. Supports `**`, `*`, and literal
 * segments.
 */
export function globToRegExp(glob: string): RegExp {
  let re = '';
  const segments = glob.split('/');
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const prevWasDoubleStar = i > 0 && segments[i - 1] === '**';
    if (i > 0 && !prevWasDoubleStar) {
      re += '/';
    }
    if (seg === '**') {
      // `**` matches zero or more path segments. `**/` (followed by another
      // segment) must also be able to match "zero directories", so the `**`
      // itself is `(?:[^/]+/)*` and the next segment must NOT add another `/`.
      re += '(?:[^/]+/)*';
    } else {
      let out = '';
      for (const ch of seg) {
        if (ch === '*') {
          out += '[^/]*';
        } else if (ch === '?') {
          out += '[^/]';
        } else if ('.[]{}()+-|^$\\'.includes(ch)) {
          out += '\\' + ch;
        } else {
          out += ch;
        }
      }
      re += out;
    }
  }
  return new RegExp(`^${re}$`);
}

/** Resolve the target Flutter project root. Throws when it cannot be found. */
export function resolveProjectRoot(): string {
  // 1. Explicit CLI arg: --project <path>
  const argv = process.argv.slice(2);
  const flagIndex = argv.indexOf('--project');
  const cliProject =
    flagIndex !== -1 && argv[flagIndex + 1] ? argv[flagIndex + 1] : undefined;

  // 2. Environment variable set by the VS Code extension / launcher.
  const envProject = process.env['FCM_MCP_PROJECT'];

  // 3. Fall back to the current working directory.
  const candidate = cliProject || envProject || process.cwd();
  const root = path.resolve(candidate);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`Flutter project path does not exist or is not a directory: ${root}`);
  }
  return root;
}

/** Absolute path to the extension repo root (parent of `mcp-server/`). */
export function extensionRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
}

/** Recursively collect files under `root` (POSIX relative paths). */
function walk(root: string): string[] {
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.well-known') {
        continue;
      }
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) {
          stack.push(abs);
        }
      } else if (entry.isFile()) {
        out.push(path.relative(root, abs).split(path.sep).join('/'));
      }
    }
  }
  return out;
}

/**
 * Discover platform files in a project using the extension's FILE_PATTERNS.
 * Returns the first match per pattern (like the extension's MAX_SEARCH_RESULTS).
 */
export function discoverProjectFiles(root: string): PlatformFile[] {
  const all = walk(root);
  const result: PlatformFile[] = [];
  const seenKinds = new Set<string>();
  for (const [kind, glob] of Object.entries(FILE_PATTERNS)) {
    const regex = globToRegExp(glob);
    const match = all.find((rel) => regex.test(rel));
    if (match) {
      seenKinds.add(kind);
      result.push({
        kind,
        relativePath: match,
        absolutePath: path.join(root, match.split('/').join(path.sep)),
      });
    }
  }
  return result;
}

/** Read a file as UTF-8 text; returns undefined when unreadable. */
export function readText(file: PlatformFile): string | undefined {
  if (file.content === undefined) {
    try {
      file.content = fs.readFileSync(file.absolutePath, 'utf8');
    } catch {
      file.content = null as unknown as string;
    }
  }
  return file.content === (null as unknown as string) ? undefined : file.content;
}

/** Write a file as UTF-8 text; throws on failure. */
export function writeText(file: PlatformFile, content: string): void {
  fs.writeFileSync(file.absolutePath, content, 'utf8');
  file.content = content;
}

/** Get a discovered file by kind, or undefined. */
export function getFile(files: PlatformFile[], kind: string): PlatformFile | undefined {
  return files.find((f) => f.kind === kind);
}

/** Parse a JSON catalog file into a typed value. */
function loadCatalog<T>(fileName: string): T {
  const filePath = path.join(extensionRoot(), 'src', fileName);
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

/** All Android permissions from the catalog, flattened + deduplicated. */
export function getAllAndroidPermissions(): AndroidPermission[] {
  const raw = loadCatalog<Record<string, AndroidPermission[]> | AndroidPermission[]>(
    ANDROID_CATALOG,
  );
  const list = Array.isArray(raw) ? raw : Object.values(raw).flat();
  const seen = new Set<string>();
  return list.filter((p) => {
    if (!p || !p.permission || seen.has(p.permission)) {
      return false;
    }
    seen.add(p.permission);
    return true;
  });
}

/** All iOS permissions from the catalog, flattened + deduplicated. */
export function getAllIOSPermissions(): IOSPermission[] {
  const raw = loadCatalog<Record<string, IOSPermission[]> | IOSPermission[]>(IOS_CATALOG);
  const list = Array.isArray(raw) ? raw : Object.values(raw).flat();
  const seen = new Set<string>();
  return list.filter((p) => {
    if (!p || !p.permission || seen.has(p.permission)) {
      return false;
    }
    seen.add(p.permission);
    return true;
  });
}

/** Load the services configuration catalog. */
export function loadServicesConfig(): Record<string, unknown> {
  return loadCatalog<Record<string, unknown>>(SERVICES_CONFIG);
}

/** Extract Android permission names currently present in a manifest. */
export function extractAndroidPermissionNames(manifestContent: string): string[] {
  const regex = /<uses-permission\b[^>]*android:name="([^"]+)"[^>]*>/g;
  const names: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(manifestContent)) !== null) {
    if (!names.includes(match[1])) {
      names.push(match[1]);
    }
  }
  return names;
}

/** Extract iOS permission entries currently present in an Info.plist. */
export function extractIOSPermissionEntries(plistContent: string): IOSPermissionEntry[] {
  const entries: IOSPermissionEntry[] = [];
  const stringRegex = /<key>((?:NS|ITS)\w*)<\/key>\s*<string>([^<]*)<\/string>/g;
  const boolRegex = /<key>((?:NS|ITS)\w*)<\/key>\s*<(true|false)\/>/g;
  let match: RegExpExecArray | null;
  while ((match = stringRegex.exec(plistContent)) !== null) {
    entries.push({ permission: match[1], value: match[2], type: 'string' });
  }
  while ((match = boolRegex.exec(plistContent)) !== null) {
    entries.push({ permission: match[1], value: match[2] === 'true', type: 'boolean' });
  }
  return entries;
}

/** Read pubspec.yaml project name if present. */
export function readProjectName(root: string): string | undefined {
  try {
    const pubspec = fs.readFileSync(path.join(root, 'pubspec.yaml'), 'utf8');
    const match = pubspec.match(/^name\s*:\s*(.+)$/m);
    return match ? match[1].trim() : undefined;
  } catch {
    return undefined;
  }
}

/** Assemble project info for the `get_project_info` tool. */
export function getProjectInfo(rootOverride?: string): ProjectInfo {
  const rootPath = rootOverride ? path.resolve(rootOverride) : resolveProjectRoot();
  const files = discoverProjectFiles(rootPath);
  const isFlutter = fs.existsSync(path.join(rootPath, 'pubspec.yaml'));
  return {
    rootPath,
    projectName: readProjectName(rootPath),
    isFlutter,
    files,
  };
}

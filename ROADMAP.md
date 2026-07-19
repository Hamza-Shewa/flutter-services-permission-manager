# Flutter Config Manager — Engineering Roadmap

> **Scope:** 6 weeks, 4 major releases. Generated 2026-07-18.
> **Primary goal:** Engineering quality hardening first, then new features.
> **Process:** Each Phase ends with a `.vsix` publish to the VS Code Marketplace.

---

## Phases Overview

| Phase | Weeks | Release | Focus |
|-------|-------|---------|-------|
| 1 | 1–2 | v1.1.0 | Foundation Hardening |
| 2 | 3–4 | v1.2.0 | Architecture Refactor |
| 3 | 4 (overlap) | v1.2.0 | Test Coverage & DX |
| 4 | 5 | v1.3.0 | pubspec Editor + Diagnostics |
| 5 | 6 | v1.4.0 | Flavors + CI/CD + Feature Flags |

---

## Phase 1 — Foundation Hardening (Weeks 1–2)

**Release target:** v1.1.0

**Goal:** Eliminate the most dangerous code smells — regex XML/plist fragility, type safety violations, and oversized function signatures.

---

### Task 1.1 — Replace regex-based XML parsing with `fast-xml-parser`

**Priority:** Critical
**Files affected:** `src/services/android/manifest.service.ts`, `src/shared/xml.ts`, `src/services/services-extractor.service.ts`

**Problem:** The current code uses a patchwork of `string.replace()` and ad-hoc regex patterns to modify `AndroidManifest.xml`. This is fragile: a single XML comment inside a tag, a CDATA section, or a multi-line attribute breaks the pattern. For example, the permission removal block at lines 127–133 of `manifest.service.ts` will silently skip any `<uses-permission>` tag that has a comment between its attributes.

**Pattern to use:** Read-parse-mutate-serialize cycle using `fast-xml-parser` for *reading* (element location) and targeted string surgery for *writing* (to preserve formatting). Keep the diff minimal — only replace extraction/query functions.

**Step 1 — Install dependency:**
```bash
npm install fast-xml-parser
```

**Step 2 — Create `src/shared/xml-parser.ts`:**
```typescript
import { XMLParser } from 'fast-xml-parser';

export const DEFAULT_PARSER_OPTIONS = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  allowBooleanAttributes: true,
  parseAttributeValue: false,
  preserveOrder: true,
  commentPropName: '#comment',
  cdataPropName: '#cdata',
  trimValues: false,
} as const;

export const manifestParser = new XMLParser(DEFAULT_PARSER_OPTIONS);

/** Safely parses XML; returns null on failure instead of throwing */
export function parseXmlSafe(content: string): unknown[] | null {
  try {
    return manifestParser.parse(content) as unknown[];
  } catch {
    return null;
  }
}

/**
 * Removes all XML elements matching a tag name from content.
 * Uses fast-xml-parser to locate elements, then surgically removes
 * the corresponding character ranges to preserve surrounding formatting.
 */
export function removeXmlElements(
  content: string,
  tagName: string,
  requiredAttribute?: string,
): string {
  // 1. Parse with position tracking
  // 2. Find all elements of tagName (optionally filtered by attribute presence)
  // 3. Collect [start, end] ranges sorted descending
  // 4. Remove each range from content (back-to-front to preserve indices)
  // 5. Return cleaned content
  // ... implementation using XMLParser with getValueFromKey position tracking
}
```

**Step 3 — Refactor `manifest.service.ts` permission-removal block (lines 127–133):**
```diff
-// Remove all uses-permission tags with their surrounding whitespace
-let cleaned = manifestContent.replace(
-    /[ \t]*<uses-permission\b[^>]*android:name="[^"]+"[^>]*\/?>(?:\s*<\/uses-permission>)?[ \t]*\r?\n?/g,
-    ''
-);
+// Use position-safe removal powered by fast-xml-parser
+let cleaned = removeXmlElements(manifestContent, 'uses-permission', 'android:name');
```

**Step 4 — Replace `findXmlElementBounds` in `src/shared/xml.ts`** with a `fast-xml-parser`-backed version. The current implementation is a manual character-walk (lines 61–130) that can fail on self-closing tags with namespace prefixes.

**Acceptance criteria:**
- A manifest with XML comments inside `<uses-permission>` tags is handled without stripping those comments.
- A manifest with CDATA in `android:label` is preserved unchanged after round-trip.
- All new unit tests from Task 3.2 pass.

---

### Task 1.2 — Replace regex-based plist parsing with a `PlistDocument` class

**Priority:** Critical
**Files affected:** `src/services/ios/plist.service.ts` (505 lines, ~15 distinct regex patterns)

**Problem:** The plist service maintains array-depth tracking manually (`findMatchingArrayBounds`), uses string-index arithmetic, and has duplicated `lastIndexOf('</dict>')` patterns spread across multiple functions. This makes adding new plist value types (integer, dict) require modifying 5+ functions simultaneously.

**Pattern to use:** A `PlistDocument` value-object class that wraps the raw string and provides a clean mutation API, returning new instances (immutable). Internally uses `fast-xml-parser` for queries while targeted string surgery preserves original formatting.

**Create `src/shared/plist-parser.ts`:**
```typescript
export class PlistDocument {
  private readonly _source: string;

  constructor(source: string) {
    this._source = source;
  }

  get source(): string { return this._source; }

  /** The dominant indentation character(s) detected in this document */
  get indent(): string { return detectPlistIndent(this._source); }

  /**
   * Returns the character-offset bounds of a key-value pair.
   * The bounds span from the opening whitespace before <key> to the
   * end of the value element (</string>, </true>, etc.).
   */
  findKeyValueBounds(key: string): { start: number; end: number } | null {
    // Search for <key>KEY</key> then find its value element
    // Return the full range including leading whitespace
  }

  /** Removes a key-value pair and its surrounding whitespace. Returns a new PlistDocument. */
  removeKey(key: string): PlistDocument {
    const bounds = this.findKeyValueBounds(key);
    if (!bounds) { return this; }
    const newSource = this._source.slice(0, bounds.start) + this._source.slice(bounds.end);
    return new PlistDocument(newSource);
  }

  /** Inserts a key-value pair before the outermost closing </dict>. Returns a new PlistDocument. */
  insertKeyValue(key: string, value: string, type: 'string' | 'bool' | 'array'): PlistDocument {
    const dictEnd = this._source.lastIndexOf('</dict>');
    if (dictEnd === -1) { return this; }
    const i = this.indent;
    let entry: string;
    if (type === 'bool') {
      entry = `${i}<key>${key}</key>\n${i}<${value}/>\n`;
    } else if (type === 'string') {
      entry = `${i}<key>${key}</key>\n${i}<string>${value}</string>\n`;
    } else {
      entry = `${i}<key>${key}</key>\n${i}<array>\n${value}\n${i}</array>\n`;
    }
    const newSource = this._source.slice(0, dictEnd) + entry + this._source.slice(dictEnd);
    return new PlistDocument(newSource);
  }
}
```

**Diff for `plist.service.ts` permission removal section (lines 190–228):**
```diff
-let cleanedPrefix = prefix;
-for (const key of keysToRemove) {
-  const keyStringRegex = new RegExp(
-    `\\s*<key>${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</key>\\s*<string>[^<]*</string>`,
-    'g'
-  );
-  cleanedPrefix = cleanedPrefix.replace(keyStringRegex, '');
-  const keyBoolRegex = new RegExp(
-    `\\s*<key>${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</key>\\s*<(?:true|false)/>`,
-    'g'
-  );
-  cleanedPrefix = cleanedPrefix.replace(keyBoolRegex, '');
-}
+let doc = new PlistDocument(plistContent);
+for (const key of keysToRemove) {
+  doc = doc.removeKey(key);
+}
+const cleanedPrefix = doc.source.slice(0, doc.source.lastIndexOf('</dict>'));
```

---

### Task 1.3 — Fix the `savePermissions()` 14-parameter explosion

**Priority:** High
**Files affected:** `src/services/document.service.ts`, `src/webview/handlers/index.ts`

**Problem:** `savePermissions()` accepts 14 positional parameters. Adding macOS entitlements or a Windows platform in the future requires changing every call site.

**Pattern to use:** Options-object / Context pattern with typed per-platform sub-contexts.

**Create `src/types/save-context.ts` (NEW FILE):**
```typescript
import type * as vscode from 'vscode';
import type { IOSPermissionEntry, ServiceEntry, ServiceConfig, AppNameLocalization } from './index.js';

export interface AndroidSaveContext {
  manifestUri?: vscode.Uri;
  permissions: string[];
  services?: ServiceEntry[];
}

export interface IOSSaveContext {
  plistUri?: vscode.Uri;
  permissions: IOSPermissionEntry[];
  podfileUri?: vscode.Uri;
  appDelegateUri?: vscode.Uri;
  entitlementsUri?: vscode.Uri;
  services?: ServiceEntry[];
}

export interface MacOSSaveContext {
  plistUri?: vscode.Uri;
  permissions: IOSPermissionEntry[];
}

export interface SaveContext {
  android?: AndroidSaveContext;
  ios?: IOSSaveContext;
  macos?: MacOSSaveContext;
  appName?: AppNameLocalization;
  servicesConfig?: ServiceConfig[];
  previousServices?: ServiceEntry[];
  categorizedIosPermissions?: Record<string, { permission: string; podfileMacro?: string }[]>;
}
```

**Diff in `document.service.ts`:**
```diff
-export async function savePermissions(
-  androidPermissions: string[],
-  iosPermissions: IOSPermissionEntry[],
-  androidManifestUri?: vscode.Uri,
-  iosPlistUri?: vscode.Uri,
-  iosPodfileUri?: vscode.Uri,
-  iosAppDelegateUri?: vscode.Uri,
-  iosEntitlementsUri?: vscode.Uri,
-  categorizedIosPermissions?: Record<string, { permission: string; podfileMacro?: string }[]>,
-  services?: ServiceEntry[],
-  servicesConfig?: ServiceConfig[],
-  previousServices?: ServiceEntry[],
-  macosPermissions?: IOSPermissionEntry[],
-  macosPlistUri?: vscode.Uri,
-  appName?: AppNameLocalization,
-): Promise<SaveResult>
+export async function savePermissions(ctx: SaveContext): Promise<SaveResult>
```

Update `handleSave` in `handlers/index.ts` to construct a `SaveContext` from the webview message payload fields.

---

### Task 1.4 — Eliminate all `as any` casts in `initializer.ts`

**Priority:** High
**Files affected:** `src/webview/initializer.ts` (lines 244–312), `src/webview/handlers/index.ts`

**Problem:** 8 occurrences of `ref as any` exist because `WebviewRef` does not distinguish Panel from View. `handleMigrateAndroid` at line 245 tries to access `ref.webview.__panel`, a non-existent property invented by the author as a workaround.

**Pattern to use:** Discriminated union for the webview reference type.

**Diff in `src/webview/handlers/index.ts`:**
```diff
-export interface WebviewRef {
-  webview: vscode.Webview;
-}
+export type WebviewRef =
+  | { kind: 'panel'; panel: vscode.WebviewPanel; webview: vscode.Webview }
+  | { kind: 'view';  view:  vscode.WebviewView;  webview: vscode.Webview };

+/** Factory — constructs the correct WebviewRef discriminant */
+export function makeWebviewRef(target: WebviewTarget): WebviewRef {
+  if (target.type === 'panel') {
+    return { kind: 'panel', panel: target.panel, webview: target.panel.webview };
+  }
+  return { kind: 'view', view: target.view, webview: target.view.webview };
+}
```

**Diff in `initializer.ts` lines 244–251:**
```diff
-case "migrateAndroid":
-  if ((ref.webview as any).__panel) {
-    await handleMigrateAndroid((ref.webview as any).__panel);
-  } else {
-    await handleMigrateAndroid(ref as any);
-  }
+case "migrateAndroid":
+  await handleMigrateAndroid(ref);   // ref is now a typed WebviewRef
```

All remaining `ref as any` casts on lines 254–312 are removed by updating all handler function signatures to accept `WebviewRef`. Since both union members have a `.webview` property, no other changes are needed in the handler bodies.

---

### Task 1.5 — Replace hardcoded version strings in migration service

**Priority:** High
**Files affected:** `src/services/android/migration.service.ts`, new `src/constants/versions.ts`, new `src/services/android/version-fetcher.ts`

**Problem:** AGP `"8.13.2"`, Kotlin `"2.2.21"`, Gradle `"8.14.3"` are hardcoded string literals in template strings at lines 43, 54, 61, 64, 67. When these go stale, the migration feature will actively break Flutter projects.

**Create `src/constants/versions.ts`:**
```typescript
/** Pinned fallback versions — bump these on each release cycle */
export const PINNED_VERSIONS = {
  AGP:           '8.13.2',
  KOTLIN:        '2.2.21',
  GRADLE:        '8.14.3',
  GOOGLE_SVCS:   '4.4.4',
  FIREBASE_PERF: '1.4.1',
  CRASHLYTICS:   '2.8.1',
} as const;

export type VersionKey = keyof typeof PINNED_VERSIONS;
```

**Create `src/services/android/version-fetcher.ts`:**
```typescript
import * as https from 'https';
import { PINNED_VERSIONS, type VersionKey } from '../../constants/versions.js';

const MAVEN_METADATA_URLS: Partial<Record<VersionKey, string>> = {
  AGP:    'https://dl.google.com/android/maven2/com/android/tools/build/gradle/maven-metadata.xml',
  KOTLIN: 'https://repo1.maven.org/maven2/org/jetbrains/kotlin/kotlin-gradle-plugin/maven-metadata.xml',
};

/**
 * Returns the latest released version from Maven Central metadata XML.
 * Falls back silently to the pinned constant on any network or parse failure.
 */
export async function fetchLatestVersion(key: VersionKey): Promise<string> {
  const url = MAVEN_METADATA_URLS[key];
  if (!url) { return PINNED_VERSIONS[key]; }
  try {
    const xml = await httpsGet(url);  // simple Promise-wrapper around https.get
    const match = xml.match(/<release>([^<]+)<\/release>/);
    return match ? match[1].trim() : PINNED_VERSIONS[key];
  } catch {
    return PINNED_VERSIONS[key];
  }
}
```

**Diff in `migration.service.ts` lines 43–68:** Replace every hardcoded version literal with `await fetchLatestVersion('AGP')`, `await fetchLatestVersion('KOTLIN')`, etc.

---

### Task 1.6 — Normalize error handling across all `catch` blocks

**Priority:** Medium
**Files affected:** `src/services/document.service.ts` (line 722), `src/webview/handlers/packages.ts`, `src/webview/handlers/migrate.ts`, `src/services/services-extractor.service.ts`

**Problem 1:** `catch (error)` blocks format the error as `` `...${error}` `` which produces `"[object Object]"` when `error` is a non-Error throwable. Line 722 of `document.service.ts` is the primary culprit — the user sees a completely uninformative message.

**Problem 2:** `console.log` and `console.error` calls in handler files bypass the structured `logger` and will appear even in production extension logs with no formatting.

**Add to `src/shared/errors.ts`:**
```typescript
/** Narrows an unknown thrown value to a human-readable string */
export function toErrorMessage(e: unknown): string {
  if (e instanceof Error) { return e.message; }
  if (typeof e === 'string') { return e; }
  try { return JSON.stringify(e); } catch { return String(e); }
}
```

**Diff in `document.service.ts` lines 721–723:**
```diff
-  } catch (error) {
-    return { success: false, message: `Failed to save permissions: ${error}` };
-  }
+  } catch (error) {
+    logger.error('savePermissions failed', error instanceof Error ? error : new Error(toErrorMessage(error)));
+    return { success: false, message: `Failed to save permissions: ${toErrorMessage(error)}` };
+  }
```

Replace all `console.log` / `console.error` in `packages.ts` (12 occurrences), `migrate.ts` (4 occurrences), and `services-extractor.service.ts` (line 98) with `logger.debug` / `logger.error`.

---

### Task 1.7 — Fix indentation inconsistency in `workspace.ts` line 26

**Priority:** Low
**Files affected:** `src/services/workspace.ts`

**Problem:** `androidStringsUri` field on line 26 uses 4-space indent while the surrounding `ProjectFiles` interface uses 2-space. A stray formatting error introduced in a past commit.

```diff
-    androidStringsUri?: vscode.Uri;
+  androidStringsUri?: vscode.Uri;
```

Run `npm run lint -- --fix` and commit the result.

---

## Phase 2 - Architecture Refactor (Weeks 3-4)

**Release target:** v1.2.0

**Goal:** Decompose the 122KB webview.js monolith into ES modules. Introduce a typed message bus. Add auto-refresh via file watching.

---

### Task 2.1 - Split webview.js into ES modules

**Priority:** Critical
**Files affected:** src/webview.js (3000+ lines) to new directory src/webview/frontend/

**Problem:** webview.js is a 122KB single-file script with all UI logic for permissions, services, packages, build details, and localization in one closure. Every feature change risks breaking unrelated features.

**Pattern to use:** ES Module split. A single index.js is the HTML entry-point. Each feature owns its own module. state.js is the single source of truth, implementing a simple pub-sub pattern.

**New file structure:**
`
src/webview/frontend/
├── index.js           <- bootstraps the app, calls init() on each module
├── state.js           <- pub-sub state store (single source of truth)
├── router.js          <- tab-switching (active class, show/hide panels)
├── permissions.js     <- Android + iOS + macOS permission UI
├── services.js        <- third-party service cards UI
├── packages.js        <- pub.dev package manager UI
├── build-details.js   <- Gradle / Xcode build details panel
├── localization.js    <- app name localization panel
├── api.js             <- ALL vscode.postMessage() calls live here only
└── utils.js           <- shared DOM helpers (createElement, showToast, setLoading)
`

**state.js pattern:**
`javascript
const _state = {
  androidPermissions: [],
  iosPermissions: [],
  macosPermissions: [],
  services: [],
  packages: [],
  platformDetails: { android: [], ios: [] },
  appName: { defaultName: '', localizations: {} },
};

const _listeners = new Map();

export function getState() { return Object.freeze({ ..._state }); }

export function setState(patch) {
  Object.assign(_state, patch);
  Object.keys(patch).forEach(k =>
    (_listeners.get(k) ?? new Set()).forEach(cb => cb(_state[k]))
  );
}

// Subscribe to state changes. Returns unsubscribe function.
export function on(key, callback) {
  if (!_listeners.has(key)) { _listeners.set(key, new Set()); }
  _listeners.get(key).add(callback);
  return () => _listeners.get(key)?.delete(callback);
}
`

**api.js pattern:**
`javascript
const vscode = acquireVsCodeApi();

export const sendRefresh = () => vscode.postMessage({ type: 'refresh' });
export const sendSavePermissions = (android, ios, macos) =>
  vscode.postMessage({ type: 'savePermissions', androidPermissions: android, iosPermissions: ios, macosPermissions: macos });
// ... one export per message type
`

**Diff in src/flutter-config.html:**
`diff
-<script src=""></script>
+<script type="module" src=""></script>
`

Update src/webview/content.ts to expose all new module URIs as webview-safe nonce URIs.

---

### Task 2.2 - Introduce a typed MessageBus

**Priority:** High
**Files affected:** src/webview/initializer.ts, src/webview/handlers/index.ts

**Problem:** The switch statement in setupMessageHandler (lines 177-314) is 137 lines long and grows with every new message type. There is no compile-time guarantee that every WebviewMessage type has a registered handler.

**Create src/webview/message-bus.ts:**
`	ypescript
import type { WebviewMessage } from '../types/webview.js';
import { logger } from '../shared/index.js';

type Handler<T extends WebviewMessage> = (msg: T) => Promise<void> | void;

export class MessageBus {
  private readonly _handlers = new Map<string, Handler<WebviewMessage>>();

  register<T extends WebviewMessage['type']>(
    type: T,
    handler: Handler<Extract<WebviewMessage, { type: T }>>
  ): this {
    this._handlers.set(type, handler as Handler<WebviewMessage>);
    return this;
  }

  async dispatch(message: unknown): Promise<void> {
    if (!this._isValid(message)) {
      logger.warn('Invalid webview message', { message });
      return;
    }
    const handler = this._handlers.get(message.type);
    if (!handler) {
      logger.warn('Unhandled webview message type', { type: message.type });
      return;
    }
    try {
      await handler(message);
    } catch (e) {
      logger.error('Handler threw', e instanceof Error ? e : new Error(String(e)));
    }
  }

  private _isValid(msg: unknown): msg is WebviewMessage {
    return typeof msg === 'object' && msg !== null &&
           typeof (msg as Record<string, unknown>).type === 'string';
  }
}
`

Replace the switch in setupMessageHandler with a fluent MessageBus chain:
`	ypescript
const bus = new MessageBus()
  .register('ready',                   () => ref.webview.postMessage(initialPayload))
  .register('refresh',                 () => handleRefresh(ref, files))
  .register('savePermissions',  (msg)  => handleSavePermissions(ref, msg.androidPermissions, msg.iosPermissions, msg.macosPermissions, files))
  .register('saveServices',     (msg)  => handleSaveServices(ref, msg.services ?? [], files))
  .register('migrateAndroid',          () => handleMigrateAndroid(ref))
  // ... all remaining handlers

ref.webview.onDidReceiveMessage((msg) => bus.dispatch(msg));
`

---

### Task 2.3 - Extract services-extractor.service.ts sub-concerns

**Priority:** Medium
**Files affected:** src/services/services-extractor.service.ts (882 lines)

**Problem:** This file mixes three concerns: Android strings.xml reference resolution (lines 61-120), intent-filter regex parsing (lines 19-56), and high-level service extraction orchestration.

**Create:**
- src/services/android/string-resolver.ts — extracts resolveStringReference() and resource-file-path logic
- src/services/android/intent-parser.ts — extracts extractApplinkIntents() and all intent-filter regex

services-extractor.service.ts becomes a pure orchestrator importing from these sub-modules only.

---

### Task 2.4 - Add file watcher for auto-refresh on external edits

**Priority:** Medium
**Files affected:** src/webview/initializer.ts, new src/utils/debounce.ts

**Create src/utils/debounce.ts:**
`	ypescript
export function debounce<TArgs extends unknown[]>(
  fn: (...args: TArgs) => unknown,
  delayMs: number
): (...args: TArgs) => void {
  let timer: ReturnType<typeof setTimeout>;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delayMs);
  };
}
`

**Add to initializePermissionWebview() after message handler setup:**
`	ypescript
const watcher = vscode.workspace.createFileSystemWatcher(
  new vscode.RelativePattern(
    vscode.workspace.workspaceFolders![0],
    '{**/AndroidManifest.xml,**/Info.plist,**/Podfile,**/pubspec.yaml}'
  )
);
const debouncedRefresh = debounce(() => handleRefresh(ref, files), 1500);
watcher.onDidChange(debouncedRefresh);
watcher.onDidCreate(debouncedRefresh);

if (target.type === 'panel') {
  target.panel.onDidDispose(() => watcher.dispose());
} else {
  context.subscriptions.push(watcher);
}
`

---

### Task 2.5 - Add input validation before file write

**Priority:** High
**Files affected:** src/webview/handlers/index.ts, new src/services/service-validator.ts, src/shared/errors.ts

**Problem:** Raw user input (e.g. XML-special chars in an API key field) is injected directly into AndroidManifest.xml without sanitization.

**Create src/services/service-validator.ts:**
`	ypescript
import type { ServiceEntry, ServiceConfig } from '../types/index.js';
import { ServiceValidationError } from '../shared/errors.js';

const XML_SPECIAL_CHARS = /[<>&"']/;

export function validateServiceEntry(entry: ServiceEntry, config: ServiceConfig): ServiceValidationError[] {
  const errors: ServiceValidationError[] = [];
  for (const field of config.fields ?? []) {
    const value = entry.values?.[field.id] ?? '';
    if (field.required && !value.trim()) {
      errors.push(new ServiceValidationError(entry.id, field.id, field.label + ' is required'));
    }
    if (value && XML_SPECIAL_CHARS.test(value)) {
      errors.push(new ServiceValidationError(entry.id, field.id, field.label + ' contains invalid characters'));
    }
    if (field.pattern && value && !new RegExp(field.pattern).test(value)) {
      errors.push(new ServiceValidationError(entry.id, field.id, field.patternError ?? field.label + ' has an invalid format'));
    }
  }
  return errors;
}
`

**Add to src/shared/errors.ts:**
`	ypescript
export class ServiceValidationError extends PermissionManagerError {
  constructor(serviceId: string, field: string, message: string) {
    super(message, 'SERVICE_VALIDATION_ERROR', { serviceId, field });
    this.name = 'ServiceValidationError';
  }
}
`

Call validateServiceEntry in handleSaveServices before file write. Return saveResult with success: false if validation fails.

---

## Phase 3 - Test Coverage and DX (Week 4, overlap)

**Release target:** Part of v1.2.0

**Goal:** Unit-test all service layer functions with real-world Flutter project fixture files. No VS Code API dependencies.

---

### Task 3.1 - Create fixture files

**Priority:** Critical
**Create directory:** src/test/fixtures/

| File | Description |
|------|-------------|
| AndroidManifest.xml | Minimal clean Flutter manifest |
| AndroidManifest.with-services.xml | Has Facebook, Google Maps, applinks |
| AndroidManifest.corrupted.xml | Has CDATA, comments inside tags |
| Info.plist | Minimal iOS plist (tab-indented) |
| Info.plist.spaces | Same plist but 4-space indented |
| Info.plist.with-services.xml | Has GIDClientID, FacebookAppID |
| strings.xml | Minimal Android strings.xml |
| Podfile | Standard Flutter Podfile |
| pubspec.yaml | Standard Flutter pubspec.yaml |

Each fixture must be a real-world snapshot from an actual Flutter project.

---

### Task 3.2 - Unit tests for manifest.service.ts

**Priority:** Critical
**Files affected:** src/test/android/manifest.service.test.ts (NEW FILE)

Pattern: Mocha + Node assert. No VS Code API calls.

Key test cases (minimum 15 total):
- normalizePermissionNames adds android.permission. prefix when missing
- normalizePermissionNames deduplicates entries
- normalizePermissionNames handles empty input
- updateAndroidManifest inserts permissions after the manifest tag
- updateAndroidManifest removes permissions not in the new list
- updateAndroidManifest produces valid XML (has closing manifest tag)
- updateAndroidManifest preserves the queries block
- updateAndroidManifest preserves XML comments from the corrupted fixture
- updateAndroidManifest handles empty permissions list correctly
- removeServicesFromAndroidManifest removes applinks comment markers
- Round-trip: apply permissions, remove permissions, assert output matches original structure

---

### Task 3.3 - Unit tests for plist.service.ts

**Priority:** Critical
**Files affected:** src/test/ios/plist.service.test.ts (NEW FILE)

Key test cases (minimum 12):
- updateIOSPlist inserts permissions before last closing dict with correct indentation
- updateIOSPlist preserves all non-permission keys
- updateIOSPlist removes a key that is in allKnownKeys but absent from new permissionEntries
- detectPlistIndent identifies tab vs 2-space vs 4-space from fixture files
- updateIOSPlistWithServices inserts GIDClientID before the closing dict
- removeServicesFromIOSPlist does NOT remove LSApplicationQueriesSchemes

---

### Task 3.4 - Unit tests for podfile.service.ts

**Priority:** High
**Files affected:** src/test/ios/podfile.service.test.ts (NEW FILE)

Key test cases (minimum 8):
- Adds PERMISSION_CAMERA=1 macro to the post_install block
- Does not duplicate a macro already present
- Creates post_install block if absent
- Adds COCOAPODS_DISABLE_STATS if missing
- Updates platform ios deployment target

---

### Task 3.5 - Extract and test document.service.ts build helpers

**Priority:** Medium
**Files affected:** New src/services/build-file-utils.ts, new src/test/build-file-utils.test.ts

Extract and export: replaceGradlePropertyLine, replaceFirst, normalizeTextValue, stripApiPrefix, escapeRegExp.

---

### Task 3.6 - Configure code coverage thresholds

**Priority:** Medium

Update .c8rc:
`json
{
  "all": true,
  "src": ["src/**/*.ts"],
  "exclude": ["src/test/**", "src/webview/frontend/**", "out/**"],
  "lines": 70, "functions": 70, "branches": 60, "statements": 70,
  "reporter": ["text", "lcov", "html"]
}
`

Add to package.json: "coverage:report": "c8 report --reporter=html"

---

## Phase 4 - New Features: pubspec Editor + Diagnostics (Week 5)

**Release target:** v1.3.0

---

### Task 4.1 - pubspec.yaml Visual Editor

**Priority:** High

New "pubspec" tab. Reads pubspec.yaml and presents: SDK constraints, asset declarations, font declarations, dependency constraints. Uses the yaml npm package for round-trip writes that preserve comments.

**New files:** src/services/pubspec.service.ts, src/webview/frontend/pubspec.js, src/types/pubspec.ts

**Key types:**
`	ypescript
export interface PubspecData {
  name: string;
  description: string;
  version: string;
  sdkConstraint: string;
  flutterConstraint?: string;
  assets: string[];
  fonts: PubspecFont[];
  dependencies: PubspecDependency[];
}
`

**Key service functions:**
`	ypescript
export async function readPubspec(root: vscode.Uri): Promise<PubspecData>;
export async function updateSdkConstraint(root: vscode.Uri, constraint: string): Promise<void>;
export async function addAsset(root: vscode.Uri, assetPath: string): Promise<void>;
export async function removeAsset(root: vscode.Uri, assetPath: string): Promise<void>;
`

**New message types:**
`	ypescript
| { type: 'requestPubspec' }
| { type: 'saveSdkConstraint'; constraint: string }
| { type: 'addAsset'; assetPath: string }
| { type: 'removeAsset'; assetPath: string }
`

---

### Task 4.2 - Android Build Diagnostics Dashboard

**Priority:** High

New "Diagnostics" tab. Read-only checks that produce a colour-coded compatibility matrix.

**New files:** src/services/android/diagnostics.service.ts, src/constants/compatibility.ts, src/webview/frontend/diagnostics.js, src/types/diagnostics.ts

**Key types:**
`	ypescript
export type DiagnosticSeverity = 'ok' | 'warning' | 'error';

export interface DiagnosticItem {
  id: string;
  title: string;
  detail: string;
  severity: DiagnosticSeverity;
  fixAction?: string;
}
`

**Compatibility matrix:**
`	ypescript
export const AGP_COMPATIBILITY = {
  '8.x': { minKotlin: '1.9.0', minGradle: '8.0', minCompileSdk: 34 },
  '7.x': { minKotlin: '1.5.0', minGradle: '7.0', minCompileSdk: 31 },
};
`

**8 checks:** AGP-Kotlin compat, AGP-Gradle compat, compileSdk >= targetSdk, minSdk <= targetSdk <= compileSdk, legacy apply plugin detection, namespace vs applicationId mismatch, iOS deployment target vs Podfile.lock, missing ndkVersion.

---

### Task 4.3 - Flutter Feature Flags Viewer

**Priority:** Medium

Read-only card grid in the Build tab. Reads pubspec.yaml flutter.config. Displays feature status (Impeller, web, desktop targets).

**New message type:** | { type: 'requestFeatureFlags' }

`	ypescript
export interface FlutterFeatureFlag {
  id: string; label: string; description: string;
  status: 'enabled' | 'disabled' | 'unknown';
  docsUrl: string;
}
`

---

## Phase 5 - New Features: Flavors + CI/CD (Week 6)

**Release target:** v1.4.0

---

### Task 5.1 - Build Flavor / Environment Manager

**Priority:** High

New "Flavors" tab. Define dev, staging, prod environments. Writes:
- android/app/src/{flavor}/AndroidManifest.xml overlay
- ios/Flutter/{Flavor}.xcconfig
- Optionally lib/env/{flavor}.dart (opt-in)

**Key type:**
`	ypescript
export interface BuildFlavor {
  id: string;
  displayName: string;
  applicationId: string;
  bundleIdentifier: string;
  appName: string;
  env: Record<string, string>;
  generateDartConstants: boolean;
}
`

**Generated Android overlay:**
`xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:tools="http://schemas.android.com/tools">
  <application android:label="MyApp Dev" tools:replace="android:label" />
</manifest>
`

**Generated iOS xcconfig:**
`
#include "Generated.xcconfig"
BUNDLE_ID=com.example.app.dev
APP_DISPLAY_NAME=MyApp Dev
`

---

### Task 5.2 - CI/CD Workflow Generator

**Priority:** High

New "CI/CD" tab. Select provider (GitHub Actions, GitLab CI, Bitrise) and workflow type. Generates and writes the config file.

**Key types:**
`	ypescript
export type CICDProvider = 'github-actions' | 'gitlab-ci' | 'bitrise';
export type WorkflowType = 'build-android' | 'build-ios' | 'test' | 'full-pipeline';

export interface CICDConfig {
  provider: CICDProvider;
  workflowType: WorkflowType;
  flutterVersion: string;
  javaVersion: string;
  buildAndroid: boolean;
  buildIOS: boolean;
  runTests: boolean;
  keystore?: { storeFileEnvVar: string; passwordEnvVar: string; aliasEnvVar: string; aliasPasswordEnvVar: string; };
}
`

**Generator pattern — pure template literal functions, no external template engines:**
`	ypescript
export function generateGithubActionsWorkflow(config: CICDConfig): string {
  const jobs = [
    config.runTests     ? generateTestJob(config)    : null,
    config.buildAndroid ? generateAndroidJob(config) : null,
    config.buildIOS     ? generateIOSJob(config)     : null,
  ].filter(Boolean).join('\n\n');
  return 'name: Flutter CI\n\non:\n  push:\n    branches: [main, develop]\n\njobs:\n' + jobs;
}
`

**New message types:**
`	ypescript
| { type: 'requestCICDPreview'; cicdConfig: CICDConfig }
| { type: 'saveCICDWorkflow';   cicdConfig: CICDConfig }
`

---

## Technical Debt Catalogue

| # | File | Line(s) | Issue | Severity |
|---|------|---------|-------|----------|
| TD-01 | services-extractor.service.ts | 98 | console.log() in production — replace with logger.debug() | Medium |
| TD-02 | manifest.service.ts | 280-299 | mainActivityRegex uses greedy [\s\S]*? in capture group — ReDoS risk on large files | High |
| TD-03 | plist.service.ts | 57-62 | buildApplinksPlistBlock() uses single template literal with embedded newlines — breaks on non-tab-indented plists | Medium |
| TD-04 | migration.service.ts | 43-68 | Plugin versions hardcoded — see Task 1.5 | High |
| TD-05 | document.service.ts | 379-388 | domain variable unused in AASA map() body | Medium (clarity) |
| TD-06 | pub.service.ts | 80 | (p: any) => p.package — type the API response | Low |
| TD-07 | initializer.ts | 117-118 | Android localizations silently override iOS for same key | Medium |
| TD-08 | workspace.ts | 40-151 | 15 concurrent findFiles() calls — batch into groups | Low |
| TD-09 | plist.service.ts | 301-302 | baseIndent repeated 4x — unify via PlistDocument.indent from Task 1.2 | Medium |
| TD-10 | manifest.service.ts | 68 | blockRegex/legacyRegex use /i flag — Android XML is case-sensitive | Low |

---

## Release Checklist (per Phase)

- [ ] npm run compile exits with 0 errors
- [ ] npm run lint exits with 0 warnings
- [ ] npm run test passes with coverage above thresholds
- [ ] CHANGELOG.md updated with the new version entry
- [ ] package.json version bumped (semver)
- [ ] npm run package produces a .vsix — verify contents via .vscodeignore
- [ ] Manual smoke test: open a real Flutter project, save one permission, verify file change and formatting preservation
- [ ] vsce publish --pat TOKEN

#!/usr/bin/env node
/**
 * Flutter Config Manager — Model Context Protocol server.
 *
 * Lets AI agents inspect and edit a Flutter project's Android/iOS/macOS
 * permissions, service integrations, and ARB/JSON translations, reusing the
 * exact pure logic the VS Code extension uses.
 *
 * Project resolution (first match wins):
 *   1. CLI flag:    node out/index.js --project /path/to/project
 *   2. Env var:     FCM_MCP_PROJECT=/path/to/project
 *   3. cwd:         run the server from inside the Flutter project
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import {
  discoverProjectFiles,
  getProjectInfo,
  readProjectName,
  resolveProjectRoot,
  type PlatformFile,
} from './host.js';
import {
  addPermissionSchema,
  addPermissionTool,
  listPermissionsSchema,
  listPermissionsTool,
  removePermissionSchema,
  removePermissionTool,
} from './permissions.js';
import {
  addTranslationLocaleSchema,
  addTranslationLocaleTool,
  listTranslationsSchema,
  listTranslationsTool,
  translateLocaleSchema,
  translateLocaleTool,
} from './translations.js';
import { loadServicesConfig } from './host.js';
import {
  applySemanticsFixesSchema,
  applySemanticsFixesTool,
  previewSemanticsFixesSchema,
  previewSemanticsFixesTool,
  scanInteractivesSchema,
  scanInteractivesTool,
} from './semantics.js';
import {
  assertRuntimeSchema,
  assertRuntimeTool,
  automationHealthSchema,
  automationHealthTool,
  backRuntimeSchema,
  backRuntimeTool,
  endAndroidSessionSchema,
  endAndroidSessionTool,
  enterRuntimeTextSchema,
  enterRuntimeTextTool,
  inspectRuntimeSchema,
  inspectRuntimeTool,
  screenshotRuntimeSchema,
  screenshotRuntimeTool,
  scrollRuntimeSchema,
  scrollRuntimeTool,
  selectRuntimeOptionSchema,
  selectRuntimeOptionTool,
  startAndroidSessionSchema,
  startAndroidSessionTool,
  tapRuntimeSchema,
  tapRuntimeTool,
  waitRuntimeSchema,
  waitRuntimeTool,
} from './android-automation.js';

const SERVER_NAME = 'flutter-config-manager';
const SERVER_VERSION = '1.1.0';

/** Create an McpServer with every tool registered against the given project. */
export function createServer(root: string): McpServer {
  const files: PlatformFile[] = discoverProjectFiles(root);
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  server.registerTool(
    'get_project_info',
    {
      title: 'Get Flutter project info',
      description:
        'Returns the resolved Flutter project root, project name, whether it is a Flutter project, and which platform files (AndroidManifest.xml, Info.plist, Podfile, AppDelegate.swift, entitlements, …) were discovered.',
      inputSchema: z.object({}),
    },
    async () => {
      const info = getProjectInfo(root);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                rootPath: info.rootPath,
                projectName: info.projectName,
                isFlutter: info.isFlutter,
                files: info.files.map((f) => ({ kind: f.kind, path: f.relativePath })),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerTool(
    'list_permissions',
    {
      title: 'List project permissions',
      description:
        'Lists the permissions currently present in the Android manifest and iOS/macOS Info.plist files, enriched with catalog metadata (description, category, equivalent cross-platform permissions) where known.',
      inputSchema: listPermissionsSchema,
    },
    async (args) => listPermissionsTool(files, args as Record<string, unknown>),
  );

  server.registerTool(
    'add_permission',
    {
      title: 'Add a permission',
      description:
        'Adds a permission to the Android manifest and/or iOS/macOS Info.plist. For Android use a name like "CAMERA" or "android.permission.CAMERA"; for iOS use an NS key like "NSCameraUsageDescription" (optionally with a value/type). Non-destructive: existing structure and comments are preserved.',
      inputSchema: addPermissionSchema,
    },
    async (args) => addPermissionTool(files, args as Record<string, unknown>),
  );

  server.registerTool(
    'remove_permission',
    {
      title: 'Remove a permission',
      description:
        'Removes a permission from the Android manifest and/or iOS/macOS Info.plist. Use the full constant for Android (e.g. "android.permission.CAMERA") or the NS key for iOS (e.g. "NSCameraUsageDescription").',
      inputSchema: removePermissionSchema,
    },
    async (args) => removePermissionTool(files, args as Record<string, unknown>),
  );

  server.registerTool(
    'list_services',
    {
      title: 'List available service integrations',
      description:
        'Lists the third-party service integrations this tool can configure (Facebook SDK, Google Sign-In, Firebase, AdMob, OneSignal, Stripe, …) and what platform files each touches.',
      inputSchema: z.object({}),
    },
    async () => {
      const config = loadServicesConfig();
      const services = Array.isArray(config) ? config : config.services;
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(services ?? config, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    'list_translations',
    {
      title: 'List translation files',
      description:
        'Lists the ARB / JSON translation files in the project (auto-discovered under l10n/translations/locales dirs, or the provided dir), with locale, file path, and key count.',
      inputSchema: listTranslationsSchema,
    },
    async (args) => listTranslationsTool(root, args as Record<string, unknown>),
  );

  server.registerTool(
    'translate_locale',
    {
      title: 'Translate a locale file',
      description:
        'Machine-translates a locale file (ARB/JSON) from the reference locale using a free keyless provider chain (MyMemory → Google → LibreTranslate). Optionally only fill missing keys (missingOnly). Persists changes to disk.',
      inputSchema: translateLocaleSchema,
    },
    async (args) => translateLocaleTool(root, args as Record<string, unknown>),
  );

  server.registerTool(
    'add_translation_locale',
    {
      title: 'Add a translation locale',
      description:
        'Creates a new translation file for a locale, inheriting all reference keys as empty values. Nested structure is preserved. Persists the new file to disk next to the reference file (or the provided dir).',
      inputSchema: addTranslationLocaleSchema,
    },
    async (args) => addTranslationLocaleTool(root, args as Record<string, unknown>),
  );

  server.registerTool(
    'scan_interactives',
    {
      title: 'Scan interactive Flutter widgets',
      description:
        'Statically inventories interactive widgets under lib/, grouped by source file, with exact references, confidence, accessibility readiness, automation identifier readiness, and opaque-surface warnings. This is a confidence-based audit, not a runtime completeness guarantee.',
      inputSchema: scanInteractivesSchema,
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async (args) => scanInteractivesTool(root, args as Record<string, unknown>),
  );

  server.registerTool(
    'preview_semantics_fixes',
    {
      title: 'Preview reviewed Flutter semantics fixes',
      description:
        'Builds a non-mutating, content-hashed preview for selected scan occurrence IDs and reviewed dotted Semantics.identifier values. Returns a short-lived preview ID required by apply_semantics_fixes.',
      inputSchema: previewSemanticsFixesSchema,
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async (args) => previewSemanticsFixesTool(root, args as Record<string, unknown>),
  );

  server.registerTool(
    'apply_semantics_fixes',
    {
      title: 'Apply a reviewed Flutter semantics preview',
      description:
        'Applies a previously generated, unexpired semantics preview only when every source hash still matches. The preview is single-use and cannot bypass scanner exclusions or validation.',
      inputSchema: applySemanticsFixesSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (args) => applySemanticsFixesTool(root, args as Record<string, unknown>),
  );

  server.registerTool(
    'check_android_automation',
    {
      title: 'Check Android automation prerequisites',
      description: 'Read-only health check for Android SDK, adb, emulator, Appium, UiAutomator2, connected devices, and the configured Appium server. It never installs or starts anything.',
      inputSchema: automationHealthSchema,
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async (args) => automationHealthTool(args as Record<string, unknown>),
  );

  server.registerTool(
    'start_android_session',
    {
      title: 'Start an Android Appium session',
      description: 'Connects to an existing Appium UiAutomator2 server and starts a session for an APK or installed package. Appium and emulator setup remain explicit prerequisites.',
      inputSchema: startAndroidSessionSchema,
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (args) => startAndroidSessionTool(root, args as Record<string, unknown>),
  );

  server.registerTool(
    'inspect_runtime_ui',
    {
      title: 'Inspect Android runtime semantics identifiers',
      description: 'Reads the current native accessibility hierarchy, reports exact semantics identifiers and duplicates, and correlates identifiers to static Dart source references.',
      inputSchema: inspectRuntimeSchema,
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async (args) => inspectRuntimeTool(root, args as Record<string, unknown>),
  );

  server.registerTool(
    'tap_interactive',
    {
      title: 'Tap an exact semantics identifier',
      description: 'Taps exactly one Android element by Semantics.identifier. Missing and duplicate identifiers fail; consequential identifiers require a one-use confirmation token.',
      inputSchema: tapRuntimeSchema,
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async (args) => tapRuntimeTool(args as Record<string, unknown>),
  );

  server.registerTool(
    'enter_interactive_text',
    {
      title: 'Enter text by semantics identifier',
      description: 'Clears and enters text into exactly one identified element. Entered values are redacted from results and are never logged by the tool.',
      inputSchema: enterRuntimeTextSchema,
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (args) => enterRuntimeTextTool(args as Record<string, unknown>),
  );

  server.registerTool(
    'select_interactive_option',
    {
      title: 'Select an identified option',
      description: 'Opens an exactly identified field and taps an exactly identified option. Consequential option identifiers require confirmation.',
      inputSchema: selectRuntimeOptionSchema,
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async (args) => selectRuntimeOptionTool(args as Record<string, unknown>),
  );

  server.registerTool(
    'scroll_interactive',
    {
      title: 'Scroll an identified container',
      description: 'Performs an Appium scroll gesture scoped to exactly one identified container; it never falls back to guessed screen coordinates.',
      inputSchema: scrollRuntimeSchema,
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (args) => scrollRuntimeTool(args as Record<string, unknown>),
  );

  server.registerTool(
    'android_back',
    {
      title: 'Navigate back in Android',
      description: 'Invokes the Android back action for the active automation session.',
      inputSchema: backRuntimeSchema,
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (args) => backRuntimeTool(args as Record<string, unknown>),
  );

  server.registerTool(
    'wait_for_interactive',
    {
      title: 'Wait for an identified element state',
      description: 'Waits up to 30 seconds for an exact semantics identifier to become present or absent.',
      inputSchema: waitRuntimeSchema,
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async (args) => waitRuntimeTool(args as Record<string, unknown>),
  );

  server.registerTool(
    'assert_interactive_state',
    {
      title: 'Assert an identified element state',
      description: 'Asserts that an exact semantics identifier is present, absent, enabled, or disabled.',
      inputSchema: assertRuntimeSchema,
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async (args) => assertRuntimeTool(args as Record<string, unknown>),
  );

  server.registerTool(
    'capture_android_screenshot',
    {
      title: 'Capture the Android session screenshot',
      description: 'Returns the current Appium session screenshot as PNG without persisting it to disk.',
      inputSchema: screenshotRuntimeSchema,
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async (args) => screenshotRuntimeTool(args as Record<string, unknown>),
  );

  server.registerTool(
    'end_android_session',
    {
      title: 'End an Android automation session',
      description: 'Closes the Appium session and discards its confirmation tokens.',
      inputSchema: endAndroidSessionSchema,
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (args) => endAndroidSessionTool(args as Record<string, unknown>),
  );

  return server;
}

/** Main entry: connect the server to stdio. */
export async function main(): Promise<void> {
  let root: string;
  try {
    root = resolveProjectRoot();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`flutter-config-manager-mcp: ${message}\n`);
    process.exit(1);
  }

  const name = readProjectName(root);
  process.stderr.write(
    `flutter-config-manager-mcp: serving project "${name ?? pathBasename(root)}" at ${root}\n`,
  );

  const server = createServer(root);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function pathBasename(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}

// Allow running directly (node out/index.js) or as a bin.
const isMain =
  process.argv[1] &&
  process.argv[1].replace(/\\/g, '/').endsWith('mcp-server/out/index.js');

if (isMain) {
  main().catch((err) => {
    process.stderr.write(`flutter-config-manager-mcp: fatal ${err}\n`);
    process.exit(1);
  });
}

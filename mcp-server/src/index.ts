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

const SERVER_NAME = 'flutter-config-manager';
const SERVER_VERSION = '1.0.0';

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

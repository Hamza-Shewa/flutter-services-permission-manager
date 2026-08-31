#!/usr/bin/env node
/**
 * Smoke test for the Flutter Config Manager MCP server.
 *
 * Connects an in-memory MCP client to the compiled server and exercises every
 * tool against the small fixture Flutter project, verifying the extension's
 * pure modules are reused correctly (permission add/remove, translation
 * discovery, locale creation). All flows exercised here are fully local — no
 * translation network calls.
 *
 * Run from the repo root:   node mcp-server/smoke-test.mjs
 */

import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

const here = dirname(fileURLToPath(import.meta.url)); // .../mcp-server
const repoRoot = resolve(here, '..');
const fixture = join(here, 'test-fixture');

// Import the compiled server factory (relative to this file).
const { createServer } = await import('./out/index.js');

const manifestPath = join(fixture, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
const plistPath = join(fixture, 'ios', 'Runner', 'Info.plist');
const frPath = join(fixture, 'lib', 'l10n', 'app_fr.arb');

// Deterministic reset: remove anything the tools may have added so the test is
// idempotent regardless of prior state (no snapshotting of possibly-dirty files).
function resetFixture() {
  const manifest = fs.readFileSync(manifestPath, 'utf8');
  const cleanManifest = manifest
    .split('\n')
    .filter((l) => !l.includes('android.permission.RECORD_AUDIO'))
    .join('\n');
  fs.writeFileSync(manifestPath, cleanManifest, 'utf8');

  const plist = fs.readFileSync(plistPath, 'utf8');
  const cleanPlist = plist
    .replace(/[\t ]*<key>NSMicrophoneUsageDescription<\/key>\n[\t ]*<string>[^<]*<\/string>\n?/g, '')
    .replace(/\n{3,}/g, '\n\n');
  fs.writeFileSync(plistPath, cleanPlist, 'utf8');

  if (fs.existsSync(frPath)) {
    fs.rmSync(frPath);
  }
}

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  \u2714 ${name}`);
  } catch (err) {
    failures++;
    console.error(`  \u2718 ${name}\n      ${err.message}`);
  }
}

resetFixture();

const server = createServer(fixture);
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
const client = new Client({ name: 'smoke-client', version: '1.0.0' });

await server.server.connect(serverTransport);
await client.connect(clientTransport);

const tools = await client.listTools();
console.log(`\nRegistered ${tools.tools.length} tools:`);
for (const t of tools.tools) {
  console.log(`  - ${t.name}`);
}

// ---- get_project_info ------------------------------------------------------
const infoRes = await client.callTool({ name: 'get_project_info', arguments: {} });
const info = JSON.parse(infoRes.content[0].text);
check('get_project_info returns project name', () => {
  assert.strictEqual(info.projectName, 'mcp_test_app');
  assert.strictEqual(info.isFlutter, true);
  const kinds = info.files.map((f) => f.kind);
  assert.ok(kinds.includes('ANDROID_MANIFEST'), 'android manifest discovered');
  assert.ok(kinds.includes('IOS_PLIST'), 'ios plist discovered');
});

// ---- list_permissions ------------------------------------------------------
const listRes = await client.callTool({ name: 'list_permissions', arguments: {} });
const perms = JSON.parse(listRes.content[0].text);
check('list_permissions shows android + ios', () => {
  assert.ok(perms.android, 'android present');
  assert.ok(perms.ios, 'ios present');
  const androidNames = perms.android.permissions.map((p) => p.name);
  assert.ok(androidNames.includes('android.permission.CAMERA'));
  assert.ok(androidNames.includes('android.permission.INTERNET'));
  const iosNames = perms.ios.permissions.map((p) => p.permission);
  assert.ok(iosNames.includes('NSCameraUsageDescription'));
});

// ---- add_permission (android) ----------------------------------------------
const addRes = await client.callTool({
  name: 'add_permission',
  arguments: { platform: 'android', name: 'RECORD_AUDIO' },
});
const add = JSON.parse(addRes.content[0].text);
check('add_permission (android) writes manifest', () => {
  assert.strictEqual(add.ok, true);
  const content = fs.readFileSync(manifestPath, 'utf8');
  assert.ok(content.includes('android.permission.RECORD_AUDIO'));
});

// ---- add_permission (ios) ---------------------------------------------------
const addIosRes = await client.callTool({
  name: 'add_permission',
  arguments: { platform: 'ios', name: 'NSMicrophoneUsageDescription', value: 'Needs mic.' },
});
const addIos = JSON.parse(addIosRes.content[0].text);
check('add_permission (ios) writes plist', () => {
  assert.strictEqual(addIos.ok, true);
  const content = fs.readFileSync(plistPath, 'utf8');
  assert.ok(content.includes('NSMicrophoneUsageDescription'));
  assert.ok(content.includes('Needs mic.'));
});

// ---- remove_permission (android) -------------------------------------------
const rmRes = await client.callTool({
  name: 'remove_permission',
  arguments: { platform: 'android', name: 'android.permission.RECORD_AUDIO' },
});
const rm = JSON.parse(rmRes.content[0].text);
check('remove_permission (android) removes from manifest', () => {
  assert.strictEqual(rm.ok, true);
  const content = fs.readFileSync(manifestPath, 'utf8');
  assert.ok(!content.includes('android.permission.RECORD_AUDIO'));
});

// ---- list_translations ------------------------------------------------------
const transRes = await client.callTool({ name: 'list_translations', arguments: {} });
const trans = JSON.parse(transRes.content[0].text);
check('list_translations discovers en + ar', () => {
  assert.strictEqual(trans.count, 2);
  const locales = trans.translations.map((t) => t.locale).sort();
  assert.deepStrictEqual(locales, ['ar', 'en']);
  const en = trans.translations.find((t) => t.locale === 'en');
  assert.ok(en.nestedKeys >= 2, 'nested keys counted');
});

// ---- add_translation_locale ------------------------------------------------
const addLocRes = await client.callTool({
  name: 'add_translation_locale',
  arguments: { locale: 'fr', referenceLocale: 'en' },
});
const addLoc = JSON.parse(addLocRes.content[0].text);
check('add_translation_locale creates fr file', () => {
  assert.strictEqual(addLoc.ok, true);
  assert.ok(fs.existsSync(join(fixture, 'lib', 'l10n', 'app_fr.arb')));
  const fr = JSON.parse(fs.readFileSync(join(fixture, 'lib', 'l10n', 'app_fr.arb'), 'utf8'));
  assert.strictEqual(fr['@@locale'], 'fr');
  assert.strictEqual(fr.appTitle, '');
});

await client.close();
await server.close();

resetFixture();

console.log(`\n${failures === 0 ? 'ALL SMOKE TESTS PASSED' : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);

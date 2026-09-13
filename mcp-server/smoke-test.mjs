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
import http from 'node:http';

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
const semanticsPath = join(fixture, 'lib', 'semantics_screen.dart');
const semanticsOriginal = `class LoginScreen {
  Object build() {
    return ElevatedButton(
      onPressed: () {},
      child: Text(strings.submitLabel),
    );
  }
}
`;

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
  fs.writeFileSync(semanticsPath, semanticsOriginal, 'utf8');
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

// ---- list_services --------------------------------------------------------
const servicesRes = await client.callTool({ name: 'list_services', arguments: {} });
const services = JSON.parse(servicesRes.content[0].text);
check('list_services exposes current runtime and manual setup metadata', () => {
  const oneSignal = services.find((service) => service.id === 'onesignal');
  const twitter = services.find((service) => service.id === 'twitter');
  assert.ok(oneSignal.dartConstants.some((constant) => constant.name === 'oneSignalAppId'));
  assert.ok(oneSignal.setupNotes.length > 0);
  assert.ok(twitter.fields.some((field) => field.id === 'callbackScheme'));
  assert.ok(!twitter.fields.some((field) => field.id === 'consumerSecret'));
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

// ---- semantics scan / guarded fix -----------------------------------------
const scanInteractiveRes = await client.callTool({ name: 'scan_interactives', arguments: {} });
const interactiveScan = JSON.parse(scanInteractiveRes.content[0].text);
const elevated = interactiveScan.groups
  .flatMap((group) => group.findings)
  .find((finding) => finding.widgetType === 'ElevatedButton');
check('scan_interactives returns exact source findings', () => {
  assert.ok(elevated);
  assert.strictEqual(elevated.source.path, 'lib/semantics_screen.dart');
  assert.strictEqual(elevated.automation, 'missing');
});

const previewFixRes = await client.callTool({
  name: 'preview_semantics_fixes',
  arguments: { requests: [{ occurrenceId: elevated.occurrenceId, identifier: 'auth.login.submit' }] },
});
const fixPreview = JSON.parse(previewFixRes.content[0].text);
check('preview_semantics_fixes does not mutate source', () => {
  assert.ok(fixPreview.previewId);
  assert.strictEqual(fs.readFileSync(semanticsPath, 'utf8'), semanticsOriginal);
});

const applyFixRes = await client.callTool({
  name: 'apply_semantics_fixes',
  arguments: { previewId: fixPreview.previewId },
});
const fixResult = JSON.parse(applyFixRes.content[0].text);
check('apply_semantics_fixes applies the reviewed preview', () => {
  assert.strictEqual(fixResult.ok, true);
  assert.ok(fs.readFileSync(semanticsPath, 'utf8').includes("Semantics(identifier: 'auth.login.submit'"));
});

// ---- Android runtime adapter (mock Appium server) -------------------------
const appiumRequests = [];
const mockAppium = http.createServer((request, response) => {
  const chunks = [];
  request.on('data', (chunk) => chunks.push(chunk));
  request.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8');
    appiumRequests.push({ method: request.method, url: request.url, body });
    response.setHeader('content-type', 'application/json');
    if (request.method === 'POST' && request.url === '/session') {
      response.end(JSON.stringify({ value: { sessionId: 'mock-appium-session', capabilities: {} } }));
    } else if (request.method === 'GET' && request.url === '/session/mock-appium-session/source') {
      response.end(JSON.stringify({ value: '<hierarchy><node resource-id="auth.login.submit" enabled="true" clickable="true"/><node resource-id="auth.login.email" enabled="true" clickable="true"/></hierarchy>' }));
    } else if (request.method === 'POST' && request.url === '/session/mock-appium-session/elements') {
      const parsed = JSON.parse(body);
      const id = parsed.value.includes('auth.login.email') ? 'email-element' : 'submit-element';
      response.end(JSON.stringify({ value: [{ 'element-6066-11e4-a52e-4f735466cecf': id }] }));
    } else {
      response.end(JSON.stringify({ value: null }));
    }
  });
});
await new Promise((resolve) => mockAppium.listen(0, '127.0.0.1', resolve));
const address = mockAppium.address();
const mockAppiumUrl = `http://127.0.0.1:${address.port}`;

const startSessionRes = await client.callTool({
  name: 'start_android_session',
  arguments: { appiumUrl: mockAppiumUrl, appPackage: 'com.example.app' },
});
const automationSession = JSON.parse(startSessionRes.content[0].text);
check('start_android_session connects to an existing Appium server', () => {
  assert.strictEqual(automationSession.ok, true);
  assert.ok(automationSession.sessionId);
});

const runtimeInspectRes = await client.callTool({
  name: 'inspect_runtime_ui',
  arguments: { sessionId: automationSession.sessionId },
});
const runtimeInspect = JSON.parse(runtimeInspectRes.content[0].text);
check('inspect_runtime_ui correlates runtime identifiers to Dart source', () => {
  assert.strictEqual(runtimeInspect.count, 2);
  const submit = runtimeInspect.nodes.find((node) => node.identifier === 'auth.login.submit');
  assert.ok(submit);
  assert.strictEqual(submit.sourceReferences[0].path, 'lib/semantics_screen.dart');
});

const guardedTapRes = await client.callTool({
  name: 'tap_interactive',
  arguments: { sessionId: automationSession.sessionId, identifier: 'auth.login.submit' },
});
const guardedTap = JSON.parse(guardedTapRes.content[0].text);
check('consequential taps require a bound confirmation token', () => {
  assert.strictEqual(guardedTap.status, 'confirmation_required');
  assert.ok(guardedTap.confirmationToken);
});

const confirmedTapRes = await client.callTool({
  name: 'tap_interactive',
  arguments: {
    sessionId: automationSession.sessionId,
    identifier: 'auth.login.submit',
    confirmationToken: guardedTap.confirmationToken,
  },
});
const confirmedTap = JSON.parse(confirmedTapRes.content[0].text);
check('confirmed tap resolves one exact identifier and clicks it', () => {
  assert.strictEqual(confirmedTap.ok, true);
  assert.ok(appiumRequests.some((entry) => entry.url.endsWith('/element/submit-element/click')));
});

const enterTextRes = await client.callTool({
  name: 'enter_interactive_text',
  arguments: { sessionId: automationSession.sessionId, identifier: 'auth.login.email', text: 'private@example.com' },
});
const enterText = JSON.parse(enterTextRes.content[0].text);
check('text-entry results are redacted', () => {
  assert.strictEqual(enterText.value, '[REDACTED]');
  assert.strictEqual(enterText.enteredCharacters, 19);
  assert.ok(!JSON.stringify(enterText).includes('private@example.com'));
});

await client.callTool({ name: 'end_android_session', arguments: { sessionId: automationSession.sessionId } });
await new Promise((resolve) => mockAppium.close(resolve));

await client.close();
await server.close();

resetFixture();

console.log(`\n${failures === 0 ? 'ALL SMOKE TESTS PASSED' : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);

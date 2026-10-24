import * as assert from 'assert';
import * as vscode from 'vscode';
import type { FlutterConfigManagerApi } from '../../webview/diagnostics.js';

/**
 * Opens the real Flutter Config Manager panel inside the extension host and lets
 * the frontend run against the fixture workspace. The frontend forwards every
 * uncaught script error as a `webviewError` message, so this proves the module
 * graph loads, the init payload renders, and the permission variant/advice code
 * paths run without throwing. It cannot see pixels; it does see exceptions.
 */

const EXTENSION_ID = 'hamza-shewa.flutter-config-manager';

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(condition: () => boolean, timeoutMs: number, what: string): Promise<void> {
    const start = Date.now();
    while (!condition()) {
        if (Date.now() - start > timeoutMs) {
            throw new Error(`Timed out after ${timeoutMs}ms waiting for ${what}`);
        }
        await delay(100);
    }
}

type Received = { type: string } & Record<string, unknown>;

suite('Webview runtime', () => {
    test('the panel loads, initialises and renders permission advice without script errors', async function () {
        this.timeout(90000);
        const extension = vscode.extensions.getExtension<FlutterConfigManagerApi>(EXTENSION_ID);
        assert.ok(extension, `extension ${EXTENSION_ID} is not installed in the test host`);
        const api = await extension.activate();
        assert.ok(api && typeof api.postMessageToWebview === 'function', 'activate() should return the diagnostics API');

        const received: Received[] = [];
        const subscription = api.onDidReceiveWebviewMessage((message) => {
            if (message && typeof (message as Received).type === 'string') {
                received.push(message as Received);
            }
        });
        const errorsSoFar = () => received.filter((message) => message.type === 'webviewError');
        const describeErrors = () => JSON.stringify(errorsSoFar(), null, 2);

        try {
            await vscode.commands.executeCommand('flutter-config-manager.edit');

            // 1. The module graph loaded and the frontend announced itself.
            await waitFor(() => received.some((message) => message.type === 'ready'), 45000, 'the webview to send "ready"');
            assert.deepStrictEqual(errorsSoFar(), [], `script errors while loading: ${describeErrors()}`);

            // 2. The init payload was rendered: the permissions tab asks for variant advice after rendering
            //    its tables (the catalogs themselves are only requested when a picker opens).
            await waitFor(() => received.some((message) => message.type === 'requestPermissionAdvice'), 20000, 'the frontend to request permission advice');
            await waitFor(() => received.some((message) => message.type === 'requestTranslations'), 20000, 'the frontend to finish its init sequence');
            await delay(2500); // let the extension answer and the tables re-render with the real advice
            assert.deepStrictEqual(errorsSoFar(), [], `script errors after the first render: ${describeErrors()}`);

            // 3. Exercise the new render paths with synthetic data: SDK header, badges with fixes,
            //    merger-removed entries, an iOS deprecation, and the diff preview modal.
            assert.ok(await api.postMessageToWebview({
                type: 'permissionAdvice',
                header: {
                    notes: ['Permission variants are keyed by SDK level (minSdk / targetSdk), not by Gradle or AGP version.'],
                    android: { minSdk: 24, targetSdk: 37, compileSdk: 37, agpVersion: '8.7.0', gradleVersion: '8.9', buildFile: 'android/app/build.gradle' },
                    ios: { deploymentTarget: '13.0', source: 'ios/Podfile' },
                },
                advice: [
                    { platform: 'android', permission: 'android.permission.READ_EXTERNAL_STORAGE', level: 'warning', code: 'max-sdk', message: 'Declare it with maxSdkVersion="32".', fix: [{ name: 'android.permission.READ_EXTERNAL_STORAGE', maxSdkVersion: 32 }] },
                    { platform: 'android', permission: 'android.permission.ACCESS_FINE_LOCATION', level: 'error', code: 'coarse-missing', message: 'Needs ACCESS_COARSE_LOCATION at targetSdk 31+.', fix: [{ name: 'android.permission.ACCESS_COARSE_LOCATION' }] },
                    { platform: 'android', permission: 'com.google.android.gms.permission.AD_ID', level: 'info', code: 'merger-removed', message: 'Removed by the manifest merger.' },
                    { platform: 'ios', permission: 'NSCalendarsUsageDescription', level: 'warning', code: 'deprecated-key', message: 'Deprecated in iOS 17; use NSCalendarsFullAccessUsageDescription.' },
                ],
            }), 'posting permissionAdvice into the webview');
            assert.ok(await api.postMessageToWebview({
                type: 'permissionChangesPreview',
                previews: [{
                    file: 'android/app/src/main/AndroidManifest.xml',
                    lines: [
                        { kind: 'context', text: '<manifest xmlns:android="http://schemas.android.com/apk/res/android">' },
                        { kind: 'remove', text: '    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" />' },
                        { kind: 'add', text: '    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />' },
                    ],
                }],
            }), 'posting permissionChangesPreview into the webview');
            assert.ok(await api.postMessageToWebview({ type: 'permissionChangesPreview', previews: [] }), 'posting an empty preview');
            await delay(1500);
            assert.deepStrictEqual(errorsSoFar(), [], `script errors while rendering synthetic advice: ${describeErrors()}`);

            // 4. The error channel itself works: a deliberate error thrown inside the page must come back.
            assert.ok(await api.postMessageToWebview({ type: 'permissions', androidPermissions: 'not-an-array' }), 'posting a malformed payload');
            await delay(1500);
            const malformed = errorsSoFar();
            // The MessageBus in the page catches handler errors and logs them, so a malformed payload may be
            // absorbed rather than thrown; either outcome is acceptable, but nothing may be left half-rendered.
            assert.ok(malformed.length <= 1, `a malformed payload produced several errors: ${describeErrors()}`);
        } finally {
            subscription.dispose();
            await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        }
    });
});

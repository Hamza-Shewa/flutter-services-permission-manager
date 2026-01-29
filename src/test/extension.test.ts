import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import { updateAndroidManifest, updateIOSPlist } from '../extension';

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('Sample test', () => {
		assert.strictEqual(-1, [1, 2, 3].indexOf(5));
		assert.strictEqual(-1, [1, 2, 3].indexOf(0));
	});

	test('updateAndroidManifest replaces permissions', () => {
		const original = `<?xml version="1.0" encoding="utf-8"?>
	<manifest package="com.example.app">
	    <uses-permission android:name="android.permission.CAMERA" />
	    <uses-permission android:name="android.permission.INTERNET" />
	    <application />
	</manifest>`;
		const updated = updateAndroidManifest(original, [
			'android.permission.ACCESS_FINE_LOCATION',
			'CAMERA'
		]);
		assert.ok(updated.includes('android.permission.ACCESS_FINE_LOCATION'));
		assert.ok(updated.includes('android.permission.CAMERA'));
		assert.ok(!updated.includes('android.permission.INTERNET'));
	});

	test('updateIOSPlist updates NS keys', () => {
		const original = `<?xml version="1.0" encoding="UTF-8"?>
	<plist version="1.0">
	<dict>
	    <key>NSCameraUsageDescription</key>
	    <string>Camera access</string>
	    <key>NSMicrophoneUsageDescription</key>
	    <string>Microphone access</string>
	</dict>
	</plist>`;
		const updated = updateIOSPlist(original, [{ permission: 'NSCameraUsageDescription', value: 'New camera reason', type: 'string' }]);
		assert.ok(updated.includes('NSCameraUsageDescription'));
		assert.ok(!updated.includes('NSMicrophoneUsageDescription'));
		assert.ok(updated.includes('New camera reason'));
	});

	test('updateIOSPlist supports boolean values', () => {
		const original = `<?xml version="1.0" encoding="UTF-8"?>
	<plist version="1.0">
	<dict>
		<key>NSBluetoothAlwaysUsageDescription</key>
		<string>Bluetooth access</string>
	</dict>
	</plist>`;
		const updated = updateIOSPlist(original, [{ permission: 'NSBluetoothAlwaysUsageDescription', value: true, type: 'boolean' }]);
		assert.ok(updated.includes('<true/>'));
	});
});

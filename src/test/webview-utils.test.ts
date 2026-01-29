import * as assert from 'assert';

const utils = require('../../src/webview-utils.js');

describe('Webview Utils', () => {
	it('filters permissions by query and category', () => {
		const permissions = [
			{ permission: 'CAMERA', description: 'Camera access', category: 'Camera', constantValue: 'android.permission.CAMERA' },
			{ permission: 'INTERNET', description: 'Network access', category: 'Network', constantValue: 'android.permission.INTERNET' }
		];
		const filtered = utils.filterPermissions(permissions, 'camera', 'Camera');
		assert.strictEqual(filtered.length, 1);
		assert.strictEqual(filtered[0].permission, 'CAMERA');
	});

	it('dedupes permissions by constant value', () => {
		const permissions = [
			{ permission: 'CAMERA', constantValue: 'android.permission.CAMERA' },
			{ permission: 'CAMERA', constantValue: 'android.permission.CAMERA' }
		];
		const deduped = utils.dedupePermissions(permissions);
		assert.strictEqual(deduped.length, 1);
	});

	it('sorts permissions by column', () => {
		const permissions = [
			{ permission: 'B', description: 'B' },
			{ permission: 'A', description: 'A' }
		];
		const sorted = utils.sortPermissions(permissions, 'permission', 'asc');
		assert.strictEqual(sorted[0].permission, 'A');
	});
});

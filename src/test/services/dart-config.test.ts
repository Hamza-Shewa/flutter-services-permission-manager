import * as assert from 'assert';
import {
    buildDartServiceConfig,
    extractDartServiceConfig,
} from '../../features/services/dart-config.service.js';
import { loadServicesConfig } from '../helpers.js';

suite('Generated Dart service config', () => {
    test('round-trips active services and their runtime constants', () => {
        const config = loadServicesConfig();
        const content = buildDartServiceConfig([
            { id: 'firebase', values: {} },
            { id: 'onesignal', values: { appId: '123e4567-e89b-12d3-a456-426614174000' } },
            { id: 'stripe', values: { publishableKey: 'pk_test_example', merchantId: 'merchant.com.example' } },
        ], config);

        assert.ok(content?.includes('// Active services: firebase, onesignal, stripe'));
        assert.ok(content?.includes("static const String stripePublishableKey = r'pk_test_example';"));
        assert.deepStrictEqual(extractDartServiceConfig(content, config), [
            { id: 'firebase', values: {} },
            { id: 'onesignal', values: { appId: '123e4567-e89b-12d3-a456-426614174000' } },
            { id: 'stripe', values: { merchantId: 'merchant.com.example', publishableKey: 'pk_test_example' } },
        ]);
    });

    test('returns no file when no configured service is selected', () => {
        assert.strictEqual(buildDartServiceConfig([], loadServicesConfig()), undefined);
    });

    test('ignores unowned Dart files', () => {
        assert.deepStrictEqual(
            extractDartServiceConfig('const stripePublishableKey = "not ours";', loadServicesConfig()),
            [],
        );
    });
});

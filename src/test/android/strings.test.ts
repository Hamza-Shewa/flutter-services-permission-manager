import * as assert from 'assert';
import {
    updateAndroidStringsWithServices,
    removeServicesFromAndroidStrings
} from '../../core/platform/android/strings.service.js';
import { loadFixture } from '../helpers.js';
import { ServiceEntry, ServiceConfig } from '../../core/types/index.js';

suite('Android Strings Service Test Suite', () => {
    let baseStrings: string;

    setup(() => {
        baseStrings = loadFixture('android/app/src/main/res/values/strings.xml');
    });

    suite('updateAndroidStringsWithServices', () => {
        const dummyServiceConfig: ServiceConfig = {
            id: 'dummy',
            name: 'Dummy',
            description: 'Dummy service',
            icon: '',
            fields: [{ id: 'apiKey', label: 'API Key' }],
            ios: { plistEntries: [] },
            android: {
                metaData: [],
                queries: [],
                applicationData: [],
                stringResources: [
                    { name: 'dummy_api_key', valueField: 'apiKey' }
                ]
            }
        };

        test('inserts new string resources from values', () => {
            const updated = updateAndroidStringsWithServices(baseStrings, [{ id: 'dummy', values: { apiKey: '12345' } }], [dummyServiceConfig]);
            assert.ok(updated.includes('<string name="dummy_api_key">12345</string>'));
        });

                test('updates existing string resources', () => {
            const withString = updateAndroidStringsWithServices(baseStrings, [{ id: 'dummy', values: { apiKey: 'old_value' } }], [dummyServiceConfig]);
            const updated = updateAndroidStringsWithServices(withString, [{ id: 'dummy', values: { apiKey: 'new_value' } }], [dummyServiceConfig]);
            assert.ok(!updated.includes('old_value'));
            assert.ok(updated.includes('<string name="dummy_api_key">new_value</string>'));
        });

        test('does not add empty string resources when field is missing', () => {
            const updated = updateAndroidStringsWithServices(baseStrings, [{ id: 'dummy', values: {} }], [dummyServiceConfig]);
            assert.ok(!updated.includes('<string name="dummy_api_key">'));
        });

            });

    suite('removeServicesFromAndroidStrings', () => {
        const dummyServiceConfig: ServiceConfig = {
            id: 'dummy',
            name: 'Dummy',
            description: 'Dummy service',
            icon: '',
            fields: [{ id: 'apiKey', label: 'API Key' }],
            ios: { plistEntries: [] },
            android: {
                metaData: [],
                queries: [],
                applicationData: [],
                stringResources: [
                    { name: 'dummy_api_key', valueField: 'apiKey' }
                ]
            }
        };

        test('removes specified service strings completely', () => {
            const withService = updateAndroidStringsWithServices(baseStrings, [{ id: 'dummy', values: { apiKey: '12345' } }], [dummyServiceConfig]);
            const removed = removeServicesFromAndroidStrings(withService, ['dummy'], [dummyServiceConfig]);
            
            assert.ok(!removed.includes('dummy_api_key'));
                        assert.ok(!removed.includes('12345'));
        });
        
        test('leaves unrelated strings intact', () => {
            const withStrings = updateAndroidStringsWithServices(baseStrings, [{ id: 'dummy', values: { apiKey: '12345' } }], [dummyServiceConfig]);            
            const removed = removeServicesFromAndroidStrings(withStrings, ['dummy'], [dummyServiceConfig]);
            
            assert.ok(!removed.includes('dummy_api_key'));
            
        });
    });
});

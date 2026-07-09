import { updateAndroidManifestWithServices } from './out/services/android/manifest.service.js';
import * as fs from 'fs';

const dummyServiceConfig = {
    id: 'dummy',
    name: 'Dummy',
    description: 'Dummy service',
    icon: '',
    fields: [{ id: 'apiKey', label: 'API Key' }],
    ios: { plistEntries: [] },
    android: {
        metaData: [
            { name: 'com.dummy.API_KEY', valueField: 'apiKey' }
        ],
        queries: [
            { tag: 'package', attributes: { 'android:name': 'com.dummy.app' } }
        ],
        applicationData: [
            { tag: 'activity', attributes: { 'android:name': 'com.dummy.Activity' } }
        ],
        mainActivityIntentFilters: [
            { tag: 'action', attributes: { 'android:name': 'android.intent.action.VIEW' } }
        ]
    }
};

const baseManifest = fs.readFileSync('src/test/fixtures/android/app/src/main/AndroidManifest.xml', 'utf8');

const updated = updateAndroidManifestWithServices(baseManifest, [{ id: 'dummy', values: { apiKey: '12345' } }], [dummyServiceConfig]);

console.log(updated);

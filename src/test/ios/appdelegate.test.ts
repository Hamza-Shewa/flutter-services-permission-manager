import * as assert from 'assert';
import {
    updateAppDelegateWithServices,
    removeServicesFromAppDelegate
} from '../../services/ios/appdelegate.service.js';
import { ServiceConfig } from '../../types/index.js';

suite('iOS AppDelegate Service Test Suite', () => {
    const dummyServiceConfig: ServiceConfig = {
        id: 'dummy',
        name: 'Dummy',
        description: 'Dummy Service',
        icon: 'dummy.png',
        fields: [],
        ios: {
            plistEntries: [],
            urlSchemes: [],
            appDelegate: {
                import: 'DummySDK',
                code: 'DummySDK.provideAPIKey("{apiKey}")'
            }
        },
        android: { metaData: [], queries: [], applicationData: [] }
    };

    const emptyAppDelegate = `import UIKit
import Flutter

@UIApplicationMain
@objc class AppDelegate: FlutterAppDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    GeneratedPluginRegistrant.register(with: self)
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
}`;

    suite('updateAppDelegateWithServices', () => {
        test('injects import and code correctly', () => {
            const updated = updateAppDelegateWithServices(
                emptyAppDelegate,
                [{ id: 'dummy', values: { apiKey: '12345' } }],
                [dummyServiceConfig]
            );
            assert.ok(updated.includes('import DummySDK'));
            assert.ok(updated.includes('DummySDK.provideAPIKey("12345")'));
            assert.ok(updated.indexOf('import DummySDK') < updated.indexOf('DummySDK.provideAPIKey("12345")'));
        });

        test('updates existing code if placeholder changes', () => {
            const withDummy = updateAppDelegateWithServices(
                emptyAppDelegate,
                [{ id: 'dummy', values: { apiKey: 'old' } }],
                [dummyServiceConfig]
            );
            const updated = updateAppDelegateWithServices(
                withDummy,
                [{ id: 'dummy', values: { apiKey: 'new' } }],
                [dummyServiceConfig]
            );
            assert.ok(updated.includes('DummySDK.provideAPIKey("new")'));
            assert.ok(!updated.includes('DummySDK.provideAPIKey("old")'));
        });

        test('injects applinks block', () => {
            const updated = updateAppDelegateWithServices(
                emptyAppDelegate,
                [{ id: 'applinks', values: { domains: 'example.com' } }],
                []
            );
            assert.ok(updated.includes('import app_links'));
            assert.ok(updated.includes('AppLinks.shared.getLink'));
            assert.ok(updated.includes('GeneratedPluginRegistrant.register(with: self)'));
            // Ensure applinks code is inserted after register
            assert.ok(updated.indexOf('GeneratedPluginRegistrant.register') < updated.indexOf('AppLinks.shared.getLink'));
        });

        test('does not duplicate applinks block', () => {
            const withApplinks = updateAppDelegateWithServices(
                emptyAppDelegate,
                [{ id: 'applinks', values: { domains: 'old.com' } }],
                []
            );
            const updated = updateAppDelegateWithServices(
                withApplinks,
                [{ id: 'applinks', values: { domains: 'new.com' } }],
                []
            );
            // It should only have one import app_links
            const matches = updated.match(/import app_links/g);
            assert.strictEqual(matches?.length, 1);
        });

        test('preserves import home_widget if inside applinks block', () => {
            const appDelegateWithHomeWidget = `import UIKit
import Flutter

// start applinks configuration
import home_widget
import app_links
// end applinks configuration

@UIApplicationMain
@objc class AppDelegate: FlutterAppDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    GeneratedPluginRegistrant.register(with: self)
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
}`;
            const updated = updateAppDelegateWithServices(
                appDelegateWithHomeWidget,
                [{ id: 'applinks', values: { domains: 'new.com' } }],
                []
            );
            assert.ok(updated.includes('import home_widget'));
            assert.ok(updated.includes('import app_links'));
        });
    });

    suite('removeServicesFromAppDelegate', () => {
        test('removes injected code and imports', () => {
            const withDummy = updateAppDelegateWithServices(
                emptyAppDelegate,
                [{ id: 'dummy', values: { apiKey: '12345' } }],
                [dummyServiceConfig]
            );
            const removed = removeServicesFromAppDelegate(
                withDummy,
                ['dummy'],
                [dummyServiceConfig]
            );
            assert.ok(!removed.includes('import DummySDK'));
            assert.ok(!removed.includes('DummySDK.provideAPIKey'));
        });

        test('removes applinks block entirely', () => {
            const withApplinks = updateAppDelegateWithServices(
                emptyAppDelegate,
                [{ id: 'applinks', values: { domains: 'example.com' } }],
                []
            );
            const removed = removeServicesFromAppDelegate(
                withApplinks,
                ['applinks'],
                []
            );
            assert.ok(!removed.includes('import app_links'));
            assert.ok(!removed.includes('AppLinks.shared.getLink'));
        });

        test('preserves import home_widget when removing applinks block', () => {
            const appDelegateWithHomeWidget = `import UIKit
import Flutter

// start applinks configuration
import home_widget
import app_links
// end applinks configuration

@UIApplicationMain
@objc class AppDelegate: FlutterAppDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    GeneratedPluginRegistrant.register(with: self)
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
}`;
            const removed = removeServicesFromAppDelegate(
                appDelegateWithHomeWidget,
                ['applinks'],
                []
            );
            assert.ok(removed.includes('import home_widget'));
            assert.ok(!removed.includes('import app_links'));
        });
    });
});

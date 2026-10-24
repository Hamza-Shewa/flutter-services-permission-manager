import * as assert from 'assert';
import { updateIOSPlist } from '../../core/platform/ios/plist.service.js';
import { parsePlistTopLevel } from '../../core/shared/plist-entries.js';
import {
    buildGccPreprocessorBlock,
    extractPodfileMacroNames,
    migrateLegacyPodfileMacros,
    nonPermissionDefinitions,
    replacementForLegacyMacro,
} from '../../core/platform/ios/podfile-macros.js';

const PLIST = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '\t<key>CFBundleName</key>',
    '\t<string>app</string>',
    '\t<key>NSPrincipalClass</key>',
    '\t<string>NSApplication</string>',
    '\t<key>NSHumanReadableCopyright</key>',
    '\t<string>Copyright (c) 2026</string>',
    '\t<key>NSCameraUsageDescription</key>',
    '\t<string>Scan receipts</string>',
    '\t<key>UISupportedInterfaceOrientations</key>',
    '\t<array>',
    '\t\t<string>UIInterfaceOrientationPortrait</string>',
    '\t</array>',
    '</dict>',
    '</plist>',
    '',
].join('\n');

function wellFormed(xml: string): boolean {
    const stack: string[] = [];
    const tagRe = /<(\/?)([A-Za-z]+)\b[^>]*?(\/?)>/g;
    let match: RegExpExecArray | null;
    const body = xml.replace(/<\?xml[^>]*\?>/, '').replace(/<!DOCTYPE[^>]*>/, '').replace(/<!--[\s\S]*?-->/g, '');
    while ((match = tagRe.exec(body)) !== null) {
        if (match[3] === '/') {
            continue;
        }
        if (match[1] === '/') {
            if (stack.pop() !== match[2]) {
                return false;
            }
        } else {
            stack.push(match[2]);
        }
    }
    return stack.length === 0;
}

suite('iOS plist permission writer (arrays, dictionaries, unknown keys)', () => {
    test('writes array and dictionary values and reads them back', () => {
        const updated = updateIOSPlist(PLIST, [
            { permission: 'NSCameraUsageDescription', value: 'Scan receipts', type: 'string' },
            { permission: 'NSLocalNetworkUsageDescription', value: 'Find printers on your network', type: 'string' },
            { permission: 'NSBonjourServices', value: ['_ipp._tcp', '_printer._tcp'], type: 'array' },
            { permission: 'NSLocationTemporaryUsageDescriptionDictionary', value: { Delivery: 'Track the courier' }, type: 'dictionary' },
        ]);
        assert.ok(wellFormed(updated));
        const parsed = parsePlistTopLevel(updated)!;
        const byKey = new Map(parsed.entries.map(entry => [entry.key, entry]));
        assert.deepStrictEqual(byKey.get('NSBonjourServices')?.value, ['_ipp._tcp', '_printer._tcp']);
        assert.deepStrictEqual(byKey.get('NSLocationTemporaryUsageDescriptionDictionary')?.value, { Delivery: 'Track the courier' });
        assert.strictEqual(byKey.get('NSBonjourServices')?.type, 'array');
        assert.ok(updated.includes('\t<array>\n\t\t<string>_ipp._tcp</string>\n\t\t<string>_printer._tcp</string>\n\t</array>'));
    });

    test('round trip: writing back what was read changes nothing', () => {
        const once = updateIOSPlist(PLIST, [
            { permission: 'NSCameraUsageDescription', value: 'Scan receipts', type: 'string' },
            { permission: 'NSBonjourServices', value: ['_ipp._tcp'], type: 'array' },
            { permission: 'NSIdentityUsageDescriptionDictionary', value: { 'com.example.id': 'Verify age' }, type: 'dictionary' },
        ]);
        const entries = parsePlistTopLevel(once)!.entries
            .filter(entry => entry.key.startsWith('NS') && entry.key !== 'NSPrincipalClass' && entry.key !== 'NSHumanReadableCopyright')
            .map(entry => ({ permission: entry.key, value: entry.value, type: entry.type }));
        assert.strictEqual(updateIOSPlist(once, entries), once);
    });

    test('updates values in place without moving keys', () => {
        const updated = updateIOSPlist(PLIST, [{ permission: 'NSCameraUsageDescription', value: 'Scan documents', type: 'string' }]);
        assert.strictEqual(updated, PLIST.replace('Scan receipts', 'Scan documents'));
    });

    test('never removes keys that are not permission keys', () => {
        const updated = updateIOSPlist(PLIST, [], new Set(['NSCameraUsageDescription', 'NSBonjourServices']));
        assert.ok(updated.includes('<key>NSPrincipalClass</key>'));
        assert.ok(updated.includes('<key>NSHumanReadableCopyright</key>'));
        assert.ok(updated.includes('<key>UISupportedInterfaceOrientations</key>'));
        assert.ok(!updated.includes('NSCameraUsageDescription'));
        assert.ok(wellFormed(updated));
    });

    test('removes an unknown usage description only when it is left out', () => {
        const withUnknown = PLIST.replace('</dict>', '\t<key>NSFutureThingUsageDescription</key>\n\t<string>x</string>\n</dict>');
        const kept = updateIOSPlist(withUnknown, [
            { permission: 'NSCameraUsageDescription', value: 'Scan receipts' },
            { permission: 'NSFutureThingUsageDescription' },
        ]);
        assert.strictEqual(kept, withUnknown);
        const removed = updateIOSPlist(withUnknown, [{ permission: 'NSCameraUsageDescription', value: 'Scan receipts' }]);
        assert.ok(!removed.includes('NSFutureThingUsageDescription'));
    });

    test('keeps nested values it cannot edit when the entry has no value', () => {
        const nested = PLIST.replace(
            '</dict>\n</plist>',
            '\t<key>NSSensorKitUsageDetail</key>\n\t<dict>\n\t\t<key>SRSensorUsageKeyboardMetrics</key>\n\t\t<dict>\n\t\t\t<key>Description</key>\n\t\t\t<string>Typing speed</string>\n\t\t</dict>\n\t</dict>\n</dict>\n</plist>',
        );
        const updated = updateIOSPlist(nested, [
            { permission: 'NSCameraUsageDescription', value: 'Scan receipts' },
            { permission: 'NSSensorKitUsageDetail', type: 'dictionary' },
        ]);
        assert.strictEqual(updated, nested);
    });

    test('escapes bare ampersands but keeps existing entities', () => {
        const updated = updateIOSPlist(PLIST, [{ permission: 'NSCameraUsageDescription', value: 'Photos & video &amp; more' }]);
        assert.ok(updated.includes('<string>Photos &amp; video &amp; more</string>'));
    });
});

suite('permission_handler Podfile macros', () => {
    const LEGACY = [
        "post_install do |installer|",
        "  installer.pods_project.targets.each do |target|",
        "    target.build_configurations.each do |config|",
        "      config.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] ||= [",
        "        '$(inherited)',",
        "        'COCOAPODS=1',",
        "        'PERMISSION_CALENDARS=1',",
        "        'PERMISSION_CAMERA=1',",
        "      ]",
        "    end",
        "  end",
        "end",
    ].join('\n');

    test('PERMISSION_CALENDARS maps to the macro matching the calendar key', () => {
        assert.deepStrictEqual(replacementForLegacyMacro('PERMISSION_CALENDARS', ['NSCalendarsFullAccessUsageDescription']), ['PERMISSION_EVENTS_FULL_ACCESS']);
        assert.deepStrictEqual(replacementForLegacyMacro('PERMISSION_CALENDARS', ['NSCalendarsWriteOnlyAccessUsageDescription']), ['PERMISSION_EVENTS']);
        assert.deepStrictEqual(replacementForLegacyMacro('PERMISSION_CAMERA', []), []);
    });

    test('migrates an existing Podfile in place', () => {
        const migrated = migrateLegacyPodfileMacros(LEGACY, ['NSCalendarsFullAccessUsageDescription', 'NSCameraUsageDescription']);
        assert.deepStrictEqual(extractPodfileMacroNames(migrated), ['PERMISSION_EVENTS_FULL_ACCESS', 'PERMISSION_CAMERA']);
        assert.ok(migrated.includes("'COCOAPODS=1',"));
    });

    test('rebuilding the block keeps non-permission definitions and drops the legacy macro', () => {
        const start = LEGACY.indexOf("config.build_settings");
        const end = LEGACY.indexOf(']', LEGACY.indexOf("'PERMISSION_CAMERA=1'")) + 1;
        const extras = nonPermissionDefinitions(LEGACY.slice(start, end));
        assert.deepStrictEqual(extras, ['COCOAPODS=1']);
        const block = buildGccPreprocessorBlock(['PERMISSION_EVENTS_FULL_ACCESS', 'PERMISSION_CAMERA', 'PERMISSION_CAMERA'], extras);
        assert.deepStrictEqual(extractPodfileMacroNames(block), ['PERMISSION_CAMERA', 'PERMISSION_EVENTS_FULL_ACCESS']);
        assert.ok(block.includes("'COCOAPODS=1',"));
        assert.ok(!block.includes('PERMISSION_CALENDARS'));
    });
});

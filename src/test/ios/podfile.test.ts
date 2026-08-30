import * as assert from 'assert';
import * as vscode from 'vscode';
import { extractPodfileMacros, updateIOSPodfile } from '../../core/platform/ios/podfile.service.js';
import { loadFixture } from '../helpers.js';
import { IOSPermissionEntry } from '../../core/types/index.js';

suite('iOS Podfile Service Test Suite', () => {
    let basePodfile: string;

    setup(() => {
        basePodfile = loadFixture('ios/Podfile');
    });

    suite('extractPodfileMacros', () => {
        test('extracts macros correctly', () => {
            const content = `config.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] ||= [
                '$(inherited)',
                'PERMISSION_CAMERA=1',
                'PERMISSION_MICROPHONE=1'
            ]`;
            const macros = extractPodfileMacros(content);
            assert.strictEqual(macros.length, 2);
            assert.ok(macros.includes('PERMISSION_CAMERA'));
            assert.ok(macros.includes('PERMISSION_MICROPHONE'));
        });

        test('returns empty array if no macros found', () => {
            const content = `config.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] ||= [
                '$(inherited)'
            ]`;
            const macros = extractPodfileMacros(content);
            assert.strictEqual(macros.length, 0);
        });
    });

    suite('updateIOSPodfile', () => {
        
        async function runUpdate(content: string, entries: IOSPermissionEntry[]): Promise<string> {
            const doc = await vscode.workspace.openTextDocument({ content, language: 'ruby' });
            const edit = await updateIOSPodfile(doc, entries, {});
            if (!edit) {return content;}
            
            // Mock apply edit
            let result = content;
            const textEdits = edit.entries()[0][1];
            // Sort edits in reverse order so we don't mess up indices
            textEdits.sort((a, b) => b.range.start.compareTo(a.range.start));
            
            for (const textEdit of textEdits) {
                const startOff = doc.offsetAt(textEdit.range.start);
                const endOff = doc.offsetAt(textEdit.range.end);
                result = result.slice(0, startOff) + textEdit.newText + result.slice(endOff);
            }
            return result;
        }

        test('inserts new macros into existing GCC block', async () => {
            const content = `
post_install do |installer|
  installer.pods_project.targets.each do |target|
    target.build_configurations.each do |config|
      config.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] ||= [
        '$(inherited)',
        'PERMISSION_CAMERA=1'
      ]
    end
  end
end`;
            const entries: IOSPermissionEntry[] = [
                { permission: 'dummy', podfileMacro: 'PERMISSION_LOCATION' }
            ];
            const updated = await runUpdate(content, entries);
            assert.ok(updated.includes("'PERMISSION_LOCATION=1'"));
            assert.ok(!updated.includes("'PERMISSION_CAMERA=1'"));
        });

        test('injects post_install block if missing', async () => {
            const content = `platform :ios, '11.0'`;
            const entries: IOSPermissionEntry[] = [
                { permission: 'dummy', podfileMacro: 'PERMISSION_CAMERA' }
            ];
            const updated = await runUpdate(content, entries);
            assert.ok(updated.includes('post_install do |installer|'));
            assert.ok(updated.includes("'PERMISSION_CAMERA=1'"));
        });

        test('injects GCC block into existing post_install block if missing', async () => {
            const content = `
post_install do |installer|
  installer.pods_project.targets.each do |target|
    target.build_configurations.each do |config|
      config.build_settings['ENABLE_BITCODE'] = 'NO'
    end
  end
end`;
            const entries: IOSPermissionEntry[] = [
                { permission: 'dummy', podfileMacro: 'PERMISSION_CAMERA' }
            ];
            const updated = await runUpdate(content, entries);
            assert.ok(updated.includes("config.build_settings['GCC_PREPROCESSOR_DEFINITIONS']"));
            assert.ok(updated.includes("'PERMISSION_CAMERA=1'"));
            assert.ok(updated.includes("config.build_settings['ENABLE_BITCODE'] = 'NO'"));
        });

        test('handles single-quoted string literals in Ruby', async () => {
            const content = `config.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] ||= [
                '$(inherited)',
                "some_other_flag=1"
            ]`;
            const entries: IOSPermissionEntry[] = [
                { permission: 'dummy', podfileMacro: 'PERMISSION_CAMERA' }
            ];
            const updated = await runUpdate(content, entries);
            assert.ok(updated.includes("'PERMISSION_CAMERA=1'"));
        });
    });
});

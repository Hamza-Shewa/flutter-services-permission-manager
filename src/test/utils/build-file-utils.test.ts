import * as assert from 'assert';
import {
  normalizeTextValue,
  stripApiPrefix,
  replaceFirst,
  escapeRegExp,
  formatGradleValue,
  replaceGradlePropertyLine,
} from '../../services/build-file-utils.js';

suite('Build File Utils Test Suite', () => {
  suite('normalizeTextValue', () => {
    test('normalizes newlines and trims', () => {
      assert.strictEqual(normalizeTextValue(' \n line \r\n test \r  '), 'line   test');
    });
    test('handles undefined', () => {
      assert.strictEqual(normalizeTextValue(undefined), '');
    });
  });

  suite('stripApiPrefix', () => {
    test('removes API prefix case insensitively', () => {
      assert.strictEqual(stripApiPrefix('API 34'), '34');
      assert.strictEqual(stripApiPrefix('api 33'), '33');
    });
    test('does not touch non-API values', () => {
      assert.strictEqual(stripApiPrefix('34'), '34');
    });
  });

  suite('replaceFirst', () => {
    test('replaces first match of regex', () => {
      assert.strictEqual(replaceFirst('abc 123 abc', /abc/, 'xyz'), 'xyz 123 abc');
    });
    test('returns original string if no match', () => {
      assert.strictEqual(replaceFirst('abc', /xyz/, '123'), 'abc');
    });
  });

  suite('escapeRegExp', () => {
    test('escapes regex special characters', () => {
      assert.strictEqual(escapeRegExp('a.b*c+d?'), 'a\\.b\\*c\\+d\\?');
    });
  });

  suite('formatGradleValue', () => {
    test('quotes string values', () => {
      assert.strictEqual(formatGradleValue('test', true), '"test"');
    });
    test('does not quote when quote is false', () => {
      assert.strictEqual(formatGradleValue('21', false), '21');
    });
    test('escapes existing quotes', () => {
      assert.strictEqual(formatGradleValue('test"quote', true), '"test\\"quote"');
    });
  });

  suite('replaceGradlePropertyLine', () => {
    test('replaces existing property', () => {
      const content = `android {
  compileSdkVersion = 33
}`;
      const updated = replaceGradlePropertyLine(content, 'compileSdkVersion', '34', false);
      assert.strictEqual(updated, `android {
  compileSdkVersion = 34
}`);
    });
    test('replaces quoted property', () => {
      const content = `android {
  namespace "com.example.old"
}`;
      const updated = replaceGradlePropertyLine(content, 'namespace', 'com.example.new', true);
      assert.strictEqual(updated, `android {
  namespace "com.example.new"
}`);
    });
  });
});

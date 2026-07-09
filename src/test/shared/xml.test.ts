import * as assert from 'assert';
import {
    findXmlElementBounds,
    escapeXmlAttribute,
    hasXmlElement,
    findInsertionPoint,
    getLineIndent
} from '../../shared/xml.js';

suite('Shared XML Test Suite', () => {
    suite('findXmlElementBounds', () => {
        test('finds bounds of simple element', () => {
            const xml = '<root>\n  <element attr="1" />\n</root>';
            const bounds = findXmlElementBounds(xml, 'element', { name: 'attr', value: '1' });
            assert.ok(bounds);
            assert.strictEqual(xml.substring(bounds.start, bounds.end), '<element attr="1" />');
        });

        test('finds bounds with attributes matching', () => {
            const xml = '<root>\n  <element attr="1" />\n  <element attr="2" />\n</root>';
            const bounds = findXmlElementBounds(xml, 'element', { name: 'attr', value: '2' });
            assert.ok(bounds);
            assert.strictEqual(xml.substring(bounds.start, bounds.end), '<element attr="2" />');
        });

        test('returns null if not found', () => {
            const xml = '<root></root>';
            const bounds = findXmlElementBounds(xml, 'element', { name: 'attr', value: '1' });
            assert.strictEqual(bounds, null);
        });

        test('handles self-closing vs separate closing tags', () => {
            const xml = '<root><element attr="1">Text</element></root>';
            const bounds = findXmlElementBounds(xml, 'element', { name: 'attr', value: '1' });
            assert.ok(bounds);
            assert.strictEqual(xml.substring(bounds.start, bounds.end), '<element attr="1">Text</element>');
        });
    });

    suite('escapeXmlAttribute', () => {
        test('escapes special characters', () => {
            assert.strictEqual(escapeXmlAttribute('a&b<c>d"e\'f'), 'a&amp;b&lt;c&gt;d&quot;e&apos;f');
        });

        test('does not double escape ampersands', () => {
            assert.strictEqual(escapeXmlAttribute('a&amp;b'), 'a&amp;b');
        });
    });

    suite('hasXmlElement', () => {
        test('returns true when element exists', () => {
            const xml = '<root><element/></root>';
            assert.strictEqual(hasXmlElement(xml, 'element'), true);
        });

        test('returns true with matching attributes', () => {
            const xml = '<root><element name="foo"/></root>';
            assert.strictEqual(hasXmlElement(xml, 'element', { name: 'name', value: 'foo' }), true);
        });

        test('returns false when attribute mismatch', () => {
            const xml = '<root><element name="bar"/></root>';
            assert.strictEqual(hasXmlElement(xml, 'element', { name: 'name', value: 'foo' }), false);
        });
    });

    suite('findInsertionPoint', () => {
        test('finds insertion point before end tag', () => {
            const xml = '<root>\n  <child/>\n</root>';
            const pos = findInsertionPoint(xml, '</root>');
            assert.strictEqual(pos, 18);
        });
    });

    suite('getLineIndent', () => {
        test('returns whitespace before position', () => {
            const str = 'line1\n  line2\n\tline3';
            assert.strictEqual(getLineIndent(str, 10), '  ');
            assert.strictEqual(getLineIndent(str, 15), '\t');
        });
    });
});

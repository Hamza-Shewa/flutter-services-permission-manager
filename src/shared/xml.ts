/**
 * XML manipulation utilities
 * Safer alternatives to regex-based XML parsing
 */

export interface XmlAttribute {
    name: string;
    value: string;
}

export interface XmlElementBounds {
    start: number;
    end: number;
    isSelfClosing: boolean;
}

/**
 * Escapes special characters for XML attribute values
 */
export function escapeXmlAttribute(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

/**
 * Builds an XML element string with attributes
 */
export function buildXmlElement(
    tagName: string,
    attributes: XmlAttribute[],
    options: { selfClosing?: boolean; indent?: string } = {}
): string {
    const { selfClosing = true, indent = '    ' } = options;
    const attrStr = attributes
        .map(attr => `${attr.name}="${escapeXmlAttribute(attr.value)}"`)
        .join('\n' + indent + '    ');

    if (selfClosing) {
        return `${indent}<${tagName}\n${indent}    ${attrStr} />`;
    }
    return `${indent}<${tagName}\n${indent}    ${attrStr}>`;
}

/**
 * Finds the bounds of an XML element by tag name and attribute match
 */
export function findXmlElementBounds(
    content: string,
    tagName: string,
    attributeMatch: { name: string; value: string }
): XmlElementBounds | null {
    // Build pattern to find the attribute
    const attrPattern = `${attributeMatch.name}\\s*=\\s*["']${escapeRegex(attributeMatch.value)}["']`;
    const attrRegex = new RegExp(attrPattern, 'g');

    let match: RegExpExecArray | null;
    while ((match = attrRegex.exec(content)) !== null) {
        const attrPos = match.index;

        // Find the opening tag start by searching backwards for <tagName
        let tagStart = -1;
        for (let i = attrPos; i >= 0; i--) {
            if (content[i] === '<') {
                const afterBracket = content.slice(i + 1, i + 1 + tagName.length + 1);
                if (afterBracket.startsWith(tagName) && /[\s>\/]/.test(afterBracket[tagName.length] || '')) {
                    tagStart = i;
                    break;
                }
            }
        }

        if (tagStart === -1) {
            continue;
        }

        // Find the end of this element
        const afterTagStart = content.slice(tagStart);
        const selfCloseMatch = afterTagStart.match(new RegExp(`^<${tagName}[^>]*/>`));
        
        if (selfCloseMatch) {
            return {
                start: tagStart,
                end: tagStart + selfCloseMatch[0].length,
                isSelfClosing: true
            };
        }

        // Find matching closing tag with depth tracking
        const closingTag = `</${tagName}>`;
        const openingTagPattern = new RegExp(`<${tagName}(?:\\s|>)`, 'g');
        
        let depth = 1;
        let searchPos = tagStart + tagName.length + 1;
        
        while (depth > 0 && searchPos < content.length) {
            const nextClose = content.indexOf(closingTag, searchPos);
            if (nextClose === -1) {
                break;
            }

            // Count opening tags between searchPos and nextClose
            openingTagPattern.lastIndex = searchPos;
            let openMatch: RegExpExecArray | null;
            while ((openMatch = openingTagPattern.exec(content)) !== null && openMatch.index < nextClose) {
                // Check if it's not self-closing
                const tagEnd = content.indexOf('>', openMatch.index);
                if (tagEnd !== -1 && content[tagEnd - 1] !== '/') {
                    depth++;
                }
            }

            depth--;
            searchPos = nextClose + closingTag.length;
            
            if (depth === 0) {
                return {
                    start: tagStart,
                    end: searchPos,
                    isSelfClosing: false
                };
            }
        }
    }

    return null;
}

/**
 * Extracts an attribute value from an XML tag string
 */
export function extractXmlAttribute(tagContent: string, attributeName: string): string | null {
    const pattern = new RegExp(`${attributeName}\\s*=\\s*["']([^"']*)["']`);
    const match = tagContent.match(pattern);
    return match ? match[1] : null;
}

/**
 * Checks if content contains an XML element with given tag and attribute
 */
export function hasXmlElement(
    content: string,
    tagName: string,
    attribute?: { name: string; value: string }
): boolean {
    if (!attribute) {
        return content.includes(`<${tagName}`) || content.includes(`<${tagName}/>`);
    }
    
    const pattern = new RegExp(
        `<${tagName}[^>]*${attribute.name}\\s*=\\s*["']${escapeRegex(attribute.value)}["'][^>]*/?>`
    );
    return pattern.test(content);
}

/**
 * Escapes special regex characters in a string
 */
export function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Finds insertion point before closing tag
 */
export function findInsertionPoint(content: string, closingTag: string): number {
    const idx = content.lastIndexOf(closingTag);
    if (idx === -1) {
        return -1;
    }
    
    // Find start of line for proper indentation
    let lineStart = idx;
    while (lineStart > 0 && content[lineStart - 1] !== '\n') {
        lineStart--;
    }
    
    return lineStart;
}

/**
 * Gets indentation of a line at given position
 */
export function getLineIndent(content: string, position: number): string {
    let lineStart = position;
    while (lineStart > 0 && content[lineStart - 1] !== '\n') {
        lineStart--;
    }
    
    const match = content.slice(lineStart).match(/^(\s*)/);
    return match ? match[1] : '';
}

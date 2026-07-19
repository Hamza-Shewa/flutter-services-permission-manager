/**
 * XML manipulation utilities
 * Safer alternatives to regex-based XML parsing
 */
import { parseXmlSafe } from './xml-parser.js';

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
        .replace(/&(?!(?:apos|quot|amp|lt|gt);)/g, '&amp;')
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
    let currentIndex = 0;
    
    while (currentIndex < content.length) {
        const startIdx = content.indexOf(`<${tagName}`, currentIndex);
        if (startIdx === -1) {
            break;
        }

        let inQuotes = false;
        let quoteChar = '';
        let tagOpenEndIdx = -1;
        
        for (let i = startIdx + `<${tagName}`.length; i < content.length; i++) {
            const char = content[i];
            if ((char === '"' || char === "'") && content[i-1] !== '\\') {
                if (!inQuotes) {
                    inQuotes = true;
                    quoteChar = char;
                } else if (char === quoteChar) {
                    inQuotes = false;
                }
            } else if (!inQuotes && char === '>') {
                tagOpenEndIdx = i;
                break;
            }
        }

        if (tagOpenEndIdx === -1) {
            currentIndex = startIdx + 1;
            continue;
        }

        const isSelfClosing = content[tagOpenEndIdx - 1] === '/';
        let endIdx = tagOpenEndIdx + 1;

        if (!isSelfClosing) {
            // Find matching closing tag with depth tracking
            const closingTag = `</${tagName}>`;
            const openingTagPrefix = `<${tagName}`;
            
            let depth = 1;
            let searchPos = tagOpenEndIdx + 1;
            
            while (depth > 0 && searchPos < content.length) {
                const nextOpen = content.indexOf(openingTagPrefix, searchPos);
                const nextClose = content.indexOf(closingTag, searchPos);
                
                if (nextClose === -1) {
                    break; // Malformed XML
                }
                
                if (nextOpen !== -1 && nextOpen < nextClose) {
                    // Check if it's not self closing by looking for >
                    let openTagEnd = content.indexOf('>', nextOpen);
                    if (openTagEnd !== -1 && content[openTagEnd - 1] !== '/') {
                        depth++;
                    }
                    searchPos = openTagEnd + 1;
                } else {
                    depth--;
                    searchPos = nextClose + closingTag.length;
                }
            }
            endIdx = searchPos;
        }

        const tagContent = content.substring(startIdx, endIdx);
        
        // Validate with fast-xml-parser
        const parsed = parseXmlSafe(tagContent);
        
        if (parsed && parsed.length > 0) {
            const element = (parsed[0] as any);
            if (element[tagName]) {
                const attrs = element[':@'];
                if (attrs && attrs[`@_${attributeMatch.name}`] === attributeMatch.value) {
                    return {
                        start: startIdx,
                        end: endIdx,
                        isSelfClosing
                    };
                }
            }
        }

        currentIndex = endIdx;
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

import { XMLParser } from 'fast-xml-parser';

export const DEFAULT_PARSER_OPTIONS = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  allowBooleanAttributes: true,
  parseAttributeValue: false,
  preserveOrder: true,
  commentPropName: '#comment',
  cdataPropName: '#cdata',
  trimValues: false,
} as const;

export const manifestParser = new XMLParser(DEFAULT_PARSER_OPTIONS);

/** Safely parses XML; returns null on failure instead of throwing */
export function parseXmlSafe(content: string): unknown[] | null {
  try {
    return manifestParser.parse(content) as unknown[];
  } catch {
    return null;
  }
}

/**
 * Removes all XML elements matching a tag name from content.
 * Uses fast-xml-parser to safely evaluate elements, then surgically removes
 * the corresponding character ranges to preserve surrounding formatting.
 */
export function removeXmlElements(
  content: string,
  tagName: string,
  requiredAttribute?: string,
): string {
  const result = [];
  let currentIndex = 0;
  
  while (currentIndex < content.length) {
    const startIdx = content.indexOf(`<${tagName}`, currentIndex);
    if (startIdx === -1) {
      result.push(content.substring(currentIndex));
      break;
    }

    // Push everything up to the start of the tag, minus trailing spaces if we are removing the tag
    let endIdx = -1;
    // Find the end of the tag. It could be self-closing `/>` or have a closing tag `</tagName>`.
    // We must find the `>` that closes the opening tag first.
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
      // Malformed XML, just skip
      result.push(content.substring(currentIndex, startIdx + 1));
      currentIndex = startIdx + 1;
      continue;
    }

    const isSelfClosing = content[tagOpenEndIdx - 1] === '/';
    endIdx = tagOpenEndIdx + 1;

    if (!isSelfClosing) {
      // Find closing tag
      const closeTag = `</${tagName}>`;
      const closeIdx = content.indexOf(closeTag, tagOpenEndIdx + 1);
      if (closeIdx !== -1) {
        endIdx = closeIdx + closeTag.length;
      }
    }

    const tagContent = content.substring(startIdx, endIdx);
    
    // Validate with fast-xml-parser
    const parsed = parseXmlSafe(tagContent);
    let shouldRemove = false;
    
    if (parsed && parsed.length > 0) {
      const element = parsed[0] as any;
      if (element[tagName]) {
        if (!requiredAttribute) {
          shouldRemove = true;
        } else {
          const attrs = element[':@'];
          if (attrs && attrs[`@_${requiredAttribute}`] !== undefined) {
            shouldRemove = true;
          }
        }
      }
    }

    if (shouldRemove) {
      // Find leading whitespace to remove as well
      let leadingWhitespaceStart = startIdx;
      while (leadingWhitespaceStart > currentIndex && /[ \t]/.test(content[leadingWhitespaceStart - 1])) {
        leadingWhitespaceStart--;
      }
      
      // Look at the character before leading whitespace
      let charBefore = leadingWhitespaceStart > 0 ? content[leadingWhitespaceStart - 1] : '';
      
      // Look at trailing newline
      let trailingNewlineEnd = endIdx;
      if (content[trailingNewlineEnd] === '\r') {
        trailingNewlineEnd++;
      }
      if (content[trailingNewlineEnd] === '\n') {
        trailingNewlineEnd++;
      } else if (charBefore === '\n') {
          // If no trailing newline but there is a preceding newline, we can remove the preceding newline and whitespace
          // We'll just leave it to not over-delete
      }
      
      result.push(content.substring(currentIndex, leadingWhitespaceStart));
      currentIndex = trailingNewlineEnd;
    } else {
      result.push(content.substring(currentIndex, endIdx));
      currentIndex = endIdx;
    }
  }

  return result.join('');
}

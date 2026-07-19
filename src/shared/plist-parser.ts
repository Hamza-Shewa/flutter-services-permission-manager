/**
 * Plist manipulation utilities
 */

export function detectPlistIndent(plistContent: string): string {
    const lines = plistContent.split('\n');
    let tabs = 0;
    let spaces2 = 0;
    let spaces4 = 0;
    for (const line of lines) {
        if (line.match(/^\t+<key>/)) {tabs++;}
        else if (line.match(/^  <key>/)) {spaces2++;}
        else if (line.match(/^    <key>/)) {spaces4++;}
    }
    if (tabs > spaces2 && tabs > spaces4) {return '\t';}
    if (spaces4 > tabs && spaces4 > spaces2) {return '    ';}
    if (spaces2 > tabs && spaces2 > spaces4) {return '  ';}
    return '\t';
}

export class PlistDocument {
  private readonly _source: string;

  constructor(source: string) {
    this._source = source;
  }

  get source(): string { return this._source; }

  get indent(): string { return detectPlistIndent(this._source); }

  findKeyValueBounds(key: string): { start: number; end: number } | null {
    const keyPattern = `<key>${key}</key>`;
    const keyIdx = this._source.indexOf(keyPattern);
    if (keyIdx === -1) { return null; }

    let start = keyIdx;
    while (start > 0 && /[ \t]/.test(this._source[start - 1])) {
        start--;
    }

    let searchPos = keyIdx + keyPattern.length;
    const valueTagStartIdx = this._source.indexOf('<', searchPos);
    if (valueTagStartIdx === -1) { return null; }

    let end = valueTagStartIdx;
    let closeTagEndIdx = -1;
    
    const openTagCloseBracketIdx = this._source.indexOf('>', valueTagStartIdx);
    if (openTagCloseBracketIdx !== -1 && this._source[openTagCloseBracketIdx - 1] === '/') {
       closeTagEndIdx = openTagCloseBracketIdx + 1;
    } else {
        const tagNameMatch = this._source.substring(valueTagStartIdx).match(/^<([a-zA-Z0-9_-]+)[ \t>]/);
        if (!tagNameMatch) {return null;}
        const tagName = tagNameMatch[1];
        
        const closingTag = `</${tagName}>`;
        let depth = 1;
        let pos = valueTagStartIdx + `<${tagName}`.length;
        
        while (pos < this._source.length) {
            const nextOpen = this._source.indexOf(`<${tagName}`, pos);
            const nextClose = this._source.indexOf(closingTag, pos);
            
            if (nextClose === -1) {break;}
            
            if (nextOpen !== -1 && nextOpen < nextClose) {
                const openTagEnd = this._source.indexOf('>', nextOpen);
                if (openTagEnd !== -1 && this._source[openTagEnd - 1] !== '/') {
                    depth++;
                }
                pos = openTagEnd + 1;
                continue;
            }
            
            depth--;
            if (depth === 0) {
                closeTagEndIdx = nextClose + closingTag.length;
                break;
            }
            pos = nextClose + closingTag.length;
        }
    }
    
    if (closeTagEndIdx === -1) {return null;}
    
    end = closeTagEndIdx;
    
    if (this._source[end] === '\r') {end++;}
    if (this._source[end] === '\n') {end++;}

    return { start, end };
  }

  removeKey(key: string): PlistDocument {
    const bounds = this.findKeyValueBounds(key);
    if (!bounds) { return this; }
    const newSource = this._source.slice(0, bounds.start) + this._source.slice(bounds.end);
    return new PlistDocument(newSource);
  }

  insertKeyValue(key: string, value: string, type: 'string' | 'bool' | 'array'): PlistDocument {
    const dictEnd = this._source.lastIndexOf('</dict>');
    if (dictEnd === -1) { return this; }
    const i = this.indent;
    let entry: string;
    if (type === 'bool') {
      entry = `${i}<key>${key}</key>\n${i}<${value}/>\n`;
    } else if (type === 'string') {
      entry = `${i}<key>${key}</key>\n${i}<string>${value}</string>\n`;
    } else {
      entry = `${i}<key>${key}</key>\n${i}<array>\n${value}\n${i}</array>\n`;
    }
    const newSource = this._source.slice(0, dictEnd) + entry + this._source.slice(dictEnd);
    return new PlistDocument(newSource);
  }
}

/**
 * Minimal line diff (LCS) for previews. Pure.
 */

export interface DiffLine {
    kind: 'same' | 'add' | 'remove';
    text: string;
}

/** Line-by-line diff of two texts (CRLF and LF are treated alike). */
export function diffLines(before: string, after: string): DiffLine[] {
    const a = before.replace(/\r\n/g, '\n').split('\n');
    const b = after.replace(/\r\n/g, '\n').split('\n');
    const n = a.length;
    const m = b.length;
    // LCS table, bounded: manifests and plists are small.
    const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
        }
    }
    const result: DiffLine[] = [];
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
        if (a[i] === b[j]) {
            result.push({ kind: 'same', text: a[i] });
            i++;
            j++;
        } else if (table[i + 1][j] >= table[i][j + 1]) {
            result.push({ kind: 'remove', text: a[i++] });
        } else {
            result.push({ kind: 'add', text: b[j++] });
        }
    }
    while (i < n) {
        result.push({ kind: 'remove', text: a[i++] });
    }
    while (j < m) {
        result.push({ kind: 'add', text: b[j++] });
    }
    return result;
}

/** Only the changed lines with `context` unchanged lines around them ("..." marks a gap). */
export function compactDiff(lines: DiffLine[], context = 2): DiffLine[] {
    const keep = new Array<boolean>(lines.length).fill(false);
    lines.forEach((line, index) => {
        if (line.kind !== 'same') {
            for (let k = Math.max(0, index - context); k <= Math.min(lines.length - 1, index + context); k++) {
                keep[k] = true;
            }
        }
    });
    const result: DiffLine[] = [];
    let skipped = false;
    lines.forEach((line, index) => {
        if (keep[index]) {
            result.push(line);
            skipped = false;
        } else if (!skipped) {
            result.push({ kind: 'same', text: '...' });
            skipped = true;
        }
    });
    return result;
}

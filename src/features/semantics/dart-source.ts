import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { Language, Node as SyntaxNode, Parser } from "web-tree-sitter";
import type { SourceReference } from "./types.js";

/** Parsing primitives shared by the interactive scanner and the project widget index. */

export const DART_GRAMMAR_VERSION = "@lumis-sh/wasm-dart@0.26.3";
export const DART_GRAMMAR_SHA256 = "f743e6ecda0447cf330d012e9c8dc4f784d2a8874dbdec4b929b0dde87faec79";

export interface ValueSpan {
  text: string;
  startOffset: number;
  endOffset: number;
}

export interface Invocation {
  widgetType: string;
  callee: string;
  startOffset: number;
  endOffset: number;
  argumentsStart: number;
  argumentsEnd: number;
  named: Map<string, ValueSpan>;
  positional: ValueSpan[];
  node: SyntaxNode;
}

let parserInitialization: Promise<Language> | undefined;

export function sha256(value: string | Buffer): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export async function loadDartLanguage(): Promise<Language> {
  if (!parserInitialization) {
    parserInitialization = (async () => {
      const runtimePath = require.resolve("web-tree-sitter/web-tree-sitter.wasm");
      const grammarPath = require.resolve("@lumis-sh/wasm-dart/tree-sitter-dart.wasm");
      const actualHash = sha256(fs.readFileSync(grammarPath));
      if (actualHash !== DART_GRAMMAR_SHA256) {
        throw new Error(`Dart parser checksum mismatch: expected ${DART_GRAMMAR_SHA256}, got ${actualHash}`);
      }
      await Parser.init({ locateFile: () => runtimePath });
      return Language.load(grammarPath);
    })();
  }
  return parserInitialization;
}

export function normalizePath(value: string): string {
  return value.split(path.sep).join("/");
}

export function globToRegExp(glob: string): RegExp {
  let pattern = "^";
  for (let index = 0; index < glob.length; index++) {
    const char = glob[index];
    if (char === "*" && glob[index + 1] === "*") {
      pattern += ".*";
      index++;
    } else if (char === "*") {
      pattern += "[^/]*";
    } else if (char === "?") {
      pattern += "[^/]";
    } else {
      pattern += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`${pattern}$`);
}

export function isGenerated(relativePath: string): boolean {
  return /(?:\.g|\.freezed|\.gr|\.config|\.mocks)\.dart$/i.test(relativePath) ||
    relativePath.includes("/generated/") || relativePath.includes("/gen/");
}

export function collectDartFiles(root: string, excludedGlobs: string[]): { files: string[]; excluded: string[] } {
  const libRoot = path.join(root, "lib");
  const files: string[] = [];
  const excluded: string[] = [];
  const excludes = excludedGlobs.map(globToRegExp);
  if (!fs.existsSync(libRoot)) {
    return { files, excluded };
  }
  const stack = [libRoot];
  while (stack.length > 0) {
    const directory = stack.pop()!;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) {
        continue;
      }
      const absolute = path.join(directory, entry.name);
      const relative = normalizePath(path.relative(root, absolute));
      if (entry.isDirectory()) {
        if (["build", ".dart_tool", "node_modules"].includes(entry.name)) {
          excluded.push(relative);
        } else {
          stack.push(absolute);
        }
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".dart")) {
        continue;
      }
      if (isGenerated(relative) || excludes.some((regex) => regex.test(relative))) {
        excluded.push(relative);
      } else {
        files.push(absolute);
      }
    }
  }
  return { files: files.sort(), excluded: excluded.sort() };
}

export function getWidgetType(callee: string): string | undefined {
  const segments = callee.split(".").filter(Boolean);
  return segments.find((segment) => /^[A-Z]/.test(segment));
}

export function invocationFromArguments(node: SyntaxNode, source: string): Invocation | undefined {
  const prefixStart = Math.max(0, node.startIndex - 500);
  const prefix = source.slice(prefixStart, node.startIndex);
  const match = /(?:const\s+|new\s+)?([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)\s*(?:<[^<>\n]*>)?\s*$/.exec(prefix);
  if (!match) {
    return undefined;
  }
  const callee = match[1].replace(/\s+/g, "");
  const widgetType = getWidgetType(callee);
  if (!widgetType) {
    return undefined;
  }
  const leading = match[0].search(/\S/);
  const startOffset = prefixStart + match.index + Math.max(0, leading);
  const named = new Map<string, ValueSpan>();
  const positional: ValueSpan[] = [];
  for (const child of node.namedChildren) {
    if (child.type === "named_argument") {
      const label = child.namedChildren.find((candidate) => candidate.type === "label");
      const name = label?.namedChildren.find((candidate) => candidate.type === "identifier")?.text;
      const valueNodes = child.namedChildren.filter((candidate) => candidate !== label);
      const firstValue = valueNodes[0];
      const lastValue = valueNodes[valueNodes.length - 1];
      if (name && firstValue && lastValue) {
        named.set(name, {
          text: source.slice(firstValue.startIndex, lastValue.endIndex).trim(),
          startOffset: firstValue.startIndex,
          endOffset: lastValue.endIndex,
        });
      }
    } else if (child.type === "argument") {
      positional.push({ text: child.text.trim(), startOffset: child.startIndex, endOffset: child.endIndex });
    }
  }
  return {
    widgetType,
    callee,
    startOffset,
    endOffset: node.endIndex,
    argumentsStart: node.startIndex,
    argumentsEnd: node.endIndex,
    named,
    positional,
    node,
  };
}

export function offsetPosition(source: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lastBreak = -1;
  for (let index = 0; index < offset; index++) {
    if (source.charCodeAt(index) === 10) {
      line++;
      lastBreak = index;
    }
  }
  return { line, column: offset - lastBreak };
}

export function reference(relativePath: string, source: string, hash: string, startOffset: number, endOffset: number): SourceReference {
  const start = offsetPosition(source, startOffset);
  const end = offsetPosition(source, endOffset);
  return {
    path: relativePath,
    line: start.line,
    column: start.column,
    endLine: end.line,
    endColumn: end.column,
    startOffset,
    endOffset,
    sourceHash: hash,
  };
}

export function stringValue(expression: string | undefined): string | undefined {
  if (!expression) {
    return undefined;
  }
  const match = /^(?:r)?(['"])([\s\S]*)\1$/.exec(expression.trim());
  return match && !match[2].includes("$") ? match[2] : undefined;
}

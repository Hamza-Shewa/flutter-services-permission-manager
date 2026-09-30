export function normalizeTextValue(value: string | undefined): string {
  return String(value ?? "").replace(/\r\n|\r|\n/g, " ").trim();
}

export function stripApiPrefix(value: string | undefined): string {
  return normalizeTextValue(value).replace(/^API\s+/i, "");
}

export function replaceFirst(content: string, regex: RegExp, replacement: string): string {
  return regex.test(content) ? content.replace(regex, replacement) : content;
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function formatGradleValue(value: string, quote: boolean): string {
  const trimmed = value.trim();
  if (!quote) {
    return trimmed;
  }

  return `"${trimmed.replace(/"/g, '\\"')}"`;
}

/** True for `build.gradle.kts` / `settings.gradle.kts` (Kotlin DSL: assignments need `=`, no Groovy helpers). */
export function isKotlinDsl(fileName: string): boolean {
  return /\.kts$/i.test(fileName);
}

/**
 * The expression to use for `versionName`: keep Groovy's `flutterVersionName` only when the file really
 * defines it (older templates); current templates and every Kotlin DSL file use `flutter.versionName`.
 */
export function versionNameExpression(content: string, kotlinDsl: boolean): string {
  if (kotlinDsl || !/\bflutterVersionName\s*=/.test(content)) {
    return "flutter.versionName";
  }
  return "flutterVersionName";
}

export function replaceGradlePropertyLine(
  content: string,
  key: string,
  value: string,
  quoteValue: boolean,
  options: { kotlinDsl?: boolean } = {},
): string {
  const safeValue = normalizeTextValue(value);
  const escapedKey = escapeRegExp(key);
  // The lookahead stops `compileSdk` from matching `compileSdkVersion` and `applicationId` from matching `applicationIdSuffix`.
  const regex = new RegExp(`^(\\s*)${escapedKey}(?![A-Za-z0-9_])(\\s*=)?\\s*.*$`, "m");

  return content.replace(regex, (_match, indent: string, assignment: string | undefined) => {
    const operator = assignment || options.kotlinDsl ? " = " : " ";
    return `${indent}${key}${operator}${formatGradleValue(safeValue, quoteValue)}`;
  });
}

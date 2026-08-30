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

export function replaceGradlePropertyLine(
  content: string,
  key: string,
  value: string,
  quoteValue: boolean,
): string {
  const safeValue = normalizeTextValue(value);
  const escapedKey = escapeRegExp(key);
  const regex = new RegExp(`^(\\s*)${escapedKey}(\\s*=)?\\s*.*$`, "m");

  return content.replace(regex, (_match, indent: string, assignment: string | undefined) => {
    const operator = assignment ? " = " : " ";
    return `${indent}${key}${operator}${formatGradleValue(safeValue, quoteValue)}`;
  });
}

// SDK-gated permission variants in the webview: writer entries, advice badges,
// the project SDK header, the "Removed by manifest merger" list, iOS
// array/dictionary editors, and the "Apply recommended variants" preview.
import { state } from '../../core/state.js';
import * as api from '../../core/api.js';
import { escapeHtml, showToast } from '../../core/utils.js';

const ANDROID_PREFIX = 'android.permission.';
const SEVERITY = { info: 0, warning: 1, error: 2 };

let adviceTimer = null;
let pendingApply = null;

/** Full permission name for a row (catalog constant, else the name as written). */
export function permissionName(permission) {
  if (permission?.entry?.name) { return permission.entry.name; }
  const name = (permission?.constantValue || permission?.permission || '').trim();
  return name && !name.includes('.') ? `${ANDROID_PREFIX}${name}` : name;
}

/** The writer entry for a row; rows added from the catalog get one on demand. */
export function entryOf(permission) {
  if (!permission.entry) {
    permission.entry = { name: permissionName(permission) };
  }
  return permission.entry;
}

/** Entries for every Android row (merger removals included: the writer keeps them). */
export function androidEntries() {
  const seen = new Set();
  const result = [];
  for (const permission of state.androidPermissions || []) {
    const entry = { ...entryOf(permission) };
    const key = `${entry.name}|${entry.sdk23 ? 'sdk23' : ''}|${entry.toolsNode || ''}`;
    if (!entry.name || seen.has(key)) { continue; }
    seen.add(key);
    result.push(entry);
  }
  return result;
}

export function iosEntries(list) {
  return (list || [])
    .filter((permission) => permission.permission)
    .map((permission) => ({ permission: permission.permission, value: permission.value, type: permission.type }));
}

/** Asks the extension for advice about the current (possibly unsaved) state. */
export function requestAdvice(delay = 300) {
  clearTimeout(adviceTimer);
  adviceTimer = setTimeout(() => {
    api.postMessage({
      type: 'requestPermissionAdvice',
      androidPermissions: state.hasAndroidManifest ? androidEntries() : undefined,
      iosPermissions: state.hasIOSPlist ? iosEntries(state.iosPermissions) : undefined,
    });
  }, delay);
}

function adviceFor(platform, name) {
  return (state.permissionAdvice?.advice || []).filter((item) => item.platform === platform && item.permission === name);
}

function worst(items) {
  return items.reduce((current, item) => (!current || SEVERITY[item.level] > SEVERITY[current] ? item.level : current), null);
}

/** "Applies" badge: ok / info / warning / error, with every message in the tooltip. */
export function adviceBadge(platform, name) {
  const items = adviceFor(platform, name);
  const level = worst(items) || 'ok';
  const badge = document.createElement('span');
  badge.className = `perm-badge ${level}`;
  badge.textContent = level === 'ok' ? 'ok' : level;
  badge.title = items.length ? items.map((item) => `${item.level.toUpperCase()}: ${item.message}`).join('\n\n') : 'No issues for this project\'s SDK levels.';
  return badge;
}

/** API column: level plus deprecated / removed badges. */
export function apiLevelCell(permission) {
  const cell = document.createElement('td');
  const level = document.createElement('span');
  level.textContent = permission.apiLevelExact || (permission.apiLevel ? String(permission.apiLevel) : '');
  cell.appendChild(level);
  if (permission.deprecatedIn) {
    const badge = document.createElement('span');
    badge.className = 'perm-badge warning';
    badge.textContent = `dep ${permission.deprecatedIn}`;
    badge.title = `Deprecated in API ${permission.deprecatedIn}${permission.replacedBy?.length ? `; use ${permission.replacedBy.map((name) => name.replace(ANDROID_PREFIX, '')).join(', ')}` : ''}`;
    cell.appendChild(badge);
  }
  if (permission.removedIn) {
    const badge = document.createElement('span');
    badge.className = 'perm-badge error';
    badge.textContent = `removed ${permission.removedIn}`;
    badge.title = `Removed from the SDK in API ${permission.removedIn}`;
    cell.appendChild(badge);
  }
  if (permission.unknown) {
    const badge = document.createElement('span');
    badge.className = 'perm-badge info';
    badge.textContent = 'not in catalog';
    cell.appendChild(badge);
  }
  return cell;
}

/** Inline editors for maxSdkVersion / usesPermissionFlags / sdk-23. */
export function variantCell(permission, onChange) {
  const cell = document.createElement('td');
  cell.className = 'variant-cell';
  const entry = entryOf(permission);
  const recommended = permission.recommended || [];

  const max = document.createElement('input');
  max.type = 'number';
  max.min = '1';
  max.placeholder = 'maxSdk';
  max.title = recommended.filter((variant) => variant.maxSdkVersion).map((variant) => `maxSdkVersion ${variant.maxSdkVersion}: ${variant.note}`).join('\n') || 'android:maxSdkVersion (empty: all API levels)';
  max.value = entry.maxSdkVersion ?? '';
  max.addEventListener('change', () => {
    const value = parseInt(max.value, 10);
    entry.maxSdkVersion = Number.isFinite(value) && value > 0 ? value : null;
    onChange();
  });
  cell.appendChild(max);

  const flags = document.createElement('input');
  flags.type = 'text';
  flags.placeholder = 'flags';
  flags.setAttribute('list', 'usesPermissionFlagsOptions');
  flags.title = recommended.filter((variant) => variant.usesPermissionFlags).map((variant) => `${variant.usesPermissionFlags}: ${variant.note}`).join('\n') || 'android:usesPermissionFlags';
  flags.value = entry.usesPermissionFlags ?? '';
  flags.addEventListener('change', () => {
    entry.usesPermissionFlags = flags.value.trim() || null;
    onChange();
  });
  cell.appendChild(flags);

  const sdk23 = document.createElement('label');
  sdk23.className = 'variant-sdk23';
  sdk23.title = 'Write <uses-permission-sdk-23>: only requested on API 23+ (needs AGP 2.0+).';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = entry.sdk23 === true;
  checkbox.addEventListener('change', () => {
    entry.sdk23 = checkbox.checked;
    onChange();
  });
  sdk23.appendChild(checkbox);
  sdk23.appendChild(document.createTextNode(' sdk-23'));
  cell.appendChild(sdk23);
  return cell;
}

/** Collapsed list of `tools:node="remove"` entries (never counted as used, always kept). */
export function renderMergerRemoved() {
  const details = document.getElementById('androidMergerRemovedDetails');
  const list = document.getElementById('androidMergerRemovedList');
  const summary = document.getElementById('androidMergerRemovedSummary');
  if (!details || !list || !summary) { return; }
  const removed = (state.androidPermissions || []).filter((permission) => permission.mergerRemoved || permission.entry?.toolsNode === 'remove');
  details.style.display = removed.length ? '' : 'none';
  summary.textContent = `Removed by manifest merger (${removed.length})`;
  list.innerHTML = removed
    .map((permission) => `<li><code>${escapeHtml(permissionName(permission))}</code> <span class="perm-note">tools:node="remove"${permission.description ? ` - ${escapeHtml(permission.description)}` : ''}</span></li>`)
    .join('');
}

/** Header with the project's SDK levels, and the advice list. */
export function renderAdvice() {
  const header = document.getElementById('permissionAdviceHeader');
  const listContainer = document.getElementById('permissionAdviceList');
  const summary = document.getElementById('permissionAdviceSummary');
  const applyButton = document.getElementById('applyRecommendedVariantsButton');
  const report = state.permissionAdvice;
  if (!header || !report) { return; }
  const android = report.header?.android;
  const ios = report.header?.ios;
  const parts = [];
  if (android) {
    parts.push(`Android: minSdk ${android.minSdk ?? '?'} · targetSdk ${android.targetSdk ?? '?'} · compileSdk ${android.compileSdk ?? '?'}`);
    if (android.agpVersion || android.gradleVersion) {
      parts.push(`AGP ${android.agpVersion ?? '?'} · Gradle ${android.gradleVersion ?? '?'}`);
    }
  }
  if (ios) {
    parts.push(`iOS deployment target ${ios.deploymentTarget ?? '?'}`);
  }
  header.textContent = parts.join('   |   ');
  header.title = (report.header?.notes || []).join('\n');

  const advice = report.advice || [];
  const fixable = advice.filter((item) => (item.fix && item.fix.length) || (item.iosFix && item.iosFix.length));
  if (applyButton) {
    applyButton.disabled = fixable.length === 0;
    applyButton.title = fixable.length ? `${fixable.length} recommended change(s); previewed before anything is written.` : 'Nothing to apply.';
  }
  if (summary) {
    const counts = ['error', 'warning', 'info'].map((level) => `${advice.filter((item) => item.level === level).length} ${level}`).join(', ');
    summary.textContent = `Advice (${counts})`;
  }
  if (listContainer) {
    listContainer.innerHTML = advice.length
      ? advice
        .slice()
        .sort((a, b) => SEVERITY[b.level] - SEVERITY[a.level])
        .map((item) => `<div class="advice-item ${item.level}"><span class="perm-badge ${item.level}">${item.level}</span> <code>${escapeHtml(item.permission.replace(ANDROID_PREFIX, ''))}</code> ${escapeHtml(item.message)}</div>`)
        .join('')
      : '<div class="advice-item">No advice: every declaration applies as written.</div>';
  }
}

export function handleAdviceMessage(message) {
  state.permissionAdvice = message;
  renderAdvice();
}

function applyAndroidFixes(entries, fixes) {
  let result = entries.map((entry) => ({ ...entry }));
  for (const fix of fixes) {
    const name = fix.name.includes('.') ? fix.name : `${ANDROID_PREFIX}${fix.name}`;
    const index = result.findIndex((entry) => entry.name === name && entry.toolsNode !== 'remove');
    if (fix.remove) {
      result = result.filter((_entry, position) => position !== index);
      continue;
    }
    const { remove, ...attributes } = fix;
    if (index === -1) {
      result.push({ ...attributes, name });
    } else {
      result[index] = { ...result[index], ...attributes, name };
    }
  }
  return result;
}

/** Computes every recommended change and asks the extension for a diff preview. */
export function applyRecommendedVariants() {
  const advice = state.permissionAdvice?.advice || [];
  const androidFixes = advice.flatMap((item) => item.fix || []);
  const iosFixes = advice.flatMap((item) => item.iosFix || []);
  if (!androidFixes.length && !iosFixes.length) {
    showToast('Nothing to apply.', 'info');
    return;
  }
  const android = state.hasAndroidManifest ? applyAndroidFixes(androidEntries(), androidFixes) : undefined;
  let ios;
  if (state.hasIOSPlist) {
    ios = iosEntries(state.iosPermissions);
    for (const fix of iosFixes) {
      if (!ios.some((entry) => entry.permission === fix.permission)) {
        ios.push({ ...fix, value: fix.value ?? (fix.type === 'array' ? [] : fix.type === 'dictionary' ? {} : undefined) });
      }
    }
  }
  pendingApply = { android, ios };
  api.postMessage({ type: 'previewPermissionChanges', androidPermissions: android, iosPermissions: ios });
}

/** Shows the diff; confirming saves exactly the previewed entries. */
export function showPermissionChangesPreview(message) {
  const backdrop = document.getElementById('permissionDiffModalBackdrop');
  const body = document.getElementById('permissionDiffBody');
  if (!backdrop || !body) { return; }
  if (message.error) {
    showToast(`Preview failed: ${message.error}`, 'error');
    return;
  }
  const previews = message.previews || [];
  body.innerHTML = previews.length
    ? previews.map((preview) => `<div class="diff-file"><div class="diff-file-name">${escapeHtml(preview.file)}</div><pre class="diff-block">${preview.lines
      .map((line) => `<span class="diff-line ${line.kind}">${line.kind === 'add' ? '+ ' : line.kind === 'remove' ? '- ' : '  '}${escapeHtml(line.text)}</span>`)
      .join('\n')}</pre></div>`).join('')
    : '<div class="advice-item">The recommended changes are already in the files.</div>';
  backdrop.style.display = 'flex';
}

export function closePermissionChangesPreview() {
  const backdrop = document.getElementById('permissionDiffModalBackdrop');
  if (backdrop) { backdrop.style.display = 'none'; }
}

export function confirmPermissionChanges() {
  if (!pendingApply) {
    closePermissionChangesPreview();
    return;
  }
  api.postMessage({
    type: 'savePermissions',
    androidPermissions: pendingApply.android ?? androidEntries(),
    iosPermissions: pendingApply.ios ?? iosEntries(state.iosPermissions),
    macosPermissions: iosEntries(state.macosPermissions),
  });
  pendingApply = null;
  closePermissionChangesPreview();
  showToast('Applying recommended variants...', 'info');
  setTimeout(() => api.sendRefresh(), 800);
}

// ---------------------------------------------------------------------------
// iOS array / dictionary values
// ---------------------------------------------------------------------------

/** Text form of an iOS value for a multi-line editor. */
export function iosValueToText(type, value) {
  if (type === 'array') {
    return Array.isArray(value) ? value.join('\n') : (typeof value === 'string' ? value : '');
  }
  if (type === 'dictionary') {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? Object.entries(value).map(([key, item]) => `${key} = ${item}`).join('\n')
      : '';
  }
  return typeof value === 'string' ? value : '';
}

/** Parses the editor text: one array item per line (or comma separated); `key = value` per dictionary line. */
export function iosTextToValue(type, text) {
  const lines = String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (type === 'array') {
    return lines.length === 1 && lines[0].includes(',') ? lines[0].split(',').map((item) => item.trim()).filter(Boolean) : lines;
  }
  if (type === 'dictionary') {
    const result = {};
    for (const line of lines.flatMap((item) => item.split(';')).map((item) => item.trim()).filter(Boolean)) {
      const index = line.indexOf('=');
      if (index > 0) {
        result[line.slice(0, index).trim()] = line.slice(index + 1).trim();
      }
    }
    return result;
  }
  return text;
}

/** Editor for array / dictionary keys, or null for other types. */
export function createIosStructuredEditor(permission, onValue) {
  const type = (permission.type || '').toLowerCase();
  if (type !== 'array' && type !== 'dictionary') { return null; }
  const textarea = document.createElement('textarea');
  textarea.className = 'ios-structured-editor';
  textarea.placeholder = type === 'array' ? 'One value per line (e.g. _ipp._tcp)' : 'One "key = value" per line';
  if (permission.value === undefined && !permission.unknown) {
    textarea.placeholder = type === 'array' ? 'One value per line' : 'One "key = value" per line';
  }
  textarea.value = iosValueToText(type, permission.value);
  textarea.rows = Math.max(2, textarea.value.split('\n').length);
  textarea.addEventListener('change', () => onValue(iosTextToValue(type, textarea.value)));
  return textarea;
}

/** "iOS" column: minimum release, deprecation badge and successor button. */
export function iosVersionCell(permission, onAddSuccessor) {
  const cell = document.createElement('td');
  const min = document.createElement('span');
  min.textContent = permission.minOS ? `${permission.minOS}+` : (permission.minMacOS ? `macOS ${permission.minMacOS}+` : '');
  cell.appendChild(min);
  if (permission.deprecatedInOS) {
    const badge = document.createElement('span');
    badge.className = 'perm-badge warning';
    badge.textContent = `dep ${permission.deprecatedInOS}`;
    badge.title = `Deprecated in iOS ${permission.deprecatedInOS}`;
    cell.appendChild(badge);
  }
  const successors = (permission.replacedBy || []).filter((key) => !(state.iosPermissions || []).some((item) => item.permission === key));
  if (successors.length && onAddSuccessor) {
    const button = document.createElement('button');
    button.className = 'equivalent-button';
    button.textContent = `Add ${successors[0].replace(/UsageDescription$/, '')}`;
    button.title = `Add ${successors.join(', ')} with the same text`;
    button.addEventListener('click', () => onAddSuccessor(successors));
    cell.appendChild(button);
  }
  if (permission.unknown) {
    const badge = document.createElement('span');
    badge.className = 'perm-badge info';
    badge.textContent = 'not in catalog';
    cell.appendChild(badge);
  }
  return cell;
}

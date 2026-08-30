import { state } from './state.js';

// Tab identifiers shown in the top-level config view.
export const TABS = ['build', 'permissions', 'appname', 'services', 'packages', 'assets'];

/**
 * Whether a section tagged with `data-platform` should be visible given the
 * current project's detected platforms. Sections without a platform tag are
 * always considered visible.
 */
function isSectionPlatformVisible(section) {
  const platform = section.dataset.platform;
  if (!platform) {
    return true;
  }
  if (platform === 'android') {
    return !!(state.hasAndroidManifest || (state.platformDetails?.android || []).length > 0);
  }
  if (platform === 'ios') {
    return !!(state.hasIOSPlist || (state.platformDetails?.ios || []).length > 0);
  }
  if (platform === 'macos') {
    return !!state.hasMacOSPlist;
  }
  return true;
}

export function getActiveTab() {
  return state.activeTab || 'build';
}

/**
 * Single source of truth for section visibility. Shows only the sections that
 * belong to the active tab AND whose platform is present in the project.
 */
export function applyTabVisibility() {
  const active = getActiveTab();

  document.querySelectorAll('section[data-tab]').forEach((section) => {
    const belongs = section.dataset.tab === active;
    const show = belongs && isSectionPlatformVisible(section);
    section.style.display = show ? '' : 'none';
  });

  document.querySelectorAll('.tab').forEach((btn) => {
    const isActive = btn.dataset.tab === active;
    btn.classList.toggle('active', isActive);
    if (btn.hasAttribute('aria-selected')) {
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    }
  });
}

export function switchTab(tabName) {
  state.activeTab = tabName;
  applyTabVisibility();
}

export function initTabs() {
  document.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
  if (!state.activeTab) {
    state.activeTab = 'build';
  }
  applyTabVisibility();
}

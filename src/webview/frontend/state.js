const _state = {
  androidPermissions: [], iosPermissions: [], macosPermissions: [],
  allAndroidPermissions: [], allIosPermissions: [],
  search: "", category: "", iosSearch: "", iosCategory: "", macosSearch: "", macosCategory: "",
  sort: { column: "permission", direction: "asc" },
  modalQuery: "", modalSelection: null, modalMode: "android", modalCategory: "",
  hasAndroidManifest: false, hasIOSPlist: false, hasMacOSPlist: false,
  pendingCrossPlatformPermissions: [], crossPlatformMode: null,
  pendingCrossPlatformModal: null, pendingEquivalentModal: null,
  equivalentPermissions: [], equivalentCategory: "",
  services: [], availableServices: [], currentEditingService: null, serviceSearch: "",
  pendingSyncModal: false,
  appName: { defaultName: "", localizations: {} },
  packages: [], showTransitive: false,
  validatorState: { isInstalled: false, issues: null, loading: false },
  assetsState: { assets: [], totalAssets: 0, usedAssets: 0 },
  platformDetails: { android: [], ios: [] },
  languages: [], syncItems: []
};

const _listeners = new Map();

export const state = new Proxy(_state, {
  set(target, prop, value) {
    target[prop] = value;
    if (_listeners.has(prop)) {
      _listeners.get(prop).forEach(cb => cb(value));
    }
    return true;
  }
});

export function on(key, callback) {
  if (!_listeners.has(key)) { _listeners.set(key, new Set()); }
  _listeners.get(key).add(callback);
  return () => _listeners.get(key)?.delete(callback);
}

export function getState() {
  return state;
}

export function setState(patch) {
  Object.assign(state, patch);
}

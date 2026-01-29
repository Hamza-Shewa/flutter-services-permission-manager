/**
 * Webview state management
 * Centralized cache and state for webview operations
 */

import type { ServiceConfig, ServiceEntry, IOSPermissionWithMacro } from '../types/index.js';

/** Cached state for webview operations */
interface WebviewState {
    categorizedIosPermissions: Record<string, IOSPermissionWithMacro[]> | null;
    servicesConfig: ServiceConfig[] | null;
    previousServices: ServiceEntry[];
}

const state: WebviewState = {
    categorizedIosPermissions: null,
    servicesConfig: null,
    previousServices: []
};

export function getCategorizedIosPermissionsCache(): Record<string, IOSPermissionWithMacro[]> | null {
    return state.categorizedIosPermissions;
}

export function setCategorizedIosPermissionsCache(
    permissions: Record<string, IOSPermissionWithMacro[]> | null
): void {
    state.categorizedIosPermissions = permissions;
}

export function getServicesConfigCache(): ServiceConfig[] | null {
    return state.servicesConfig;
}

export function setServicesConfigCache(services: ServiceConfig[] | null): void {
    state.servicesConfig = services;
}

export function getPreviousServicesCache(): ServiceEntry[] {
    return state.previousServices;
}

export function setPreviousServicesCache(services: ServiceEntry[]): void {
    state.previousServices = [...services];
}

export function resetState(): void {
    state.categorizedIosPermissions = null;
    state.servicesConfig = null;
    state.previousServices = [];
}

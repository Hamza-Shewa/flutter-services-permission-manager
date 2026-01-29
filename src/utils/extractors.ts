import path from 'path';
import * as vscode from 'vscode';
import { extensionBaseUri, flattenAndroidPermissions, flattenIOSPermissions } from '../extension';

interface AndroidPermission {
    permission: string;
    description: string;
    protectionLevel: string;
    constantValue: string;
    category: string;
    apiLevel: number;
    removedIn?: number | null;
    equivalentIosPermissions?: string[];
}

interface IOSPermission {
    permission: string;
    description: string;
    type: string;
    category: string;
    value?: string | boolean;
    equivalentAndroidPermissions?: string[];
}

interface PermissionMapping {
    androidToIos: Record<string, string[]>;
    iosToAndroid: Record<string, string[]>;
}

interface IOSPermissionEntry {
    permission: string;
    value?: string | boolean;
    type?: string;
}


async function getUsedAndroidPermissions(manifestContent: string): Promise<AndroidPermission[]> {
    //since all Android permissions are in the form <uses-permission android:name="android.permission.CAMERA" /> wrapped in <uses-permission> tags
    //we can use a regex to extract them
    const androidPermissionRegex = /<uses-permission\b[^>]*android:name="([^"]+)"[^>]*>/g;
    const usedPermissions: AndroidPermission[] = [];
    const allPermissions: AndroidPermission[] = await getAndroidPermissions();
    let match;
    while ((match = androidPermissionRegex.exec(manifestContent)) !== null) {
        const permissionName = match[1];
        const shortName = permissionName.replace(/^android\.permission\./, '');
        const permissionInfo = allPermissions.find(p =>
            p.constantValue === permissionName || p.permission === permissionName || p.permission === shortName
        );
        if (permissionInfo) {
            usedPermissions.push(permissionInfo);
        }
    }
    console.log('used permissions:', usedPermissions.length);
    return usedPermissions;
}

async function getUsedIOSPermissions(plistContent: string): Promise<IOSPermission[]> {
    const usedPermissions: IOSPermission[] = [];
    const allPermissions: IOSPermission[] = await getIOSPermissions();
    //same for iOS permissions in the Info.plist file, they are in the form <key>NSCameraUsageDescription</key> starting with NS
    //we can use a regex to extract them
    const stringRegex = /<key>(NS[^<]*)<\/key>\s*<string>([^<]*)<\/string>/g;
    // also support boolean type permissions since apple has boolean values and not only strings
    const boolRegex = /<key>(NS[^<]*)<\/key>\s*<(true|false)\/>/g;
    console.log('iOS plist content length:', plistContent.length);
    console.log('allPermissions length:', allPermissions.length);
    console.log('string matches:', (plistContent.match(stringRegex) || []).length);
    console.log('bool matches:', (plistContent.match(boolRegex) || []).length);
    let match;
    while ((match = stringRegex.exec(plistContent)) !== null) {
        const permissionName = match[1];
        const value = match[2];
        const permissionInfo = allPermissions.find(p => p.permission === permissionName);
        if (permissionInfo) {
            usedPermissions.push({ ...permissionInfo, value });
        } else {
            console.log('Permission not found in allPermissions:', permissionName);
        }
    }
    while ((match = boolRegex.exec(plistContent)) !== null) {
        const permissionName = match[1];
        const value = match[2] === 'true';
        const permissionInfo = allPermissions.find(p => p.permission === permissionName);
        if (permissionInfo) {
            usedPermissions.push({ ...permissionInfo, value });
        } else {
            console.log('Permission not found in allPermissions:', permissionName);
        }
    }
    console.log('used iOS permissions:', usedPermissions.length);
    return usedPermissions;
}

async function getAndroidPermissions(): Promise<AndroidPermission[]> {
    const raw = await getListFromFile<AndroidPermission[] | Record<string, AndroidPermission[]>>('categorized-android-permissions.json');
    const permissions = flattenAndroidPermissions(raw);
    const mapping = await getPermissionMapping();
    return enrichAndroidPermissionsWithEquivalents(permissions, mapping);
}

async function getIOSPermissions(): Promise<IOSPermission[]> {
    const raw = await getListFromFile<IOSPermission[] | Record<string, IOSPermission[]>>('categorized-ios-permissions.json');
    const permissions = flattenIOSPermissions(raw);
    const mapping = await getPermissionMapping();
    return enrichIOSPermissionsWithEquivalents(permissions, mapping);
}

async function getPermissionMapping(): Promise<PermissionMapping> {
    return getListFromFile<PermissionMapping>('permission-mapping.json');
}

function enrichAndroidPermissionsWithEquivalents(permissions: AndroidPermission[], mapping: PermissionMapping): AndroidPermission[] {
    return permissions.map(permission => ({
        ...permission,
        equivalentIosPermissions: mapping.androidToIos[permission.constantValue] || []
    }));
}

function enrichIOSPermissionsWithEquivalents(permissions: IOSPermission[], mapping: PermissionMapping): IOSPermission[] {
    return permissions.map(permission => ({
        ...permission,
        equivalentAndroidPermissions: mapping.iosToAndroid[permission.permission] || []
    }));
}


async function getListFromFile<T>(filePath: string): Promise<T> {
    try {
        const currentFile = __filename;
        const dir = path.dirname(currentFile);
        const extensionFolder = vscode.Uri.file(dir);
        const candidatePaths: vscode.Uri[] = [];
        if (extensionBaseUri) {
            candidatePaths.push(vscode.Uri.joinPath(extensionBaseUri, 'src', filePath));
        }
        candidatePaths.push(vscode.Uri.joinPath(extensionFolder, filePath));
        let rawData: Uint8Array | undefined;
        for (const candidate of candidatePaths) {
            try {
                rawData = await vscode.workspace.fs.readFile(candidate);
                break;
            } catch {
                continue;
            }
        }
        if (!rawData) {
            throw new Error(`${filePath} not found`);
        }
        return JSON.parse(rawData.toString()) as T;
    } catch (error) {
        console.error(`Error reading or parsing JSON at ${filePath}:`, error);
        return [] as unknown as T;
    }
}

export { AndroidPermission, IOSPermission, IOSPermissionEntry, PermissionMapping, getUsedAndroidPermissions, getUsedIOSPermissions, getAndroidPermissions, getIOSPermissions, getPermissionMapping };
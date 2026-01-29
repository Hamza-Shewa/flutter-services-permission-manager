// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { AndroidPermission, IOSPermission, IOSPermissionEntry, getUsedAndroidPermissions, getUsedIOSPermissions, getAndroidPermissions, getIOSPermissions } from './utils/extractors';


let extensionBaseUri: vscode.Uri | undefined;
// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	extensionBaseUri = context.extensionUri;


	// The command has been defined in the package.json file
	// This command launches the permission manager webview
	const editDisposable = vscode.commands.registerCommand('permission-manager.edit', async () => {

		// detect the android-manifest.xml path in the workspace
		// the manager ignores the debug/profile/release manifests and only uses the main one
		const androidPermissionsUri = await vscode.workspace.findFiles('**/AndroidManifest.xml', '**/{build,profile,debug,release}/**', 1);
		// detects the IOS Info.plist path in the workspace
		const iosPermissionsUri = await vscode.workspace.findFiles('**/Info.plist', '**/build', 1);

		//this opens the files to read their contents and extract the permissions
		const android_manifest = androidPermissionsUri.length > 0 ? await vscode.workspace.openTextDocument(androidPermissionsUri[0]) : null;
		const ios_info_plist = iosPermissionsUri.length > 0 ? await vscode.workspace.openTextDocument(iosPermissionsUri[0]) : null;

		//get the used permissions with more details from the manifest/plist contents with helper functions defined below with an interface
		const usedAndroidPermissions = await getUsedAndroidPermissions(android_manifest?.getText() || '');
		const usedIOSPermissions = await getUsedIOSPermissions(ios_info_plist?.getText() || '');

		viewPanel(
			context.extensionUri,
			usedAndroidPermissions,
			usedIOSPermissions,
			androidPermissionsUri[0],
			iosPermissionsUri[0]
		);
		// await vscode.window.showTextDocument(permDoc, { viewColumn: vscode.ViewColumn.Beside, preview: false });
		vscode.window.showInformationMessage('Edit command executed from Permission Manager!');
	});

	context.subscriptions.push(editDisposable);
}



async function viewPanel(
	extensionUri: vscode.Uri,
	androidPermissions: AndroidPermission[],
	iosPermissions: IOSPermission[],
	androidManifestUri?: vscode.Uri,
	iosPlistUri?: vscode.Uri
) {
	// Create and show a new webview
	const panel = vscode.window.createWebviewPanel(
		'permissionManager', // Identifies the type of the webview. Used internally
		'Permission Manager', // Title of the panel displayed to the user
		vscode.ViewColumn.One, // Editor column to show the new webview panel in.
		{
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'src')]
		} // Webview options. More on these later.
	);

	// And set its HTML content
	panel.webview.html = await getWebviewContent(panel.webview, extensionUri);

	const payload = {
		type: 'permissions',
		androidPermissions,
		iosPermissions
	};

	panel.webview.onDidReceiveMessage(async message => {
		switch (message?.type) {
			case 'ready':
				panel.webview.postMessage(payload);
				break;
			case 'requestAllAndroidPermissions': {
				const allAndroidPermissions = await getAndroidPermissions();
				panel.webview.postMessage({
					type: 'allAndroidPermissions',
					permissions: allAndroidPermissions
				});
				break;
			}
			case 'requestAllIOSPermissions': {
				const allIOSPermissions = await getIOSPermissions();
				panel.webview.postMessage({
					type: 'allIOSPermissions',
					permissions: allIOSPermissions
				});
				break;
			}
			case 'savePermissions': {
				const androidList: string[] = Array.isArray(message?.androidPermissions) ? message.androidPermissions : [];
				const iosList: IOSPermissionEntry[] = Array.isArray(message?.iosPermissions) ? message.iosPermissions : [];
				const result = await savePermissions(androidList, iosList, androidManifestUri, iosPlistUri);
				panel.webview.postMessage({ type: 'saveResult', ...result });
				break;
			}
			default:
				break;
		}
	});

	panel.webview.postMessage(payload);
}

async function getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri) {
	const htmlPath = vscode.Uri.joinPath(extensionUri, 'src', 'permission-manager.html');
	const rawData = await vscode.workspace.fs.readFile(htmlPath);
	const html = rawData.toString();

	const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'src', 'webview.js'));
	const utilsUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'src', 'webview-utils.js'));
	const cspSource = webview.cspSource;

	return html
		.replace(/\{\{cspSource\}\}/g, cspSource)
		.replace(/\{\{scriptUri\}\}/g, scriptUri.toString())
		.replace(/\{\{utilsUri\}\}/g, utilsUri.toString());
}


function normalizePermissionNames(permissionNames: string[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const entry of permissionNames) {
		const trimmed = entry?.trim();
		if (!trimmed) {
			continue;
		}
		const normalized = trimmed.startsWith('android.permission.') ? trimmed : `android.permission.${trimmed}`;
		if (!seen.has(normalized)) {
			seen.add(normalized);
			result.push(normalized);
		}
	}
	return result;
}

function updateAndroidManifest(manifestContent: string, permissionNames: string[]): string {
	const normalized = normalizePermissionNames(permissionNames);
	const usesPermissionsXml = normalized
		.map(permission => `    <uses-permission android:name="${permission}" />`)
		.join('\n');
	const cleaned = manifestContent.replace(/\s*<uses-permission\b[^>]*android:name="[^"]+"[^>]*\/?>(?:\s*<\/uses-permission>)?\s*/g, '');
	const manifestMatch = cleaned.match(/<manifest[^>]*>/);
	if (!manifestMatch) {
		return manifestContent;
	}
	const insertIndex = manifestMatch.index! + manifestMatch[0].length;
	const prefix = cleaned.slice(0, insertIndex);
	const suffix = cleaned.slice(insertIndex);
	if (!usesPermissionsXml) {
		return `${prefix}${suffix}`;
	}
	const insertBlock = `\n${usesPermissionsXml}`;
	return `${prefix}${insertBlock}${suffix}`;
}

function updateIOSPlist(plistContent: string, permissionEntries: IOSPermissionEntry[]): string {
	const uniqueEntries = new Map<string, IOSPermissionEntry>();
	permissionEntries
		.filter(entry => entry.permission?.trim())
		.forEach(entry => uniqueEntries.set(entry.permission.trim(), entry));

	const existingStringPairs = new Map<string, string>();
	const existingBooleanPairs = new Map<string, boolean>();
	const stringRegex = /\s*<key>(NS[^<]*)<\/key>\s*<string>([^<]*)<\/string>\s*/g;
	const boolRegex = /\s*<key>(NS[^<]*)<\/key>\s*<(true|false)\/>\s*/g;
	let match;
	while ((match = stringRegex.exec(plistContent)) !== null) {
		existingStringPairs.set(match[1], match[2]);
	}
	while ((match = boolRegex.exec(plistContent)) !== null) {
		existingBooleanPairs.set(match[1], match[2] === 'true');
	}

	let cleaned = plistContent.replace(stringRegex, '').replace(boolRegex, '');
	const dictCloseIndex = cleaned.indexOf('</dict>');
	if (dictCloseIndex === -1) {
		return plistContent;
	}
	const entries = Array.from(uniqueEntries.values())
		.map(entry => {
			const type = entry.type?.toLowerCase();
			if (type === 'boolean') {
				const value = entry.value ?? existingBooleanPairs.get(entry.permission) ?? false;
				return `\t<key>${entry.permission}</key>\n\t<${value ? 'true' : 'false'}/>`;
			}
			const value = typeof entry.value === 'string' && entry.value.trim().length > 0
				? entry.value
				: existingStringPairs.get(entry.permission) ?? 'TODO: Provide usage description.';
			return `\t<key>${entry.permission}</key>\n\t<string>${value}</string>`;
		})
		.join('\n');
	if (!entries) {
		return normalizePlistSpacing(cleaned);
	}
	const insertBlock = `\n${entries}`;
	const merged = cleaned.slice(0, dictCloseIndex) + insertBlock + cleaned.slice(dictCloseIndex);
	return normalizePlistSpacing(merged);
}

function normalizePlistSpacing(plistContent: string): string {
	let normalized = plistContent;
	normalized = normalized.replace(/(<true\/>|<false\/>)\s*<key>/g, '$1\n\t<key>');
	normalized = normalized.replace(/<\/string>\s*<key>/g, '</string>\n\t<key>');
	normalized = normalized.replace(/\n{2,}/g, '\n');
	return normalized;
}

async function replaceDocumentContent(uri: vscode.Uri, content: string): Promise<void> {
	const document = await vscode.workspace.openTextDocument(uri);
	const lastLine = document.lineAt(document.lineCount - 1);
	const fullRange = new vscode.Range(0, 0, document.lineCount - 1, lastLine.text.length);
	const edit = new vscode.WorkspaceEdit();
	edit.replace(uri, fullRange, content);
	await vscode.workspace.applyEdit(edit);
	await document.save();
}

async function savePermissions(
	androidPermissions: string[],
	iosPermissions: IOSPermissionEntry[],
	androidManifestUri?: vscode.Uri,
	iosPlistUri?: vscode.Uri
): Promise<{ success: boolean; message: string }> {
	try {
		if (!androidManifestUri && !iosPlistUri) {
			return { success: false, message: 'No AndroidManifest.xml or Info.plist was found to update.' };
		}
		if (androidManifestUri) {
			const doc = await vscode.workspace.openTextDocument(androidManifestUri);
			const updated = updateAndroidManifest(doc.getText(), androidPermissions);
			await replaceDocumentContent(androidManifestUri, updated);
		}
		if (iosPlistUri) {
			const doc = await vscode.workspace.openTextDocument(iosPlistUri);
			const updated = updateIOSPlist(doc.getText(), iosPermissions);
			await replaceDocumentContent(iosPlistUri, updated);
		}
		return { success: true, message: 'Permissions saved successfully.' };
	} catch (error) {
		return { success: false, message: `Failed to save permissions: ${error}` };
	}
}
function flattenAndroidPermissions(raw: AndroidPermission[] | Record<string, AndroidPermission[]>): AndroidPermission[] {
	if (Array.isArray(raw)) {
		return raw;
	}
	return Object.values(raw).flat();
}

function flattenIOSPermissions(raw: IOSPermission[] | Record<string, IOSPermission[]>): IOSPermission[] {
	if (Array.isArray(raw)) {
		return raw;
	}
	return Object.values(raw).flat();
}

export { updateAndroidManifest, updateIOSPlist, normalizePermissionNames, flattenAndroidPermissions, flattenIOSPermissions, normalizePlistSpacing, extensionBaseUri };
export function deactivate() { }

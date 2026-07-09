import type { WebviewRef } from './index.js';
import { analyzePackages, upgradePackage } from '../../services/pub.service.js';

export async function handleRequestPackagesAnalysis(ref: WebviewRef): Promise<void> {
    try {
        const packages = await analyzePackages();
        ref.webview.postMessage({
            type: 'packagesAnalysisResult',
            packages
        });
    } catch (error) {
        console.error('Packages analysis error:', error);
        ref.webview.postMessage({
            type: 'packagesAnalysisResult',
            packages: [],
            error: error instanceof Error ? error.message : String(error)
        });
    }
}

export async function handleUpgradeSinglePackage(ref: WebviewRef, packageName: string): Promise<void> {
    try {
        ref.webview.postMessage({ type: 'saveResult', success: true, message: `Upgrading ${packageName}... Please wait.` });
        
        await upgradePackage(packageName);
        
        ref.webview.postMessage({ type: 'saveResult', success: true, message: `Successfully upgraded ${packageName}!` });
        
        // Trigger a re-analysis automatically to update the table
        await handleRequestPackagesAnalysis(ref);
    } catch (error) {
        console.error(`Upgrade package error for ${packageName}:`, error);
        ref.webview.postMessage({ type: 'saveResult', success: false, message: `Failed to upgrade ${packageName}: ${error instanceof Error ? error.message : String(error)}` });
    }
}

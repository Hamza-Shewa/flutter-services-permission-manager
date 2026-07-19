import type { WebviewRef } from './index.js';
import { toErrorMessage } from '../../shared/index.js';
import { 
    analyzePackages, upgradePackage, searchPackages, getPackageDetails, addPackage,
    checkDependencyValidator, installDependencyValidator, runDependencyValidator, removePackage, downgradePackage
} from '../../services/pub.service.js';

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
            error: toErrorMessage(error)
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
        ref.webview.postMessage({ type: 'saveResult', success: false, message: `Failed to upgrade ${packageName}: ${toErrorMessage(error)}` });
    }
}

export async function handleSearchPackages(ref: WebviewRef, query: string): Promise<void> {
    try {
        const packages = await searchPackages(query);
        ref.webview.postMessage({
            type: 'searchPackagesResult',
            packages
        });
    } catch (error) {
        console.error('Search packages error:', error);
        ref.webview.postMessage({
            type: 'searchPackagesResult',
            packages: [],
            error: toErrorMessage(error)
        });
    }
}

export async function handleRequestPackageDetails(ref: WebviewRef, packageName: string): Promise<void> {
    try {
        const details = await getPackageDetails(packageName);
        ref.webview.postMessage({
            type: 'packageDetailsResult',
            packageName,
            ...details
        });
    } catch (error) {
        console.error('Package details error:', error);
        ref.webview.postMessage({
            type: 'packageDetailsResult',
            packageName,
            error: toErrorMessage(error)
        });
    }
}

export async function handleAddPackage(ref: WebviewRef, packageName: string): Promise<void> {
    try {
        ref.webview.postMessage({ type: 'saveResult', success: true, message: `Adding ${packageName}... Please wait.` });
        
        await addPackage(packageName);
        
        ref.webview.postMessage({ type: 'saveResult', success: true, message: `Successfully added ${packageName}!` });
        
        // Trigger a re-analysis automatically to update the table
        await handleRequestPackagesAnalysis(ref);
    } catch (error) {
        console.error(`Add package error for ${packageName}:`, error);
        ref.webview.postMessage({ type: 'saveResult', success: false, message: `Failed to add ${packageName}: ${toErrorMessage(error)}` });
    }
}

export async function handleCheckDependencyValidator(ref: WebviewRef): Promise<void> {
    try {
        const isInstalled = await checkDependencyValidator();
        ref.webview.postMessage({
            type: 'dependencyValidatorState',
            isInstalled
        });
    } catch (error) {
        console.error('Check dependency validator error:', error);
        ref.webview.postMessage({ type: 'dependencyValidatorState', isInstalled: false });
    }
}

export async function handleInstallDependencyValidator(ref: WebviewRef): Promise<void> {
    try {
        ref.webview.postMessage({ type: 'saveResult', success: true, message: `Installing dependency_validator... Please wait.` });
        await installDependencyValidator();
        ref.webview.postMessage({ type: 'saveResult', success: true, message: `Successfully installed dependency_validator!` });
        
        await handleCheckDependencyValidator(ref);
        await handleRunDependencyValidator(ref);
    } catch (error) {
        console.error('Install dependency validator error:', error);
        ref.webview.postMessage({ type: 'saveResult', success: false, message: `Failed to install dependency_validator: ${toErrorMessage(error)}` });
    }
}

export async function handleRunDependencyValidator(ref: WebviewRef): Promise<void> {
    try {
        ref.webview.postMessage({ type: 'saveResult', success: true, message: `Running dependency validation...` });
        const issues = await runDependencyValidator();
        ref.webview.postMessage({
            type: 'dependencyValidationResult',
            issues
        });
        ref.webview.postMessage({ type: 'saveResult', success: true, message: `Validation complete.` });
    } catch (error) {
        console.error('Run dependency validator error:', error);
        ref.webview.postMessage({
            type: 'dependencyValidationResult',
            issues: [],
            error: toErrorMessage(error)
        });
    }
}

export async function handleRemovePackage(ref: WebviewRef, packageName: string): Promise<void> {
    try {
        ref.webview.postMessage({ type: 'saveResult', success: true, message: `Removing ${packageName}...` });
        await removePackage(packageName);
        ref.webview.postMessage({ type: 'saveResult', success: true, message: `Removed ${packageName}.` });
        
        await handleRunDependencyValidator(ref);
        await handleRequestPackagesAnalysis(ref);
    } catch (error) {
        console.error(`Remove package error for ${packageName}:`, error);
        ref.webview.postMessage({ type: 'saveResult', success: false, message: `Failed to remove ${packageName}: ${toErrorMessage(error)}` });
    }
}

export async function handleDowngradePackage(ref: WebviewRef, packageName: string): Promise<void> {
    try {
        ref.webview.postMessage({ type: 'saveResult', success: true, message: `Downgrading ${packageName}...` });
        await downgradePackage(packageName);
        ref.webview.postMessage({ type: 'saveResult', success: true, message: `Downgraded ${packageName}.` });
        
        await handleRunDependencyValidator(ref);
        await handleRequestPackagesAnalysis(ref);
    } catch (error) {
        console.error(`Downgrade package error for ${packageName}:`, error);
        ref.webview.postMessage({ type: 'saveResult', success: false, message: `Failed to downgrade ${packageName}: ${toErrorMessage(error)}` });
    }
}

export async function handleRemoveAllFlaggedPackages(ref: WebviewRef, packages: string[]): Promise<void> {
    try {
        ref.webview.postMessage({ type: 'saveResult', success: true, message: `Removing ${packages.length} packages...` });
        for (const pkg of packages) {
            await removePackage(pkg);
        }
        ref.webview.postMessage({ type: 'saveResult', success: true, message: `Removed all flagged packages.` });
        
        await handleRunDependencyValidator(ref);
        await handleRequestPackagesAnalysis(ref);
    } catch (error) {
        console.error('Remove all flagged packages error:', error);
        ref.webview.postMessage({ type: 'saveResult', success: false, message: `Failed to remove some packages: ${toErrorMessage(error)}` });
    }
}

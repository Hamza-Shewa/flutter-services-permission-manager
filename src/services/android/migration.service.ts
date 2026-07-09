import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';

/**
 * Automatically migrates the Android project from the legacy imperative setup
 * to the modern declarative setup (Flutter 3.16+ / AGP 8.13.2).
 */
export async function migrateAndroidSetup(): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
        throw new Error('No workspace root found');
    }

    const androidDir = path.join(workspaceRoot, 'android');
    if (!fs.existsSync(androidDir)) {
        throw new Error('No android directory found in the workspace');
    }

    const settingsGradlePath = path.join(androidDir, 'settings.gradle');
    const projectBuildGradlePath = path.join(androidDir, 'build.gradle');
    const appBuildGradlePath = path.join(androidDir, 'app', 'build.gradle');
    const wrapperPropertiesPath = path.join(androidDir, 'gradle', 'wrapper', 'gradle-wrapper.properties');

    let usesGoogleServices = false;
    let usesFirebasePerf = false;
    let usesCrashlytics = false;

    // ----- 1. PRE-CHECK APP BUILD.GRADLE FOR FIREBASE PLUGINS -----
    if (fs.existsSync(appBuildGradlePath)) {
        const appContent = fs.readFileSync(appBuildGradlePath, 'utf8');
        if (appContent.includes('com.google.gms.google-services')) usesGoogleServices = true;
        if (appContent.includes('com.google.firebase.firebase-perf')) usesFirebasePerf = true;
        if (appContent.includes('com.google.firebase.crashlytics')) usesCrashlytics = true;
    }

    // ----- 2. MIGRATE SETTINGS.GRADLE -----
    if (fs.existsSync(settingsGradlePath)) {
        let content = fs.readFileSync(settingsGradlePath, 'utf8');
        
        // Ensure plugins block exists
        if (!content.includes('plugins {')) {
            content += `\nplugins {\n    id "dev.flutter.flutter-plugin-loader" version "1.0.0"\n    id "com.android.application" version "8.13.2" apply false\n    id "org.jetbrains.kotlin.android" version "2.2.21" apply false\n}\n`;
        } else {
            // Update AGP
            if (content.match(/id\s+"com\.android\.application"/)) {
                content = content.replace(/id\s+"com\.android\.application".*/g, `id "com.android.application" version "8.13.2" apply false`);
            } else {
                content = content.replace(/plugins\s*\{/, `plugins {\n    id "com.android.application" version "8.13.2" apply false`);
            }

            // Update Kotlin
            if (content.match(/id\s+"org\.jetbrains\.kotlin\.android"/)) {
                content = content.replace(/id\s+"org\.jetbrains\.kotlin\.android".*/g, `id "org.jetbrains.kotlin.android" version "2.2.21" apply false`);
            } else {
                content = content.replace(/plugins\s*\{/, `plugins {\n    id "org.jetbrains.kotlin.android" version "2.2.21" apply false`);
            }

            // Add Firebase plugins if needed
            if (usesGoogleServices && !content.includes('com.google.gms.google-services')) {
                content = content.replace(/plugins\s*\{/, `plugins {\n    id "com.google.gms.google-services" version "4.4.4" apply false`);
            }
            if (usesFirebasePerf && !content.includes('com.google.firebase.firebase-perf')) {
                content = content.replace(/plugins\s*\{/, `plugins {\n    id "com.google.firebase.firebase-perf" version "1.4.1" apply false`);
            }
            if (usesCrashlytics && !content.includes('com.google.firebase.crashlytics')) {
                content = content.replace(/plugins\s*\{/, `plugins {\n    id "com.google.firebase.crashlytics" version "2.8.1" apply false`);
            }
        }
        fs.writeFileSync(settingsGradlePath, content);
    }

    // ----- 3. MIGRATE BUILD.GRADLE (PROJECT LEVEL) -----
    if (fs.existsSync(projectBuildGradlePath)) {
        let content = fs.readFileSync(projectBuildGradlePath, 'utf8');
        
        // Remove buildscript block entirely using simple bracket counting
        const startIndex = content.indexOf('buildscript {');
        if (startIndex !== -1) {
            let braceCount = 0;
            let endIndex = -1;
            // The brace opens at index: content.indexOf('{', startIndex)
            const openBraceIndex = content.indexOf('{', startIndex);
            if (openBraceIndex !== -1) {
                for (let i = openBraceIndex; i < content.length; i++) {
                    if (content[i] === '{') braceCount++;
                    if (content[i] === '}') {
                        braceCount--;
                        if (braceCount === 0) {
                            endIndex = i;
                            break;
                        }
                    }
                }
                if (endIndex !== -1) {
                    content = content.substring(0, startIndex) + content.substring(endIndex + 1);
                }
            }
        }
        fs.writeFileSync(projectBuildGradlePath, content.trim() + '\n');
    }

    // ----- 4. MIGRATE APP/BUILD.GRADLE -----
    if (fs.existsSync(appBuildGradlePath)) {
        let content = fs.readFileSync(appBuildGradlePath, 'utf8');

        // Remove `id "kotlin-android"`
        content = content.replace(/\s*id\s+['"]kotlin-android['"]\s*/g, '\n    ');

        // Remove legacy `kotlinOptions { ... }` block completely
        let kotlinOptionsStart = content.indexOf('kotlinOptions {');
        if (kotlinOptionsStart !== -1) {
            let braceCount = 0;
            let kotlinOptionsEnd = -1;
            const openBrace = content.indexOf('{', kotlinOptionsStart);
            if (openBrace !== -1) {
                for (let i = openBrace; i < content.length; i++) {
                    if (content[i] === '{') braceCount++;
                    if (content[i] === '}') {
                        braceCount--;
                        if (braceCount === 0) {
                            kotlinOptionsEnd = i;
                            break;
                        }
                    }
                }
                if (kotlinOptionsEnd !== -1) {
                    content = content.substring(0, kotlinOptionsStart) + content.substring(kotlinOptionsEnd + 1);
                }
            }
        }

        // Add root-level kotlin block if missing
        if (!content.includes('kotlin {')) {
            const rootKotlinBlock = `\nkotlin {\n    compilerOptions {\n        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17\n    }\n}\n`;
            content = content.replace(/android\s*\{/, `${rootKotlinBlock}android {`);
        }

        // Update SDK versions
        content = content.replace(/compileSdkVersion\s+\d+/g, 'compileSdk 37');
        content = content.replace(/targetSdkVersion\s+\d+/g, 'targetSdkVersion 37');

        // Update or add ndkVersion using flutter's variable
        if (content.includes('ndkVersion')) {
            content = content.replace(/ndkVersion\s+["'][^"']+["']/g, 'ndkVersion flutter.ndkVersion');
        } else {
            content = content.replace(/compileSdk\s+37/, `compileSdk 37\n    ndkVersion flutter.ndkVersion`);
        }

        // Inject useLibrary
        if (!content.includes("useLibrary 'org.apache.http.legacy'")) {
            content = content.replace(/compileSdk\s+37/, `compileSdk 37\n    useLibrary 'org.apache.http.legacy'`);
        }

        fs.writeFileSync(appBuildGradlePath, content);
    }

    // ----- 5. MIGRATE GRADLE WRAPPER PROPERTIES -----
    if (fs.existsSync(wrapperPropertiesPath)) {
        let content = fs.readFileSync(wrapperPropertiesPath, 'utf8');
        content = content.replace(/distributionUrl=.*/g, 'distributionUrl=https\\://services.gradle.org/distributions/gradle-8.14.3-all.zip');
        fs.writeFileSync(wrapperPropertiesPath, content);
    }
}

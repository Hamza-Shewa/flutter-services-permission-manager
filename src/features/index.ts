/**
 * Features umbrella barrel
 *
 * Re-exports every feature module plus the shared platform write services and
 * the save orchestrator. Consumers can import the whole surface from here or
 * from an individual feature barrel (src/features/<feature>/index.ts).
 */

// Feature barrels
export * from './permissions/index.js';
export * from './services/index.js';
export * from './build/index.js';
export * from './migration/index.js';
export * from './packages/index.js';
export * from './assets/index.js';
export * from './localization/index.js';

// Shared platform write services + save orchestrator
export * from '../core/platform/android/index.js';
export * from '../core/platform/ios/index.js';
export * from '../core/document.service.js';

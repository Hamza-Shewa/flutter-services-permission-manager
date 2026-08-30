/**
 * Services feature barrel
 *
 * Public API for third-party service integration extraction, validation and
 * app-link intent parsing.
 */

export {
    extractServices,
    extractServicesFromAndroid,
    extractServicesFromIOS,
    extractServicesFromAppDelegate,
    extractServicesFromIOSEntitlements
} from './extractor.service.js';

export { validateServiceEntry } from './validator.service.js';

export { extractApplinkIntents } from './intent-parser.js';

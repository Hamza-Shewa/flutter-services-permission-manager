const fs = require('fs');

const file = 'src/services/services-extractor.service.ts';
let content = fs.readFileSync(file, 'utf8');

// Fix logger.debug string interpolation
content = content.replace(
  /logger\.debug\('\[Services Extractor\] Services config count:', servicesConfig\.length\);/g,
  "logger.debug(`[Services Extractor] Services config count: ${servicesConfig.length}`);"
);

// Fix logger.error passing 'unknown' error parameter
content = content.replace(
  /logger\.error\(`Failed to parse google-services\.json`, error\);/g,
  "logger.error(`Failed to parse google-services.json`, error instanceof Error ? error : new Error(String(error)));"
);
content = content.replace(
  /logger\.error\('\[Services Extractor\] Error extracting services from Android manifest:', error\);/g,
  "logger.error('[Services Extractor] Error extracting services from Android manifest:', error instanceof Error ? error : new Error(String(error)));"
);
content = content.replace(
  /logger\.error\('\[Services Extractor\] Error extracting services from iOS plist:', error\);/g,
  "logger.error('[Services Extractor] Error extracting services from iOS plist:', error instanceof Error ? error : new Error(String(error)));"
);
content = content.replace(
  /logger\.error\('\[Services Extractor\] Error extracting services from Podfile:', error\);/g,
  "logger.error('[Services Extractor] Error extracting services from Podfile:', error instanceof Error ? error : new Error(String(error)));"
);
content = content.replace(
  /logger\.error\('\[Services Extractor\] Error extracting services from AppDelegate:', error\);/g,
  "logger.error('[Services Extractor] Error extracting services from AppDelegate:', error instanceof Error ? error : new Error(String(error)));"
);
content = content.replace(
  /logger\.error\('\[Services Extractor\] Error extracting services from Entitlements:', error\);/g,
  "logger.error('[Services Extractor] Error extracting services from Entitlements:', error instanceof Error ? error : new Error(String(error)));"
);
content = content.replace(
  /logger\.error\('\[Services Extractor\] Error resolving string reference:', error\);/g,
  "logger.error('[Services Extractor] Error resolving string reference:', error instanceof Error ? error : new Error(String(error)));"
);


fs.writeFileSync(file, content, 'utf8');
console.log('Fixed services-extractor.service.ts logger errors');

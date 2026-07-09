import * as fs from 'fs';
import * as path from 'path';

/**
 * Loads a fixture file as a string for use in tests.
 * @param relativePath Path to the fixture relative to src/test/fixtures
 * @returns The contents of the fixture file
 */
export function loadFixture(relativePath: string): string {
    const fixturePath = path.join(__dirname, '..', '..', 'src', 'test', 'fixtures', relativePath);
    return fs.readFileSync(fixturePath, 'utf8');
}

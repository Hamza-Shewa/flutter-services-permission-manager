import { defineConfig } from '@vscode/test-cli';

export default defineConfig([
    {
        label: 'unitTests',
        files: 'out/test/**/*.test.js',
        version: '1.80.0',
        workspaceFolder: './src/test/fixtures',
        mocha: {
            ui: 'tdd',
            timeout: 20000
        }
    }
]);

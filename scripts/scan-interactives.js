#!/usr/bin/env node
/*
 * Standalone CLI for the Flutter Semantics inventory.
 * Run `npm run compile` first when using it from a source checkout.
 */

const path = require("path");
const { scanInteractives } = require("../out/features/semantics/scanner.js");

function valuesFor(argv, name) {
  const values = [];
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === name && argv[index + 1]) {
      values.push(argv[++index]);
    }
  }
  return values;
}

async function main() {
  const argv = process.argv.slice(2);
  const pathIndex = argv.indexOf("--path");
  const root = path.resolve(pathIndex >= 0 && argv[pathIndex + 1] ? argv[pathIndex + 1] : process.cwd());
  const result = await scanInteractives(root, {
    excludedGlobs: valuesFor(argv, "--exclude"),
    customWidgets: valuesFor(argv, "--custom-widget"),
    callbackNames: valuesFor(argv, "--callback"),
    ignoredWidgets: valuesFor(argv, "--ignore-widget"),
  });
  process.stdout.write(`${JSON.stringify(result, null, argv.includes("--pretty") ? 2 : 0)}\n`);
}

main().catch((error) => {
  process.stderr.write(`scan-interactives: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

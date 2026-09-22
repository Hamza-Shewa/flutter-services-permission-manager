import * as assert from "assert";
import * as vscode from "vscode";
import { WORKSPACE_SEARCH_EXCLUDE } from "../../core/constants/index.js";
import { discoverProjectFiles } from "../../core/workspace.service.js";

suite("Workspace file discovery", () => {
  test("WORKSPACE_SEARCH_EXCLUDE filters out a duplicate project copy under a tool worktree directory", async () => {
    // The fixture workspace also has a decoy AndroidManifest.xml under
    // `.kilo/worktrees/fake-worktree/android/app/src/main/`, mirroring what
    // a git-worktree-creating extension (e.g. Kilo Code) leaves behind.
    // `findFiles` doesn't document a result order, so asserting on "which
    // one comes first" would be filesystem-dependent - what actually matters
    // is that the exclude glob removes the decoy from the results entirely.
    const unfiltered = await vscode.workspace.findFiles("**/app/src/main/AndroidManifest.xml", undefined, 10);
    assert.ok(
      unfiltered.some((uri) => uri.fsPath.replace(/\\/g, "/").includes("/.kilo/")),
      "test fixture setup is broken: expected the decoy manifest to exist and be found without an exclude",
    );

    const filtered = await vscode.workspace.findFiles("**/app/src/main/AndroidManifest.xml", WORKSPACE_SEARCH_EXCLUDE, 10);
    const filteredPaths = filtered.map((uri) => uri.fsPath.replace(/\\/g, "/"));
    assert.ok(!filteredPaths.some((p) => p.includes("/.kilo/")), `decoy should have been excluded: ${filteredPaths.join(", ")}`);
    assert.ok(filteredPaths.some((p) => p.endsWith("/fixtures/android/app/src/main/AndroidManifest.xml")));
  });

  test("discoverProjectFiles resolves the real AndroidManifest.xml, not the worktree decoy", async () => {
    const files = await discoverProjectFiles();
    assert.ok(files.androidManifestUri, "expected an AndroidManifest.xml to be found");
    const foundPath = files.androidManifestUri!.fsPath.replace(/\\/g, "/");
    assert.ok(!foundPath.includes("/.kilo/"), `expected the real manifest, got a worktree decoy: ${foundPath}`);
    assert.ok(foundPath.endsWith("/android/app/src/main/AndroidManifest.xml"));
  });
});

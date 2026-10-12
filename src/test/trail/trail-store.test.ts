import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  TRAILS_FILE,
  annotateTrails,
  deleteTrail,
  readTrails,
  saveTrail,
  scanRouteGraph,
  slugify,
  validateTrail,
  type TrailGraph,
} from "../../features/trail/index.js";

suite("Trail store", () => {
  const fixture = path.resolve(__dirname, "../../../src/test/fixtures/trail_project");
  let root: string;
  let graph: TrailGraph;

  setup(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "fcm-trail-store-"));
    fs.cpSync(fixture, root, { recursive: true });
    graph = await scanRouteGraph(root);
  });

  teardown(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const minimal = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    title: "Sign in",
    steps: [
      { title: "Launch", kind: "screen", route: "AppRoute.splash" },
      { title: "Log in", kind: "screen", route: "AppRoute.login" },
    ],
    ...overrides,
  });

  test("derives ids from the title and numbers steps that have none", () => {
    assert.strictEqual(slugify("Pay with LyPay!"), "pay-with-lypay");
    const result = validateTrail(root, minimal(), graph);
    assert.ok(result.ok);
    if (result.ok) {
      assert.strictEqual(result.trail.id, "sign-in");
      assert.deepStrictEqual(result.trail.steps.map((step) => step.id), ["s1", "s2"]);
    }
  });

  test("saves, replaces by id and keeps other trails", () => {
    const first = saveTrail(root, minimal(), graph);
    assert.strictEqual(first.created, true);
    saveTrail(root, minimal({ title: "Other", steps: [{ title: "Only", kind: "screen", route: "AppRoute.login" }] }), graph);
    const replaced = saveTrail(root, minimal({ steps: [{ title: "Only login", kind: "screen", route: "AppRoute.login" }] }), graph);
    assert.strictEqual(replaced.created, false);
    const trails = readTrails(root);
    assert.deepStrictEqual(trails.map((trail) => trail.id), ["sign-in", "other"]);
    assert.strictEqual(trails[0].steps.length, 1);
    assert.ok(fs.readFileSync(path.join(root, TRAILS_FILE), "utf8").endsWith("\n"));
  });

  test("reports every problem in one pass", () => {
    const result = validateTrail(root, {
      title: "",
      id: "Not A Slug",
      steps: [
        { id: "a", title: "A", kind: "teleport" },
        { id: "a", title: "B", kind: "screen", route: "login", branches: [{ label: "x", to: "ghost" }] },
        { id: "c", title: "C", kind: "screen", source: { path: "lib/missing.dart" }, optional: "yes" },
      ],
    }, graph);
    assert.ok(!result.ok);
    if (!result.ok) {
      const joined = result.errors.join("\n");
      assert.ok(joined.includes("title is required"));
      assert.ok(joined.includes('id "Not A Slug"'));
      assert.ok(joined.includes("kind must be one of"));
      assert.ok(joined.includes('Step id "a" is used twice'));
      assert.ok(joined.includes('"ghost"'));
      assert.ok(joined.includes("lib/missing.dart"));
      assert.ok(joined.includes("optional must be a boolean"));
    }
  });

  test("resolves a unique loose route name and suggests candidates for an ambiguous one", () => {
    const loose = validateTrail(root, minimal({ steps: [{ title: "Receipt", kind: "screen", route: "ReceiptPage" }] }), graph);
    assert.ok(loose.ok && loose.trail.steps[0].route === "AppRoute.receipt" && loose.warnings.length === 1);
    const ambiguous = validateTrail(root, minimal({ steps: [{ title: "Beneficiary", kind: "screen", route: "benef" }] }), graph);
    assert.ok(!ambiguous.ok);
    if (!ambiguous.ok) {
      assert.ok(ambiguous.errors[0].includes("AppRoute.beneficiaries") && ambiguous.errors[0].includes("AppRoute.beneficiary"), "both candidates are offered");
    }
  });

  test("rejects absolute and escaping source paths even when the file exists", () => {
    for (const source of [path.join(root, "pubspec.yaml"), "../pubspec.yaml", "lib/../../pubspec.yaml"]) {
      const result = validateTrail(root, minimal({ steps: [{ title: "x", kind: "action", source: { path: source } }] }), graph);
      assert.ok(!result.ok, `accepted ${source}`);
    }
    const inside = validateTrail(root, minimal({ steps: [{ title: "x", kind: "action", source: { path: "lib/pages/splash_page.dart", line: 3 } }] }), graph);
    assert.ok(inside.ok);
  });

  test("never overwrites a trails file it cannot read", () => {
    const file = path.join(root, TRAILS_FILE);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "{ not json", "utf8");
    assert.throws(() => saveTrail(root, minimal(), graph), /not valid JSON/);
    assert.strictEqual(fs.readFileSync(file, "utf8"), "{ not json");
    fs.writeFileSync(file, JSON.stringify({ version: 2, trails: [] }), "utf8");
    assert.throws(() => readTrails(root), /unsupported format/);
  });

  test("deletes by id and reports whether it existed", () => {
    saveTrail(root, minimal(), graph);
    assert.strictEqual(deleteTrail(root, "missing"), false);
    assert.strictEqual(deleteTrail(root, "sign-in"), true);
    assert.deepStrictEqual(readTrails(root), []);
  });

  test("flags a trail whose route or file no longer exists", async () => {
    saveTrail(root, minimal({ steps: [
      { title: "Launch", kind: "screen", route: "AppRoute.splash", source: { path: "lib/pages/splash_page.dart" } },
      { title: "Receipt", kind: "screen", route: "AppRoute.receipt" },
    ] }), graph);
    const [healthy] = annotateTrails(root, readTrails(root), graph);
    assert.deepStrictEqual(healthy.issues, []);

    fs.rmSync(path.join(root, "lib/pages/splash_page.dart"));
    const withoutReceipt: TrailGraph = { ...graph, routes: graph.routes.filter((route) => route.id !== "AppRoute.receipt") };
    const [annotated] = annotateTrails(root, readTrails(root), withoutReceipt);
    assert.ok(annotated.issues.some((issue) => issue.includes("splash_page.dart")));
    assert.ok(annotated.issues.some((issue) => issue.includes("AppRoute.receipt")));
    assert.strictEqual(annotated.issues.length, 2);
  });
});

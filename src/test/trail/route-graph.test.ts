import * as assert from "assert";
import * as path from "path";
import {
  buildTrailPrompt,
  findRoutePaths,
  resolveRoutes,
  scanRouteGraph,
  toMermaid,
  type TrailEdge,
  type TrailGraph,
} from "../../features/trail/index.js";

suite("Trail route graph", () => {
  const fixture = path.resolve(__dirname, "../../../src/test/fixtures/trail_project");
  let graph: TrailGraph;

  const edgesBetween = (from: string | null, to: string): TrailEdge[] =>
    graph.edges.filter((edge) => edge.from === from && edge.to === to);

  suiteSetup(async () => {
    graph = await scanRouteGraph(fixture);
  });

  test("finds go_router, enum-backed and Navigator routes and skips generated files", () => {
    const ids = graph.routes.map((route) => route.id);
    for (const id of ["AppRoute.splash", "AppRoute.login", "AppRoute.financeMenu", "AppRoute.receipt", "/legacy"]) {
      assert.ok(ids.includes(id), `missing route ${id}`);
    }
    const login = graph.routes.find((route) => route.id === "AppRoute.login");
    assert.strictEqual(login?.widget, "LoginPage", "the widget behind the _page(...) wrapper is the page, not the wrapper");
    assert.strictEqual(login?.path, "/login", "the path is derived from the enum extension");
    assert.ok(!ids.includes("AppRoute.neverUsed"), "an enum member nothing uses is not a route");
    assert.ok(!graph.edges.some((edge) => edge.to.includes("generated")), "generated files are not scanned");
    assert.deepStrictEqual(graph.entry, ["AppRoute.splash", "widget:LegacyHome"]);
    assert.ok(graph.frameworks.includes("go_router") && graph.frameworks.includes("navigator"));
  });

  test("detects navigation helpers but not functions that only interpolate a parameter", () => {
    const helpers = graph.navigationHelpers.map((helper) => helper.name);
    assert.ok(helpers.includes("pushNavigation"));
    assert.ok(helpers.includes("replace"));
    assert.ok(helpers.includes("showBottomSheet"));
    assert.ok(!helpers.includes("_openDetails"), "push('/details/$id') does not make _openDetails a helper");
    assert.strictEqual(graph.navigationHelpers.find((helper) => helper.name === "replace")?.navigation, "go");
  });

  test("attributes a listener in a part file to its page and keeps the condition", () => {
    const [toFinance] = edgesBetween("AppRoute.login", "AppRoute.financeMenu");
    assert.ok(toFinance, "login -> financeMenu");
    assert.strictEqual(toFinance.attribution, "class");
    assert.strictEqual(toFinance.navigation, "push");
    assert.strictEqual(toFinance.trigger.kind, "state");
    assert.deepStrictEqual(toFinance.guards, ["state.status == Status.success", "state.isActive"]);
    const [toWelcome] = edgesBetween("AppRoute.login", "AppRoute.welcome").filter((edge) => edge.source.path.endsWith("submit_listener.dart"));
    assert.deepStrictEqual(toWelcome.guards, ["state.status == Status.success", "!state.isActive"]);
  });

  test("does not mix up two pages whose listeners use the same private extension name", () => {
    const fromBeneficiary = graph.edges.filter((edge) => edge.source.path.includes("beneficiary/listeners"));
    assert.deepStrictEqual(fromBeneficiary.map((edge) => `${edge.from}>${edge.to}`).sort(), [
      "AppRoute.beneficiary>AppRoute.receipt",
      "AppRoute.beneficiary>AppRoute.result",
    ]);
    const [paid] = edgesBetween("AppRoute.beneficiary", "AppRoute.receipt");
    assert.deepStrictEqual(paid.guards, ["state.paid"]);
    assert.strictEqual(paid.navigation, "go");
  });

  test("attributes a widget used by a page through composition and passes callbacks to the page that wires them", () => {
    const [signUp] = edgesBetween("AppRoute.login", "AppRoute.welcome").filter((edge) => edge.source.path.endsWith("sign_up.dart"));
    assert.strictEqual(signUp.attribution, "composition");
    assert.strictEqual(signUp.trigger.kind, "user");
    assert.strictEqual(signUp.trigger.hint, "onPressed");
    assert.ok(edgesBetween("AppRoute.beneficiaries", "AppRoute.beneficiary").length === 1, "the onTap closure is written in the page, not in BeneficiaryTile");
  });

  test("models a bottom sheet named by a route constant as an overlay with its widget", () => {
    const [toOtp] = edgesBetween("AppRoute.login", "AppRoute.otp");
    assert.ok(toOtp);
    assert.strictEqual(toOtp.navigation, "overlay");
    const otp = graph.routes.find((route) => route.id === "AppRoute.otp");
    assert.strictEqual(otp?.kind, "overlay");
    assert.strictEqual(otp?.widget, "OtpSheet");
  });

  test("keeps every label of a switch fall-through and never writes a double negation", () => {
    const [toLogin] = edgesBetween("AppRoute.splash", "AppRoute.login");
    assert.deepStrictEqual(toLogin.guards, [
      "(state.status == Status.failure || state.status == Status.success)",
      "!state.firstLaunch",
      "state.agreed",
    ]);
    const welcomeGuards = edgesBetween("AppRoute.splash", "AppRoute.welcome").map((edge) => edge.guards.join(" && "));
    assert.ok(welcomeGuards.some((guard) => guard.endsWith("!state.firstLaunch && !state.agreed")));
    assert.ok(graph.edges.every((edge) => edge.guards.every((guard) => !guard.startsWith("!!"))), "no guard starts with !!");
  });

  test("does not read an enum that merely appears in a navigation-like call as a route", () => {
    assert.ok(!graph.routes.some((route) => route.id.startsWith("AlertType.")), "AlertType.warning passed to a dialog helper is not a destination");
    assert.ok(!graph.edges.some((edge) => edge.to.startsWith("AlertType.")));
    assert.ok(graph.routes.some((route) => route.id === "AppRoute.otp"), "the real route enum still resolves");
  });

  test("links the tabs of a StatefulShellRoute to each other", () => {
    const [tab] = edgesBetween("AppRoute.financeMenu", "AppRoute.settings");
    assert.strictEqual(tab?.navigation, "tab");
    assert.ok(edgesBetween("AppRoute.settings", "AppRoute.financeMenu").some((edge) => edge.navigation === "tab"));
  });

  test("reads redirects, Navigator.pushNamed and MaterialPageRoute", () => {
    const redirect = graph.edges.find((edge) => edge.navigation === "redirect" && edge.to === "AppRoute.result");
    assert.strictEqual(redirect?.from, "AppRoute.receipt", "a route's own redirect leaves from that route");
    assert.ok(graph.edges.some((edge) => edge.navigation === "redirect" && edge.to === "AppRoute.welcome" && edge.from === null), "the router-level redirect applies from anywhere");
    assert.ok(edgesBetween("AppRoute.settings", "/legacy").length === 1);
    const [details] = edgesBetween("widget:LegacyHome", "widget:LegacyDetailsPage");
    assert.ok(details, "Navigator.push(MaterialPageRoute(builder: ... LegacyDetailsPage())) leads to that page");
    assert.strictEqual(details.attribution, "class");
  });

  test("ignores a route wrapper that mentions its own route and reports computed destinations", () => {
    assert.ok(!graph.edges.some((edge) => edge.source.path.endsWith("routes.dart") && edge.callee.includes("_page")), "_page(AppRoute.login, ...) is a definition");
    assert.strictEqual(graph.unresolvedNavigation.length, 1);
    assert.strictEqual(graph.unresolvedNavigation[0].expression, "target");
    assert.ok(graph.unresolvedNavigation[0].source.path.endsWith("result_page.dart"));
  });

  test("finds the journey from launch to the receipt, shortest first, with the hop edges", () => {
    const result = findRoutePaths(graph, { to: "AppRoute.receipt", maxPaths: 3 });
    assert.ok(result.paths.length >= 1);
    assert.deepStrictEqual(result.paths[0].routes, [
      "AppRoute.splash",
      "AppRoute.login",
      "AppRoute.financeMenu",
      "AppRoute.lypay",
      "AppRoute.beneficiaries",
      "AppRoute.beneficiary",
      "AppRoute.receipt",
    ]);
    assert.ok(result.paths[0].hops.every((hop) => hop.edgeIds.length > 0));
    assert.strictEqual(result.paths[0].weakestAttribution, "class");
    assert.ok(result.paths.every((path, index) => index === 0 || path.routes.length >= result.paths[index - 1].routes.length));
  });

  test("resolves routes by id, path, widget or loose text and reports ambiguity", () => {
    assert.strictEqual(resolveRoutes(graph, "/login")[0].id, "AppRoute.login");
    assert.strictEqual(resolveRoutes(graph, "ReceiptPage")[0].id, "AppRoute.receipt");
    assert.ok(resolveRoutes(graph, "lypay").some((route) => route.id === "AppRoute.lypay"));
    const missing = findRoutePaths(graph, { to: "doesNotExist" });
    assert.ok(missing.error);
    const ambiguous = findRoutePaths(graph, { to: "page" });
    assert.ok(ambiguous.error?.includes("several") || ambiguous.error?.includes("No route"));
  });

  test("draws a Mermaid flowchart and builds a prompt that names the gaps", () => {
    const mermaid = toMermaid(graph, { routes: ["AppRoute.login", "AppRoute.financeMenu"] });
    assert.ok(mermaid.startsWith("flowchart TD"));
    assert.ok(mermaid.includes("n_AppRoute_login -.->"));
    assert.ok(!mermaid.includes("AppRoute_receipt"));
    const prompt = buildTrailPrompt(graph, "pay with LyPay");
    assert.ok(prompt.includes("Journey to map: pay with LyPay"));
    assert.ok(prompt.includes("find_route_paths"));
    assert.ok(prompt.includes("save_trail"));
    assert.ok(prompt.includes("result_page.dart"), "computed destinations are listed for the agent");
    assert.ok(prompt.includes("First-launch"));
  });
});

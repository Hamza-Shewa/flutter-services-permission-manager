import * as assert from "assert";
import * as path from "path";
import { scanRouteGraph, type TrailEdge, type TrailGraph } from "../../features/trail/index.js";

/**
 * One small project per routing package, written from that package's documented API. They prove the scan reads each
 * package's declarations and navigation calls; the go_router and Fluro behaviour is additionally checked on real apps.
 */
suite("Trail routing packages", () => {
  const fixtures = path.resolve(__dirname, "../../../src/test/fixtures/trail_routers");
  const scan = (name: string): Promise<TrailGraph> => scanRouteGraph(path.join(fixtures, name));
  const edge = (graph: TrailGraph, from: string, to: string): TrailEdge | undefined =>
    graph.edges.find((candidate) => candidate.from === from && candidate.to === to);
  const ids = (graph: TrailGraph): string[] => graph.routes.map((route) => route.id).sort();

  test("fluro: define() with Handler variables, a navigateTo helper and a literal path pattern", async () => {
    const graph = await scan("fluro_app");
    assert.deepStrictEqual(ids(graph), ["/", "/details/:id", "/home"]);
    assert.strictEqual(graph.routes.find((route) => route.id === "/home")?.widget, "HomePage", "the widget comes from the handler variable");
    assert.strictEqual(graph.routes.find((route) => route.id === "/")?.framework, "fluro");
    assert.deepStrictEqual(graph.entry, ["/"]);
    assert.ok(graph.navigationHelpers.some((helper) => helper.name === "navigateTo"), "Routes.navigateTo forwards its route to the router");
    assert.strictEqual(edge(graph, "/", "/home")?.callee, "Routes.navigateTo");
    assert.ok(edge(graph, "/home", "/details/:id"), "'/details/42' matches the '/details/:id' pattern");
    assert.strictEqual(graph.routers[0].package, "fluro");
  });

  test("auto_route: @RoutePage classes, generated route names, config paths and router.push(XRoute())", async () => {
    const graph = await scan("auto_route_app");
    assert.deepStrictEqual(ids(graph), ["HomeRoute", "ProfileRoute", "SettingsRoute"], "HomePage -> HomeRoute, SettingsScreen -> SettingsRoute, @RoutePage(name:) wins");
    assert.strictEqual(graph.routes.find((route) => route.id === "SettingsRoute")?.path, "/settings", "the AutoRoute(...) config adds the path");
    assert.deepStrictEqual(graph.entry, ["HomeRoute"], "initial: true");
    assert.strictEqual(edge(graph, "HomeRoute", "SettingsRoute")?.navigation, "push");
    assert.strictEqual(edge(graph, "HomeRoute", "ProfileRoute")?.navigation, "replace");
    assert.strictEqual(edge(graph, "SettingsRoute", "HomeRoute")?.navigation, "go", "replaceAll([HomeRoute()])");
    assert.ok(edge(graph, "ProfileRoute", "SettingsRoute"), "navigate(SettingsRoute())");
  });

  test("getx: GetPage tables with const names, Get.toNamed/offAllNamed, Get.to(() => Page()) and Get.dialog", async () => {
    const graph = await scan("getx_app");
    assert.deepStrictEqual(ids(graph), ["/home", "/login", "/settings", "overlay:ConfirmDialog", "widget:AboutPage"]);
    assert.deepStrictEqual(graph.entry, ["/login"]);
    assert.strictEqual(edge(graph, "/login", "/home")?.navigation, "go");
    assert.strictEqual(edge(graph, "/home", "/settings")?.navigation, "push");
    assert.strictEqual(edge(graph, "/settings", "/login")?.navigation, "replace");
    assert.ok(edge(graph, "/home", "widget:AboutPage"), "Get.to(() => AboutPage()) pushes the page directly");
    assert.strictEqual(edge(graph, "/home", "overlay:ConfirmDialog")?.navigation, "overlay");
  });

  test("flutter_modular: module path prefixes, r.child / r.module and ChildRoute", async () => {
    const graph = await scan("modular_app");
    assert.deepStrictEqual(ids(graph), ["/", "/auth/login", "/auth/register", "/legacy"], "AuthModule's routes are prefixed with /auth and the mount itself is not a screen");
    assert.ok(edge(graph, "/", "/auth/login"));
    assert.ok(edge(graph, "/auth/login", "/"));
    assert.ok(edge(graph, "/auth/login", "/auth/register"));
  });

  test("beamer: routes map, BeamLocation classes and beamToNamed / beamTo(Location())", async () => {
    const graph = await scan("beamer_app");
    assert.deepStrictEqual(ids(graph), ["/", "/articles", "/books/:bookId"]);
    assert.strictEqual(graph.routes.find((route) => route.id === "/articles")?.widget, "ArticlesScreen", "the page comes from the location's buildPages");
    assert.deepStrictEqual(graph.entry, ["/"], "initialPath");
    assert.ok(edge(graph, "/", "/books/:bookId"), "'/books/1' matches '/books/:bookId'");
    assert.ok(edge(graph, "/", "/articles"), "beamTo(ArticlesLocation())");
    assert.ok(edge(graph, "/books/:bookId", "/"));
  });

  test("routemaster, vrouter, qlevar and sailor", async () => {
    const routemaster = await scan("routemaster_app");
    assert.deepStrictEqual(ids(routemaster), ["/", "/feed", "/feed/:id"]);
    assert.ok(edge(routemaster, "/", "/feed") && edge(routemaster, "/feed", "/feed/:id") && edge(routemaster, "/feed/:id", "/"));

    const vrouter = await scan("vrouter_app");
    assert.deepStrictEqual(ids(vrouter), ["/", "/settings"]);
    assert.ok(edge(vrouter, "/", "/settings"), "vRouter.to");
    assert.ok(edge(vrouter, "/settings", "/settings"), "vRouter.toNamed('settings') resolves through VWidget(name:)");

    const qlevar = await scan("qlevar_app");
    assert.deepStrictEqual(ids(qlevar), ["/", "/profile"]);
    assert.ok(edge(qlevar, "/", "/profile"), "QR.to");
    assert.ok(edge(qlevar, "/profile", "/profile"), "QR.toName");

    const sailor = await scan("sailor_app");
    assert.deepStrictEqual(ids(sailor), ["/details", "/home"], "SailorRoute(name: '/x', builder:)");
    assert.ok(edge(sailor, "/home", "/details"));
  });

  test("typed go_router: @TypedGoRoute classes with nested routes and HomeRoute().go(context)", async () => {
    const graph = await scan("typed_go_router_app");
    assert.deepStrictEqual(ids(graph), ["DetailsRoute", "HomeRoute"]);
    assert.strictEqual(graph.routes.find((route) => route.id === "DetailsRoute")?.path, "/details/:id", "the nested path is joined to its parent");
    assert.strictEqual(graph.routes.find((route) => route.id === "HomeRoute")?.widget, "HomeScreen", "the page is the one the class's build() returns");
    assert.strictEqual(edge(graph, "HomeRoute", "DetailsRoute")?.callee, "DetailsRoute().go", "const DetailsRoute(id: '1').go(context)");
    assert.strictEqual(edge(graph, "DetailsRoute", "HomeRoute")?.navigation, "push");
  });

  test("onGenerateRoute: switch statements, if chains, Dart 3 switch expressions, const names and destination helpers", async () => {
    const graph = await scan("on_generate_route_app");
    assert.deepStrictEqual(ids(graph), ["/", "/about", "/modern", "/profile", "/settings"]);
    assert.ok(edge(graph, "/", "/profile"), "Navigator.pushNamed(context, RouteNames.profile)");
    assert.ok(edge(graph, "/", "/settings"), "Navigator.of(context).pushNamed('/settings')");
    assert.strictEqual(edge(graph, "/profile", "/about")?.navigation, "replace");
    assert.ok(edge(graph, "/settings", "/modern"), "a route declared by a Dart 3 switch expression");
    const viaHelper = graph.edges.find((candidate) => candidate.callee === "AppNavigator.toAbout");
    assert.strictEqual(viaHelper?.from, "/", "the edge leaves from the screen that calls the helper, not from the helper");
    assert.strictEqual(viaHelper?.to, "/about");
    assert.ok(!graph.edges.some((candidate) => candidate.from === null && candidate.to === "/about"), "the helper's own body adds no edge of unknown origin");
    assert.ok(graph.navigationHelpers.some((helper) => helper.name === "toAbout"));
  });

  test("says so when the project's router is not read instead of returning a silently thin graph", async () => {
    const graph = await scan("unsupported_router_app");
    assert.deepStrictEqual(graph.routers.map((router) => `${router.package}:${router.support}`), ["yeet:none"]);
    assert.ok(graph.diagnostics.some((diagnostic) => diagnostic.message.includes("yeet is used but its routes are not read")));
    assert.ok(graph.diagnostics.some((diagnostic) => diagnostic.message.includes("No routes were found")));
  });
});

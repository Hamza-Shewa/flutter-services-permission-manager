import * as fs from "fs";
import * as path from "path";
import type { DetectedRouter, RouterSupport, TrailFramework } from "./types.js";

interface KnownRouter {
  support: RouterSupport;
  framework?: TrailFramework;
  note: string;
}

/**
 * `full` means the scan has been checked against real apps; `partial` means it reads the package's route
 * declarations and navigation calls from its documented API but has only been tested on small examples;
 * `none` means the package is recognised but its routes are not read.
 */
const KNOWN_ROUTERS: Readonly<Record<string, KnownRouter>> = {
  go_router: { support: "full", framework: "go_router", note: "GoRoute (nested, shell/tabs, redirects) and typed routes from go_router_builder." },
  fluro: { support: "full", framework: "fluro", note: "router.define with Handler variables, and navigateTo." },
  auto_route: { support: "partial", framework: "auto_route", note: "@RoutePage classes, AutoRoute(page:) configuration and router.push(XRoute()). Guards are not read." },
  get: { support: "partial", framework: "get", note: "GetPage tables, Get.toNamed/offNamed/to. Middlewares and bindings are not read." },
  flutter_modular: { support: "partial", framework: "flutter_modular", note: "ChildRoute/ModuleRoute (and r.child/r.module) with module path prefixes. Guards are not read." },
  beamer: { support: "partial", framework: "beamer", note: "routes: {...} maps and BeamLocation pathPatterns. Logic inside buildPages is not evaluated." },
  routemaster: { support: "partial", framework: "routemaster", note: "RouteMap(routes: {...}) and push/replace. Guards and tab pages are not read." },
  vrouter: { support: "partial", framework: "vrouter", note: "VWidget(path:, widget:) and vRouter.to/toNamed." },
  qlevar_router: { support: "partial", framework: "qlevar_router", note: "QRoute(path:, builder:) and QR.to/toName." },
  sailor: { support: "partial", framework: "sailor", note: "SailorRoute(name:, builder:) and Sailor.navigate." },
  yeet: { support: "none", note: "Routes are not read; use the agent or add navigation helpers to flutter-config-manager.trail.navigationCallees." },
  routefly: { support: "none", note: "Routes come from the file system and are not read." },
};

/** The frameworks a detected package corresponds to. */
export function frameworkOf(packageName: string): TrailFramework | undefined {
  return KNOWN_ROUTERS[packageName]?.framework;
}

export function detectRouters(root: string): DetectedRouter[] {
  let pubspec = "";
  try {
    pubspec = fs.readFileSync(path.join(root, "pubspec.yaml"), "utf8");
  } catch {
    return [];
  }
  const detected: DetectedRouter[] = [];
  for (const [name, router] of Object.entries(KNOWN_ROUTERS)) {
    if (new RegExp(`^\\s{1,4}${name}\\s*:`, "m").test(pubspec)) {
      detected.push({ package: name, support: router.support, note: router.note });
    }
  }
  return detected;
}

class Routes {
  static String root = "/";
  static String home = "/home";
  static String details = "/details/:id";

  static void configureRoutes(FluroRouter router) {
    router.define(root, handler: rootHandler);
    router.define(home, handler: homeHandler);
    router.define(details, handler: detailsHandler);
  }

  static Future navigateTo(BuildContext context, String route, {bool clearStack = false}) {
    return Application.router.navigateTo(context, route, clearStack: clearStack);
  }
}

class Routes {
  static void create() {
    final sailor = Sailor();
    sailor.addRoutes([
      SailorRoute(name: '/home', builder: (context, args, params) => const HomePage()),
      SailorRoute(name: '/details', builder: (context, args, params) => const DetailsPage()),
    ]);
  }
}

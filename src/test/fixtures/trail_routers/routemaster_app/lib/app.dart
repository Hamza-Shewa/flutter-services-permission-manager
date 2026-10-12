final routes = RouteMap(
  routes: {
    '/': (_) => const MaterialPage(child: HomePage()),
    '/feed': (_) => MaterialPage(child: FeedPage()),
    '/feed/:id': (info) => MaterialPage(child: FeedItemPage()),
  },
);

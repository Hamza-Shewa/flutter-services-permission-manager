@TypedGoRoute<HomeRoute>(
  path: '/',
  routes: [
    TypedGoRoute<DetailsRoute>(path: 'details/:id'),
  ],
)
class HomeRoute extends GoRouteData {
  const HomeRoute();
  @override
  Widget build(BuildContext context, GoRouterState state) => const HomeScreen();
}

class DetailsRoute extends GoRouteData {
  const DetailsRoute({required this.id});
  final String id;
  @override
  Widget build(BuildContext context, GoRouterState state) => DetailsScreen(id: id);
}

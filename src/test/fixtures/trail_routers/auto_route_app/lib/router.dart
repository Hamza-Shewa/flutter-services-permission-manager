@AutoRouterConfig()
class AppRouter extends RootStackRouter {
  @override
  List<AutoRoute> get routes => [
        AutoRoute(page: HomeRoute.page, path: '/', initial: true),
        AutoRoute(page: SettingsRoute.page, path: '/settings'),
        AutoRoute(page: ProfileRoute.page, path: '/profile'),
      ];
}

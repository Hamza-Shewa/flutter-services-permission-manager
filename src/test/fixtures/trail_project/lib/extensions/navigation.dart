import 'package:go_router/go_router.dart';

extension NavigationHelper on BuildContext {
  Future<T?> pushNavigation<T>(AppRoute route, {Object? extra}) =>
      GoRouter.of(this).push(route.toPath, extra: extra);

  void replace(AppRoute route, {Object? extra}) =>
      GoRouter.of(this).go(route.toPath, extra: extra);

  void showBottomSheet(Widget content, {String? routeName}) =>
      showModalBottomSheet(
        context: this,
        routeSettings: routeName == null ? null : RouteSettings(name: routeName),
        builder: (ctx) => content,
      );

  // Not a navigation helper: the parameter is only interpolated into a path.
  void _openDetails(String id) {
    GoRouter.of(this).push('/details/$id');
  }
}

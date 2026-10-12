class RouteNames {
  static const String home = '/';
  static const String profile = '/profile';
  static const String settings = '/settings';
  static const String about = '/about';
}

class AppRouter {
  Route<dynamic>? generateRoute(RouteSettings settings) {
    switch (settings.name) {
      case RouteNames.home:
        return MaterialPageRoute(builder: (_) => const HomePage());
      case RouteNames.profile:
        return MaterialPageRoute(builder: (_) => ProfilePage(user: settings.arguments as User));
      case '/settings':
        return MaterialPageRoute(builder: (_) => const SettingsPage());
    }
    if (settings.name == RouteNames.about) {
      return MaterialPageRoute(builder: (_) => const AboutPage());
    }
    return null;
  }
}

class DartThreeRouter {
  Route<dynamic> generate(RouteSettings settings) => switch (settings.name) {
        '/modern' => MaterialPageRoute(builder: (_) => const ModernPage()),
        _ => MaterialPageRoute(builder: (_) => const HomePage()),
      };
}

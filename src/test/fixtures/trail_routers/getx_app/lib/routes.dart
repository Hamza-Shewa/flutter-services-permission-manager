abstract class AppRoutes {
  static const home = '/home';
  static const settings = '/settings';
  static const login = '/login';
}

class AppPages {
  static final pages = [
    GetPage(name: AppRoutes.home, page: () => const HomePage()),
    GetPage(name: AppRoutes.settings, page: () => const SettingsPage(), middlewares: [AuthMiddleware()]),
    GetPage(name: '/login', page: () => const LoginPage(), binding: LoginBinding()),
  ];
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});
  @override
  Widget build(BuildContext context) => GetMaterialApp(initialRoute: AppRoutes.login, getPages: AppPages.pages);
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});
  @override
  Widget build(BuildContext context) => VRouter(
        routes: [
          VWidget(path: '/', widget: const HomeScreen()),
          VWidget(path: '/settings', name: 'settings', widget: const SettingsScreen()),
        ],
      );
}

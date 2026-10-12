@RoutePage()
class HomePage extends StatelessWidget {
  const HomePage({super.key});
  @override
  Widget build(BuildContext context) => Column(children: [
        TextButton(onPressed: () => context.router.push(const SettingsRoute()), child: const Text('Settings')),
        TextButton(onPressed: () => AutoRouter.of(context).replace(ProfileRoute(id: 1)), child: const Text('Profile')),
      ]);
}

@RoutePage()
class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});
  @override
  Widget build(BuildContext context) =>
      TextButton(onPressed: () => context.router.replaceAll([const HomeRoute()]), child: const Text('Reset'));
}

@RoutePage(name: 'ProfileRoute')
class UserProfilePage extends StatelessWidget {
  const UserProfilePage({super.key, required this.id});
  final int id;
  @override
  Widget build(BuildContext context) =>
      TextButton(onPressed: () => context.router.navigate(const SettingsRoute()), child: const Text('Back'));
}

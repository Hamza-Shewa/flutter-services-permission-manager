class HomePage extends StatelessWidget {
  const HomePage({super.key});
  @override
  Widget build(BuildContext context) => Column(children: [TextButton(onPressed: () => Navigator.pushNamed(context, RouteNames.profile), child: const Text('Profile')), TextButton(onPressed: () => Navigator.of(context).pushNamed('/settings'), child: const Text('Settings')), TextButton(onPressed: () => AppNavigator.toAbout(context), child: const Text('About'))]);
}
class ProfilePage extends StatelessWidget {
  const ProfilePage({super.key});
  @override
  Widget build(BuildContext context) => TextButton(onPressed: () => Navigator.pushReplacementNamed(context, RouteNames.about), child: const Text('About'));
}
class SettingsPage extends StatelessWidget {
  const SettingsPage({super.key});
  @override
  Widget build(BuildContext context) => TextButton(onPressed: () => Navigator.pushNamed(context, '/modern'), child: const Text('Modern'));
}
class AboutPage extends StatelessWidget {
  const AboutPage({super.key});
  @override
  Widget build(BuildContext context) => const SizedBox();
}
class ModernPage extends StatelessWidget {
  const ModernPage({super.key});
  @override
  Widget build(BuildContext context) => const SizedBox();
}

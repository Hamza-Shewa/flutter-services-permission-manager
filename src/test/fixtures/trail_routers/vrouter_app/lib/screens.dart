class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});
  @override
  Widget build(BuildContext context) => TextButton(onPressed: () => context.vRouter.to('/settings'), child: const Text('Settings'));
}
class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});
  @override
  Widget build(BuildContext context) => TextButton(onPressed: () => context.vRouter.toNamed('settings'), child: const Text('Again'));
}

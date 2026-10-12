class LoginPage extends StatelessWidget {
  const LoginPage({super.key});
  @override
  Widget build(BuildContext context) => TextButton(onPressed: () => Get.offAllNamed(AppRoutes.home), child: const Text('Login'));
}
class HomePage extends StatelessWidget {
  const HomePage({super.key});
  @override
  Widget build(BuildContext context) => Column(children: [TextButton(onPressed: () => Get.toNamed(AppRoutes.settings), child: const Text('Settings')), TextButton(onPressed: () => Get.to(() => const AboutPage()), child: const Text('About')), TextButton(onPressed: () => Get.dialog(const ConfirmDialog()), child: const Text('Confirm'))]);
}
class SettingsPage extends StatelessWidget {
  const SettingsPage({super.key});
  @override
  Widget build(BuildContext context) => TextButton(onPressed: () => Get.offNamed('/login'), child: const Text('Log out'));
}
class AboutPage extends StatelessWidget {
  const AboutPage({super.key});
  @override
  Widget build(BuildContext context) => const SizedBox();
}
class ConfirmDialog extends StatelessWidget {
  const ConfirmDialog({super.key});
  @override
  Widget build(BuildContext context) => const SizedBox();
}

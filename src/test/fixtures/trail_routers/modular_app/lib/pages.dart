class HomePage extends StatelessWidget {
  const HomePage({super.key});
  @override
  Widget build(BuildContext context) => TextButton(onPressed: () => Modular.to.pushNamed('/auth/login'), child: const Text('Login'));
}
class LoginPage extends StatelessWidget {
  const LoginPage({super.key});
  @override
  Widget build(BuildContext context) => Column(children: [TextButton(onPressed: () => Modular.to.navigate('/'), child: const Text('Done')), TextButton(onPressed: () => Modular.to.pushNamed('/auth/register'), child: const Text('Register'))]);
}
class RegisterPage extends StatelessWidget {
  const RegisterPage({super.key});
  @override
  Widget build(BuildContext context) => const SizedBox();
}
class LegacyPage extends StatelessWidget {
  const LegacyPage({super.key});
  @override
  Widget build(BuildContext context) => const SizedBox();
}

class SplashPage extends StatelessWidget {
  const SplashPage({super.key});
  @override
  Widget build(BuildContext context) => TextButton(onPressed: () => Routes.navigateTo(context, Routes.home, clearStack: true), child: const Text('Go'));
}
class HomePage extends StatelessWidget {
  const HomePage({super.key});
  @override
  Widget build(BuildContext context) => TextButton(onPressed: () => Application.router.navigateTo(context, '/details/42'), child: const Text('Open'));
}
class DetailsPage extends StatelessWidget {
  const DetailsPage({super.key});
  @override
  Widget build(BuildContext context) => const SizedBox();
}

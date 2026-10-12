class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});
  @override
  Widget build(BuildContext context) => TextButton(onPressed: () => const DetailsRoute(id: '1').go(context), child: const Text('Details'));
}
class DetailsScreen extends StatelessWidget {
  const DetailsScreen({super.key});
  @override
  Widget build(BuildContext context) => TextButton(onPressed: () => HomeRoute().push(context), child: const Text('Home'));
}

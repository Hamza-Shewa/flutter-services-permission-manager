class HomePage extends StatelessWidget {
  const HomePage({super.key});
  @override
  Widget build(BuildContext context) => TextButton(onPressed: () => Sailor.instance.navigate('/details'), child: const Text('Details'));
}
class DetailsPage extends StatelessWidget {
  const DetailsPage({super.key});
  @override
  Widget build(BuildContext context) => const SizedBox();
}

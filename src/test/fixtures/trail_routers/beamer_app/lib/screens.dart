class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});
  @override
  Widget build(BuildContext context) => Column(children: [TextButton(onPressed: () => context.beamToNamed('/books/1'), child: const Text('Book')), TextButton(onPressed: () => Beamer.of(context).beamTo(ArticlesLocation()), child: const Text('Articles'))]);
}
class BookDetailsScreen extends StatelessWidget {
  const BookDetailsScreen({super.key});
  @override
  Widget build(BuildContext context) => TextButton(onPressed: () => context.beamToNamed('/'), child: const Text('Home'));
}
class ArticlesScreen extends StatelessWidget {
  const ArticlesScreen({super.key});
  @override
  Widget build(BuildContext context) => const SizedBox();
}

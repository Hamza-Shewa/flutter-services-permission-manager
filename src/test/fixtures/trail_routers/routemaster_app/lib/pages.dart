class HomePage extends StatelessWidget {
  const HomePage({super.key});
  @override
  Widget build(BuildContext context) => TextButton(onPressed: () => Routemaster.of(context).push('/feed'), child: const Text('Feed'));
}
class FeedPage extends StatelessWidget {
  const FeedPage({super.key});
  @override
  Widget build(BuildContext context) => TextButton(onPressed: () => Routemaster.of(context).push('/feed/7'), child: const Text('Item'));
}
class FeedItemPage extends StatelessWidget {
  const FeedItemPage({super.key});
  @override
  Widget build(BuildContext context) => TextButton(onPressed: () => Routemaster.of(context).replace('/'), child: const Text('Home'));
}

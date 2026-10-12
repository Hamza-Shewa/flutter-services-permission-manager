final routerDelegate = BeamerDelegate(
  initialPath: '/',
  locationBuilder: RoutesLocationBuilder(
    routes: {
      '/': (context, state, data) => const BeamPage(key: ValueKey('home'), child: HomeScreen()),
      '/books/:bookId': (context, state, data) => BeamPage(key: ValueKey('book'), child: BookDetailsScreen()),
    },
  ),
);

class ArticlesLocation extends BeamLocation<BeamState> {
  @override
  List<String> get pathPatterns => ['/articles'];

  @override
  List<BeamPage> buildPages(BuildContext context, BeamState state) => [
        BeamPage(key: const ValueKey('articles'), child: ArticlesScreen()),
      ];
}

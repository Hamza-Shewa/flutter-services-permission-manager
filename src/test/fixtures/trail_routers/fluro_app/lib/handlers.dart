var rootHandler = Handler(handlerFunc: (BuildContext? context, Map<String, List<String>> params) => SplashPage());
var homeHandler = Handler(handlerFunc: (BuildContext? context, Map<String, List<String>> params) => const HomePage());
var detailsHandler = Handler(handlerFunc: (BuildContext? context, Map<String, List<String>> params) => DetailsPage(id: params['id']![0]));

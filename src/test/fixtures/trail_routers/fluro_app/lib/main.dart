class MyApp extends StatelessWidget {
  const MyApp({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(initialRoute: Routes.root, onGenerateRoute: Application.router.generator);
}

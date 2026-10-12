class LegacyApp extends StatelessWidget {
  const LegacyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      home: const LegacyHome(),
      routes: {
        '/legacy': (context) => const LegacyPage(),
      },
    );
  }
}

class LegacyHome extends StatelessWidget {
  const LegacyHome({super.key});

  @override
  Widget build(BuildContext context) {
    return TextButton(
      onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const LegacyDetailsPage())),
      child: const Text('Details'),
    );
  }
}

class LegacyPage extends StatelessWidget {
  const LegacyPage({super.key});
  @override
  Widget build(BuildContext context) => const SizedBox();
}

class LegacyDetailsPage extends StatelessWidget {
  const LegacyDetailsPage({super.key});
  @override
  Widget build(BuildContext context) => const SizedBox();
}

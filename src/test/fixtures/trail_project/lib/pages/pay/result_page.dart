class ResultPage extends StatelessWidget {
  const ResultPage({super.key});

  @override
  Widget build(BuildContext context) {
    final target = computeTarget();
    return TextButton(onPressed: () => context.go(target), child: const Text('Back'));
  }
}

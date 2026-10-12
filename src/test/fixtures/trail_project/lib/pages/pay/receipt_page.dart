class ReceiptPage extends StatelessWidget {
  const ReceiptPage({super.key});

  @override
  Widget build(BuildContext context) {
    return TextButton(onPressed: () => context.replace(AppRoute.financeMenu), child: const Text('Done'));
  }
}

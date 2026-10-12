class FinanceMenuPage extends StatelessWidget {
  const FinanceMenuPage({super.key});

  @override
  Widget build(BuildContext context) {
    return ListTile(
      onTap: () => context.pushNavigation(AppRoute.lypay),
      title: const Text('LyPay'),
    );
  }
}

class LyPayPage extends StatelessWidget {
  const LyPayPage({super.key});

  @override
  Widget build(BuildContext context) {
    return ElevatedButton(
      onPressed: () => context.pushNavigation(AppRoute.beneficiaries),
      child: const Text('Pay with LyPay'),
    );
  }
}

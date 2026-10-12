class BeneficiariesPage extends StatelessWidget {
  const BeneficiariesPage({super.key});

  @override
  Widget build(BuildContext context) {
    return BeneficiaryTile(onTap: () => context.pushNavigation(AppRoute.beneficiary));
  }
}

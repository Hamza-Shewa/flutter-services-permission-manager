class BeneficiaryTile extends StatelessWidget {
  const BeneficiaryTile({super.key, required this.onTap});
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => InkWell(onTap: onTap);
}

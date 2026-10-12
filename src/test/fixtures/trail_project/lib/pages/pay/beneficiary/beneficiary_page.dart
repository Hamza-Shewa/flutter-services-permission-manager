part 'listeners/submit_listener.dart';

class BeneficiaryPage extends StatefulWidget {
  const BeneficiaryPage({super.key});

  @override
  State<BeneficiaryPage> createState() => _BeneficiaryPageState();
}

class _BeneficiaryPageState extends State<BeneficiaryPage> {
  @override
  Widget build(BuildContext context) {
    return BlocListener<BeneficiaryBloc, BeneficiaryState>(
      listener: (context, state) => _parseState(context, state),
      child: const SizedBox(),
    );
  }
}

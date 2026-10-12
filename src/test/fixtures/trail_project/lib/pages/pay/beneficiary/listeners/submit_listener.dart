part of '../beneficiary_page.dart';

// Same private extension name as the login page's listener, on purpose.
extension _SubmitListener on _BeneficiaryPageState {
  void _parseState(BuildContext context, BeneficiaryState state) {
    if (state.paid) {
      context.replace(AppRoute.receipt);
    } else {
      context.replace(AppRoute.result);
    }
  }
}

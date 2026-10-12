part of '../login_page.dart';

extension _SubmitListener on _LoginPageState {
  void _parseState(BuildContext context, LoginState state) {
    switch (state.status) {
      case Status.success:
        if (state.isActive) {
          context.pushNavigation(AppRoute.financeMenu);
        } else {
          context.pushNavigation(AppRoute.welcome);
        }
        break;
      case Status.failure:
        context.showErrorDialog(state.message);
        break;
      default:
        break;
    }
  }
}

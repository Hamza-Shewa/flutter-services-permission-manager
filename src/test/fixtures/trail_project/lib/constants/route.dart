enum AppRoute {
  splash,
  welcome,
  login,
  otp,
  financeMenu,
  lypay,
  beneficiaries,
  beneficiary,
  result,
  receipt,
  settings,
  neverUsed,
}

extension AppPageExtension on AppRoute {
  String get toPath {
    switch (this) {
      default:
        return '/${toString().split('.').last}';
    }
  }
}

// Not a route enum: it is only ever passed to dialog helpers.
enum AlertType { warning, info }

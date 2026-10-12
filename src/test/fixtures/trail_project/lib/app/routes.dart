import 'package:go_router/go_router.dart';

class AppRouter {
  Widget _page(AppRoute route, Widget Function(BuildContext, GoRouterState) builder, BuildContext context, GoRouterState state) {
    return builder(context, state);
  }

  GoRouter build() {
    return GoRouter(
      initialLocation: AppRoute.splash.toPath,
      redirect: (context, state) => loggedOut ? AppRoute.welcome.toPath : null,
      routes: [
        GoRoute(
          path: AppRoute.splash.toPath,
          builder: (context, state) => const SplashPage(),
        ),
        GoRoute(
          path: AppRoute.welcome.toPath,
          builder: (context, state) => const WelcomePage(),
        ),
        GoRoute(
          path: AppRoute.login.toPath,
          builder: (context, state) => _page(
            AppRoute.login,
            (context, state) => const LoginPage(),
            context,
            state,
          ),
        ),
        StatefulShellRoute.indexedStack(
          builder: (context, state, shell) => NavigationMenuPage(shell: shell),
          branches: <StatefulShellBranch>[
            StatefulShellBranch(
              routes: [
                GoRoute(
                  path: AppRoute.financeMenu.toPath,
                  builder: (context, state) => const FinanceMenuPage(),
                ),
              ],
            ),
            StatefulShellBranch(
              routes: [
                GoRoute(
                  path: AppRoute.settings.toPath,
                  builder: (context, state) => const SettingsPage(),
                ),
              ],
            ),
          ],
        ),
        GoRoute(
          path: AppRoute.lypay.toPath,
          builder: (context, state) => const LyPayPage(),
        ),
        GoRoute(
          path: AppRoute.beneficiaries.toPath,
          builder: (context, state) => const BeneficiariesPage(),
        ),
        GoRoute(
          path: AppRoute.beneficiary.toPath,
          builder: (context, state) => BlocProvider(
            create: (_) => BeneficiaryBloc(),
            child: const BeneficiaryPage(),
          ),
        ),
        GoRoute(
          path: AppRoute.result.toPath,
          builder: (context, state) => const ResultPage(),
        ),
        GoRoute(
          path: AppRoute.receipt.toPath,
          redirect: (context, state) => paid ? null : AppRoute.result.toPath,
          builder: (context, state) => const ReceiptPage(),
        ),
      ],
    );
  }
}

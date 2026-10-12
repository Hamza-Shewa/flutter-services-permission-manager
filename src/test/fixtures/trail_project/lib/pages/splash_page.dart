class SplashPage extends StatelessWidget {
  const SplashPage({super.key});

  @override
  Widget build(BuildContext context) {
    return BlocListener<LaunchBloc, LaunchState>(
      listener: (context, state) {
        switch (state.status) {
          case Status.failure:
          case Status.success:
            if (state.firstLaunch) {
              context.replace(AppRoute.welcome);
            } else if (!state.agreed) {
              context.replace(AppRoute.welcome);
            } else {
              context.replace(AppRoute.login);
            }
            break;
          default:
            break;
        }
      },
      child: const SizedBox(),
    );
  }
}
class WelcomePage extends StatelessWidget {
  const WelcomePage({super.key});
  @override
  Widget build(BuildContext context) =>
      FilledButton(onPressed: () => context.pushNavigation(AppRoute.login), child: const Text('Start'));
}
class OtpSheet extends StatelessWidget {
  const OtpSheet({super.key});
  @override
  Widget build(BuildContext context) => const SizedBox();
}
class NavigationMenuPage extends StatelessWidget {
  const NavigationMenuPage({super.key, required this.shell});
  final StatefulNavigationShell shell;
  @override
  Widget build(BuildContext context) => shell;
}
class SettingsPage extends StatelessWidget {
  const SettingsPage({super.key});
  @override
  Widget build(BuildContext context) =>
      TextButton(onPressed: () => Navigator.pushNamed(context, '/legacy'), child: const Text('Legacy'));
}

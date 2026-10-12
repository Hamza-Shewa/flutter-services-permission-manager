class SignUpButton extends StatelessWidget {
  const SignUpButton({super.key});

  @override
  Widget build(BuildContext context) {
    return TextButton(
      onPressed: () => context.pushNavigation(AppRoute.welcome),
      child: const Text('Sign up'),
    );
  }
}

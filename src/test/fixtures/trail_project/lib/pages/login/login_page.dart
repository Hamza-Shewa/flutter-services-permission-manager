import '../../extensions/navigation.dart';
import 'components/sign_up.dart';
part 'listeners/submit_listener.dart';

class LoginPage extends StatefulWidget {
  const LoginPage({super.key});

  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  @override
  Widget build(BuildContext context) {
    return BlocListener<LoginBloc, LoginState>(
      listener: _parseState,
      child: Column(children: [
        const SignUpButton(),
        TextButton(
          onPressed: () => context.showBottomSheet(const OtpSheet(), routeName: AlertType.warning.name),
          child: const Text('Warn'),
        ),
        TextButton(
          onPressed: () => context.showBottomSheet(const OtpSheet(), routeName: AppRoute.otp.toPath),
          child: const Text('Send code'),
        ),
      ]),
    );
  }
}

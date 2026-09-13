import 'package:flutter/material.dart';

class LoginScreen extends StatelessWidget {
  const LoginScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        TextField(
          decoration: InputDecoration(labelText: strings.emailLabel),
        ),
        Semantics(
          identifier: 'auth.login.cancel',
          child: TextButton(
            onPressed: () {},
            child: Text(strings.cancelLabel),
          ),
        ),
        ElevatedButton(
          onPressed: () {},
          child: Text(strings.submitLabel),
        ),
        IconButton(onPressed: () {}, icon: const Icon(Icons.help)),
        CustomAction(onActivate: () {}),
        WebViewWidget(controller: controller),
      ],
    );
  }
}

import 'package:flutter/material.dart';

/// A screen with several buttons: never a composite, even though it is referenced twice.
class SettingsView extends StatelessWidget {
  const SettingsView({super.key});

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        TextButton(onPressed: () {}, child: Text(strings.language)),
        TextButton(onPressed: () {}, child: Text(strings.theme)),
      ],
    );
  }
}

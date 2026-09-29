import 'package:flutter/material.dart';
import 'views/settings_view.dart';

class MainApp extends StatelessWidget {
  const MainApp({super.key});

  @override
  Widget build(BuildContext context) => const Column(children: [SettingsView(), SettingsView()]);
}

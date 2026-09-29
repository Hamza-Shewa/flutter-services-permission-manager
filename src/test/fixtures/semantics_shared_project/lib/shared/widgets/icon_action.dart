import 'package:flutter/material.dart';

class IconAction extends StatelessWidget {
  const IconAction({required this.onPressed, required this.icon, this.tooltip, super.key});

  final VoidCallback onPressed;
  final IconData icon;
  final String? tooltip;

  @override
  Widget build(BuildContext context) {
    return IconButton(onPressed: onPressed, tooltip: tooltip, icon: Icon(icon));
  }
}

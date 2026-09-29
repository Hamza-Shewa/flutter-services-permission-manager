import 'package:flutter/material.dart';
import 'primary_button.dart';

/// Wraps PrimaryButton, so it must be fixed after it (layer 1).
class SaveBar extends StatelessWidget {
  const SaveBar({required this.onSave, super.key});

  final VoidCallback onSave;

  @override
  Widget build(BuildContext context) {
    return PrimaryButton(text: 'Save', onPressed: onSave);
  }
}

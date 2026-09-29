import 'package:flutter/material.dart';

/// Already exposes a complete semantics contract.
class LabeledButton extends StatelessWidget {
  const LabeledButton({
    required this.onPressed,
    required this.text,
    required this.semanticsIdentifier,
    super.key,
  });

  final VoidCallback onPressed;
  final String text;
  final String semanticsIdentifier;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      identifier: semanticsIdentifier,
      button: true,
      child: TextButton(onPressed: onPressed, child: Text(text)),
    );
  }
}

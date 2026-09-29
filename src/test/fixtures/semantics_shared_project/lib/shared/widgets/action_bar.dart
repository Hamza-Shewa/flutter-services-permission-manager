import 'package:flutter/material.dart';

/// A composite that already derives its identifiers from a required prefix.
class ActionBar extends StatelessWidget {
  const ActionBar({
    required this.onUndo,
    required this.onRedo,
    required this.semanticsIdentifierPrefix,
    super.key,
  });

  final VoidCallback onUndo;
  final VoidCallback onRedo;
  final String semanticsIdentifierPrefix;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Semantics(
          identifier: '$semanticsIdentifierPrefix.undo',
          button: true,
          child: IconButton(onPressed: onUndo, icon: const Icon(Icons.undo)),
        ),
        Semantics(
          identifier: '$semanticsIdentifierPrefix.redo',
          button: true,
          child: IconButton(onPressed: onRedo, icon: const Icon(Icons.redo)),
        ),
      ],
    );
  }
}

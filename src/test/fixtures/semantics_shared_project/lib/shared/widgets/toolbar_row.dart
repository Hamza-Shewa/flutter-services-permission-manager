import 'package:flutter/material.dart';

/// Two independent controls: a composite, never a single-parameter shared control.
class ToolbarRow extends StatelessWidget {
  const ToolbarRow({required this.onUndo, required this.onRedo, super.key});

  final VoidCallback onUndo;
  final VoidCallback onRedo;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        IconButton(onPressed: onUndo, icon: const Icon(Icons.undo)),
        IconButton(onPressed: onRedo, icon: const Icon(Icons.redo)),
      ],
    );
  }
}

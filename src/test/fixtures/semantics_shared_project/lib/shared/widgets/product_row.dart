import 'package:flutter/material.dart';

/// Two controls and reused: a composite that has no identifier prefix yet.
class ProductRow extends StatelessWidget {
  const ProductRow({required this.onOpen, required this.onRemove, super.key});

  final VoidCallback onOpen;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        InkWell(onTap: onOpen, child: const Text('Item')),
        IconButton(onPressed: onRemove, icon: const Icon(Icons.close)),
      ],
    );
  }
}

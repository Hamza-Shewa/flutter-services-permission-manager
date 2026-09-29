import 'package:flutter/material.dart';

class Tile extends StatelessWidget {
  const Tile({required this.onTap, super.key});
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => InkWell(onTap: onTap, child: const Text('A'));
}

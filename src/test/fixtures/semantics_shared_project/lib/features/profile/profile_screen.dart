import 'package:flutter/material.dart';
import '../../shared/widgets/widgets.dart';

class ProfileScreen extends StatelessWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        PrimaryButton(text: strings.editProfile, onPressed: () {}),
        IconAction(icon: Icons.settings, tooltip: strings.settings, onPressed: () {}),
        SaveBar(onSave: () {}),
        ProductRow(onOpen: () {}, onRemove: () {}),
        IconButton(onPressed: () {}, icon: const Icon(Icons.share)),
        Semantics(
          label: strings.close,
          child: TextButton(onPressed: () {}, child: Text(strings.close)),
        ),
        Text(strings.share),
      ],
    );
  }
}

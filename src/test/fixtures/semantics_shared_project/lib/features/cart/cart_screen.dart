import 'package:flutter/material.dart';
import 'package:shop_app/shared/widgets/widgets.dart';

class CartScreen extends StatelessWidget {
  const CartScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        PrimaryButton(text: strings.checkout, onPressed: () {}),
        PrimaryButton(text: strings.continueShopping, onPressed: () {}),
        IconAction(icon: Icons.delete, onPressed: () {}),
        LabeledButton(
          text: strings.applyCoupon,
          onPressed: () {},
          semanticsIdentifier: 'cart.coupon.apply',
        ),
        LabeledButton(text: strings.clear, onPressed: () {}, semanticsIdentifier: 'cart.clear'),
        LabeledButton(text: strings.refund, onPressed: () {}),
        SaveBar(onSave: () {}),
        ToolbarRow(onUndo: () {}, onRedo: () {}),
        ProductRow(onOpen: () {}, onRemove: () {}),
        ProductRow(onOpen: () {}, onRemove: () {}),
        ActionBar(semanticsIdentifierPrefix: 'cart.editor', onUndo: () {}, onRedo: () {}),
        ActionBar(onUndo: () {}, onRedo: () {}),
      ],
    );
  }
}

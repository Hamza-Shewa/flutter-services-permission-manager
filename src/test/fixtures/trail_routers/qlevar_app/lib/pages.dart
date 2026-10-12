class HomePage extends StatelessWidget {
  const HomePage({super.key});
  @override
  Widget build(BuildContext context) => TextButton(onPressed: () => QR.to('/profile'), child: const Text('Profile'));
}
class ProfilePage extends StatelessWidget {
  const ProfilePage({super.key});
  @override
  Widget build(BuildContext context) => TextButton(onPressed: () => QR.toName('profile'), child: const Text('Reload'));
}

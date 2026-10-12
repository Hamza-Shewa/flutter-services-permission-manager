final routes = [
  QRoute(path: '/', builder: () => const HomePage()),
  QRoute(path: '/profile', name: 'profile', builder: () => const ProfilePage()),
];

class AppModule extends Module {
  @override
  void routes(r) {
    r.child('/', child: (_) => const HomePage());
    r.module('/auth', module: AuthModule());
  }
}

class AuthModule extends Module {
  @override
  void routes(r) {
    r.child('/login', child: (_) => const LoginPage());
    r.child('/register', child: (_) => const RegisterPage());
  }
}

class LegacyModule extends Module {
  @override
  List<ModularRoute> get routes => [
        ChildRoute('/legacy', child: (_, args) => const LegacyPage()),
      ];
}

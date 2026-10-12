/// Navigation written once in a small method; the screen it leaves from is wherever it is called.
class AppNavigator {
  static void toAbout(BuildContext context) {
    Navigator.pushNamed(context, RouteNames.about);
  }
}

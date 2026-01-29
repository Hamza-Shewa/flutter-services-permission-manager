# permission-manager README

This is the README for your extension "permission-manager". After writing up a brief description, we recommend including the following sections.

## Features

Permission Manager provides a dedicated webview for managing Android and iOS permissions.

- View Android permissions in a sortable table with columns for Permission, Description, Constant Value, Category, and API level.
- Filter permissions by search term or category.
- Add permissions via a modal search that looks up Android permissions by name, constant value, or category.
- Save changes to AndroidManifest.xml and Info.plist with a single action.
- Responsive layout that works well across screen sizes.

## Usage

1. Run the command **Permission Manager: Edit Files File**.
2. Review the Android permission table.
3. Use the search box or category filter to narrow results.
4. Click **Add Permission** to open the modal search and add a permission.
5. Click **Save Changes** to update AndroidManifest.xml and Info.plist.

> When saving iOS permissions, missing usage descriptions are inserted as `TODO: Provide usage description.` so you can update them manually.

## Requirements

If you have any requirements or dependencies, add a section describing those and how to install and configure them.

## Extension Settings

Include if your extension adds any VS Code settings through the `contributes.configuration` extension point.

For example:

This extension contributes the following settings:

* `myExtension.enable`: Enable/disable this extension.
* `myExtension.thing`: Set to `blah` to do something.

## Known Issues

- iOS permission updates require you to fill in usage descriptions after saving.

## Release Notes

Users appreciate release notes as you update your extension.

### 1.0.0

Initial release of ...

### 1.0.1

Fixed issue #.

### 1.1.0

Added features X, Y, and Z.

---

## Following extension guidelines

Ensure that you've read through the extensions guidelines and follow the best practices for creating your extension.

* [Extension Guidelines](https://code.visualstudio.com/api/references/extension-guidelines)

## Working with Markdown

You can author your README using Visual Studio Code. Here are some useful editor keyboard shortcuts:

* Split the editor (`Cmd+\` on macOS or `Ctrl+\` on Windows and Linux).
* Toggle preview (`Shift+Cmd+V` on macOS or `Shift+Ctrl+V` on Windows and Linux).
* Press `Ctrl+Space` (Windows, Linux, macOS) to see a list of Markdown snippets.

## For more information

* [Visual Studio Code's Markdown Support](http://code.visualstudio.com/docs/languages/markdown)
* [Markdown Syntax Reference](https://help.github.com/articles/markdown-basics/)

**Enjoy!**

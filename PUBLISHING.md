# Publishing Guide for Flutter Config Manager

## Prerequisites

1. **Azure DevOps Account**: You need a Microsoft/Azure account to create a publisher
2. **Personal Access Token (PAT)**: Required for publishing

## Step 1: Create a Publisher

1. Go to [Visual Studio Marketplace Publisher Management](https://marketplace.visualstudio.com/manage)
2. Sign in with your Microsoft account (shewa.hz98@gmail.com)
3. Click **Create publisher**
4. Fill in the details:
   - **Publisher ID**: `hamza-shewa` (must match package.json)
   - **Publisher Name**: `Hamza Shewa`
   - **Description**: Optional description about you

## Step 2: Create a Personal Access Token (PAT)

1. Go to [Azure DevOps](https://dev.azure.com/)
2. Sign in and create an organization if you don't have one
3. Click on **User Settings** (top right) → **Personal Access Tokens**
4. Click **New Token**
5. Configure:
   - **Name**: `vsce-publish` (or any name)
   - **Organization**: `All accessible organizations`
   - **Expiration**: Choose appropriate duration
   - **Scopes**: Select **Custom defined**, then:
     - Under **Marketplace**, check **Acquire** and **Manage**
6. Click **Create** and **copy the token immediately** (you won't see it again)

## Step 3: Login with vsce

```bash
npx vsce login hamza-shewa
```

When prompted, paste your Personal Access Token.

## Step 4: Publish the Extension

```bash
npm run publish
```

Or manually:

```bash
npx vsce publish
```

### Publish with Version Bump

```bash
# Patch version (1.0.0 → 1.0.1)
npx vsce publish patch

# Minor version (1.0.0 → 1.1.0)
npx vsce publish minor

# Major version (1.0.0 → 2.0.0)
npx vsce publish major
```

## Step 5: Verify Publication

1. Go to [Visual Studio Marketplace](https://marketplace.visualstudio.com/)
2. Search for "Flutter Config Manager"
3. Your extension should appear within a few minutes

## Useful Commands

```bash
# Package without publishing (creates .vsix file)
npm run package

# View what will be included in the package
npx vsce ls --tree

# Publish a pre-packaged .vsix
npx vsce publish --packagePath flutter-config-manager-1.0.0.vsix
```

## Updating the Extension

1. Update the code
2. Update version in `package.json` (or use `vsce publish patch/minor/major`)
3. Update `CHANGELOG.md`
4. Run `npm run publish`

## GitHub Repository Setup

1. Create a new repository on GitHub: `flutter-config-manager`
2. Initialize and push:

```bash
cd permission-manager
git init
git add .
git commit -m "Initial commit: Flutter Config Manager v1.0.0"
git branch -M main
git remote add origin https://github.com/Hamza-Shewa/flutter-config-manager.git
git push -u origin main
```

## Troubleshooting

### "Publisher not found"
- Make sure the publisher ID in `package.json` matches exactly what you created

### "Invalid token"
- Create a new PAT with the correct scopes (Marketplace: Acquire & Manage)
- Make sure you selected "All accessible organizations"

### "Missing required field"
- Check that `package.json` has: name, displayName, description, version, publisher, engines

## Links

- [Publishing Extensions Guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
- [Marketplace Publisher Portal](https://marketplace.visualstudio.com/manage)
- [Azure DevOps](https://dev.azure.com/)

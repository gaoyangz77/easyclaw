# Release Checklist

Checklist for releasing a new version.

## 📋 Pre-Release Preparation

- [ ] All features are completed and tested
- [ ] Run full test suite: `pnpm test`
- [ ] Update `CHANGELOG.md` (if applicable)
- [ ] Update version number (see below)
- [ ] Build and test installers locally

## 🔢 Update Version Number

Use the following command to update version in all package.json files:

```bash
# Example: upgrade from 0.1.0 to 0.1.1
pnpm version patch

# Or manually update version in apps/desktop/package.json
# "version": "0.1.1"
```

## 🏷️ Create Release Tag

```bash
# Commit version change
git add .
git commit -m "chore: bump version to v0.1.1"

# Create tag (triggers CI/CD)
git tag -a v0.1.1 -m "Release v0.1.1"

# Push tag to GitHub
git push origin main
git push origin v0.1.1
```

## 🤖 Automated Process

After pushing the tag, GitHub Actions will automatically:

1. ✅ Build Windows installer
2. ✅ Build macOS installer (DMG + ZIP)
3. ⏳ Submit to SignPath for signing (Windows, after configuration)
4. ⏳ Notarize macOS app (after configuring certificate)
5. 📦 Create Draft Release

## 📝 Complete the Release

1. Go to GitHub Releases page
2. Find the automatically created Draft Release
3. Review uploaded files:
   - `EasyClaw-Setup-{version}.exe` (Windows)
   - `EasyClaw-{version}.dmg` (macOS)
   - `EasyClaw-{version}-mac.zip` (macOS Universal)
4. Edit Release Notes (modify auto-generated content)
5. Click **Publish release**

## 🔍 Verify Signatures

### Windows

Right-click the downloaded `.exe` file → Properties → Digital Signatures:

- ✅ Signed: Should see SignPath Foundation certificate
- ❌ Unsigned: Check SignPath configuration

### macOS

After downloading `.dmg`, run:

```bash
# Check signature
codesign -dv --verbose=4 /Applications/EasyClaw.app

# Check notarization status
spctl -a -vv /Applications/EasyClaw.app
```

## 🚨 If Build Fails

1. Check GitHub Actions logs
2. Common issues:
   - Dependency installation failed: Clear cache and retry
   - Signing failed: Check secrets configuration
   - Notarization failed: Check Apple ID credentials
3. Delete failed tag and retry:
   ```bash
   git tag -d v0.1.1
   git push origin :refs/tags/v0.1.1
   ```

## 📢 Post-Release

- [ ] Announce new version on social media/forums
- [ ] Update website/documentation (if applicable)
- [ ] Close related GitHub Issues
- [ ] Thank contributors 🎉

## 🔄 Hotfix Process

If a critical bug is found after release:

```bash
# Quick fix
git checkout -b hotfix/v0.1.2
# ... fix the code ...
git commit -m "fix: critical bug"
git tag -a v0.1.2 -m "Hotfix v0.1.2"
git push origin hotfix/v0.1.2
git push origin v0.1.2
```

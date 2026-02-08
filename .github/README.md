# GitHub Actions Configuration

This directory contains CI/CD automation configuration for the EasyClaw project.

## 📁 File Structure

### Workflows (Automation)

| File | Trigger | Purpose |
|------|---------|---------|
| `test-build.yml` | Every push to `main` or PR | Test builds (unsigned) to ensure code doesn't break the build process |
| `build.yml` | Push `v*` tag | Official release: build, sign, and create GitHub Release |

### Documentation

| File | Description |
|------|-------------|
| `SIGNPATH_SETUP.md` | **SignPath Foundation Setup Guide** - Get free Windows code signing |
| `RELEASE_CHECKLIST.md` | Complete checklist for releasing a new version |

## 🚀 Quick Start

### 1. Test Automated Builds (Available Now)

```bash
# Push code to GitHub
git add .
git commit -m "feat: add CI/CD workflows"
git push origin main
```

GitHub Actions will automatically run `test-build.yml` to verify Windows and macOS build processes.

View results at: https://github.com/gaoyangz77/easyclaw/actions

### 2. Apply for Free Windows Signing (Recommended)

**Important**: SignPath Foundation is completely free for open source projects!

1. 📖 Read [`SIGNPATH_SETUP.md`](./SIGNPATH_SETUP.md)
2. 🌐 Visit https://about.signpath.io/product/open-source
3. 📝 Fill out the application (1-3 day review)
4. 🔑 Add GitHub Secrets after approval
5. ✅ Uncomment signing steps in `build.yml`

### 3. Release Your First Version

```bash
# Update version number
vim apps/desktop/package.json  # Change to "version": "0.1.0"

# Commit and create tag
git add .
git commit -m "chore: bump version to v0.1.0"
git tag -a v0.1.0 -m "Release v0.1.0"
git push origin main
git push origin v0.1.0
```

GitHub Actions will automatically build and create a Draft Release.

## 📊 Current Status

| Platform | Build | Signing | Status |
|----------|-------|---------|--------|
| **Windows** | ✅ Configured | ⏳ Awaiting SignPath approval | Available (unsigned) |
| **macOS** | ✅ Configured | ❌ Requires Apple Developer | Available (unsigned) |

## 🔐 Required GitHub Secrets

### Windows Signing (After SignPath Foundation Approval)

Add in `Settings → Secrets → Actions`:

```
SIGNPATH_API_TOKEN         # Provided by SignPath
SIGNPATH_ORGANIZATION_ID   # From SignPath dashboard
```

### macOS Signing (Optional, requires Apple Developer $99/year)

```
MACOS_CERTIFICATE          # Base64-encoded .p12 certificate
MACOS_CERTIFICATE_PWD      # Certificate password
KEYCHAIN_PASSWORD          # Temporary keychain password (any strong password)
APPLE_ID                   # Apple ID email
APPLE_APP_SPECIFIC_PASSWORD # App-specific password
APPLE_TEAM_ID              # 10-character team ID
```

## 🐛 Troubleshooting

### Build Failures

1. Check GitHub Actions logs
2. Ensure `pnpm install` and `pnpm run build` work locally
3. Verify Node.js version (should be 22)

### Signing Failures

1. **Windows**: Check SignPath API token and Organization ID
2. **macOS**: Verify all Apple secrets are correctly configured
3. Check SignPath dashboard for signing request status

### File Path Issues

Check actual file names in `apps/desktop/release/`, could be:
- `EasyClaw-Setup.exe` ✅
- `EasyClaw Setup.exe` ❌ (with space)

Update paths in `build.yml` accordingly.

## 📚 Further Reading

- [electron-builder Documentation](https://www.electron.build/)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [SignPath Documentation](https://about.signpath.io/documentation)
- [Apple Notarization Guide](https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution)

## 💡 Best Practices

1. **Sign only on release**: Signing on every push wastes resources
2. **Use Draft Releases**: Review files before publishing to avoid mistakes
3. **Keep secrets secure**: Regularly rotate passwords and tokens
4. **Test builds locally**: Ensure packaging works before pushing tags

## 🎯 Next Steps

- [ ] Push code and test `test-build.yml` workflow
- [ ] Apply for SignPath Foundation free signing
- [ ] (Optional) Purchase Apple Developer account
- [ ] Configure GitHub Secrets
- [ ] Release first official version v0.1.0

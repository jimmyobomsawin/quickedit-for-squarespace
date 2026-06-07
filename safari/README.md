# Safari Web Extension

This directory holds the Xcode project that wraps `../extension/` into a macOS app
suitable for Mac App Store distribution.

Generated initially with:

```sh
xcrun safari-web-extension-converter ../extension \
  --project-location . \
  --app-name "QuickEdit for Squarespace" \
  --bundle-identifier "com.jimmytechsf.QuickEditForSquarespace" \
  --swift --macos-only --no-open --no-prompt --copy-resources --force
```

Subsequent updates to the web-extension code go in `../extension/`; the build
scripts call `../scripts/sync-extension.sh` to mirror it into
`QuickEdit for Squarespace Extension/Resources/` before any `xcodebuild` run.

## Local debug build

```sh
../scripts/build-safari.sh
```

Output: `/tmp/quickedit-for-squarespace-derived/Build/Products/Debug/QuickEdit for Squarespace.app`

> **Why `/tmp`?** Building inside iCloud-synced `~/Documents/` causes
> Finder metadata to be applied to build products, which makes codesign
> reject the embedded `.appex`. Same gotcha as Play Nice / JimmyTech Checkup.

## Production release

```sh
../scripts/release-safari.sh 0.4.1                  # archive + export + upload
../scripts/release-safari.sh 0.4.1 --dry-run        # archive + export only
```

## Bundle IDs

- App: `com.jimmytechsf.QuickEditForSquarespace`
- Extension: `com.jimmytechsf.QuickEditForSquarespace.Extension`

The extension's bundle ID **must** be prefixed by the app's bundle ID — App Store
validation rejects mismatched pairs. (The converter initially generated
`com.jimmytechsf.QuickEdit-for-Squarespace` for the app, which doesn't prefix the
extension's ID. Both were unified to the no-hyphen camelcase form.)

## Icons

`make_icons.py` writes the AppIcon set into
`QuickEdit for Squarespace/Assets.xcassets/AppIcon.appiconset/` with the filenames
the converter's generated `Contents.json` expects (`mac-icon-NN@Nx.png`). It also
writes `QuickEdit for Squarespace/Resources/Icon.png`, used in the app shell's
Main.html webview.

## App shell

The macOS app shell is the converter's default: a WKWebView that loads
`Resources/Base.lproj/Main.html`. It detects whether the extension is enabled in
Safari and shows a "Quit and Open Safari Extensions Preferences…" button. Good
enough as-is — customize `Main.html`, `Style.css`, and `Script.js` if you want
more onboarding copy.

# QuickEdit for Squarespace

A small browser extension that adds a **pencil overlay in the top-right corner** of any page on your Squarespace site. Click it and the editor for that exact page opens in a new tab — no more hunting through the admin to find the page you're already looking at.

Works in **Chrome / Brave / Edge** and **Safari** (macOS).

![icon](safari/QuickEdit%20for%20Squarespace/Assets.xcassets/AppIcon.appiconset/mac-icon-256@1x.png)

## Install

- **Chrome / Brave / Edge** — install from the [Chrome Web Store](#) *(link goes here once published)*.
- **Safari** — install from the [Mac App Store](#) *(link goes here once published)*.

Or build from source — see below.

## How it works

1. You map each of your public domains to its Squarespace subdomain in **Options** (e.g. `jimmytechsf.com` → `squarespace-jimmytechsf`). The **Import from Squarespace** button on the options page pulls the list straight from your [account.squarespace.com](https://account.squarespace.com) dashboard.
2. A dog-ear overlay appears on every page of a mapped site.
3. Clicking it opens `https://<subdomain>.squarespace.com/config/pages/` with the right page pre-loaded in the editor iframe — by injecting the `@@History/<key>` and `frameurl` entries that Squarespace's admin SPA reads at boot.

The technique is the same one the dashboard's Engagement page uses internally to open a row's editor in a new tab.

## Repo layout

```
quickedit-for-squarespace/
├── extension/      ← single source of truth for the web-extension code
├── chrome/         ← Chrome Web Store packaging notes
├── safari/         ← Xcode project + macOS app shell
├── scripts/        ← build + release shell scripts (local, no CI)
├── dist/           ← release artefacts (gitignored)
└── build/          ← local build outputs (gitignored)
```

`extension/` is shared between Chrome and Safari. The Safari Xcode project's `Extension/Resources/` is a mirror, kept in sync by `scripts/sync-extension.sh` (called by both `build-safari.sh` and `release-safari.sh`). Don't edit `safari/.../Extension/Resources/` directly — edit `extension/` and let the sync script copy it over.

## Develop

```sh
# Regenerate icons (browser PNGs + macOS AppIcon set)
python3 make_icons.py

# Build a Chrome zip for local unpacked install
./scripts/build-chrome.sh
# → dist/QuickEditForSquarespace-<ver>-chrome.zip
# Load it: brave://extensions → Developer mode → "Load unpacked" → pick extension/

# Build the Safari .app for local testing
./scripts/build-safari.sh
# → /tmp/quickedit-for-squarespace-derived/Build/Products/Debug/QuickEdit for Squarespace.app
# Open it, then in Safari: Settings → Extensions → enable QuickEdit for Squarespace
```

## Release

Both release scripts are local-only — no GitHub Actions for signing or distribution. Credentials live in your macOS Keychain.

**Chrome Web Store** *(needs a $5 one-time CWS developer account + OAuth credentials)*:

```sh
# One-time setup — store the OAuth credentials in Keychain
security add-generic-password -s QuickEditForSquarespace_CWS -a clientId      -w '…'
security add-generic-password -s QuickEditForSquarespace_CWS -a clientSecret  -w '…'
security add-generic-password -s QuickEditForSquarespace_CWS -a refreshToken  -w '…'
security add-generic-password -s QuickEditForSquarespace_CWS -a extensionId   -w '…'

# Release
./scripts/release-chrome.sh 0.4.1                  # upload as draft
./scripts/release-chrome.sh 0.4.1 --auto-publish   # upload + publish
./scripts/release-chrome.sh 0.4.1 --dry-run        # build only
```

**Mac App Store** *(needs an active Apple Developer Program membership + Apple Distribution cert in Keychain)*:

```sh
# One-time setup
security add-generic-password -s AC_PASSWORD -a appleId  -w 'you@example.com'
security add-generic-password -s AC_PASSWORD -a "you@example.com" -w '<app-specific-password>'

# Release
./scripts/release-safari.sh 0.4.1                  # archive, export, upload to App Store Connect
./scripts/release-safari.sh 0.4.1 --dry-run        # archive + export only, opens .pkg in Finder
```

Both release scripts also call `gh release` to attach build artefacts to a GitHub release tagged `v<version>`.

## License

MIT. See [LICENSE](LICENSE).

"Squarespace" is a trademark of Squarespace, Inc. This project is independent and not affiliated.

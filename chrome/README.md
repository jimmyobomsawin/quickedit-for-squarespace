# Chrome Web Store packaging

The Chrome (and Brave, Edge, any Chromium browser) build is just a zip of the
contents of `../extension/`.

## Local install (development)

1. `brave://extensions` (or `chrome://extensions`).
2. Toggle **Developer mode** on.
3. Click **Load unpacked** → pick `../extension/`.
4. The pencil icon will appear in your toolbar. Click it to open Options.

## Production release

See the [top-level README](../README.md#release) for the full release flow.

Quick version:

```sh
./scripts/release-chrome.sh 0.4.1                  # draft upload
./scripts/release-chrome.sh 0.4.1 --auto-publish   # upload + publish
```

## Store listing assets

*(Deferred — screenshots, short description, full description, promotional images go here.)*

Required by the Chrome Web Store:
- 128×128 store icon (use `extension/icons/icon-128.png`)
- 440×280 small promo tile
- 1280×800 screenshots (at least one, up to five)

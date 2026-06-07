# Developer notes

Background context and known fragilities to check first when something stops working in a future Squarespace admin update.

## Selector & state contract with Squarespace's admin SPA

Three pieces of "private API" we depend on. None of them are documented; they were reverse-engineered from the live admin DOM. If a Squarespace release breaks them, the fix is usually one CSS selector update or one JSON-shape tweak.

### 1. The `frameurl` handoff (admin_inject.js)

To make `/config/pages/` boot into a specific page editor, we pre-populate the admin's internal history-library state in sessionStorage before its boot script runs:

```js
sessionStorage["@@History/<key>"] = JSON.stringify({
  appUrl: "/config/pages/",
  frameUrl: "/blog/<slug>",
  showFrameUrl: false,
  backTo: null,
});
sessionStorage["frameurl"] = "/blog/<slug>";  // also written; used by some boot paths
history.replaceState({ key: "<key>" }, "", "/config/pages/");
```

Squarespace's router reads `history.state.key`, looks up `@@History/<key>`, and loads the iframe at `frameUrl`. The `key` format is a short alphanumeric string — `Math.random().toString(36).slice(2, 8)` matches what the SPA generates internally.

**If editor opens the home page instead of the target**: the entry shape or key prefix has probably changed. Reproduce the engagement-page-click flow once in DevTools, inspect `sessionStorage["@@History/*"]` in the resulting tab, and update the field names in `admin_inject.js`.

### 2. Focus-mode CSS overrides (admin_inject.js)

For the square overlay button, we hide the page-tree sidebar and stretch the iframe to fill the viewport. The selectors and the specific properties to override:

| Element                | Why it's offset                                      | Properties we override                          |
|------------------------|------------------------------------------------------|-------------------------------------------------|
| `.App-sidebar`         | The page tree itself                                  | `display: none`                                 |
| `.config-website-frame`| `position: fixed` + `transform: translateX(342px)` + `right: 358px` | `transform: none`, `left: 0`, `right: 0`, `width: 100%` |
| `.preview-viewport`, `.js-device-view-frame`, `#sqs-site-frame` | Inherit positioning from `.config-website-frame` | `width: 100%`, `left: 0`             |

**Critical gotcha (Nov 2026):** `.config-website-frame` does its leftward offset via **CSS transform**, not via `left`. A `left: 0 !important` alone has no effect — you must also set `transform: none !important`. The right-edge reservation (`right: 358px`) is for an inspector panel that swings in when editing blocks; we kill that too.

**If focus mode leaves a white stripe somewhere**: re-run this inspection on a fresh `/config/pages/` tab:

```js
// Walk from the iframe outward and dump computed styles
const f = document.getElementById('sqs-site-frame');
let el = f;
while (el && el !== document.body) {
  const cs = getComputedStyle(el);
  console.log(el.tagName, el.className.slice(0,50),
    'pos:', cs.position, 'transform:', cs.transform,
    'left:', cs.left, 'right:', cs.right);
  el = el.parentElement;
}
```

Look for any ancestor with a non-`none` `transform`, a non-`auto` `left`/`right`, or non-zero margin/padding. Add overrides for whichever ones contribute to the leftover whitespace.

### 3. The dashboard scrape (account_inject.js)

`account_inject.js` scrapes `account.squarespace.com` for the user's site list. The key DOM markers:

- `a[aria-label^="Go to website"]` — the per-site card's primary link. The aria-label embeds the admin URL, which contains the Squarespace subdomain.
- `a[aria-label^="Start your website"]` — the site name link inside each card.
- A `<p>` inside each card whose text is the primary public domain (sometimes followed by " + N more").

**If Import stops finding sites**: open `account.squarespace.com`, right-click a site card → Inspect, and look for whatever stable attributes Squarespace's new card markup uses. Update the three selectors above.

## iCloud + codesign

`~/Documents/Claude/` is iCloud-synced. The Finder file provider stamps `com.apple.fileprovider.ignore#P` and friends onto everything, which makes `codesign` refuse to sign embedded `.appex` plug-ins ("resource fork, Finder information, or similar detritus not allowed"). Two mitigations are baked into the scripts:

1. `find ... -exec xattr -c {} +` at the top of every build/release script (strips the xattrs).
2. DerivedData lives under `$TMPDIR` (`/var/folders/...`), outside iCloud, so build products don't get re-tagged.

Same gotcha as Play Nice and JimmyTech Checkup. Don't move the repo out of iCloud just to avoid it — the xattr-strip is enough.

## Bundle ID prefix invariant

App Store validation rejects mismatched pairs. The extension's bundle ID **must** start with the app's bundle ID:

- App: `com.jimmytechsf.QuickEditForSquarespace`
- Extension: `com.jimmytechsf.QuickEditForSquarespace.Extension`

`xcrun safari-web-extension-converter` initially generated `com.jimmytechsf.QuickEdit-for-Squarespace` for the app (transforming the app name) but kept the camelcase form for the extension. The first build's `ValidateEmbeddedBinary` failure pointed straight at this. Both were unified to the no-hyphen camelcase form.

If you ever rename the bundle: change both at once and never let them diverge.

## Known edge cases (by design, not bugs)

- **`www.`-only host normalization.** `normalize()`/`cleanWebsite()` strip a leading `www.` but nothing else. A site mapped as `example.com` matches `example.com` and `www.example.com`, but NOT other subdomains like `blog.example.com`. Dynamic registration uses `*://example.com/*` + `*://*.example.com/*` so the script *can* run on subdomains, but the overlay's own `mappings.some(...)` check keys on the normalized apex — so map each distinct host you want the pencil on. Intentional, to avoid the overlay appearing on unrelated subdomains.
- **IDN / punycode.** `location.hostname` is punycode (`xn--…`) for internationalized domains, while a user typing the Unicode form into Options stores Unicode, so they won't match. Niche; if it ever matters, normalize both sides with `new URL("https://" + host).hostname`.
- **Per-device mappings.** Mappings live in `chrome.storage.local` (not `sync`), so they don't roam between machines and don't survive an extension-ID change (e.g., loading unpacked from a different path wipes them). Deliberate trade for reliability on Brave; revisit with an export/import JSON pair if multi-device sync is ever wanted.

## Edit-mode detection (sidebar toggle)

The in-editor "show/hide sidebar" dog-ear must disappear while Squarespace's page editor is open (otherwise it looks dead — the page tree isn't shown in edit mode, so toggling has no visible effect until exit). Detection signal (confirmed Jun 2026, parent `/config/pages/` doc): preview mode has a top-bar button with text **"Edit"**; edit mode replaces it with **"Save"** and **"Exit"**. `admin_inject.js` hides the toggle when `hasExit || (hasSave && !hasEdit)`. If Squarespace renames those buttons, the toggle simply stops auto-hiding (graceful degradation) — update the text checks in `isEditing()`.

// Runs at document_start on *.squarespace.com/config/*.
//
// Squarespace's admin SPA uses an internal history library that keys routes
// by `history.state.key`, and stores per-route data in
// `sessionStorage["@@History/<key>"]` as JSON of shape
//   { appUrl, frameUrl, showFrameUrl, backTo }
//
// On boot, the router reads `history.state.key`, looks up the entry, and
// loads the public-side path from `frameUrl` into the sqs-site-frame iframe.
//
// Our handoff is: synchronously, before the page's scripts run,
//   1. parse target path + flags from the URL fragment
//      (#__sqspedit=<path>&focus=1&src=<live-url>)
//   2. mint a unique history key
//   3. write sessionStorage["@@History/<key>"] with our target frameUrl
//   4. also write sessionStorage.frameurl (fallback in some boot paths)
//   5. history.replaceState({key}, "", "/config/pages/")  -- strips the fragment
//   6. if focus=1, inject a <style> that hides the App-sidebar and stretches
//      the iframe-holding container to fill the viewport, plus a top-left
//      corner control:
//        • primary (the dog-ear)  → a back arrow that returns to the live page
//          (navigates to the validated `src` URL)
//        • secondary (drops down on hover) → the sidebar show/hide toggle.
//
// Direct visits & non-focus arrivals: if the editor is opened WITHOUT focus mode
// (no fragment at all, or a fragment without focus=1, e.g. the plain context-menu
// item) on a site the user has mapped, we add the corner (back arrow) WITHOUT
// hiding the sidebar — the side toggle still lets the user enter focus mode. The
// back arrow uses the validated src when present, else the mapping's public
// domain + the page currently open in the editor.

(() => {
  const TAG = "[QuickEdit for Squarespace]";
  let guard = null;       // MutationObserver re-applying the focus class, until user toggles off
  let returnUrl = null;   // validated live-page URL for the "back to live" arrow (pencil arrival)
  let liveDomain = null;  // mapped public domain, for the back arrow on a direct editor visit

  const normalizeHost = (h) => (h || "").toLowerCase().replace(/^www\./, "");

  try {
    const SENTINEL = "__sqspedit=";
    const hash = location.hash || "";
    const idx = hash.indexOf(SENTINEL);
    if (idx === -1) { installCornerForMappedSite(); return; }

    const rest = hash.slice(idx + SENTINEL.length);
    const ampIdx = rest.indexOf("&");
    const raw = ampIdx === -1 ? rest : rest.slice(0, ampIdx);
    const flagsStr = ampIdx === -1 ? "" : rest.slice(ampIdx + 1);
    const frameUrl = decodeURIComponent(raw);
    if (!frameUrl) return;

    // Security: only accept a same-origin root-relative path. The legitimate
    // value from background.js is always location.pathname+search ("/..."). A
    // crafted #__sqspedit= link from another site could otherwise smuggle an
    // absolute URL, protocol-relative ("//evil.com"), or a "javascript:"/"data:"
    // scheme into Squarespace's frame loader. Allow "/" and "/path"; reject the
    // rest (the regex forbids a 2nd leading "/" or "\\").
    if (!/^\/(?![/\\])/.test(frameUrl)) {
      console.warn(TAG, "ignoring non-path frameUrl:", frameUrl);
      return;
    }

    const flags = new URLSearchParams(flagsStr);
    const focus = flags.get("focus") === "1";

    // Optional originating live URL for the "back to live page" arrow. Gate it
    // to http(s) here (blocks javascript:/data: etc.); the host is additionally
    // checked against the saved mappings at click time (see goBackToLive).
    const srcRaw = flags.get("src");
    if (srcRaw) {
      try {
        const su = new URL(srcRaw);
        if (su.protocol === "http:" || su.protocol === "https:") returnUrl = su.href;
        else console.warn(TAG, "ignoring non-http(s) src:", srcRaw);
      } catch {
        console.warn(TAG, "ignoring unparseable src:", srcRaw);
      }
    }

    const key = Math.random().toString(36).slice(2, 8);
    const entry = {
      appUrl: location.pathname,
      frameUrl,
      showFrameUrl: false,
      backTo: null
    };
    sessionStorage.setItem(`@@History/${key}`, JSON.stringify(entry));
    sessionStorage.setItem("frameurl", frameUrl);

    const before = hash.slice(0, idx).replace(/[#&]$/, "");
    const cleanHash = before.replace(/^[#&]/, "");
    const newUrl = location.pathname + location.search + (cleanHash ? "#" + cleanHash : "");
    history.replaceState({ key }, "", newUrl);

    console.info(TAG, "primed history.state.key =", key, "frameUrl =", frameUrl, focus ? "(focus mode)" : "");

    // Focus arrival → corner + hidden sidebar. Non-focus arrival (e.g. the plain
    // context-menu item) → corner only, same treatment as a direct visit.
    if (focus) installCorner(true);
    else installCornerForMappedSite();
  } catch (e) {
    console.warn(TAG, "admin_inject error:", e);
  }

  function whenBodyReady(cb) {
    if (document.body) { cb(); return; }
    new MutationObserver((_, obs) => {
      if (document.body) { cb(); obs.disconnect(); }
    }).observe(document.documentElement, { childList: true });
  }

  // Navigate back to the originating live page. Re-validate the URL against the
  // saved mappings before navigating, so only the user's own mapped sites are
  // ever reachable this way. Falls back to history.back() (which lands on the
  // live page in the same-tab flow) if there's no usable src.
  async function goBackToLive() {
    try {
      // Pencil arrival: navigate to the validated originating live URL.
      if (returnUrl) {
        const h = normalizeHost(new URL(returnUrl).hostname);
        const { mappings = [] } = await chrome.storage.local.get({ mappings: [] });
        if (mappings.some((m) => normalizeHost(m.publicDomain) === h)) {
          location.assign(returnUrl);
          return;
        }
        console.warn(TAG, "src host not in mappings, not navigating:", h);
      }
      // No (valid) src: build the live URL from the mapped public domain + the
      // page currently open in the editor (live homepage as a safe fallback).
      if (liveDomain) {
        location.assign("https://" + liveDomain + currentEditorPath());
        return;
      }
    } catch (e) {
      console.warn(TAG, "back-to-live validation error:", e);
    }
    if (history.length > 1) history.back();
  }

  // The public path currently open in the editor preview. Squarespace tracks it in
  // the same history-library state we write for the handoff (see top-of-file notes).
  // Returns a validated root-relative path, or "/" if it can't be read.
  function currentEditorPath() {
    try {
      const key = history.state && history.state.key;
      if (key) {
        const entry = JSON.parse(sessionStorage.getItem("@@History/" + key) || "{}");
        if (entry && typeof entry.frameUrl === "string" && /^\/(?![/\\])/.test(entry.frameUrl)) {
          return entry.frameUrl;
        }
      }
      const fu = sessionStorage.getItem("frameurl");
      if (fu && /^\/(?![/\\])/.test(fu)) return fu;
    } catch {}
    return "/";
  }

  // Non-focus entry (direct visit, or a fragment arrival without focus=1): if this
  // is the editor of a site we've mapped, add the corner (back arrow) WITHOUT
  // hiding the sidebar. The user can still hide it from the side toggle.
  // Remembers the public domain for the arrow.
  async function installCornerForMappedSite() {
    try {
      const host = location.hostname.toLowerCase();
      if (!host.endsWith(".squarespace.com")) return;
      const sub = host.slice(0, -".squarespace.com".length);
      const { mappings = [] } = await chrome.storage.local.get({ mappings: [] });
      const m = mappings.find((x) => (x.sqspSubdomain || "").trim().toLowerCase() === sub);
      if (!m || !m.publicDomain) return;  // not a mapped site → leave the editor untouched
      // Defensive: a hand-edited mapping with a malformed domain (spaces, slashes,
      // a scheme) would build a broken or surprising URL — require a plausible
      // hostname, mirroring background.js's subdomain check.
      const domain = String(m.publicDomain).trim().toLowerCase();
      if (!/^[a-z0-9][a-z0-9.-]*\.[a-z0-9-]+$/.test(domain)) {
        console.warn(TAG, "invalid publicDomain in mapping:", m.publicDomain);
        return;
      }
      liveDomain = domain;
      installCorner(false);  // show the corner, but don't strip the sidebar
    } catch (e) {
      console.warn(TAG, "mapped-site corner error:", e);
    }
  }

  // Installs the corner control + its stylesheet (which also defines the focus view).
  // enterFocus=true hides the sidebar (pencil flow); enterFocus=false just adds the
  // corner and leaves the editor untouched (direct visit) — the user can still hide
  // the sidebar from the side toggle.
  function installCorner(enterFocus = true) {
    // Inject styles before the SPA renders. The sidebar-hiding rules are scoped to
    // body.qe4sqsp-focus, so without that class the editor is left as-is; the corner
    // rules apply either way. Selectors target stable class names (see NOTES.md).
    const style = document.createElement("style");
    style.id = "qe4sqsp-focus-css";
    style.textContent = `
      /* Hide the page-tree sidebar */
      body.qe4sqsp-focus .App-sidebar { display: none !important; }

      /* .config-website-frame uses position:fixed + transform:translateX(342px)
         + right:358px (the right-side inspector reservation). Override the
         transform — left/right alone don't move a transform-positioned element. */
      body.qe4sqsp-focus .config-website-frame {
        transform: none !important;
        left: 0 !important;
        right: 0 !important;
        width: 100% !important;
        max-width: 100% !important;
        margin-left: 0 !important;
      }

      body.qe4sqsp-focus .App-siteFrame,
      body.qe4sqsp-focus .js-device-view-frame,
      body.qe4sqsp-focus .preview-viewport {
        left: 0 !important;
        right: 0 !important;
        width: 100% !important;
        max-width: 100% !important;
        margin-left: 0 !important;
      }
      body.qe4sqsp-focus #sqs-site-frame {
        width: 100% !important;
      }

      /* Top-left corner control. The root is non-interactive; only the visible
         buttons capture clicks (so the page editor underneath stays usable). */
      .qe4sqsp-corner {
        position: fixed;
        top: 0;
        left: 0;
        z-index: 2147483647;
        pointer-events: none;
        font: 12px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      }

      /* Primary: back-to-live dog-ear (corner triangle). clip-path matches the
         hit area to the visible triangle so the transparent half doesn't capture
         clicks meant for the editor. */
      .qe4sqsp-back {
        position: absolute;
        top: 0;
        left: 0;
        width: 56px;
        height: 56px;
        background: #111;
        clip-path: polygon(0 0, 100% 0, 0 100%);
        pointer-events: auto;
        cursor: pointer;
        transition: transform 180ms ease, filter 180ms ease;
        transform-origin: top left;
        filter: drop-shadow(2px 2px 6px rgba(0, 0, 0, 0.25));
      }
      .qe4sqsp-back:hover {
        transform: scale(1.08);
        filter: drop-shadow(3px 3px 10px rgba(0, 0, 0, 0.4));
      }
      .qe4sqsp-back svg {
        position: absolute;
        top: 9px;
        left: 9px;
        width: 18px;
        height: 18px;
        fill: #fff;
        pointer-events: none;
      }

      /* Secondary: show/hide sidebar — drops down below the dog-ear on hover.
         The hide is delayed so the cursor can travel from the dog-ear onto this
         button without it disappearing. */
      .qe4sqsp-sidebar-toggle {
        position: absolute;
        top: 46px;
        left: 7px;
        width: 34px;
        height: 34px;
        border-radius: 9px;
        background: #111;
        display: grid;
        place-items: center;
        pointer-events: auto;
        cursor: pointer;
        opacity: 0;
        visibility: hidden;
        transform: translateY(-10px) scale(0.85);
        transform-origin: top center;
        filter: drop-shadow(2px 2px 6px rgba(0, 0, 0, 0.25));
        transition: opacity .18s ease .25s, transform .18s ease .25s, visibility 0s linear .43s;
      }
      /* :focus-visible keeps the dropdown reachable by keyboard — it's tabbable,
         so it must become visible when tabbed onto, not just on pointer hover. */
      .qe4sqsp-back:hover ~ .qe4sqsp-sidebar-toggle,
      .qe4sqsp-back:focus-visible ~ .qe4sqsp-sidebar-toggle,
      .qe4sqsp-sidebar-toggle:hover,
      .qe4sqsp-sidebar-toggle:focus-visible {
        opacity: 1;
        visibility: visible;
        transform: translateY(0) scale(1);
        transition: opacity .18s ease, transform .18s ease, visibility 0s;
      }
      .qe4sqsp-sidebar-toggle:hover {
        transform: translateY(0) scale(1.08);
        filter: drop-shadow(3px 3px 10px rgba(0, 0, 0, 0.4));
      }
      .qe4sqsp-sidebar-toggle svg {
        width: 18px;
        height: 18px;
        stroke: #fff;
        stroke-width: 2;
        fill: none;
        stroke-linecap: round;
        stroke-linejoin: round;
        pointer-events: none;
      }

      /* Tooltips */
      .qe4sqsp-tip {
        position: absolute;
        background: #111;
        color: #fff;
        white-space: nowrap;
        padding: 6px 10px;
        border-radius: 6px;
        opacity: 0;
        transform: translateX(-6px);
        transition: opacity 160ms ease, transform 160ms ease;
        pointer-events: none;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
      }
      .qe4sqsp-tip--back { top: 14px; left: 60px; }
      .qe4sqsp-tip--bar  { top: 52px; left: 50px; }
      .qe4sqsp-back:hover ~ .qe4sqsp-tip--back {
        opacity: 1;
        transform: translateX(0);
      }
      .qe4sqsp-sidebar-toggle:hover ~ .qe4sqsp-tip--bar {
        opacity: 1;
        transform: translateX(0);
      }
    `;
    (document.head || document.documentElement).appendChild(style);

    whenBodyReady(() => {
      if (enterFocus) {
        document.body.classList.add("qe4sqsp-focus");
        // Defensive: re-apply if the admin SPA replaces body.className later.
        // We track the observer so the toggle can disconnect it on user request.
        guard = new MutationObserver(() => {
          if (!document.body.classList.contains("qe4sqsp-focus")) {
            document.body.classList.add("qe4sqsp-focus");
          }
        });
        guard.observe(document.body, { attributes: true, attributeFilter: ["class"] });
      }
      injectCorner();
    });
  }

  function injectCorner() {
    if (document.querySelector(".qe4sqsp-corner")) return;

    const root = document.createElement("div");
    root.className = "qe4sqsp-corner";
    // opacity + visibility (not display) so edit-mode hide/show can fade.
    root.style.cssText = "opacity:1;visibility:visible;transition:opacity .4s ease, visibility .4s ease;";
    // Order matters: the `~` general-sibling selectors require the dropdown and
    // tooltips to follow the elements that trigger them.
    root.innerHTML = `
      <div class="qe4sqsp-back" role="button" tabindex="0" aria-label="Back to live page">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
        </svg>
      </div>
      <div class="qe4sqsp-sidebar-toggle" role="button" tabindex="0">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3" y="4" width="18" height="16" rx="2"/>
          <line x1="9" y1="4" x2="9" y2="20"/>
        </svg>
      </div>
      <div class="qe4sqsp-tip qe4sqsp-tip--back">Back to live page</div>
      <div class="qe4sqsp-tip qe4sqsp-tip--bar"></div>
    `;

    const backBtn = root.querySelector(".qe4sqsp-back");
    const barBtn = root.querySelector(".qe4sqsp-sidebar-toggle");
    const barTip = root.querySelector(".qe4sqsp-tip--bar");

    // ---- primary: back to the live page ----
    const back = (e) => { e.preventDefault(); e.stopPropagation(); goBackToLive(); };
    backBtn.addEventListener("click", back);
    backBtn.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") back(e);
    });

    // ---- secondary: show/hide the sidebar ----
    function refresh() {
      const inFocus = document.body && document.body.classList.contains("qe4sqsp-focus");
      // Label reflects the *action* the click will perform, not the current state.
      const label = inFocus ? "Show sidebar" : "Hide sidebar";
      barBtn.setAttribute("aria-label", label);
      barTip.textContent = label;
    }
    const toggleSidebar = (e) => {
      e.preventDefault();
      e.stopPropagation();
      // First user interaction means the SPA has clearly settled; disconnect
      // the guard so the toggle can flip the class freely in both directions.
      if (guard) { guard.disconnect(); guard = null; }
      if (!document.body) return;
      document.body.classList.toggle("qe4sqsp-focus");
      refresh();
    };
    barBtn.addEventListener("click", toggleSidebar);
    barBtn.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") toggleSidebar(e);
    });

    document.documentElement.appendChild(root);
    refresh();

    // Hide the whole control whenever Squarespace's page editor is active. In
    // edit mode the top-bar "Edit" button is replaced by "Save"/"Exit", the
    // page-tree sidebar isn't shown, and Squarespace has its own top-left
    // controls — so ours shouldn't sit on top of them. Restore on exit to preview.
    function isEditing() {
      let hasEdit = false, hasSave = false;
      for (const b of document.querySelectorAll("button")) {
        const t = (b.textContent || "").trim();
        if (t === "Exit") return true; // unambiguous edit-mode signal — stop scanning
        if (t === "Edit") hasEdit = true;
        else if (t === "Save") hasSave = true;
      }
      // Positive signal (Exit/Save present) so we never false-hide during load,
      // before the "Edit" button has rendered.
      return hasSave && !hasEdit;
    }
    function syncCornerVisibility() {
      const editing = isEditing();
      root.style.opacity = editing ? "0" : "1";
      root.style.visibility = editing ? "hidden" : "visible";
    }
    syncCornerVisibility();
    let vt = null;
    new MutationObserver(() => {
      if (vt) clearTimeout(vt);
      vt = setTimeout(syncCornerVisibility, 250);
    }).observe(document.body, { childList: true, subtree: true });
  }
})();

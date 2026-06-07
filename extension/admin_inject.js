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
//   1. parse target path + flags from the URL fragment (#__sqspedit=...&focus=1)
//   2. mint a unique history key
//   3. write sessionStorage["@@History/<key>"] with our target frameUrl
//   4. also write sessionStorage.frameurl (fallback in some boot paths)
//   5. history.replaceState({key}, "", "/config/pages/")  -- strips the fragment
//   6. if focus=1, inject a <style> that hides the App-sidebar and stretches
//      the iframe-holding container to fill the viewport, plus a top-left
//      dog-ear toggle that re-reveals the sidebar.

(() => {
  const TAG = "[QuickEdit for Squarespace]";
  let guard = null; // MutationObserver re-applying the focus class, until user toggles off

  try {
    const SENTINEL = "__sqspedit=";
    const hash = location.hash || "";
    const idx = hash.indexOf(SENTINEL);
    if (idx === -1) return;

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

    if (focus) applyFocusMode();
  } catch (e) {
    console.warn(TAG, "admin_inject error:", e);
  }

  function whenBodyReady(cb) {
    if (document.body) { cb(); return; }
    new MutationObserver((_, obs) => {
      if (document.body) { cb(); obs.disconnect(); }
    }).observe(document.documentElement, { childList: true });
  }

  function applyFocusMode() {
    // Inject styles before the SPA renders. Selectors target stable
    // semantic class names we observed in the admin DOM (see NOTES.md).
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

      /* Top-left dog-ear that brings the sidebar back. Visible only while
         focus mode is active — we remove the element on click.
         clip-path makes the hit area match the visible triangle so the
         transparent half doesn't capture clicks meant for the page editor. */
      .qe4sqsp-sidebar-toggle {
        position: fixed;
        top: 0;
        left: 0;
        width: 56px;
        height: 56px;
        z-index: 2147483647;
        background: #111;
        clip-path: polygon(0 0, 100% 0, 0 100%);
        pointer-events: auto;
        cursor: pointer;
        transition: transform 180ms ease, filter 180ms ease;
        transform-origin: top left;
        filter: drop-shadow(2px 2px 6px rgba(0, 0, 0, 0.25));
        font: 12px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      }
      .qe4sqsp-sidebar-toggle:hover {
        transform: scale(1.08);
        filter: drop-shadow(3px 3px 10px rgba(0, 0, 0, 0.4));
      }
      .qe4sqsp-sidebar-toggle svg {
        position: absolute;
        top: 9px;
        left: 9px;
        width: 18px;
        height: 18px;
        stroke: #fff;
        stroke-width: 2;
        fill: none;
        stroke-linecap: round;
        stroke-linejoin: round;
        pointer-events: none;
      }
      .qe4sqsp-sidebar-toggle__tooltip {
        position: absolute;
        top: 14px;
        left: 60px;
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
      .qe4sqsp-sidebar-toggle:hover ~ .qe4sqsp-sidebar-toggle__tooltip {
        opacity: 1;
        transform: translateX(0);
      }
    `;
    (document.head || document.documentElement).appendChild(style);

    whenBodyReady(() => {
      document.body.classList.add("qe4sqsp-focus");

      // Defensive: re-apply if the admin SPA replaces body.className later.
      // We track the observer so the toggle can disconnect it on user request.
      guard = new MutationObserver(() => {
        if (!document.body.classList.contains("qe4sqsp-focus")) {
          document.body.classList.add("qe4sqsp-focus");
        }
      });
      guard.observe(document.body, { attributes: true, attributeFilter: ["class"] });

      injectSidebarToggle();
    });
  }

  function injectSidebarToggle() {
    if (document.querySelector(".qe4sqsp-sidebar-toggle")) return;

    const root = document.createElement("div");
    // opacity + visibility (not display) so edit-mode hide/show can fade.
    root.style.cssText = "position:fixed;top:0;left:0;z-index:2147483647;pointer-events:none;opacity:1;visibility:visible;transition:opacity .4s ease, visibility .4s ease;";
    root.innerHTML = `
      <div class="qe4sqsp-sidebar-toggle"
           role="button" tabindex="0">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3" y="4" width="18" height="16" rx="2"/>
          <line x1="9" y1="4" x2="9" y2="20"/>
        </svg>
      </div>
      <div class="qe4sqsp-sidebar-toggle__tooltip"></div>
    `;

    const btn = root.querySelector(".qe4sqsp-sidebar-toggle");
    const tooltip = root.querySelector(".qe4sqsp-sidebar-toggle__tooltip");

    function refresh() {
      const inFocus = document.body && document.body.classList.contains("qe4sqsp-focus");
      // Label reflects the *action* the click will perform, not the current state.
      const label = inFocus ? "Show sidebar" : "Hide sidebar";
      btn.setAttribute("aria-label", label);
      tooltip.textContent = label;
    }

    const handler = (e) => {
      e.preventDefault();
      e.stopPropagation();
      // First user interaction means the SPA has clearly settled; disconnect
      // the guard so the toggle can flip the class freely in both directions.
      if (guard) { guard.disconnect(); guard = null; }
      if (!document.body) return;
      document.body.classList.toggle("qe4sqsp-focus");
      refresh();
    };

    btn.addEventListener("click", handler);
    btn.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") handler(e);
    });

    document.documentElement.appendChild(root);
    refresh();

    // Hide the toggle whenever Squarespace's page editor is active. In edit mode
    // the top-bar "Edit" button is replaced by "Save"/"Exit", and the page-tree
    // sidebar isn't shown at all — so our toggle has no purpose and shouldn't sit
    // there looking clickable (toggling the class only takes visible effect after
    // you exit, which reads as a dead button). Restore it on exit to preview.
    function isEditing() {
      let hasEdit = false, hasExit = false, hasSave = false;
      for (const b of document.querySelectorAll("button")) {
        const t = (b.textContent || "").trim();
        if (t === "Edit") hasEdit = true;
        else if (t === "Exit") hasExit = true;
        else if (t === "Save") hasSave = true;
      }
      // Positive signal (Exit/Save present) so we never false-hide during load,
      // before the "Edit" button has rendered.
      return hasExit || (hasSave && !hasEdit);
    }
    function syncToggleVisibility() {
      const editing = isEditing();
      root.style.opacity = editing ? "0" : "1";
      root.style.visibility = editing ? "hidden" : "visible";
    }
    syncToggleVisibility();
    let vt = null;
    new MutationObserver(() => {
      if (vt) clearTimeout(vt);
      vt = setTimeout(syncToggleVisibility, 250);
    }).observe(document.body, { childList: true, subtree: true });
  }
})();

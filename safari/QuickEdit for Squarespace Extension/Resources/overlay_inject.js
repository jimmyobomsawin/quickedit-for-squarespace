// Injects a top-LEFT corner overlay on mapped public domains.
//   Click the pencil dog-ear → opens the editor in THIS tab (same window),
//   in FOCUS MODE (sidebar hidden, iframe stretched).
//   Hover the pencil → an "open in new tab" button drops down; clicking it
//   opens the editor in a NEW tab instead.
// From inside the editor, a back-arrow dog-ear returns you to the live page
// and a hover dropdown re-reveals the sidebar (see admin_inject.js).

(async () => {
  if (window.__sqspEditOverlayInstalled) return;
  window.__sqspEditOverlayInstalled = true;

  const normalize = (h) => (h || "").toLowerCase().replace(/^www\./, "");

  let mappings = [];
  try {
    ({ mappings = [] } = await chrome.storage.local.get({ mappings: [] }));
  } catch {
    return;
  }
  const host = normalize(location.hostname);
  if (!mappings.some((m) => normalize(m.publicDomain) === host)) return;

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.mappings) return;
    const updated = changes.mappings.newValue || [];
    const stillMapped = updated.some((m) => normalize(m.publicDomain) === host);
    const el = document.querySelector(".sqsp-edit-overlay");
    if (!stillMapped && el) el.remove();
    else if (stillMapped && !el) injectOverlay();
  });

  injectOverlay();

  function injectOverlay() {
    if (document.querySelector(".sqsp-edit-overlay")) return;

    const style = document.createElement("style");
    style.textContent = `
      .sqsp-edit-overlay {
        position: fixed;
        top: 0;
        left: 0;
        z-index: 2147483647;
        pointer-events: none;
        font: 12px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      }

      /* Primary: pencil dog-ear — top-left corner triangle. Opens the editor in
         THIS tab. clip-path restricts BOTH the visible region and the hit area
         to the triangle, so clicks just outside the diagonal pass through to the
         page content below. */
      .sqsp-edit-overlay__pencil {
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
      .sqsp-edit-overlay__pencil:hover {
        transform: scale(1.08);
        filter: drop-shadow(3px 3px 10px rgba(0, 0, 0, 0.4));
      }
      .sqsp-edit-overlay__pencil svg {
        position: absolute;
        top: 9px;
        left: 9px;
        width: 18px;
        height: 18px;
        fill: #fff;
        pointer-events: none;
        /* Mirror the pencil so it visually matches the left corner — tip
           points toward bottom-right, eraser tucks into the upper-left. */
        transform: scaleX(-1);
      }

      /* Secondary: "open in a new tab" — drops down below the pencil on hover.
         The hide is delayed so the cursor can travel from the pencil onto this
         button without it disappearing (there's a small gap between the two). */
      .sqsp-edit-overlay__more {
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
      .sqsp-edit-overlay__pencil:hover ~ .sqsp-edit-overlay__more,
      .sqsp-edit-overlay__more:hover {
        opacity: 1;
        visibility: visible;
        transform: translateY(0) scale(1);
        transition: opacity .18s ease, transform .18s ease, visibility 0s;
      }
      .sqsp-edit-overlay__more:hover {
        transform: translateY(0) scale(1.08);
        filter: drop-shadow(3px 3px 10px rgba(0, 0, 0, 0.4));
      }
      .sqsp-edit-overlay__more svg {
        width: 17px;
        height: 17px;
        fill: #fff;
        pointer-events: none;
      }

      /* Tooltips */
      .sqsp-edit-overlay__tip {
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
      .sqsp-edit-overlay__tip--edit { top: 14px; left: 60px; }
      .sqsp-edit-overlay__tip--new  { top: 52px; left: 50px; }
      .sqsp-edit-overlay__pencil:hover ~ .sqsp-edit-overlay__tip--edit {
        opacity: 1;
        transform: translateX(0);
      }
      .sqsp-edit-overlay__more:hover ~ .sqsp-edit-overlay__tip--new {
        opacity: 1;
        transform: translateX(0);
      }
    `;
    document.documentElement.appendChild(style);

    const root = document.createElement("div");
    root.className = "sqsp-edit-overlay";
    // Order matters: the `~` general-sibling selectors above require .more and
    // the tooltips to follow the elements that trigger them.
    root.innerHTML = `
      <div class="sqsp-edit-overlay__pencil"
           role="button" tabindex="0"
           aria-label="Edit this page in Squarespace">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.42l-2.34-2.34a1 1 0 0 0-1.42 0l-1.83 1.83 3.75 3.75 1.84-1.82z"/>
        </svg>
      </div>
      <div class="sqsp-edit-overlay__more"
           role="button" tabindex="0"
           aria-label="Edit this page in a new tab">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/>
        </svg>
      </div>
      <div class="sqsp-edit-overlay__tip sqsp-edit-overlay__tip--edit">Edit this page</div>
      <div class="sqsp-edit-overlay__tip sqsp-edit-overlay__tip--new">Edit in new tab</div>
    `;

    // Cooldown so a fast double-click doesn't fire twice (two tabs / double nav).
    let lastSent = 0;
    const send = (sameTab) => {
      const now = Date.now();
      if (now - lastSent < 800) return;
      lastSent = now;
      // Swallow "Unchecked runtime.lastError" if the service worker is briefly
      // unavailable (it gets woken by the message anyway).
      try {
        const p = chrome.runtime.sendMessage({ type: "edit-this-page", focus: true, sameTab });
        if (p && typeof p.catch === "function") p.catch(() => {});
      } catch (_) {}
    };

    const bind = (selector, sameTab) => {
      const el = root.querySelector(selector);
      const handler = (e) => { e.preventDefault(); e.stopPropagation(); send(sameTab); };
      el.addEventListener("click", handler);
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") handler(e);
      });
    };
    bind(".sqsp-edit-overlay__pencil", true);  // primary  → same tab
    bind(".sqsp-edit-overlay__more", false);   // secondary → new tab

    document.documentElement.appendChild(root);
  }
})();

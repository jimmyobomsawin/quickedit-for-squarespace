// Injects a top-LEFT corner overlay on mapped public domains.
//   Click the pencil → opens the editor in FOCUS MODE (sidebar hidden,
//   iframe stretched). Sidebar can be re-revealed from inside the editor
//   via the admin's left-corner toggle (see admin_inject.js).

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

      /* Pencil dog-ear — top-left corner triangle.
         clip-path restricts BOTH the visible region and the hit area to the
         actual triangle, so clicks just outside the diagonal pass through to
         the page content below. */
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

      /* Tooltip */
      .sqsp-edit-overlay__tooltip {
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
        top: 14px;
        left: 60px;
      }
      .sqsp-edit-overlay__pencil:hover ~ .sqsp-edit-overlay__tooltip {
        opacity: 1;
        transform: translateX(0);
      }
    `;
    document.documentElement.appendChild(style);

    const root = document.createElement("div");
    root.className = "sqsp-edit-overlay";
    root.innerHTML = `
      <div class="sqsp-edit-overlay__pencil"
           role="button" tabindex="0"
           aria-label="Edit this page in Squarespace">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.42l-2.34-2.34a1 1 0 0 0-1.42 0l-1.83 1.83 3.75 3.75 1.84-1.82z"/>
        </svg>
      </div>
      <div class="sqsp-edit-overlay__tooltip">Edit in Squarespace</div>
    `;

    const pencilBtn = root.querySelector(".sqsp-edit-overlay__pencil");
    // Cooldown so a fast double-click doesn't fire twice and open two editor tabs.
    let lastSent = 0;
    const send = () => {
      const now = Date.now();
      if (now - lastSent < 800) return;
      lastSent = now;
      // Swallow "Unchecked runtime.lastError" if the service worker is briefly
      // unavailable (it gets woken by the message anyway).
      try {
        const p = chrome.runtime.sendMessage({ type: "edit-this-page", focus: true });
        if (p && typeof p.catch === "function") p.catch(() => {});
      } catch (_) {}
    };
    const handler = (e) => { e.preventDefault(); e.stopPropagation(); send(); };
    pencilBtn.addEventListener("click", handler);
    pencilBtn.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") handler(e);
    });

    document.documentElement.appendChild(root);
  }
})();

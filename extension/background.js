const ADMIN_PATH = "/config/pages/";
const EDIT_SENTINEL = "__sqspedit";
const OVERLAY_SCRIPT_ID = "overlay-mapped-sites";

// Read mappings from chrome.storage.local. (Was chrome.storage.sync prior to
// v0.4.x — sync was unreliable on Brave without Brave Sync enabled, and
// added propagation lag with no benefit for a single-device workflow. Local
// storage persists across reloads/updates without external sync.)
async function getMappings() {
  const { mappings } = await chrome.storage.local.get({ mappings: [] });
  return mappings;
}

// One-time migration: if local is empty but legacy sync data exists, copy it
// over. Idempotent. Called from onInstalled and onStartup.
async function migrateSyncToLocal() {
  try {
    const { mappings: local } = await chrome.storage.local.get({ mappings: null });
    if (Array.isArray(local) && local.length) return;
    const { mappings: sync = [] } = await chrome.storage.sync.get({ mappings: [] });
    if (sync.length) {
      await chrome.storage.local.set({ mappings: sync });
      console.info("[QuickEdit] migrated", sync.length, "mapping(s) from sync to local storage");
    }
  } catch (e) {
    console.warn("[QuickEdit] sync→local migration error:", e);
  }
}

function normalizeHost(host) {
  return (host || "").toLowerCase().replace(/^www\./, "");
}

function matchMapping(mappings, host) {
  const h = normalizeHost(host);
  return mappings.find((m) => normalizeHost(m.publicDomain) === h);
}

// ---------------------------------------------------------------------------
// Dynamic overlay registration.
//
// The overlay used to be a static content script matching http(s)://*/* — which
// meant the extension declared access to every site and ran on every page load.
// Now it's registered at runtime only for the specific domains the user has
// mapped AND granted per-site access to. host_permissions is just squarespace.com;
// the broad grant lives in optional_host_permissions and is requested per-site
// from the options page (a user gesture) on Save.
// ---------------------------------------------------------------------------

function originsForDomain(domain) {
  // Cover the apex AND any subdomain (people visit example.com and www./shop. etc).
  return [`*://${domain}/*`, `*://*.${domain}/*`];
}

async function grantedOriginsForMappings(mappings) {
  const out = [];
  for (const m of mappings) {
    if (!m || !m.publicDomain) continue;
    // Check each pattern independently so a partial grant (e.g. the apex but not
    // the subdomain wildcard) still registers the overlay where it's allowed.
    for (const origin of originsForDomain(m.publicDomain)) {
      let has = false;
      try { has = await chrome.permissions.contains({ origins: [origin] }); } catch {}
      if (has) out.push(origin);
    }
  }
  return [...new Set(out)];
}

async function reconcileOverlayScripts() {
  if (!chrome.scripting || !chrome.scripting.registerContentScripts) {
    console.warn("[QuickEdit] chrome.scripting.registerContentScripts unavailable — overlay can't be registered on this browser version");
    return;
  }

  const mappings = await getMappings();
  const origins = await grantedOriginsForMappings(mappings);

  let existing = [];
  try {
    existing = await chrome.scripting.getRegisteredContentScripts({ ids: [OVERLAY_SCRIPT_ID] });
  } catch {}

  // Nothing granted → make sure no overlay script is registered.
  if (!origins.length) {
    if (existing.length) {
      try { await chrome.scripting.unregisterContentScripts({ ids: [OVERLAY_SCRIPT_ID] }); }
      catch (e) { console.warn("[QuickEdit] unregister overlay failed:", e); }
    }
    return;
  }

  const def = {
    id: OVERLAY_SCRIPT_ID,
    js: ["overlay_inject.js"],
    matches: origins,
    // Never run on Squarespace's own admin/account pages, even if a user maps a
    // *.squarespace.com site — admin_inject/account_inject own those.
    excludeMatches: ["*://*.squarespace.com/*"],
    runAt: "document_idle",
    allFrames: false,
    persistAcrossSessions: true
  };

  try {
    if (existing.length) await chrome.scripting.updateContentScripts([def]);
    else await chrome.scripting.registerContentScripts([def]);
  } catch (e) {
    console.warn("[QuickEdit] register overlay failed:", e);
  }
}

// Serialize reconciles so overlapping triggers (storage change + permissions
// change firing together) can't race into a duplicate-register error.
let reconcileChain = Promise.resolve();
function scheduleReconcile() {
  reconcileChain = reconcileChain.then(reconcileOverlayScripts, () => reconcileOverlayScripts());
  return reconcileChain;
}

// ---------------------------------------------------------------------------

async function editTab(tab, opts = {}) {
  if (!tab || !tab.url) return;
  let u;
  try { u = new URL(tab.url); } catch { return; }

  const mappings = await getMappings();
  const mapping = matchMapping(mappings, u.hostname);

  if (!mapping) {
    await chrome.tabs.create({
      url: chrome.runtime.getURL(`options.html?missing=${encodeURIComponent(u.hostname)}`)
    });
    return;
  }

  const sqsp = (mapping.sqspSubdomain || "").trim().toLowerCase();
  // Defense against a corrupt/hand-edited mapping: a real Squarespace subdomain
  // is a single DNS label (letters, digits, hyphens). Anything else could build
  // a malformed or unexpected admin URL, so bail to Options instead of opening it.
  if (!/^[a-z0-9-]+$/.test(sqsp)) {
    console.warn("[QuickEdit] invalid Squarespace subdomain in mapping:", mapping.sqspSubdomain);
    await chrome.runtime.openOptionsPage();
    return;
  }
  const frameUrl = (u.pathname || "/") + (u.search || "");
  // Pass the target path via URL fragment so admin_inject.js can read it
  // synchronously at document_start (before the admin shell boots).
  // Append &focus=1 when focus mode was the trigger.
  let fragment = `${EDIT_SENTINEL}=${encodeURIComponent(frameUrl)}`;
  if (opts.focus) fragment += "&focus=1";
  // Carry the originating live URL so the in-editor "back to live page"
  // dog-ear knows where to return — for both focus and normal arrivals, and
  // even when opened in a new tab. admin_inject.js re-validates it (http(s) +
  // matches a saved mapping) before ever navigating, so a stale/forged value
  // can't redirect anywhere.
  fragment += `&src=${encodeURIComponent(tab.url)}`;
  const adminUrl = `https://${sqsp}.squarespace.com${ADMIN_PATH}#${fragment}`;

  // Same-tab navigation (the overlay pencil) reuses the current tab; the
  // drop-down "open in new tab" button (and context menus) create a new one.
  if (opts.sameTab && tab.id != null && tab.id !== chrome.tabs.TAB_ID_NONE) {
    try {
      await chrome.tabs.update(tab.id, { url: adminUrl });
      return;
    } catch (e) {
      console.warn("[QuickEdit] same-tab navigation failed, opening a new tab:", e);
    }
  }
  await chrome.tabs.create({ url: adminUrl, index: tab.index + 1 });
}

// Toolbar click → open the settings page. (The dog-ear overlay on the user's
// own sites is the trigger for actually editing.)
chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

chrome.runtime.onInstalled.addListener(() => {
  // removeAll first so re-running can't throw a duplicate-id error; swallow
  // lastError on each create so it never logs an unchecked-error warning.
  chrome.contextMenus.removeAll(() => {
    void chrome.runtime.lastError;
    chrome.contextMenus.create({
      id: "sqsp-edit-page",
      title: "Edit this page in Squarespace",
      contexts: ["page", "frame", "link"]
    }, () => void chrome.runtime.lastError);
    chrome.contextMenus.create({
      id: "sqsp-edit-page-focus",
      title: "Edit this page in Squarespace (focus mode)",
      contexts: ["page", "frame", "link"]
    }, () => void chrome.runtime.lastError);
  });
  migrateSyncToLocal().then(scheduleReconcile);
});

chrome.runtime.onStartup.addListener(() => {
  migrateSyncToLocal().then(scheduleReconcile);
});

// Re-register whenever mappings change or host permissions are granted/revoked.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.mappings) scheduleReconcile();
});
if (chrome.permissions && chrome.permissions.onAdded) {
  chrome.permissions.onAdded.addListener(() => scheduleReconcile());
}
if (chrome.permissions && chrome.permissions.onRemoved) {
  chrome.permissions.onRemoved.addListener(() => scheduleReconcile());
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "sqsp-edit-page") editTab(tab);
  if (info.menuItemId === "sqsp-edit-page-focus") editTab(tab, { focus: true });
});

// Dog-ear overlay on user's public sites sends a message; we resolve the
// sender's tab and run the edit flow on that tab.
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg && msg.type === "edit-this-page" && sender && sender.tab) {
    editTab(sender.tab, { focus: !!msg.focus, sameTab: !!msg.sameTab });
  }
});

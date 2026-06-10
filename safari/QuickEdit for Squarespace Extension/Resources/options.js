const tbody = document.querySelector("#mappings tbody");
const addBtn = document.querySelector("#add");
const saveBtn = document.querySelector("#save");
const importBtn = document.querySelector("#import");
const removeAllBtn = document.querySelector("#removeAll");
const statusEl = document.querySelector("#status");
const bannerEl = document.querySelector("#banner");

function cleanWebsite(input) {
  if (!input) return "";
  let s = String(input).trim().toLowerCase();
  s = s.replace(/^[a-z]+:\/\//, "");
  s = s.replace(/^www\./, "");
  s = s.split("/")[0];
  s = s.split("?")[0];
  s = s.split("#")[0];
  s = s.replace(/:\d+$/, "");
  s = s.replace(/\.+$/, "");
  return s;
}

function cleanSubdomain(input) {
  if (!input) return "";
  let s = String(input).trim().toLowerCase();
  s = s.replace(/^[a-z]+:\/\//, "");
  s = s.split("/")[0];
  s = s.split("?")[0];
  s = s.split("#")[0];
  s = s.replace(/\.squarespace\.com\.?$/, "");
  s = s.replace(/^www\./, "");
  s = s.replace(/^\.+|\.+$/g, "");
  return s;
}

// Host-permission origin patterns the overlay needs for a mapping. Covers the
// apex domain and any subdomain. Mirrors originsForDomain() in background.js.
function originsForMappings(mappings) {
  const out = [];
  for (const m of mappings) {
    if (!m.publicDomain) continue;
    out.push(`*://${m.publicDomain}/*`, `*://*.${m.publicDomain}/*`);
  }
  return [...new Set(out)];
}

function makeRow(mapping = {}) {
  const tr = document.createElement("tr");

  const tdDomain = document.createElement("td");
  tdDomain.className = "col-domain";
  const domainInput = document.createElement("input");
  domainInput.type = "text";
  domainInput.name = "publicDomain";
  domainInput.placeholder = "";
  domainInput.value = mapping.publicDomain || "";
  domainInput.spellcheck = false;
  domainInput.autocapitalize = "off";
  domainInput.autocomplete = "off";
  domainInput.addEventListener("blur", () => {
    domainInput.value = cleanWebsite(domainInput.value);
  });
  tdDomain.appendChild(domainInput);
  tr.appendChild(tdDomain);

  const tdSub = document.createElement("td");
  tdSub.className = "col-sub";
  const wrap = document.createElement("div");
  wrap.className = "input-with-suffix";
  const subInput = document.createElement("input");
  subInput.type = "text";
  subInput.name = "sqspSubdomain";
  subInput.placeholder = "";
  subInput.value = mapping.sqspSubdomain || "";
  subInput.spellcheck = false;
  subInput.autocapitalize = "off";
  subInput.autocomplete = "off";
  subInput.addEventListener("blur", () => {
    subInput.value = cleanSubdomain(subInput.value);
  });
  const suffix = document.createElement("span");
  suffix.className = "suffix";
  suffix.textContent = ".squarespace.com";
  wrap.appendChild(subInput);
  wrap.appendChild(suffix);
  tdSub.appendChild(wrap);
  tr.appendChild(tdSub);

  const actions = document.createElement("td");
  actions.className = "actions";
  const del = document.createElement("button");
  del.type = "button";
  del.className = "danger-link";
  del.textContent = "Remove";
  del.addEventListener("click", () => tr.remove());
  actions.appendChild(del);
  tr.appendChild(actions);

  return tr;
}

function readRows() {
  return Array.from(tbody.querySelectorAll("tr"))
    .map((tr) => {
      const publicDomain = cleanWebsite(tr.querySelector('input[name="publicDomain"]').value);
      const sqspSubdomain = cleanSubdomain(tr.querySelector('input[name="sqspSubdomain"]').value);
      return { publicDomain, sqspSubdomain };
    })
    .filter((m) => m.publicDomain && m.sqspSubdomain);
}

function showBanner(html) {
  bannerEl.hidden = false;
  bannerEl.innerHTML = html;
}

function hideBanner() {
  bannerEl.hidden = true;
  bannerEl.innerHTML = "";
}

function setStatus(msg, isErr = false) {
  statusEl.textContent = msg;
  statusEl.classList.toggle("err", isErr);
  if (msg) setTimeout(() => { if (statusEl.textContent === msg) statusEl.textContent = ""; }, 3000);
}

async function load() {
  // Prefer local (current home for mappings). Fall back to sync once for any
  // user upgrading from a pre-0.4.x version — anything found there is
  // migrated into local on the next save.
  let { mappings = [] } = await chrome.storage.local.get({ mappings: [] });
  if (!mappings.length) {
    const { mappings: legacy = [] } = await chrome.storage.sync.get({ mappings: [] });
    if (legacy.length) {
      mappings = legacy;
      await chrome.storage.local.set({ mappings: legacy });
    }
  }
  const cleaned = mappings.map((m) => ({
    publicDomain: cleanWebsite(m.publicDomain),
    sqspSubdomain: cleanSubdomain(m.sqspSubdomain)
  }));
  tbody.innerHTML = "";
  const rows = cleaned.length ? cleaned : [{}];
  for (const m of rows) tbody.appendChild(makeRow(m));
  maybeShowMissingBanner();
  checkAccessBanner();
}

// If sites are mapped but the overlay's host access hasn't been granted yet,
// nudge the user to Save (the grant happens on Save, inside the user gesture).
async function checkAccessBanner() {
  if (!bannerEl.hidden) return; // don't clobber the "missing mapping" banner
  const origins = originsForMappings(readRows());
  if (!origins.length) return;
  if (!(chrome.permissions && chrome.permissions.contains)) return;
  let has = false;
  try { has = await chrome.permissions.contains({ origins }); } catch {}
  if (!has) {
    showBanner(`The pencil needs permission to appear on your sites. Click <strong>Save</strong> to grant access (you'll see a one-time prompt).`);
  }
}

function maybeShowMissingBanner() {
  const params = new URLSearchParams(location.search);
  const missing = params.get("missing");
  if (!missing) return;
  const cleanedMissing = cleanWebsite(missing);
  showBanner(`No mapping found for <code>${cleanedMissing.replace(/[<&>]/g, "")}</code>. Add it below, then click <strong>Save</strong>.`);
  const firstEmpty = Array.from(tbody.querySelectorAll('input[name="publicDomain"]')).find((i) => !i.value);
  if (firstEmpty) firstEmpty.value = cleanedMissing;
  else tbody.appendChild(makeRow({ publicDomain: cleanedMissing }));
}

addBtn.addEventListener("click", () => {
  const tr = makeRow();
  tbody.appendChild(tr);
  tr.querySelector("input").focus();
});

saveBtn.addEventListener("click", async () => {
  // Sync DOM cleanup only. chrome.permissions.request() must be called while the
  // click's user gesture is still active, so it has to be the first await here.
  for (const tr of tbody.querySelectorAll("tr")) {
    const d = tr.querySelector('input[name="publicDomain"]');
    const s = tr.querySelector('input[name="sqspSubdomain"]');
    d.value = cleanWebsite(d.value);
    s.value = cleanSubdomain(s.value);
  }
  const mappings = readRows();
  const origins = originsForMappings(mappings);

  // Request per-site host access for the mapped domains. Already-granted
  // origins don't re-prompt; the browser only asks about new ones. Any failure
  // is surfaced verbatim in the status line so it's diagnosable without DevTools.
  let granted = true;
  let requestError = "";
  if (origins.length) {
    if (!(chrome.permissions && chrome.permissions.request)) {
      granted = false;
      requestError = "chrome.permissions.request is unavailable in this browser.";
    } else {
      try {
        granted = await chrome.permissions.request({ origins });
      } catch (e) {
        granted = false;
        requestError = String((e && e.message) || e);
      }
    }
  }

  await chrome.storage.local.set({ mappings });

  // Best-effort privacy cleanup: revoke host access for sites that are no longer
  // mapped, so removing a mapping also drops the permission it granted. Required
  // permissions (*.squarespace.com) are filtered out; failures are non-fatal
  // (Safari's permissions model differs, and background re-reconciles on change).
  try {
    if (chrome.permissions && chrome.permissions.getAll && chrome.permissions.remove) {
      const all = await chrome.permissions.getAll();
      const needed = new Set(origins);
      const stale = (all.origins || []).filter(
        (o) => o !== "*://*.squarespace.com/*" && !needed.has(o)
      );
      if (stale.length) await chrome.permissions.remove({ origins: stale });
    }
  } catch (e) {
    console.warn("[QuickEdit] stale-permission cleanup skipped:", e);
  }

  if (!origins.length) {
    setStatus("Saved. Add a site above, then Save again to grant access.");
  } else if (granted) {
    setStatus(`Saved ${mappings.length} site${mappings.length === 1 ? "" : "s"} and granted access. Reload an open site tab to see the pencil.`);
    hideBanner();
  } else if (requestError) {
    setStatus(`Saved, but requesting site access failed: ${requestError}`, true);
  } else {
    setStatus("Saved, but you declined site access. Click Save again and choose Allow so the pencil can appear.", true);
  }
});

removeAllBtn.addEventListener("click", () => {
  const rowCount = tbody.querySelectorAll("tr").length;
  const filled = readRows().length;
  if (filled === 0 && rowCount <= 1) {
    setStatus("Nothing to remove.");
    return;
  }
  if (!confirm("Remove all site mappings? This won't save until you click Save.")) return;
  tbody.innerHTML = "";
  tbody.appendChild(makeRow());
  setStatus("All rows cleared. Click Save to commit.");
});

importBtn.addEventListener("click", async () => {
  hideBanner();
  const { discoveredSites } = await chrome.storage.local.get({ discoveredSites: null });
  if (!discoveredSites || !discoveredSites.sites || discoveredSites.sites.length === 0) {
    showBanner(`No imported sites yet. Open <a href="https://account.squarespace.com" target="_blank" rel="noopener">account.squarespace.com</a>, wait for it to load, then come back and click Import again.`);
    return;
  }

  // Drop the placeholder empty row, if any
  const existingRows = Array.from(tbody.querySelectorAll("tr"));
  const empties = existingRows.filter((tr) => {
    const d = tr.querySelector('input[name="publicDomain"]').value.trim();
    const s = tr.querySelector('input[name="sqspSubdomain"]').value.trim();
    return !d && !s;
  });
  for (const e of empties) e.remove();

  const filled = readRows();
  const existingSubs = new Set(filled.map((r) => r.sqspSubdomain));
  const existingDomains = new Set(filled.map((r) => r.publicDomain).filter(Boolean));

  let added = 0, skipped = 0, needsDomain = 0;
  for (const s of discoveredSites.sites) {
    const sub = cleanSubdomain(s.subdomain);
    const dom = cleanWebsite(s.publicDomain || "");
    if (!sub) continue;
    if (existingSubs.has(sub)) { skipped++; continue; }
    if (dom && existingDomains.has(dom)) { skipped++; continue; }
    tbody.appendChild(makeRow({ publicDomain: dom, sqspSubdomain: sub }));
    if (!dom) needsDomain++;
    added++;
    existingSubs.add(sub);
    if (dom) existingDomains.add(dom);
  }

  if (added === 0) {
    setStatus(`Nothing new to import. (${skipped} already mapped.)`);
  } else {
    const parts = [`Imported ${added} site${added===1?'':'s'}.`];
    if (skipped) parts.push(`${skipped} already mapped (skipped).`);
    if (needsDomain) parts.push(`${needsDomain} need a custom domain filled in.`);
    parts.push(`Click Save to commit.`);
    setStatus(parts.join(" "));
  }
});

load();

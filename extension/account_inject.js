// Runs on account.squarespace.com to scrape the user's site list.
// Stores discovered sites in chrome.storage.local so the options page can
// import them when the user clicks "Import from Squarespace".

(() => {
  let observer = null;
  let hardStop = null;
  let lastCount = -1;
  let stableRuns = 0;

  function extractSites() {
    const links = Array.from(document.querySelectorAll('a[aria-label^="Go to website"]'));
    const sites = [];
    const seen = new Set();

    for (const a of links) {
      const m = a.href.match(/https?:\/\/([^./]+)\.squarespace\.com/i);
      if (!m) continue;
      const subdomain = m[1].toLowerCase();
      if (seen.has(subdomain)) continue;
      // Never import Squarespace's own infrastructure hosts — a dashboard markup
      // change could otherwise surface e.g. account.squarespace.com as a "site".
      if (["account", "www", "login", "static1", "assets"].includes(subdomain)) continue;

      // Find the smallest ancestor that contains only this one site link.
      let card = a.parentElement;
      while (card && card.parentElement) {
        const parentCount = card.parentElement.querySelectorAll('a[aria-label^="Go to website"]').length;
        if (parentCount > 1) break;
        card = card.parentElement;
      }
      if (!card) continue;

      const nameAnchor =
        card.querySelector('a[aria-label^="Start your website"]') ||
        card.querySelector('a[aria-label^="Go to website"]');
      const siteName = nameAnchor ? (nameAnchor.textContent || "").trim() : "";

      // The dashboard renders the primary public domain in a <p> inside the card,
      // sometimes followed by " + N more".
      let publicDomain = "";
      for (const p of card.querySelectorAll("p")) {
        const t = (p.textContent || "").trim();
        if (!/[a-z0-9-]+\.[a-z]{2,}/i.test(t)) continue;
        const firstDomain = t.split(/\s+\+\s+/)[0].trim();
        if (!firstDomain) continue;
        if (/\.squarespace\.com$/i.test(firstDomain)) continue; // not a custom domain
        publicDomain = firstDomain.replace(/^www\./i, "").toLowerCase();
        break;
      }

      // Skip sites with no custom domain mapped — they can't be reached
      // from a public URL the overlay would activate on.
      if (!publicDomain) continue;

      sites.push({ subdomain, siteName, publicDomain });
      seen.add(subdomain);
    }
    return sites;
  }

  function stopObserving() {
    if (observer) { observer.disconnect(); observer = null; }
    if (hardStop) { clearTimeout(hardStop); hardStop = null; }
  }

  async function persist() {
    try {
      const sites = extractSites();

      // Stability bookkeeping (synchronous, before any await, so overlapping
      // persist() calls can't race on these counters). Once the discovered set
      // is non-empty and unchanged across two consecutive scrapes, the dashboard
      // has finished rendering — stop watching so we don't keep an observer alive
      // on a tab the user leaves open. A freshly created site added later just
      // needs a dashboard reload to be picked up.
      if (sites.length > 0 && sites.length === lastCount) stableRuns++;
      else stableRuns = 0;
      lastCount = sites.length;
      if (stableRuns >= 2) stopObserving();

      if (sites.length) {
        await chrome.storage.local.set({ discoveredSites: { sites, ts: Date.now() } });
      }
    } catch (e) {
      console.warn("[QuickEdit for Squarespace] account scraper:", e);
    }
  }

  function start() {
    persist();
    setTimeout(persist, 1500);
    setTimeout(persist, 4000);

    let t = null;
    observer = new MutationObserver(() => {
      if (t) clearTimeout(t);
      t = setTimeout(persist, 800);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // Safety cap: stop watching after 30s regardless. The dashboard has long
    // since rendered by then; this prevents a perpetual observer.
    hardStop = setTimeout(stopObserving, 30000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();

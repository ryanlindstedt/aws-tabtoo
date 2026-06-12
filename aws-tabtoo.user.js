// ==UserScript==
// @name         AWS Tabtoo
// @namespace    https://github.com/ryanlindstedt/aws-tabtoo
// @version      1.2.0
// @description  Prefixes AWS Console browser tab titles with the account name or ID for easy multi-account identification
// @author       ryanlindstedt
// @match        https://*.console.aws.amazon.com/*
// @match        https://*.console.amazonaws-us-gov.com/*
// @match        https://*.awsapps.com/start/*
// @updateURL    https://raw.githubusercontent.com/ryanlindstedt/aws-tabtoo/main/aws-tabtoo.user.js
// @downloadURL  https://raw.githubusercontent.com/ryanlindstedt/aws-tabtoo/main/aws-tabtoo.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ============================================================
  // ACCOUNT ID → CUSTOM NAME MAPPING
  // Add your accounts here. The key is the 12-digit account ID
  // (no dashes), and the value is the label shown in the title.
  // These take highest priority over any auto-detected name.
  // ============================================================
  const ACCOUNT_NAMES = {
    // '123456789012': 'CUSTNAME',
    // '987654321098': 'my-dev-account',
  };

  // ============================================================
  // DIRECTORY ID → CUSTOM NAME MAPPING (AWS Access Portal)
  // Add your SSO directory IDs here. The key is the directory ID
  // from the URL (e.g. 'd-90661c91cb'), and the value is the
  // label shown in the title.
  // ============================================================
  const DIRECTORY_NAMES = {
    // 'd-90661c91cb': 'My SSO Portal',
  };

  // --- State ---

  let accountId = null;
  let accountName = null;
  let resolved = false; // true once we have a definitive display name
  let lastHref = location.href; // for SPA navigation detection
  let updatingTitle = false; // re-entrancy guard for title observer

  // Zero-width space used as a marker to identify our prefix vs legitimate brackets
  const PREFIX_MARKER = '\u200B';

  // --- AWS Access Portal detection ---

  function isAccessPortal() {
    return location.hostname.endsWith('.awsapps.com');
  }

  function getPortalDirectoryId() {
    const match = location.hostname.match(/^([^.]+)\.awsapps\.com$/);
    return match ? match[1] : null;
  }

  // --- Unified display name resolution ---

  function resolveDisplayName() {
    if (isAccessPortal()) {
      const directoryId = getPortalDirectoryId();
      if (directoryId && DIRECTORY_NAMES[directoryId]) return DIRECTORY_NAMES[directoryId];
      if (directoryId) return directoryId;
      return 'unknown';
    }
    if (accountId && ACCOUNT_NAMES[accountId]) return ACCOUNT_NAMES[accountId];
    if (accountName) return accountName;
    if (accountId) return accountId;
    return 'unknown';
  }

  // --- Unified title update (single code path for all page types) ---

  function updateTitle() {
    if (updatingTitle) return;
    const displayName = resolveDisplayName();
    const current = document.title;
    // Strip our own prefix using the zero-width space marker
    const stripped = current.replace(new RegExp(`^\\[.*?\\]${PREFIX_MARKER}\\s*`), '');
    const newTitle = `[${displayName}]${PREFIX_MARKER} ${stripped}`;
    if (document.title !== newTitle) {
      updatingTitle = true;
      document.title = newTitle;
      updatingTitle = false;
    }
  }

  // --- Account ID extraction (cheapest methods first) ---

  function fetchAccountIdFromUrl() {
    // Pattern: {accountId}-{hash}.{region}.console.aws.amazon.com
    const subdomainMatch = location.hostname.match(/^(\d{12})-/);
    return subdomainMatch ? subdomainMatch[1] : null;
  }

  function fetchAccountIdFromDom() {
    // Method 1: meta tag (very fast, single querySelector)
    const metaTag = document.querySelector('meta[name="awsc-account-id"]');
    if (metaTag) return metaTag.getAttribute('content');

    // Method 2: account menu button in the top nav
    const menuBtn = document.querySelector('[data-testid="awsc-nav-account-menu-button"]');
    if (menuBtn) {
      const match = menuBtn.textContent.match(/(\d{4}-\d{4}-\d{4}|\d{12})/);
      if (match) return match[0].replace(/-/g, '');
    }

    // Method 3: account ID element in the nav
    const idEl = document.querySelector('#awsc-navigation__more-menu--account-id');
    if (idEl) return idEl.textContent.trim().replace(/-/g, '');

    // Method 4: inline script data (scan once, stop at first match)
    const scripts = document.querySelectorAll('script:not([src])');
    for (let i = 0; i < scripts.length; i++) {
      const text = scripts[i].textContent;
      if (!text) continue;
      const match = text.match(/"accountId"\s*:\s*"(\d{12})"/);
      if (match) return match[1];
    }

    return null;
  }

  function fetchAccountName() {
    // Method 1: account menu button text ("AccountName @ 1234-5678-9012")
    // Single querySelector, most reliable indicator
    const menuBtn = document.querySelector('[data-testid="awsc-nav-account-menu-button"]');
    if (menuBtn) {
      const text = menuBtn.textContent.trim();
      const aliasMatch = text.match(/^(.+?)\s*@\s*\d/);
      if (aliasMatch) return aliasMatch[1].trim();
    }

    // Method 2: inline scripts for accountAlias or accountName
    // More stable than DOM structure — relies on data, not layout
    const scripts = document.querySelectorAll('script:not([src])');
    for (let i = 0; i < scripts.length; i++) {
      const text = scripts[i].textContent;
      if (!text) continue;
      const m1 = text.match(/"accountAlias"\s*:\s*"([^"]+)"/);
      if (m1) return m1[1];
      const m2 = text.match(/"accountName"\s*:\s*"([^"]+)"/);
      if (m2) return m2[1];
    }

    // Method 3: button with aria-label "Copy account name" (fragile — relies on sibling structure)
    const copyBtn = document.querySelector('button[aria-label="Copy account name"]');
    if (copyBtn) {
      const wrapper = copyBtn.closest('span[class*="root"]');
      if (wrapper && wrapper.nextElementSibling) {
        const name = wrapper.nextElementSibling.textContent.trim();
        if (name) return name;
      }
    }

    return null;
  }

  // --- Title observer (with re-entrancy guard) ---

  function observeTitleChanges() {
    const titleEl = document.querySelector('title');
    if (!titleEl) return;
    new MutationObserver(() => updateTitle())
      .observe(titleEl, { childList: true, characterData: true, subtree: true });
  }

  // --- Account name observer (polling instead of broad body observer) ---

  function pollForAccountName() {
    // Try the targeted observer first if the nav element exists
    const navTarget =
      document.querySelector('[data-testid="awsc-nav-account-menu-button"]')?.closest('nav, header') ||
      document.querySelector('header');

    if (navTarget) {
      // Narrow observer — only watches the nav area
      const observer = new MutationObserver(() => {
        const name = fetchAccountName();
        if (name) {
          accountName = name;
          resolved = true;
          updateTitle();
          observer.disconnect();
        }
      });
      observer.observe(navTarget, { childList: true, subtree: true });
      setTimeout(() => observer.disconnect(), 30000);
    } else {
      // Fallback: poll every 500ms instead of observing entire body
      let attempts = 0;
      const maxAttempts = 60; // 30 seconds at 500ms intervals
      const interval = setInterval(() => {
        attempts++;
        const name = fetchAccountName();
        if (name) {
          accountName = name;
          resolved = true;
          updateTitle();
          clearInterval(interval);
        } else if (attempts >= maxAttempts) {
          clearInterval(interval);
        }
      }, 500);
    }
  }

  // --- SPA navigation detection ---

  function watchForNavigation() {
    // Poll for URL changes to detect SPA navigation and account switches
    setInterval(() => {
      if (location.href !== lastHref) {
        lastHref = location.href;
        onNavigate();
      }
    }, 1000);

    // Also catch popstate events (back/forward navigation)
    window.addEventListener('popstate', () => {
      if (location.href !== lastHref) {
        lastHref = location.href;
        onNavigate();
      }
    });
  }

  function onNavigate() {
    // Re-run account detection — the user may have switched roles/accounts
    const newAccountId = fetchAccountIdFromUrl() || fetchAccountIdFromDom();
    const newAccountName = fetchAccountName();

    // Only update if something actually changed
    if (newAccountId !== accountId || newAccountName !== accountName) {
      accountId = newAccountId;
      accountName = newAccountName;
      resolved = !!(accountId && ACCOUNT_NAMES[accountId]) || !!accountName;
    }

    updateTitle();
  }

  // --- Main execution ---

  function init() {
    // Access Portal pages: resolve name from hostname, no account detection needed
    if (isAccessPortal()) {
      resolved = true;
      updateTitle();
      observeTitleChanges();
      watchForNavigation();
      return;
    }

    // Console pages: try URL first (no DOM access needed)
    accountId = fetchAccountIdFromUrl();

    // If URL didn't have it, check the DOM
    if (!accountId) {
      accountId = fetchAccountIdFromDom();
    }

    // Check if we already have a custom name mapped
    if (accountId && ACCOUNT_NAMES[accountId]) {
      resolved = true;
    }

    // Try to get account name from DOM
    if (!resolved) {
      accountName = fetchAccountName();
      if (accountName) resolved = true;
    }

    // Apply title immediately with whatever we have
    updateTitle();
    observeTitleChanges();
    watchForNavigation();

    // If we don't have the best display name yet, poll for it
    if (!resolved) {
      pollForAccountName();
    }
  }

  // Minimal delay — document-idle already ensures DOM is ready
  if (document.readyState === 'complete') {
    init();
  } else {
    window.addEventListener('load', init, { once: true });
  }
})();

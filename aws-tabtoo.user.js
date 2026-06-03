// ==UserScript==
// @name         AWS Tabtoo
// @namespace    https://github.com/ryanlindstedt/aws-tabtoo
// @version      1.0.0
// @description  Prefixes AWS Console browser tab titles with the account name or ID for easy multi-account identification
// @author       ryanlindstedt
// @match        https://*.console.aws.amazon.com/*
// @match        https://*.console.amazonaws-us-gov.com/*
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

  let accountId = null;
  let accountName = null;
  let resolved = false; // true once we have a custom name or account name

  // Resolution order: Custom name → Account name → Account ID → "unknown"
  function getDisplayName() {
    if (accountId && ACCOUNT_NAMES[accountId]) return ACCOUNT_NAMES[accountId];
    if (accountName) return accountName;
    if (accountId) return accountId;
    return 'unknown';
  }

  function updateTitle() {
    const displayName = getDisplayName();
    const current = document.title;
    const stripped = current.replace(/^\[.*?\]\s*/, '');
    const newTitle = `[${displayName}] ${stripped}`;
    if (document.title !== newTitle) {
      document.title = newTitle;
    }
  }

  // --- Account ID extraction (fast path first) ---

  function fetchAccountIdFromUrl() {
    // AWS console URLs use the pattern: {accountId}-{hash}.{region}.console.aws.amazon.com
    // e.g. https://004813221592-y2jf7tih.us-east-2.console.aws.amazon.com/...
    const hostname = location.hostname;
    const subdomainMatch = hostname.match(/^(\d{12})-/);
    if (subdomainMatch) return subdomainMatch[1];

    return null;
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
    // This is the cheapest check — single querySelector, no iteration
    const menuBtn = document.querySelector('[data-testid="awsc-nav-account-menu-button"]');
    if (menuBtn) {
      const text = menuBtn.textContent.trim();
      const aliasMatch = text.match(/^(.+?)\s*@\s*\d/);
      if (aliasMatch) return aliasMatch[1].trim();
    }

    // Method 2: button with aria-label "Copy account name"
    const copyBtn = document.querySelector('button[aria-label="Copy account name"]');
    if (copyBtn) {
      const wrapper = copyBtn.closest('span[class*="root"]');
      if (wrapper && wrapper.nextElementSibling) {
        const name = wrapper.nextElementSibling.textContent.trim();
        if (name) return name;
      }
    }

    // Method 3: inline scripts for accountAlias or accountName
    const scripts = document.querySelectorAll('script:not([src])');
    for (let i = 0; i < scripts.length; i++) {
      const text = scripts[i].textContent;
      if (!text) continue;
      const m1 = text.match(/"accountAlias"\s*:\s*"([^"]+)"/);
      if (m1) return m1[1];
      const m2 = text.match(/"accountName"\s*:\s*"([^"]+)"/);
      if (m2) return m2[1];
    }

    return null;
  }

  // --- Observers (lightweight) ---

  function observeTitleChanges() {
    const titleEl = document.querySelector('title');
    if (!titleEl) return;
    new MutationObserver(() => updateTitle())
      .observe(titleEl, { childList: true, characterData: true, subtree: true });
  }

  // Targeted observer: only watches the nav area for account name appearance
  function observeAccountName() {
    // Find the narrowest container — the top nav bar
    const target =
      document.querySelector('[data-testid="awsc-nav-account-menu-button"]')?.closest('nav, header') ||
      document.querySelector('header') ||
      document.body;

    const observer = new MutationObserver(() => {
      const name = fetchAccountName();
      if (name) {
        accountName = name;
        resolved = true;
        updateTitle();
        observer.disconnect(); // Job done, stop watching
      }
    });

    observer.observe(target, { childList: true, subtree: true });

    // Safety: disconnect after 30s regardless to avoid long-running observers
    setTimeout(() => observer.disconnect(), 30000);
  }

  // --- Main execution ---

  function init() {
    // Fast path: try URL first (no DOM access needed)
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

    // If we don't have the best display name yet, set up a targeted observer
    if (!resolved) {
      observeAccountName();
    }
  }

  // Minimal delay — document-idle already ensures DOM is ready
  if (document.readyState === 'complete') {
    init();
  } else {
    window.addEventListener('load', init, { once: true });
  }
})();

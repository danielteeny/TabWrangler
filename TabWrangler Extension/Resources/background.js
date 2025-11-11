// background.js - Background service for tab monitoring

let userSettings = {};
let duplicateCache = new Set();

// Initialize background script
browser.runtime.onInstalled.addListener(async () => {
  console.log('TabWrangler installed');
  await loadSettings();
});

// Load settings
async function loadSettings() {
  const result = await browser.storage.sync.get({
    matchMode: 'domain',
    autoDetect: true,
    keepNewest: true,
    notifyDuplicates: true
  });
  userSettings = result;
}

// Listen for settings changes
browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync') {
    loadSettings();
  }
});

// Monitor tab creation
browser.tabs.onCreated.addListener(async (tab) => {
  if (!userSettings.autoDetect) return;

  // Wait a bit for the URL to load
  setTimeout(async () => {
    await checkForDuplicates(tab);
  }, 1000);
});

// Monitor tab updates
browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!userSettings.autoDetect) return;

  if (changeInfo.url) {
    await checkForDuplicates(tab);
  }
});

// Check for duplicates when a tab is created or updated
async function checkForDuplicates(tab) {
  if (!tab.url || tab.url.startsWith('about:') || tab.url.startsWith('chrome:') || tab.url.startsWith('safari:')) {
    return;
  }

  const allTabs = await browser.tabs.query({});
  const duplicates = allTabs.filter(t => {
    if (t.id === tab.id) return false;
    return matchTabs(tab, t, userSettings.matchMode);
  });

  if (duplicates.length > 0 && !duplicateCache.has(tab.id)) {
    duplicateCache.add(tab.id);

    if (userSettings.notifyDuplicates) {
      // Note: Safari extensions have limited notification support
      // This will need to be handled through the popup or badge
      updateBadge(duplicates.length + 1);
    }
  }
}

// Update extension badge
function updateBadge(count) {
  if (count > 0) {
    browser.browserAction.setBadgeText({ text: count.toString() });
    browser.browserAction.setBadgeBackgroundColor({ color: '#ff3b30' });
  } else {
    browser.browserAction.setBadgeText({ text: '' });
  }
}

// Match tabs based on mode
function matchTabs(tab1, tab2, mode) {
  try {
    const url1 = new URL(tab1.url);
    const url2 = new URL(tab2.url);

    switch (mode) {
      case 'exact':
        return tab1.url === tab2.url;

      case 'domain':
        return url1.hostname === url2.hostname;

      case 'subdomain':
        return url1.host === url2.host;

      case 'path':
        return url1.hostname === url2.hostname && url1.pathname === url2.pathname;

      default:
        return url1.hostname === url2.hostname;
    }
  } catch (e) {
    return false;
  }
}

// Listen for messages from popup
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'getDuplicates') {
    getDuplicateCount().then(sendResponse);
    return true;
  }
});

// Get current duplicate count
async function getDuplicateCount() {
  const tabs = await browser.tabs.query({});
  const duplicates = new Set();

  tabs.forEach((tab, index) => {
    tabs.slice(index + 1).forEach(otherTab => {
      if (matchTabs(tab, otherTab, userSettings.matchMode)) {
        duplicates.add(otherTab.id);
      }
    });
  });

  return duplicates.size;
}

// Clear duplicate cache when tabs are removed
browser.tabs.onRemoved.addListener((tabId) => {
  duplicateCache.delete(tabId);
});

// popup.js - Main popup UI logic

let currentScope = 'current';
let userSettings = {};

// Initialize popup
document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  await updateStats();
  attachEventListeners();
});

// Load user settings
async function loadSettings() {
  const result = await browser.storage.sync.get({
    matchMode: 'fullpath',
    autoDetect: true,
    keepNewest: true
  });
  userSettings = result;

  // Update UI controls
  document.getElementById('matchMode').value = userSettings.matchMode;
  document.getElementById('autoDetect').checked = userSettings.autoDetect;
  document.getElementById('keepNewest').checked = userSettings.keepNewest;

  // Update match mode description
  updateMatchModeDescription();
}

// Update match mode description
function updateMatchModeDescription() {
  const matchMode = document.getElementById('matchMode').value;
  const descriptions = {
    'exact': 'Complete URL must match exactly (including hash)',
    'fullpath': 'Host + port + path + query parameters must match',
    'path': 'Host + port + path only (ignores query parameters)',
    'port': 'Hostname + port only (perfect for self-hosted services)',
    'subdomain': 'Exact subdomain match (www.example.com ≠ api.example.com)',
    'domain': 'Root domain only (www.example.com = api.example.com)'
  };

  document.getElementById('matchModeDesc').textContent = descriptions[matchMode] || '';
}

// Save settings
async function saveSettings() {
  userSettings.matchMode = document.getElementById('matchMode').value;
  userSettings.autoDetect = document.getElementById('autoDetect').checked;
  userSettings.keepNewest = document.getElementById('keepNewest').checked;

  await browser.storage.sync.set(userSettings);
  updateMatchModeDescription();
  await updateStats();
  await updateDuplicatesList();
}

// Update tab statistics
async function updateStats() {
  const tabs = await getTabs();
  const duplicates = TabUtils.findDuplicates(tabs, userSettings.matchMode);

  document.getElementById('totalTabs').textContent = tabs.length;
  document.getElementById('duplicateCount').textContent = duplicates.totalDuplicates;

  // Update duplicates list
  await updateDuplicatesList();
}

// Update duplicates manifest list
async function updateDuplicatesList() {
  const tabs = await getTabs();
  const duplicates = TabUtils.findDuplicates(tabs, userSettings.matchMode);

  const listElement = document.getElementById('duplicatesList');

  if (duplicates.groups.length === 0) {
    listElement.innerHTML = '<p style="color: #86868b; text-align: center; padding: 12px;">No duplicates found</p>';
  } else {
    listElement.innerHTML = '<h3>Duplicate Tabs</h3>';

    duplicates.groups.forEach((group, groupIndex) => {
      const groupContainer = document.createElement('div');
      groupContainer.className = 'duplicate-group-container';

      // Main group header
      const groupHeader = document.createElement('div');
      groupHeader.className = 'duplicate-group';
      groupHeader.innerHTML = `
        <button class="expand-btn" data-group-index="${groupIndex}" title="Expand to see individual tabs">▶</button>
        <div class="count-badge">${group.tabs.length}</div>
        <div class="url" title="${escapeHtml(group.url)}">${escapeHtml(group.url)}</div>
        <button class="close-group-btn" data-group-index="${groupIndex}" title="Close these duplicates">✕</button>
      `;

      // Expanded tabs list (hidden by default)
      const tabsList = document.createElement('div');
      tabsList.className = 'tabs-list hidden';
      tabsList.dataset.groupIndex = groupIndex;

      group.tabs.forEach((tab, tabIndex) => {
        const tabItem = document.createElement('div');
        tabItem.className = 'tab-item';
        tabItem.innerHTML = `
          <div class="tab-title" data-tab-id="${tab.id}" title="${escapeHtml(tab.title)}">${escapeHtml(tab.title)}</div>
          <button class="close-tab-btn" data-tab-id="${tab.id}" title="Close this tab">✕</button>
        `;
        tabsList.appendChild(tabItem);
      });

      groupContainer.appendChild(groupHeader);
      groupContainer.appendChild(tabsList);
      listElement.appendChild(groupContainer);
    });

    // Add event listeners to expand buttons
    listElement.querySelectorAll('.expand-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const groupIndex = btn.dataset.groupIndex;
        const tabsList = listElement.querySelector(`.tabs-list[data-group-index="${groupIndex}"]`);
        const isExpanded = !tabsList.classList.contains('hidden');

        if (isExpanded) {
          tabsList.classList.add('hidden');
          btn.textContent = '▶';
        } else {
          tabsList.classList.remove('hidden');
          btn.textContent = '▼';
        }
      });
    });

    // Add event listeners to close group buttons
    listElement.querySelectorAll('.close-group-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const groupIndex = parseInt(e.target.dataset.groupIndex);
        await closeSpecificDuplicateGroup(duplicates.groups[groupIndex]);
      });
    });

    // Add event listeners to individual tab titles (click to switch to tab)
    listElement.querySelectorAll('.tab-title').forEach(titleDiv => {
      titleDiv.addEventListener('click', async (e) => {
        const tabId = parseInt(e.target.dataset.tabId);
        await browser.tabs.update(tabId, { active: true });
        const tab = await browser.tabs.get(tabId);
        await browser.windows.update(tab.windowId, { focused: true });
      });
    });

    // Add event listeners to individual tab close buttons
    listElement.querySelectorAll('.close-tab-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const tabId = parseInt(e.target.dataset.tabId);
        await browser.tabs.remove(tabId);
        await new Promise(resolve => setTimeout(resolve, 100));
        await updateStats();
      });
    });
  }
}

// Close a specific duplicate group
async function closeSpecificDuplicateGroup(group) {
  const tabsToClose = [];

  // Keep the first tab (or newest if setting enabled)
  const tabsToKeep = userSettings.keepNewest ?
    [group.tabs.sort((a, b) => b.id - a.id)[0]] :
    [group.tabs[0]];

  group.tabs.forEach(tab => {
    if (!tabsToKeep.includes(tab)) {
      tabsToClose.push(tab.id);
    }
  });

  if (tabsToClose.length > 0) {
    await browser.tabs.remove(tabsToClose);
    // Wait a bit for browser to update tab list
    await new Promise(resolve => setTimeout(resolve, 100));
    await updateStats();
  }
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Get tabs based on current scope
async function getTabs() {
  let tabs;
  if (currentScope === 'current') {
    const currentWindow = await browser.windows.getCurrent();
    tabs = await browser.tabs.query({ windowId: currentWindow.id });
  } else {
    tabs = await browser.tabs.query({});
  }

  // Filter out pinned tabs
  return tabs.filter(tab => !tab.pinned);
}

// Attach event listeners
function attachEventListeners() {
  // Scope selector
  document.querySelectorAll('input[name="scope"]').forEach(radio => {
    radio.addEventListener('change', async (e) => {
      currentScope = e.target.value;
      await updateStats();
    });
  });

  // Find duplicates
  document.getElementById('findDuplicates').addEventListener('click', async () => {
    await findAndDisplayDuplicates();
  });

  // Close duplicates
  document.getElementById('closeDuplicates').addEventListener('click', async () => {
    await closeDuplicates();
  });

  // Group by domain
  document.getElementById('groupByDomain').addEventListener('click', async () => {
    await groupTabsByDomain();
  });

  // Reorder tabs
  document.getElementById('reorderTabs').addEventListener('click', async () => {
    await reorderTabsByDomain();
  });

  // Save session
  document.getElementById('saveSession').addEventListener('click', async () => {
    await saveSession();
  });

  // Restore session
  document.getElementById('restoreSession').addEventListener('click', async () => {
    await showSavedSessions();
  });

  // Settings controls
  document.getElementById('matchMode').addEventListener('change', async () => {
    await saveSettings();
  });

  document.getElementById('autoDetect').addEventListener('change', async () => {
    await saveSettings();
  });

  document.getElementById('keepNewest').addEventListener('change', async () => {
    await saveSettings();
  });
}

// Find and display duplicates (refresh the list)
async function findAndDisplayDuplicates() {
  await updateStats();
}

// Close duplicate tabs
async function closeDuplicates() {
  const tabs = await getTabs();
  const duplicates = TabUtils.findDuplicates(tabs, userSettings.matchMode);

  const tabsToClose = [];
  duplicates.groups.forEach(group => {
    // Keep the first tab (or newest if setting enabled)
    const tabsToKeep = userSettings.keepNewest ?
      [group.tabs.sort((a, b) => b.id - a.id)[0]] :
      [group.tabs[0]];

    group.tabs.forEach(tab => {
      if (!tabsToKeep.includes(tab)) {
        tabsToClose.push(tab.id);
      }
    });
  });

  if (tabsToClose.length > 0) {
    await browser.tabs.remove(tabsToClose);
    // Wait a bit for browser to update tab list
    await new Promise(resolve => setTimeout(resolve, 100));
    await updateStats();
    alert(`Closed ${tabsToClose.length} duplicate tabs!`);
  } else {
    alert('No duplicates to close!');
  }
}

// Group tabs by domain
async function groupTabsByDomain() {
  const tabs = await getTabs();
  const grouped = TabUtils.groupByDomain(tabs);

  alert(`Found ${Object.keys(grouped).length} domain groups. Check console for details.`);
  console.log('Grouped tabs:', grouped);
}

// Reorder tabs by domain
async function reorderTabsByDomain() {
  const tabs = await getTabs();
  const grouped = TabUtils.groupByDomain(tabs);

  let index = 0;
  for (const domain in grouped) {
    for (const tab of grouped[domain]) {
      await browser.tabs.move(tab.id, { index: index++ });
    }
  }

  alert('Tabs reordered by domain!');
}

// Save current session
async function saveSession() {
  const tabs = await getTabs();
  const sessionName = prompt('Enter a name for this session:');

  if (!sessionName) return;

  const session = {
    name: sessionName,
    timestamp: Date.now(),
    tabs: tabs.map(tab => ({
      url: tab.url,
      title: tab.title
    }))
  };

  const { sessions = [] } = await browser.storage.local.get('sessions');
  sessions.push(session);
  await browser.storage.local.set({ sessions });

  alert(`Session "${sessionName}" saved with ${tabs.length} tabs!`);
}

// Show saved sessions
async function showSavedSessions() {
  const { sessions = [] } = await browser.storage.local.get('sessions');

  const listElement = document.getElementById('sessionsList');
  listElement.innerHTML = '<h3>Saved Sessions</h3>';

  if (sessions.length === 0) {
    listElement.innerHTML += '<p style="color: #86868b;">No saved sessions yet.</p>';
  } else {
    sessions.forEach((session, index) => {
      const sessionDiv = document.createElement('div');
      sessionDiv.className = 'session-item';
      const date = new Date(session.timestamp).toLocaleDateString();
      sessionDiv.innerHTML = `
        <div style="font-weight: 500;">${session.name}</div>
        <div style="font-size: 11px; color: #86868b;">${session.tabs.length} tabs - ${date}</div>
      `;
      sessionDiv.addEventListener('click', () => restoreSession(index));
      listElement.appendChild(sessionDiv);
    });
  }

  listElement.classList.remove('hidden');
}

// Restore a session
async function restoreSession(index) {
  const { sessions = [] } = await browser.storage.local.get('sessions');
  const session = sessions[index];

  if (!session) return;

  for (const tab of session.tabs) {
    await browser.tabs.create({ url: tab.url });
  }

  alert(`Restored ${session.tabs.length} tabs from "${session.name}"!`);
}

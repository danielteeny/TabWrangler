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
    matchMode: 'domain',
    autoDetect: true,
    keepNewest: true
  });
  userSettings = result;
}

// Update tab statistics
async function updateStats() {
  const tabs = await getTabs();
  const duplicates = TabUtils.findDuplicates(tabs, userSettings.matchMode);

  document.getElementById('totalTabs').textContent = tabs.length;
  document.getElementById('duplicateCount').textContent = duplicates.totalDuplicates;
}

// Get tabs based on current scope
async function getTabs() {
  if (currentScope === 'current') {
    const currentWindow = await browser.windows.getCurrent();
    return await browser.tabs.query({ windowId: currentWindow.id });
  } else {
    return await browser.tabs.query({});
  }
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

  // Open settings
  document.getElementById('openSettings').addEventListener('click', () => {
    browser.runtime.openOptionsPage();
  });
}

// Find and display duplicates
async function findAndDisplayDuplicates() {
  const tabs = await getTabs();
  const duplicates = TabUtils.findDuplicates(tabs, userSettings.matchMode);

  const listElement = document.getElementById('duplicatesList');
  listElement.innerHTML = '<h3>Duplicate Tabs Found</h3>';

  if (duplicates.groups.length === 0) {
    listElement.innerHTML += '<p style="color: #86868b;">No duplicates found!</p>';
  } else {
    duplicates.groups.forEach(group => {
      const groupDiv = document.createElement('div');
      groupDiv.className = 'duplicate-group';
      groupDiv.innerHTML = `
        <div class="url">${group.url}</div>
        <div class="count">${group.tabs.length} duplicates</div>
      `;
      listElement.appendChild(groupDiv);
    });
  }

  listElement.classList.remove('hidden');
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
    alert(`Closed ${tabsToClose.length} duplicate tabs!`);
    await updateStats();
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

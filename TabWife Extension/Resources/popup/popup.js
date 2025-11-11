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
    keepNewest: true,
    consolidationThreshold: 3
  });
  userSettings = result;

  // Update UI controls
  document.getElementById('matchMode').value = userSettings.matchMode;
  document.getElementById('autoDetect').checked = userSettings.autoDetect;
  document.getElementById('keepNewest').checked = userSettings.keepNewest;
  document.getElementById('consolidationThreshold').value = userSettings.consolidationThreshold;
  document.getElementById('thresholdValue').textContent = userSettings.consolidationThreshold;

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
  userSettings.consolidationThreshold = parseInt(document.getElementById('consolidationThreshold').value);

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

  // Analyze organization
  document.getElementById('analyzeOrganization').addEventListener('click', async () => {
    await analyzeAndShowSuggestions();
  });

  // Smart organize
  document.getElementById('smartOrganize').addEventListener('click', async () => {
    await smartOrganize();
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

  document.getElementById('consolidationThreshold').addEventListener('input', (e) => {
    document.getElementById('thresholdValue').textContent = e.target.value;
  });

  document.getElementById('consolidationThreshold').addEventListener('change', async () => {
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

// Analyze organization and show suggestions
async function analyzeAndShowSuggestions() {
  // Get all windows with their tabs
  const allWindows = await browser.windows.getAll({ populate: true });

  // Filter out pinned tabs from each window
  const windows = allWindows.map(window => ({
    id: window.id,
    tabs: window.tabs.filter(tab => !tab.pinned)
  }));

  const suggestions = TabUtils.generateConsolidationSuggestions(
    windows,
    userSettings.consolidationThreshold
  );

  displayConsolidationSuggestions(suggestions);
}

// Smart organize - automatically apply all suggestions
async function smartOrganize() {
  const allWindows = await browser.windows.getAll({ populate: true });
  const windows = allWindows.map(window => ({
    id: window.id,
    tabs: window.tabs.filter(tab => !tab.pinned)
  }));

  const suggestions = TabUtils.generateConsolidationSuggestions(
    windows,
    userSettings.consolidationThreshold
  );

  if (suggestions.length === 0) {
    alert('No consolidation opportunities found!');
    return;
  }

  // Show warning if first time
  const shouldProceed = await showMoveWarningIfNeeded();
  if (!shouldProceed) return;

  let totalMoved = 0;
  for (const suggestion of suggestions) {
    for (const stray of suggestion.strayTabs) {
      try {
        // Safari doesn't support browser.tabs.move with windowId parameter
        // Workaround: create new tab in target window, then close original
        await browser.tabs.create({
          windowId: suggestion.homeWindowId,
          url: stray.tab.url,
          active: false
        });

        await browser.tabs.remove(stray.tab.id);
        totalMoved++;
      } catch (e) {
        console.error('Error moving tab:', e);
      }
    }
  }

  await new Promise(resolve => setTimeout(resolve, 200));
  alert(`Smart Organize complete! Moved ${totalMoved} tabs to their domain groups.`);

  // Clear suggestions display
  document.getElementById('consolidationSuggestions').innerHTML = '';
  document.getElementById('consolidationSuggestions').classList.add('hidden');
}

// Display consolidation suggestions
function displayConsolidationSuggestions(suggestions) {
  const container = document.getElementById('consolidationSuggestions');

  if (suggestions.length === 0) {
    container.innerHTML = '<p style="color: #86868b; text-align: center; padding: 12px;">No consolidation opportunities found</p>';
    container.classList.remove('hidden');
    return;
  }

  container.innerHTML = '<h3>Organization Suggestions</h3>';

  suggestions.forEach((suggestion, suggestionIndex) => {
    const suggestionDiv = document.createElement('div');
    suggestionDiv.className = 'consolidation-suggestion';

    // Group by source window for better organization
    const byWindow = {};
    suggestion.strayTabs.forEach(stray => {
      if (!byWindow[stray.fromWindowId]) {
        byWindow[stray.fromWindowId] = [];
      }
      byWindow[stray.fromWindowId].push(stray);
    });

    let tabsListHTML = '';
    for (const windowId in byWindow) {
      const tabs = byWindow[windowId];
      tabsListHTML += `
        <div class="stray-window-group">
          <label class="stray-checkbox-label">
            <input type="checkbox" class="stray-window-checkbox" data-suggestion="${suggestionIndex}" data-window="${windowId}" checked>
            <span>Move ${tabs.length} tab${tabs.length > 1 ? 's' : ''} from <span class="window-link" data-window-id="${windowId}">Window ${windowId}</span></span>
          </label>
          <div class="stray-tabs-list">
            ${tabs.map(stray => `
              <div class="stray-tab clickable" data-tab-id="${stray.tab.id}" data-window-id="${stray.fromWindowId}" title="${escapeHtml(stray.tab.title)}">
                ${escapeHtml(stray.tab.title.substring(0, 60))}${stray.tab.title.length > 60 ? '...' : ''}
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    suggestionDiv.innerHTML = `
      <div class="suggestion-header">
        <strong>${escapeHtml(suggestion.domain)}</strong>
        <span class="suggestion-count"><span class="window-link" data-window-id="${suggestion.homeWindowId}">Window ${suggestion.homeWindowId}</span> has ${suggestion.homeWindowTabCount} tabs</span>
      </div>
      <div class="suggestion-body">
        ${tabsListHTML}
      </div>
      <div class="suggestion-actions">
        <button class="move-selected-btn" data-suggestion="${suggestionIndex}">Move Selected</button>
        <button class="move-all-btn" data-suggestion="${suggestionIndex}">Move All</button>
      </div>
    `;

    // Add event listeners for checkboxes and buttons
    container.appendChild(suggestionDiv);
  });

  // Add event listeners for move buttons
  const selectedBtns = container.querySelectorAll('.move-selected-btn');
  console.log('Found move-selected buttons:', selectedBtns.length);
  if (selectedBtns.length === 0) {
    alert('ERROR: No move-selected buttons found!');
  }
  selectedBtns.forEach(btn => {
    btn.addEventListener('click', async (e) => {
      console.log('Move selected button clicked!', e.target.dataset.suggestion);
      const suggestionIndex = parseInt(e.target.dataset.suggestion);
      await moveSelectedTabs(suggestions[suggestionIndex], suggestionIndex);
    });
  });

  const allBtns = container.querySelectorAll('.move-all-btn');
  console.log('Found move-all buttons:', allBtns.length);
  if (allBtns.length === 0) {
    alert('ERROR: No move-all buttons found!');
  }
  allBtns.forEach(btn => {
    btn.addEventListener('click', async (e) => {
      console.log('Move all button clicked!', e.target.dataset.suggestion);
      const suggestionIndex = parseInt(e.target.dataset.suggestion);
      await moveAllTabs(suggestions[suggestionIndex]);
    });
  });

  // Add click handlers for tabs to switch to them
  container.querySelectorAll('.stray-tab.clickable').forEach(tabDiv => {
    tabDiv.addEventListener('click', async (e) => {
      const tabId = parseInt(e.target.dataset.tabId);
      const windowId = parseInt(e.target.dataset.windowId);
      await browser.tabs.update(tabId, { active: true });
      await browser.windows.update(windowId, { focused: true });
    });
  });

  // Add click handlers for window links to focus windows
  container.querySelectorAll('.window-link').forEach(link => {
    link.addEventListener('click', async (e) => {
      e.stopPropagation();
      const windowId = parseInt(e.target.dataset.windowId);
      try {
        const currentWindow = await browser.windows.getCurrent();
        if (currentWindow.id === windowId) {
          // Already in this window
          return;
        }
        await browser.windows.update(windowId, { focused: true });
      } catch (err) {
        console.error('Error focusing window:', err);
      }
    });
  });

  container.classList.remove('hidden');
}

// Show one-time warning about tab reloading
async function showMoveWarningIfNeeded() {
  console.log('showMoveWarningIfNeeded called');

  const result = await browser.storage.local.get('hasSeenMoveWarning');
  console.log('Storage result:', result);

  const hasSeenMoveWarning = result.hasSeenMoveWarning;
  console.log('hasSeenMoveWarning:', hasSeenMoveWarning);

  if (!hasSeenMoveWarning) {
    console.log('Showing warning dialog...');

    // TEMPORARY: Skip dialog for testing
    console.log('SKIPPING DIALOG FOR TESTING - proceeding automatically');
    await browser.storage.local.set({ hasSeenMoveWarning: true });
    return true;

    /* Original dialog code - commented out for testing
    const proceed = confirm(
      'Moving tabs between windows will reload the pages.\n\n' +
      'Tab history, form data, and scroll position will be lost.\n\n' +
      'This is a Safari limitation. Continue?'
    );

    console.log('User chose:', proceed);

    if (proceed) {
      await browser.storage.local.set({ hasSeenMoveWarning: true });
      console.log('Saved warning preference');
      return true;
    }
    return false;
    */
  }

  console.log('Already seen warning, proceeding');
  return true;
}

// Move selected tabs based on checkboxes
async function moveSelectedTabs(suggestion, suggestionIndex) {
  console.log('moveSelectedTabs called with:', { suggestion, suggestionIndex });

  // Show warning if first time
  const shouldProceed = await showMoveWarningIfNeeded();
  if (!shouldProceed) return;

  const container = document.getElementById('consolidationSuggestions');
  const checkboxes = container.querySelectorAll(`.stray-window-checkbox[data-suggestion="${suggestionIndex}"]:checked`);

  console.log('Found checkboxes:', checkboxes.length);

  const windowIdsToMove = Array.from(checkboxes).map(cb => parseInt(cb.dataset.window));
  console.log('Windows to move from:', windowIdsToMove);

  if (windowIdsToMove.length === 0) {
    alert('No windows selected! Please check at least one window to move tabs from.');
    return;
  }

  let movedCount = 0;
  const errors = [];

  console.log('Starting to move tabs. Total stray tabs:', suggestion.strayTabs.length);

  for (const stray of suggestion.strayTabs) {
    console.log(`Checking stray tab from window ${stray.fromWindowId}, should move:`, windowIdsToMove.includes(stray.fromWindowId));

    if (windowIdsToMove.includes(stray.fromWindowId)) {
      try {
        console.log(`Moving tab ${stray.tab.id} (${stray.tab.title}) from window ${stray.fromWindowId} to ${suggestion.homeWindowId}`);

        // Safari doesn't support browser.tabs.move with windowId parameter
        // Workaround: create new tab in target window, then close original
        const newTab = await browser.tabs.create({
          windowId: suggestion.homeWindowId,
          url: stray.tab.url,
          active: false
        });
        console.log('Created new tab:', newTab.id);

        await browser.tabs.remove(stray.tab.id);
        console.log('Removed old tab:', stray.tab.id);

        movedCount++;
      } catch (e) {
        console.error('Error moving tab:', e);
        errors.push({ tab: stray.tab.title, error: e.message });
      }
    }
  }

  console.log(`Finished moving. Total moved: ${movedCount}`);

  await new Promise(resolve => setTimeout(resolve, 200));

  if (errors.length > 0) {
    console.error('Move errors:', errors);
    alert(`Moved ${movedCount} tabs. ${errors.length} failed to move. Check console for details.`);
  } else {
    alert(`Moved ${movedCount} tabs to Window ${suggestion.homeWindowId}`);
  }

  // Refresh suggestions
  await analyzeAndShowSuggestions();
}

// Move all tabs for a suggestion
async function moveAllTabs(suggestion) {
  console.log('moveAllTabs called with:', suggestion);

  // Show warning if first time
  const shouldProceed = await showMoveWarningIfNeeded();
  if (!shouldProceed) return;

  let movedCount = 0;
  const errors = [];

  for (const stray of suggestion.strayTabs) {
    try {
      console.log(`Moving tab ${stray.tab.id} from window ${stray.fromWindowId} to ${suggestion.homeWindowId}`);

      // Safari doesn't support browser.tabs.move with windowId parameter
      // Workaround: create new tab in target window, then close original
      await browser.tabs.create({
        windowId: suggestion.homeWindowId,
        url: stray.tab.url,
        active: false
      });

      await browser.tabs.remove(stray.tab.id);
      movedCount++;
    } catch (e) {
      console.error('Error moving tab:', e);
      errors.push({ tab: stray.tab.title, error: e.message });
    }
  }

  await new Promise(resolve => setTimeout(resolve, 200));

  if (errors.length > 0) {
    console.error('Move errors:', errors);
    alert(`Moved ${movedCount} tabs. ${errors.length} failed to move. Check console for details.`);
  } else {
    alert(`Moved ${movedCount} tabs to Window ${suggestion.homeWindowId}`);
  }

  // Refresh suggestions
  await analyzeAndShowSuggestions();
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

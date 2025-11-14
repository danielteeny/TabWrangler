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
    matchDomain: true,
    matchSubdomain: true,
    matchPort: true,
    matchPath: true,
    matchQuery: true,
    matchHash: false,
    autoDetect: true,
    keepNewest: true,
    consolidationThreshold: 3,
    persistWindowConfig: true,
    autoOrganizeTabs: true
  });
  userSettings = result;

  // Update UI controls - match checkboxes
  document.getElementById('matchDomain').checked = userSettings.matchDomain;
  document.getElementById('matchSubdomain').checked = userSettings.matchSubdomain;
  document.getElementById('matchPort').checked = userSettings.matchPort;
  document.getElementById('matchPath').checked = userSettings.matchPath;
  document.getElementById('matchQuery').checked = userSettings.matchQuery;
  document.getElementById('matchHash').checked = userSettings.matchHash;

  // Update UI controls - other settings
  document.getElementById('autoDetect').checked = userSettings.autoDetect;
  document.getElementById('keepNewest').checked = userSettings.keepNewest;
  document.getElementById('consolidationThreshold').value = userSettings.consolidationThreshold;
  document.getElementById('thresholdValue').textContent = userSettings.consolidationThreshold;
  document.getElementById('persistWindowConfig').checked = userSettings.persistWindowConfig;
  document.getElementById('autoOrganizeTabs').checked = userSettings.autoOrganizeTabs;
}

// Save settings
async function saveSettings() {
  userSettings.matchDomain = document.getElementById('matchDomain').checked;
  userSettings.matchSubdomain = document.getElementById('matchSubdomain').checked;
  userSettings.matchPort = document.getElementById('matchPort').checked;
  userSettings.matchPath = document.getElementById('matchPath').checked;
  userSettings.matchQuery = document.getElementById('matchQuery').checked;
  userSettings.matchHash = document.getElementById('matchHash').checked;
  userSettings.autoDetect = document.getElementById('autoDetect').checked;
  userSettings.keepNewest = document.getElementById('keepNewest').checked;
  userSettings.consolidationThreshold = parseInt(document.getElementById('consolidationThreshold').value);
  userSettings.persistWindowConfig = document.getElementById('persistWindowConfig').checked;
  userSettings.autoOrganizeTabs = document.getElementById('autoOrganizeTabs').checked;

  await browser.storage.sync.set(userSettings);
  await updateStats();
  await updateDuplicatesList();

  // Clear window config if persistence is disabled
  if (!userSettings.persistWindowConfig) {
    await browser.storage.local.remove(['windowNicknames', 'windowDomains', 'windowKeywords']);
  }
}

// Update tab statistics
async function updateStats() {
  const tabs = await getTabs();
  const duplicates = TabUtils.findDuplicates(tabs, userSettings);

  document.getElementById('totalTabs').textContent = tabs.length;
  document.getElementById('duplicateCount').textContent = duplicates.totalDuplicates;

  // Update duplicates list
  await updateDuplicatesList();
}

// Update duplicates manifest list
async function updateDuplicatesList() {
  const tabs = await getTabs();
  const duplicates = TabUtils.findDuplicates(tabs, userSettings);

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

  // Manage windows
  document.getElementById('manageWindows').addEventListener('click', async () => {
    await loadWindowManagement();
  });

  // Save session
  document.getElementById('saveSession').addEventListener('click', async () => {
    await saveSession();
  });

  // Restore session
  document.getElementById('restoreSession').addEventListener('click', async () => {
    await showSavedSessions();
  });

  // Settings controls - Match checkboxes
  ['matchDomain', 'matchSubdomain', 'matchPort', 'matchPath', 'matchQuery', 'matchHash'].forEach(id => {
    document.getElementById(id).addEventListener('change', async () => {
      await saveSettings();
    });
  });

  // Preset buttons
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const preset = btn.dataset.preset;

      // Remove active class from all preset buttons
      document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Set checkboxes based on preset
      if (preset === 'relaxed') {
        // Only domain must match
        document.getElementById('matchDomain').checked = true;
        document.getElementById('matchSubdomain').checked = false;
        document.getElementById('matchPort').checked = false;
        document.getElementById('matchPath').checked = false;
        document.getElementById('matchQuery').checked = false;
        document.getElementById('matchHash').checked = false;
      } else if (preset === 'normal') {
        // Domain + subdomain + port + path + query (like old fullpath default)
        document.getElementById('matchDomain').checked = true;
        document.getElementById('matchSubdomain').checked = true;
        document.getElementById('matchPort').checked = true;
        document.getElementById('matchPath').checked = true;
        document.getElementById('matchQuery').checked = true;
        document.getElementById('matchHash').checked = false;
      } else if (preset === 'strict') {
        // Everything must match
        document.getElementById('matchDomain').checked = true;
        document.getElementById('matchSubdomain').checked = true;
        document.getElementById('matchPort').checked = true;
        document.getElementById('matchPath').checked = true;
        document.getElementById('matchQuery').checked = true;
        document.getElementById('matchHash').checked = true;
      }

      saveSettings();
    });
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

  document.getElementById('persistWindowConfig').addEventListener('change', async () => {
    await saveSettings();
  });

  document.getElementById('autoOrganizeTabs').addEventListener('change', async () => {
    await saveSettings();
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
  const duplicates = TabUtils.findDuplicates(tabs, userSettings);

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
    const keptCount = duplicates.groups.length;
    const confirmMessage = `Close ${tabsToClose.length} duplicate tab${tabsToClose.length > 1 ? 's' : ''}? (keeps ${keptCount} tab${keptCount > 1 ? 's' : ''})`;

    if (!confirm(confirmMessage)) {
      return;
    }

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

  const suggestions = await TabUtils.generateConsolidationSuggestions(
    windows,
    userSettings.consolidationThreshold
  );

  await displayConsolidationSuggestions(suggestions);
}

// Smart organize - automatically apply all suggestions
async function smartOrganize() {
  const allWindows = await browser.windows.getAll({ populate: true });
  const windows = allWindows.map(window => ({
    id: window.id,
    tabs: window.tabs.filter(tab => !tab.pinned)
  }));

  const suggestions = await TabUtils.generateConsolidationSuggestions(
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
async function displayConsolidationSuggestions(suggestions) {
  const container = document.getElementById('consolidationSuggestions');

  if (suggestions.length === 0) {
    container.innerHTML = '<p style="color: #86868b; text-align: center; padding: 12px;">No consolidation opportunities found</p>';
    container.classList.remove('hidden');
    return;
  }

  container.innerHTML = '<h3>Organization Suggestions</h3>';

  for (let suggestionIndex = 0; suggestionIndex < suggestions.length; suggestionIndex++) {
    const suggestion = suggestions[suggestionIndex];

    // Get window nickname for home window
    const homeWindowNickname = await TabUtils.formatWindowDisplay(suggestion.homeWindowId);

    const suggestionContainer = document.createElement('div');
    suggestionContainer.className = 'duplicate-group-container';

    // Create collapsible header (like duplicate tabs)
    const suggestionHeader = document.createElement('div');
    suggestionHeader.className = 'duplicate-group';

    // Group by source window for better organization
    const byWindow = {};
    suggestion.strayTabs.forEach(stray => {
      if (!byWindow[stray.fromWindowId]) {
        byWindow[stray.fromWindowId] = [];
      }
      byWindow[stray.fromWindowId].push(stray);
    });

    // Build expanded body HTML (hidden by default)
    let tabsListHTML = '';
    for (const windowId in byWindow) {
      const tabs = byWindow[windowId];
      const sourceWindowNickname = await TabUtils.formatWindowDisplay(parseInt(windowId));

      tabsListHTML += `
        <div class="stray-window-group">
          <label class="stray-checkbox-label">
            <input type="checkbox" class="stray-window-checkbox" data-suggestion="${suggestionIndex}" data-window="${windowId}" checked>
            <span>Move ${tabs.length} tab${tabs.length > 1 ? 's' : ''} from <span class="window-link" data-window-id="${windowId}">${escapeHtml(sourceWindowNickname)}</span></span>
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

    // Build assignment or keyword badge
    let badge = '';
    if (suggestion.isAssigned) {
      badge = ' <span class="suggestion-assigned-badge">⭐ assigned</span>';
    } else if (suggestion.isKeywordMatch) {
      badge = ' <span class="suggestion-keyword-badge">🔑 keyword</span>';
    }

    // Build header with expand button and count badge
    suggestionHeader.innerHTML = `
      <button class="expand-btn" data-group-index="${suggestionIndex}" title="Expand to see details">▶</button>
      <div class="count-badge">${suggestion.totalStrayTabs}</div>
      <div class="url" title="${escapeHtml(suggestion.domain)}">
        ${escapeHtml(suggestion.domain)} → <span class="window-link" data-window-id="${suggestion.homeWindowId}">${escapeHtml(homeWindowNickname)}</span>${badge}
      </div>
    `;

    // Build expanded body (hidden by default)
    const suggestionBody = document.createElement('div');
    suggestionBody.className = 'tabs-list hidden';
    suggestionBody.setAttribute('data-group-index', suggestionIndex);
    suggestionBody.innerHTML = `
      <div class="suggestion-body">
        ${tabsListHTML}
      </div>
      <div class="suggestion-actions">
        <button class="move-selected-btn" data-suggestion="${suggestionIndex}">Move Selected</button>
        <button class="move-all-btn" data-suggestion="${suggestionIndex}">Move All</button>
      </div>
    `;

    suggestionContainer.appendChild(suggestionHeader);
    suggestionContainer.appendChild(suggestionBody);
    container.appendChild(suggestionContainer);
  }

  // Add expand/collapse event listeners
  container.querySelectorAll('.expand-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const groupIndex = btn.dataset.groupIndex;
      const tabsList = container.querySelector(`.tabs-list[data-group-index="${groupIndex}"]`);
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

// Window configuration functions
async function saveWindowNickname(windowId, nickname) {
  try {
    const result = await browser.storage.local.get('windowNicknames');
    const nicknames = result.windowNicknames || {};

    if (nickname && nickname.trim()) {
      nicknames[windowId] = nickname.trim();
    } else {
      delete nicknames[windowId];
    }

    await browser.storage.local.set({ windowNicknames: nicknames });
  } catch (e) {
    console.error('Error saving window nickname:', e);
  }
}

async function saveWindowDomains(windowId, domains) {
  try {
    const result = await browser.storage.local.get('windowDomains');
    const windowDomains = result.windowDomains || {};

    if (domains && domains.length > 0) {
      windowDomains[windowId] = domains;
    } else {
      delete windowDomains[windowId];
    }

    await browser.storage.local.set({ windowDomains: windowDomains });
  } catch (e) {
    console.error('Error saving window domains:', e);
  }
}

async function saveWindowKeywords(windowId, keywords) {
  try {
    const result = await browser.storage.local.get('windowKeywords');
    const windowKeywords = result.windowKeywords || {};

    if (keywords && keywords.length > 0) {
      windowKeywords[windowId] = keywords;
    } else {
      delete windowKeywords[windowId];
    }

    await browser.storage.local.set({ windowKeywords: windowKeywords });
  } catch (e) {
    console.error('Error saving window keywords:', e);
  }
}

async function getWindowKeywords(windowId) {
  try {
    const result = await browser.storage.local.get('windowKeywords');
    const keywords = result.windowKeywords || {};
    return keywords[windowId] || [];
  } catch (e) {
    console.error('Error getting window keywords:', e);
    return [];
  }
}

async function organizeExistingTabs(targetWindowId) {
  try {
    const allWindows = await browser.windows.getAll({ populate: true });
    const assignedDomains = await TabUtils.getWindowDomains(targetWindowId);
    const assignedKeywords = await getWindowKeywords(targetWindowId);

    let movedCount = 0;
    const tabsToMove = [];

    // Find all tabs in other windows that match assigned domains or keywords
    for (const window of allWindows) {
      if (window.id === targetWindowId) continue; // Skip target window

      for (const tab of window.tabs) {
        if (tab.pinned) continue; // Skip pinned tabs

        let shouldMove = false;

        // Check domain match
        try {
          const url = new URL(tab.url);
          const domain = TabUtils.getRootDomain(url.hostname);
          const domainKey = url.port ? `${domain}:${url.port}` : domain;

          if (assignedDomains.includes(domainKey)) {
            shouldMove = true;
          }
        } catch (e) {
          // Skip invalid URLs
        }

        // Check keyword match
        if (!shouldMove && assignedKeywords.length > 0) {
          try {
            const tabUrl = tab.url.toLowerCase();
            const tabTitle = (tab.title || '').toLowerCase();
            const url = new URL(tab.url);
            const tabDomain = url.hostname.toLowerCase();

            for (const keyword of assignedKeywords) {
              const keywordLower = keyword.toLowerCase();
              if (tabUrl.includes(keywordLower) || tabTitle.includes(keywordLower) || tabDomain.includes(keywordLower)) {
                shouldMove = true;
                break;
              }
            }
          } catch (e) {
            // Skip invalid URLs
          }
        }

        if (shouldMove) {
          tabsToMove.push(tab);
        }
      }
    }

    // Move all matched tabs
    for (const tab of tabsToMove) {
      try {
        // Safari workaround: create new tab in target window, then close original
        await browser.tabs.create({
          windowId: targetWindowId,
          url: tab.url,
          active: false
        });
        await browser.tabs.remove(tab.id);
        movedCount++;
      } catch (e) {
        console.error('Error moving tab:', e);
      }
    }

    if (movedCount > 0) {
      alert(`Moved ${movedCount} existing tab${movedCount > 1 ? 's' : ''} to this window!`);
    }
  } catch (e) {
    console.error('Error organizing existing tabs:', e);
  }
}

async function loadWindowManagement() {
  const allWindows = await browser.windows.getAll({ populate: true });

  const managementSection = document.getElementById('windowManagement');
  managementSection.innerHTML = '<h4>Manage Windows</h4>';

  for (const window of allWindows) {
    const displayName = await TabUtils.formatWindowDisplay(window.id);
    const assignedDomains = await TabUtils.getWindowDomains(window.id);
    const assignedKeywords = await getWindowKeywords(window.id);

    // Count tabs per domain for this specific window (excluding pinned tabs)
    const domainCounts = {};
    window.tabs.forEach(tab => {
      if (tab.pinned) return; // Skip pinned tabs

      try {
        const url = new URL(tab.url);
        const domain = TabUtils.getRootDomain(url.hostname);
        const key = url.port ? `${domain}:${url.port}` : domain;
        domainCounts[key] = (domainCounts[key] || 0) + 1;
      } catch (e) {
        // Skip invalid URLs
      }
    });

    // Get only domains present in this window and sort by count (descending), then alphabetically
    const windowDomains = Object.keys(domainCounts);
    const sortedDomains = windowDomains.sort((a, b) => {
      const countA = domainCounts[a];
      const countB = domainCounts[b];

      if (countB !== countA) {
        return countB - countA; // Higher counts first
      }
      return a.localeCompare(b); // Alphabetical for same counts
    });

    // Badge for window name
    const totalAssignments = assignedDomains.length + assignedKeywords.length;
    const assignmentBadge = totalAssignments > 0 ? ` <span class="assignment-badge">${totalAssignments}</span>` : '';

    const windowDiv = document.createElement('div');
    windowDiv.className = 'window-config-item';
    windowDiv.innerHTML = `
      <div class="window-config-header">
        <span class="window-name-display" data-window-id="${window.id}">
          <span class="window-link" data-window-id="${window.id}">${escapeHtml(displayName)}${assignmentBadge}</span>
          <button class="edit-nickname-btn" data-window-id="${window.id}" title="Edit window name">✎</button>
        </span>
        <span class="window-tab-count">${window.tabs.length} tabs</span>
      </div>
      <div class="window-config-controls">
        <!-- Unified tag section for domains and keywords -->
        <div class="tag-section">
          <label class="tag-section-label">Assigned to this window</label>
          <div class="tags-container" data-window-id="${window.id}">
            ${(() => {
              // Domains currently in window
              const domainTags = sortedDomains.map(domain => {
                const count = domainCounts[domain];
                const isAssigned = assignedDomains.includes(domain);
                return `
                  <div class="domain-tag ${isAssigned ? 'assigned' : 'unassigned'}" data-domain="${escapeHtml(domain)}" data-window-id="${window.id}">
                    <span>${escapeHtml(domain)}</span>
                    <span class="tag-count">(${count})</span>
                    ${isAssigned ? '<span class="tag-remove" data-domain="' + escapeHtml(domain) + '">✕</span>' : ''}
                  </div>
                `;
              }).join('');

              // Assigned domains not currently in window
              const assignedNotInWindow = assignedDomains.filter(d => !windowDomains.includes(d));
              const assignedOnlyTags = assignedNotInWindow.map(domain => `
                <div class="domain-tag assigned" data-domain="${escapeHtml(domain)}" data-window-id="${window.id}">
                  <span>${escapeHtml(domain)}</span>
                  <span class="tag-remove" data-domain="${escapeHtml(domain)}">✕</span>
                </div>
              `).join('');

              // Assigned keywords
              const keywordTags = assignedKeywords.map(keyword => `
                <div class="keyword-tag" data-keyword="${escapeHtml(keyword)}" data-window-id="${window.id}">
                  <span>${escapeHtml(keyword)}</span>
                  <span class="tag-remove" data-keyword="${escapeHtml(keyword)}">✕</span>
                </div>
              `).join('');

              const allTags = domainTags + assignedOnlyTags + keywordTags;
              return allTags || '<span class="empty-tags-message">Click a domain to assign it, or add keywords below</span>';
            })()}
          </div>
          <div class="keyword-input-group">
            <input type="text" class="keyword-input" placeholder="Add domain or keyword" data-window-id="${window.id}">
            <button class="add-keyword-btn" data-window-id="${window.id}">Add</button>
          </div>
        </div>
      </div>
    `;

    managementSection.appendChild(windowDiv);
  }

  // Add event listeners for window links
  managementSection.querySelectorAll('.window-link').forEach(link => {
    link.addEventListener('click', async (e) => {
      const windowId = parseInt(e.target.dataset.windowId);
      await browser.windows.update(windowId, { focused: true });
    });
  });

  // Add event listeners for edit buttons
  managementSection.querySelectorAll('.edit-nickname-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const windowId = parseInt(e.target.dataset.windowId);
      const nameDisplay = managementSection.querySelector(`.window-name-display[data-window-id="${windowId}"]`);
      const currentNickname = await TabUtils.getWindowNickname(windowId);

      // Replace display with input
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'window-nickname-edit';
      input.value = currentNickname || '';
      input.placeholder = `Window ${windowId}`;
      input.dataset.windowId = windowId;

      // Save nickname function
      const saveNickname = async () => {
        const newNickname = input.value.trim();
        await saveWindowNickname(windowId, newNickname);

        // Reload window management to refresh display
        await loadWindowManagement();

        // Refresh consolidation suggestions if visible
        const suggestionsDiv = document.getElementById('consolidationSuggestions');
        if (!suggestionsDiv.classList.contains('hidden')) {
          await analyzeAndShowSuggestions();
        }
      };

      input.addEventListener('blur', saveNickname);
      input.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') {
          await saveNickname();
        } else if (e.key === 'Escape') {
          // Cancel editing
          await loadWindowManagement();
        }
      });

      nameDisplay.innerHTML = '';
      nameDisplay.appendChild(input);
      input.focus();
      input.select();
    });
  });

  // Add event listeners for domain tags (assign/unassign)
  managementSection.querySelectorAll('.domain-tag').forEach(tag => {
    tag.addEventListener('click', async (e) => {
      // Don't trigger if clicking the remove button
      if (e.target.classList.contains('tag-remove')) return;

      const domain = tag.dataset.domain;
      const windowId = parseInt(tag.dataset.windowId);
      const isAssigned = tag.classList.contains('assigned');

      // Get current assignments
      const currentDomains = await TabUtils.getWindowDomains(windowId);

      if (isAssigned) {
        // Already assigned - clicking doesn't do anything (use X to remove)
        return;
      } else {
        // Not assigned - assign it
        const newDomains = [...currentDomains, domain];
        await saveWindowDomains(windowId, newDomains);

        // Organize existing tabs that match this assignment
        await organizeExistingTabs(windowId);

        await loadWindowManagement();

        // Refresh consolidation suggestions if visible
        const suggestionsDiv = document.getElementById('consolidationSuggestions');
        if (!suggestionsDiv.classList.contains('hidden')) {
          await analyzeAndShowSuggestions();
        }
      }
    });
  });

  // Add event listeners for domain tag remove buttons
  managementSection.querySelectorAll('.domain-tag .tag-remove').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const domain = btn.dataset.domain;
      const tag = btn.closest('.domain-tag');
      const windowId = parseInt(tag.dataset.windowId);

      // Get current assignments and remove this domain
      const currentDomains = await TabUtils.getWindowDomains(windowId);
      const newDomains = currentDomains.filter(d => d !== domain);
      await saveWindowDomains(windowId, newDomains);
      await loadWindowManagement();

      // Refresh consolidation suggestions if visible
      const suggestionsDiv = document.getElementById('consolidationSuggestions');
      if (!suggestionsDiv.classList.contains('hidden')) {
        await analyzeAndShowSuggestions();
      }
    });
  });

  // Add event listeners for keyword remove buttons
  managementSection.querySelectorAll('.keyword-tag .tag-remove').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const keyword = btn.dataset.keyword;
      const tag = btn.closest('.keyword-tag');
      const windowId = parseInt(tag.dataset.windowId);

      // Get current keywords and remove this one
      const currentKeywords = await getWindowKeywords(windowId);
      const newKeywords = currentKeywords.filter(k => k !== keyword);
      await saveWindowKeywords(windowId, newKeywords);
      await loadWindowManagement();

      // Refresh consolidation suggestions if visible
      const suggestionsDiv = document.getElementById('consolidationSuggestions');
      if (!suggestionsDiv.classList.contains('hidden')) {
        await analyzeAndShowSuggestions();
      }
    });
  });

  // Add event listeners for keyword input (Enter key)
  managementSection.querySelectorAll('.keyword-input').forEach(input => {
    input.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const windowId = parseInt(input.dataset.windowId);
        const keyword = input.value.trim().toLowerCase();

        if (keyword) {
          const currentKeywords = await getWindowKeywords(windowId);
          if (!currentKeywords.includes(keyword)) {
            const newKeywords = [...currentKeywords, keyword];
            await saveWindowKeywords(windowId, newKeywords);

            // Organize existing tabs that match this keyword
            await organizeExistingTabs(windowId);

            await loadWindowManagement();

            // Refresh consolidation suggestions if visible
            const suggestionsDiv = document.getElementById('consolidationSuggestions');
            if (!suggestionsDiv.classList.contains('hidden')) {
              await analyzeAndShowSuggestions();
            }
          }
        }
      }
    });
  });

  // Add event listeners for keyword Add button
  managementSection.querySelectorAll('.add-keyword-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const windowId = parseInt(btn.dataset.windowId);
      const input = managementSection.querySelector(`.keyword-input[data-window-id="${windowId}"]`);
      const keyword = input.value.trim().toLowerCase();

      if (keyword) {
        const currentKeywords = await getWindowKeywords(windowId);
        if (!currentKeywords.includes(keyword)) {
          const newKeywords = [...currentKeywords, keyword];
          await saveWindowKeywords(windowId, newKeywords);

          // Organize existing tabs that match this keyword
          await organizeExistingTabs(windowId);

          await loadWindowManagement();

          // Refresh consolidation suggestions if visible
          const suggestionsDiv = document.getElementById('consolidationSuggestions');
          if (!suggestionsDiv.classList.contains('hidden')) {
            await analyzeAndShowSuggestions();
          }
        }
      }
    });
  });

  managementSection.classList.remove('hidden');
}

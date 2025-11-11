// options.js - Settings page logic

const defaultSettings = {
  matchMode: 'domain',
  autoDetect: true,
  keepNewest: true
};

// Load settings on page load
document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  document.getElementById('saveSettings').addEventListener('click', saveSettings);
});

// Load settings from storage
async function loadSettings() {
  const settings = await browser.storage.sync.get(defaultSettings);

  document.getElementById('matchMode').value = settings.matchMode;
  document.getElementById('autoDetect').checked = settings.autoDetect;
  document.getElementById('keepNewest').checked = settings.keepNewest;
}

// Save settings to storage
async function saveSettings() {
  const settings = {
    matchMode: document.getElementById('matchMode').value,
    autoDetect: document.getElementById('autoDetect').checked,
    keepNewest: document.getElementById('keepNewest').checked
  };

  await browser.storage.sync.set(settings);

  const status = document.getElementById('status');
  status.textContent = 'Settings saved!';
  setTimeout(() => {
    status.textContent = '';
  }, 2000);
}

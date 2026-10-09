/**
 * SessionSwitch - Background Service Worker
 * Handles badge counters on the extension icon and background tasks.
 */

const STORAGE_KEY = 'session_switch_data_v1';
const SYNC_SERVER_URL = 'http://127.0.0.1:49152/api/sessions';

const DOMAIN_CLUSTERS = [
  ['learningmall.cn', 'www.learningmall.cn', 'core.xjtlu.edu.cn', 'premium.learningmall.cn', 'learningmall.xjtlu.edu.cn']
];

function getAssociatedDomains(domain) {
  if (!domain) return [];
  const result = new Set();
  const lower = domain.toLowerCase();
  const clean = lower.replace(/^www\./, '');
  result.add(lower);
  result.add(clean);
  result.add('www.' + clean);

  for (const cluster of DOMAIN_CLUSTERS) {
    if (cluster.some(d => d.toLowerCase() === lower || d.toLowerCase() === clean)) {
      for (const d of cluster) result.add(d.toLowerCase());
    }
  }

  const parts = clean.split('.');
  if (parts.length > 2) {
    const parentDomain = parts.slice(1).join('.');
    result.add(parentDomain);
  }

  return Array.from(result);
}

function getMatchedProfilesCount(domain, profilesObj) {
  if (!domain || !profilesObj) return 0;
  const associated = getAssociatedDomains(domain);
  const seenIds = new Set();
  for (const d of associated) {
    const list = profilesObj[d] || [];
    for (const p of list) {
      if (p && p.id) seenIds.add(p.id);
    }
  }
  return seenIds.size;
}

// Check if background server has updates
let lastChecked = 0;
async function backgroundSync() {
  const now = Date.now();
  if (now - lastChecked < 3000) return;
  lastChecked = now;

  try {
    const res = await fetch(SYNC_SERVER_URL);
    if (res.ok) {
      const json = await res.json();
      if (json && json.success && json.data) {
        const remote = json.data;
        const local = await chrome.storage.local.get(STORAGE_KEY);
        const localData = local[STORAGE_KEY] || { profiles: {}, activeProfiles: {} };

        if (remote.lastModified && remote.lastModified !== localData.lastSyncedAt) {
          const merged = {
            ...localData,
            profiles: remote.profiles || {},
            lastSyncedAt: remote.lastModified
          };
          await chrome.storage.local.set({ [STORAGE_KEY]: merged });
        }
      }
    }
  } catch (e) {}
}

// Update icon badge when active tab changes or completes loading
async function updateBadgeForTab(tabId, url) {
  if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
    chrome.action.setBadgeText({ text: '', tabId: tabId });
    return;
  }

  try {
    const domain = new URL(url).hostname;
    const res = await chrome.storage.local.get(STORAGE_KEY);
    const data = res[STORAGE_KEY] || {};
    const count = getMatchedProfilesCount(domain, data.profiles || {});

    if (count > 0) {
      chrome.action.setBadgeText({ text: String(count), tabId: tabId });
      chrome.action.setBadgeBackgroundColor({ color: '#4F46E5', tabId: tabId });
    } else {
      chrome.action.setBadgeText({ text: '', tabId: tabId });
    }
  } catch (e) {
    // Silently ignore if tab closed
  }
}

// Tab updated
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    await backgroundSync();
    updateBadgeForTab(tabId, tab.url);
  }
});

// Tab switched
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  await backgroundSync();
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab && tab.url) {
      updateBadgeForTab(activeInfo.tabId, tab.url);
    }
  } catch (e) {}
});

// Listen to storage changes to refresh current tab badge
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes[STORAGE_KEY]) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs[0]) {
        updateBadgeForTab(tabs[0].id, tabs[0].url);
      }
    });
  }
});

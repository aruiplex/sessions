/**
 * SessionSwitch - Background Service Worker
 * Handles badge counters on the extension icon and background tasks.
 */

const STORAGE_KEY = 'session_switch_data_v1';

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
    const profiles = (data.profiles && data.profiles[domain]) || [];

    if (profiles.length > 0) {
      chrome.action.setBadgeText({ text: String(profiles.length), tabId: tabId });
      chrome.action.setBadgeBackgroundColor({ color: '#4F46E5', tabId: tabId });
    } else {
      chrome.action.setBadgeText({ text: '', tabId: tabId });
    }
  } catch (e) {
    // Silently ignore if tab closed
  }
}

// Tab updated
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    updateBadgeForTab(tabId, tab.url);
  }
});

// Tab switched
chrome.tabs.onActivated.addListener(async (activeInfo) => {
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

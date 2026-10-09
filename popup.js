/**
 * SessionSwitch - Chrome Extension Popup Script
 * Manages multiple login profiles (Cookies, LocalStorage, SessionStorage) per domain.
 */

// Storage keys
const STORAGE_KEY = 'session_switch_data_v1';

// Global state
let currentTab = null;
let currentDomain = '';
let currentUrl = '';
let currentSiteValid = false;

let appData = {
  profiles: {},      // { [domain]: Array<Profile> }
  activeProfiles: {} // { [domain]: profileId }
};

let capturedBuffer = null; // Temporary buffer when opening the Save modal
let editingProfileId = null; // When editing/renaming

// DOM Elements
const el = {
  // Tabs
  navTabs: document.querySelectorAll('.nav-tab'),
  viewCurrent: document.getElementById('view-current'),
  viewAll: document.getElementById('view-all'),
  viewBackup: document.getElementById('view-backup'),

  // Site Header
  siteFavicon: document.getElementById('site-favicon'),
  siteDomain: document.getElementById('site-domain'),
  siteUrl: document.getElementById('site-url'),
  activeBadge: document.getElementById('active-profile-badge'),
  unsupportedBanner: document.getElementById('unsupported-banner'),

  // Toolbar
  btnSaveCurrent: document.getElementById('btn-save-current'),
  btnAddNext: document.getElementById('btn-add-next'),
  btnClearCurrent: document.getElementById('btn-clear-current'),
  btnReloadTab: document.getElementById('btn-reload-tab'),
  onboardingBanner: document.getElementById('onboarding-banner'),
  btnCloseGuide: document.getElementById('btn-close-guide'),

  // Profile List
  profileCount: document.getElementById('profile-count'),
  profileList: document.getElementById('profile-list'),
  profileEmpty: document.getElementById('profile-empty'),

  // All Sites Tab
  allSitesSearch: document.getElementById('all-sites-search'),
  allSitesList: document.getElementById('all-sites-list'),
  allSitesEmpty: document.getElementById('all-sites-empty'),

  // Backup Tab
  btnExportAll: document.getElementById('btn-export-all'),
  fileImport: document.getElementById('file-import'),
  btnTriggerImport: document.getElementById('btn-trigger-import'),
  btnWipeAll: document.getElementById('btn-wipe-all'),

  // Modals
  modal: document.getElementById('modal'),
  modalTitle: document.getElementById('modal-title'),
  modalClose: document.getElementById('modal-close'),
  inputProfileName: document.getElementById('input-profile-name'),
  inputProfileNote: document.getElementById('input-profile-note'),
  capturedPreview: document.getElementById('captured-preview'),
  previewCookieCount: document.getElementById('preview-cookie-count'),
  previewLocalCount: document.getElementById('preview-local-count'),
  previewSessionCount: document.getElementById('preview-session-count'),
  btnModalCancel: document.getElementById('btn-modal-cancel'),
  btnModalConfirm: document.getElementById('btn-modal-confirm'),

  // Confirm Modal
  confirmModal: document.getElementById('confirm-modal'),
  confirmTitle: document.getElementById('confirm-title'),
  confirmMessage: document.getElementById('confirm-message'),
  confirmClose: document.getElementById('confirm-close'),
  btnConfirmCancel: document.getElementById('btn-confirm-cancel'),
  btnConfirmOk: document.getElementById('btn-confirm-ok'),

  // Toast
  toast: document.getElementById('toast'),
  toastMessage: document.getElementById('toast-message'),

  // Sync Badge
  syncBadge: document.getElementById('sync-status-badge')
};

const SYNC_SERVER_URL = 'http://127.0.0.1:49152/api/sessions';

// ==========================================
// Initialization
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
  await loadData();
  await initCurrentTab();
  setupEventListeners();
  renderCurrentSiteProfiles();
  renderAllSitesList();
});

// Deep merge remote data into local state
function deepMergeAppData(target, incoming) {
  if (!incoming || !incoming.profiles) return target;
  if (!target.profiles) target.profiles = {};
  if (!target.activeProfiles) target.activeProfiles = {};

  for (const [domain, list] of Object.entries(incoming.profiles)) {
    if (!Array.isArray(list)) continue;
    if (!target.profiles[domain]) {
      target.profiles[domain] = [];
    }

    for (const inProf of list) {
      if (!inProf || !inProf.id) continue;
      const idx = target.profiles[domain].findIndex(
        p => p.id === inProf.id || (p.name === inProf.name && p.createdAt === inProf.createdAt)
      );

      if (idx >= 0) {
        if ((inProf.updatedAt || 0) >= (target.profiles[domain][idx].updatedAt || 0)) {
          target.profiles[domain][idx] = inProf;
        }
      } else {
        target.profiles[domain].push(inProf);
      }
    }
  }

  if (incoming.activeProfiles) {
    for (const [domain, id] of Object.entries(incoming.activeProfiles)) {
      if (!target.activeProfiles[domain] && id) {
        target.activeProfiles[domain] = id;
      }
    }
  }
  return target;
}

// Synchronize with local background server
async function syncWithServer() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1200);

    const res = await fetch(SYNC_SERVER_URL, { signal: controller.signal });
    clearTimeout(timer);

    if (res.ok) {
      const json = await res.json();
      if (json && json.success && json.data) {
        const remoteData = json.data;
        deepMergeAppData(appData, remoteData);
        await chrome.storage.local.set({ [STORAGE_KEY]: appData });
        pushToServer(appData);

        if (el.syncBadge) {
          el.syncBadge.className = 'sync-badge';
          el.syncBadge.innerHTML = '<span class="sync-dot"></span><span class="sync-text">自动同步</span>';
          el.syncBadge.title = '已连接到本地共享服务 (127.0.0.1:49152)，所有 Chrome Profile 自动实时互通';
        }
        return true;
      }
    }
  } catch (err) {
    if (el.syncBadge) {
      el.syncBadge.className = 'sync-badge offline';
      el.syncBadge.innerHTML = '<span class="sync-dot"></span><span class="sync-text">本地模式</span>';
      el.syncBadge.title = '未连接到共享服务，当前使用 Profile 独立存储';
    }
  }
  return false;
}

// Asynchronously push updates to local sync server
async function pushToServer(data) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    await fetch(SYNC_SERVER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: data }),
      signal: controller.signal
    });
    clearTimeout(timer);
  } catch (e) {}
}

// Load persistent data
async function loadData() {
  try {
    const res = await chrome.storage.local.get(STORAGE_KEY);
    if (res && res[STORAGE_KEY]) {
      appData = res[STORAGE_KEY];
      if (!appData.profiles) appData.profiles = {};
      if (!appData.activeProfiles) appData.activeProfiles = {};
    }
  } catch (err) {
    console.error('Error loading data:', err);
  }

  // Attempt automatic sync with local server
  await syncWithServer();
}

// Save persistent data
async function saveData() {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: appData });
  } catch (err) {
    console.error('Error saving data:', err);
    showToast('保存配置失败: ' + err.message);
  }

  // Auto push to background server for cross-profile sharing
  pushToServer(appData);
}

// Domain clustering & ecosystem association
const DOMAIN_CLUSTERS = [
  // XJTLU Learning Mall ecosystem (Portal, Core LMS, Premium, SSO)
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

  // Cluster matching
  for (const cluster of DOMAIN_CLUSTERS) {
    if (cluster.some(d => d.toLowerCase() === lower || d.toLowerCase() === clean)) {
      for (const d of cluster) result.add(d.toLowerCase());
    }
  }

  // Parent / subdomain matching
  const parts = clean.split('.');
  if (parts.length > 2) {
    const parentDomain = parts.slice(1).join('.');
    result.add(parentDomain);
  }

  return Array.from(result);
}

function getMatchedProfiles(domain) {
  if (!domain) return [];
  const associated = getAssociatedDomains(domain);
  const matched = [];
  const seenIds = new Set();
  const cleanCurrent = domain.toLowerCase().replace(/^www\./, '');

  for (const d of associated) {
    const list = appData.profiles[d] || [];
    for (const p of list) {
      if (!p || !p.id) continue;
      if (!seenIds.has(p.id)) {
        seenIds.add(p.id);
        const cleanProfileDomain = (p.domain || d).toLowerCase().replace(/^www\./, '');
        const isAffiliated = cleanProfileDomain !== cleanCurrent;
        matched.push({ ...p, isAffiliated, sourceDomain: p.domain || d });
      }
    }
  }
  return matched;
}

// Initialize active tab info
async function initCurrentTab() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs || tabs.length === 0) {
      markUnsupported('无法获取当前标签页');
      return;
    }

    currentTab = tabs[0];
    currentUrl = currentTab.url || '';

    if (!currentUrl.startsWith('http://') && !currentUrl.startsWith('https://')) {
      markUnsupported('当前页面不支持插件操作');
      return;
    }

    const urlObj = new URL(currentUrl);
    currentDomain = urlObj.hostname;
    currentSiteValid = true;

    // Set UI elements
    el.siteDomain.textContent = currentDomain;
    el.siteUrl.textContent = currentUrl;
    el.siteUrl.title = currentUrl;

    if (currentTab.favIconUrl) {
      el.siteFavicon.src = currentTab.favIconUrl;
      el.siteFavicon.onerror = () => {
        el.siteFavicon.src = 'icons/icon16.png';
      };
    }

    updateActiveBadge();

    // Check if domain is in onboarding mode
    if (appData.onboardingDomains && appData.onboardingDomains[currentDomain]) {
      el.onboardingBanner.classList.remove('hidden');
    } else {
      el.onboardingBanner.classList.add('hidden');
    }
  } catch (err) {
    console.error('Error inspecting tab:', err);
    markUnsupported('页面初始化失败');
  }
}

function markUnsupported(message) {
  currentSiteValid = false;
  el.siteDomain.textContent = '不受支持的页面';
  el.siteUrl.textContent = message;
  el.unsupportedBanner.classList.remove('hidden');
  el.btnSaveCurrent.disabled = true;
  if (el.btnAddNext) el.btnAddNext.disabled = true;
  el.btnClearCurrent.disabled = true;
  el.btnSaveCurrent.style.opacity = '0.5';
  if (el.btnAddNext) el.btnAddNext.style.opacity = '0.5';
  el.btnClearCurrent.style.opacity = '0.5';
}

function updateActiveBadge() {
  const matched = getMatchedProfiles(currentDomain);
  let activeId = appData.activeProfiles[currentDomain];
  if (!activeId) {
    const associated = getAssociatedDomains(currentDomain);
    for (const d of associated) {
      if (appData.activeProfiles[d]) {
        activeId = appData.activeProfiles[d];
        break;
      }
    }
  }

  const activeProfile = matched.find(p => p.id === activeId);

  if (activeProfile) {
    el.activeBadge.className = 'status-badge status-badge-active';
    el.activeBadge.textContent = activeProfile.name;
    el.activeBadge.title = `当前活跃账号: ${activeProfile.name}`;
  } else {
    el.activeBadge.className = 'status-badge status-badge-idle';
    el.activeBadge.textContent = '未选定账号';
    el.activeBadge.title = '当前会话未绑定到已知保存档案';
  }
}

// ==========================================
// Event Listeners
// ==========================================
function setupEventListeners() {
  // Navigation Tabs
  el.navTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      el.navTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      const target = tab.dataset.tab;
      el.viewCurrent.classList.toggle('active', target === 'current');
      el.viewAll.classList.toggle('active', target === 'all');
      el.viewBackup.classList.toggle('active', target === 'backup');

      if (target === 'all') {
        renderAllSitesList();
      }
    });
  });

  // Current Site Toolbar
  el.btnSaveCurrent.addEventListener('click', handleOpenSaveModal);
  if (el.btnAddNext) {
    el.btnAddNext.addEventListener('click', handlePrepareAddNextAccount);
  }
  el.btnClearCurrent.addEventListener('click', handleClearSessionConfirm);
  if (el.btnCloseGuide) {
    el.btnCloseGuide.addEventListener('click', () => {
      el.onboardingBanner.classList.add('hidden');
      if (appData.onboardingDomains) {
        delete appData.onboardingDomains[currentDomain];
        saveData();
      }
    });
  }
  el.btnReloadTab.addEventListener('click', () => {
    if (currentTab && currentTab.id) {
      chrome.tabs.reload(currentTab.id);
      showToast('已重新加载页面');
    }
  });

  // Modal Actions
  el.modalClose.addEventListener('click', closeModal);
  el.btnModalCancel.addEventListener('click', closeModal);
  el.btnModalConfirm.addEventListener('click', handleConfirmSaveOrEdit);
  el.inputProfileName.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleConfirmSaveOrEdit();
    if (e.key === 'Escape') closeModal();
  });

  // Confirm Modal Actions
  el.confirmClose.addEventListener('click', closeConfirmModal);
  el.btnConfirmCancel.addEventListener('click', closeConfirmModal);

  // All Sites Search
  el.allSitesSearch.addEventListener('input', (e) => {
    renderAllSitesList(e.target.value.trim());
  });

  // Backup & Restore
  el.btnExportAll.addEventListener('click', handleExportAll);
  el.btnTriggerImport.addEventListener('click', () => el.fileImport.click());
  el.fileImport.addEventListener('change', handleFileImport);
  el.btnWipeAll.addEventListener('click', handleWipeAllConfirm);
}

// ==========================================
// Session Capture & Restore Logic
// ==========================================

/**
 * Capture all cookies for the current tab's domain and URL
 */
async function captureCookies(url, domain) {
  const cookieMap = new Map();

  // 1. Get cookies specifically matched to the URL
  try {
    const urlCookies = await chrome.cookies.getAll({ url: url });
    for (const c of urlCookies) {
      const key = `${c.name}|${c.domain}|${c.path}|${c.storeId}`;
      cookieMap.set(key, c);
    }
  } catch (e) {
    console.warn('Get cookies by URL error:', e);
  }

  // 2. Query all cookies matching domain parts
  try {
    const parts = domain.split('.');
    const domainCandidates = new Set();
    const cleanMainDomain = domain.replace(/^\./, '');
    domainCandidates.add(cleanMainDomain);

    // If multi-level domain, also inspect parent domains (without leading dots)
    for (let i = 1; i < parts.length - 1; i++) {
      const parentDomain = parts.slice(i).join('.').replace(/^\./, '');
      if (parentDomain && parentDomain.includes('.')) {
        domainCandidates.add(parentDomain);
      }
    }

    for (const d of domainCandidates) {
      try {
        const domCookies = await chrome.cookies.getAll({ domain: d });
        for (const c of domCookies) {
          const key = `${c.name}|${c.domain}|${c.path}|${c.storeId}`;
          if (!cookieMap.has(key)) {
            cookieMap.set(key, c);
          }
        }
      } catch (domErr) {
        console.warn('Error querying domain cookies for', d, domErr);
      }
    }
  } catch (e) {
    console.warn('Get cookies by domain error:', e);
  }

  // Sanitize cookies for storage
  return Array.from(cookieMap.values()).map(c => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    secure: c.secure,
    httpOnly: c.httpOnly,
    sameSite: c.sameSite,
    expirationDate: c.expirationDate,
    storeId: c.storeId,
    hostOnly: c.hostOnly,
    session: c.session
  }));
}

/**
 * Capture LocalStorage & SessionStorage from active tab
 */
async function captureStorage(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: () => {
        const local = {};
        try {
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key !== null) local[key] = localStorage.getItem(key);
          }
        } catch (e) {}

        const session = {};
        try {
          for (let i = 0; i < sessionStorage.length; i++) {
            const key = sessionStorage.key(i);
            if (key !== null) session[key] = sessionStorage.getItem(key);
          }
        } catch (e) {}

        return { local, session };
      }
    });

    if (results && results[0] && results[0].result) {
      return results[0].result;
    }
  } catch (err) {
    console.warn('Failed to capture storage via scripting:', err);
  }
  return { local: {}, session: {} };
}

/**
 * Completely clear cookies & storage for current tab's domain
 */
async function clearDomainSession(url, domain, tabId) {
  // 1. Remove all cookies for current domain & URL
  try {
    const existingCookies = await captureCookies(url, domain);
    for (const c of existingCookies) {
      const protocol = c.secure ? 'https:' : 'http:';
      const cleanDomain = (c.domain || domain).replace(/^\./, '');
      const path = c.path && c.path.startsWith('/') ? c.path : '/' + (c.path || '');
      const cookieUrl = `${protocol}//${cleanDomain}${path}`;

      try {
        await chrome.cookies.remove({
          url: cookieUrl,
          name: c.name,
          storeId: c.storeId
        });
      } catch (err) {
        console.warn('Error removing cookie:', c.name, err);
      }
    }

    // Smart SSO clearing for affiliated systems (e.g. learningmall & xjtlu SSO)
    if (domain.includes('learningmall') || domain.includes('xjtlu.edu.cn')) {
      const ssoDomains = [
        'uim.xjtlu.edu.cn',
        'sso.xjtlu.edu.cn',
        'learningmall.cn',
        'www.learningmall.cn',
        'learningmall.xjtlu.edu.cn',
        'core.xjtlu.edu.cn'
      ];
      for (const sDom of ssoDomains) {
        try {
          const sCookies = await chrome.cookies.getAll({ domain: sDom });
          for (const sc of sCookies) {
            const proto = sc.secure ? 'https:' : 'http:';
            const cleanD = (sc.domain || sDom).replace(/^\./, '');
            const p = sc.path && sc.path.startsWith('/') ? sc.path : '/' + (sc.path || '');
            await chrome.cookies.remove({
              url: `${proto}//${cleanD}${p}`,
              name: sc.name,
              storeId: sc.storeId
            });
          }
        } catch (e) {}
      }
    }
  } catch (err) {
    console.error('Clear cookies failed:', err);
  }

  // 2. Clear storage via scripting
  if (tabId) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: () => {
          try { localStorage.clear(); } catch (e) {}
          try { sessionStorage.clear(); } catch (e) {}
          try {
            if (window.indexedDB && window.indexedDB.databases) {
              window.indexedDB.databases().then(dbs => {
                for (const db of dbs) {
                  if (db.name) window.indexedDB.deleteDatabase(db.name);
                }
              }).catch(() => {});
            }
          } catch (e) {}
        }
      });
    } catch (err) {
      console.warn('Failed to clear tab storage:', err);
    }
  }
}

/**
 * Restore cookies from a saved profile
 */
async function restoreCookies(cookies, defaultDomain) {
  for (const c of cookies) {
    const protocol = c.secure ? 'https:' : 'http:';
    const cleanDomain = (c.domain || defaultDomain).replace(/^\./, '');
    const path = c.path && c.path.startsWith('/') ? c.path : '/' + (c.path || '');
    const cookieUrl = `${protocol}//${cleanDomain}${path}`;

    const details = {
      url: cookieUrl,
      name: c.name,
      value: c.value,
      path: c.path || '/',
      secure: Boolean(c.secure),
      httpOnly: Boolean(c.httpOnly)
    };

    if (!c.hostOnly && c.domain) {
      details.domain = c.domain.replace(/^\./, '');
    }

    if (c.expirationDate && !c.session) {
      details.expirationDate = c.expirationDate;
    }

    if (c.sameSite && c.sameSite !== 'unspecified') {
      details.sameSite = c.sameSite;
      if (details.sameSite === 'no_restriction') {
        details.secure = true;
      }
    }

    if (c.storeId) {
      details.storeId = c.storeId;
    }

    try {
      await chrome.cookies.set(details);
    } catch (err) {
      console.warn('Failed to restore cookie:', c.name, err);
    }
  }
}

/**
 * Restore LocalStorage & SessionStorage from a saved profile
 */
async function restoreStorage(tabId, storageData) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: (data) => {
        try {
          localStorage.clear();
          if (data && data.local) {
            for (const [k, v] of Object.entries(data.local)) {
              if (v !== null && v !== undefined) localStorage.setItem(k, v);
            }
          }
        } catch (e) {
          console.warn('Failed restoring localStorage', e);
        }

        try {
          sessionStorage.clear();
          if (data && data.session) {
            for (const [k, v] of Object.entries(data.session)) {
              if (v !== null && v !== undefined) sessionStorage.setItem(k, v);
            }
          }
        } catch (e) {
          console.warn('Failed restoring sessionStorage', e);
        }
      },
      args: [storageData || { local: {}, session: {} }]
    });
  } catch (err) {
    console.warn('Script execution for restoreStorage failed:', err);
  }
}

/**
 * Perform full switch to a profile
 */
async function switchProfile(profile) {
  if (!currentSiteValid || !currentTab) {
    showToast('当前页面无法操作');
    return;
  }

  showToast('正在切换账号，请稍候...', 3000);

  // 1. Wipe current credentials for current tab and target profile domain
  await clearDomainSession(currentUrl, currentDomain, currentTab.id);
  if (profile.domain && profile.domain.toLowerCase() !== currentDomain.toLowerCase()) {
    await clearDomainSession(profile.originUrl || ('https://' + profile.domain), profile.domain, currentTab.id);
  }

  // 2. Inject target profile cookies
  if (profile.cookies && profile.cookies.length > 0) {
    await restoreCookies(profile.cookies, profile.domain || currentDomain);
  }

  // 3. Inject target profile storage
  await restoreStorage(currentTab.id, profile.storage);

  // 4. Update active tracking
  appData.activeProfiles[currentDomain] = profile.id;
  if (profile.domain) {
    appData.activeProfiles[profile.domain] = profile.id;
  }
  await saveData();

  // 5. Reload active tab or navigate to target profile originUrl if on an affiliated portal
  const cleanCurrent = currentDomain.toLowerCase().replace(/^www\./, '');
  const cleanProfile = (profile.domain || '').toLowerCase().replace(/^www\./, '');

  if (profile.originUrl && cleanCurrent !== cleanProfile) {
    chrome.tabs.update(currentTab.id, { url: profile.originUrl });
  } else {
    chrome.tabs.reload(currentTab.id, { bypassCache: true });
  }

  updateActiveBadge();
  renderCurrentSiteProfiles();
  showToast(`已成功切换至「${profile.name}」并刷新页面`);
}

// ==========================================
// UI Actions: Save / Update / Delete
// ==========================================

async function handleOpenSaveModal() {
  if (!currentSiteValid) {
    showToast('当前页面不受支持');
    return;
  }

  editingProfileId = null;
  el.modalTitle.textContent = '保存当前账号会话';
  el.capturedPreview.classList.remove('hidden');

  // Generate suggested name
  const existing = appData.profiles[currentDomain] || [];
  const nextNum = existing.length + 1;
  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  el.inputProfileName.value = `账号 ${nextNum} (${timeStr})`;
  el.inputProfileNote.value = '';

  // Capture current state in background for preview
  el.previewCookieCount.textContent = '读取中...';
  el.previewLocalCount.textContent = '读取中...';
  el.previewSessionCount.textContent = '读取中...';
  openModal();

  try {
    const cookies = await captureCookies(currentUrl, currentDomain);
    const storage = await captureStorage(currentTab.id);
    capturedBuffer = { cookies, storage };

    el.previewCookieCount.textContent = `${cookies.length} 项`;
    el.previewLocalCount.textContent = `${Object.keys(storage.local || {}).length} 项`;
    el.previewSessionCount.textContent = `${Object.keys(storage.session || {}).length} 项`;
  } catch (err) {
    console.error('Error pre-capturing:', err);
    el.previewCookieCount.textContent = '获取失败';
  }
}

async function handleConfirmSaveOrEdit() {
  const name = el.inputProfileName.value.trim();
  const note = el.inputProfileNote.value.trim();

  if (!name) {
    el.inputProfileName.focus();
    showToast('请输入账号备注名称');
    return;
  }

  if (editingProfileId) {
    // Renaming existing profile
    const profiles = appData.profiles[currentDomain] || [];
    const prof = profiles.find(p => p.id === editingProfileId);
    if (prof) {
      prof.name = name;
      prof.note = note;
      prof.updatedAt = Date.now();
      await saveData();
      showToast(`已更新账号名称为「${name}」`);
    }
  } else {
    // Saving new profile
    if (!capturedBuffer) {
      showToast('未能读取会话凭证，请重试');
      return;
    }

    const newProfile = {
      id: 'prof_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
      name: name,
      note: note,
      domain: currentDomain,
      originUrl: currentUrl,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      cookies: capturedBuffer.cookies,
      storage: capturedBuffer.storage
    };

    if (!appData.profiles[currentDomain]) {
      appData.profiles[currentDomain] = [];
    }
    appData.profiles[currentDomain].push(newProfile);
    appData.activeProfiles[currentDomain] = newProfile.id;

    if (appData.onboardingDomains && appData.onboardingDomains[currentDomain]) {
      delete appData.onboardingDomains[currentDomain];
    }

    await saveData();
    if (el.onboardingBanner) {
      el.onboardingBanner.classList.add('hidden');
    }
    showToast(`账号「${name}」已保存成功`);
  }

  closeModal();
  updateActiveBadge();
  renderCurrentSiteProfiles();
}

function handleOpenEditModal(profile) {
  editingProfileId = profile.id;
  el.modalTitle.textContent = '编辑账号备注';
  el.capturedPreview.classList.add('hidden');
  el.inputProfileName.value = profile.name || '';
  el.inputProfileNote.value = profile.note || '';
  openModal();
}

async function handleOverwriteProfile(profile) {
  openConfirmModal(
    '确认覆盖凭证',
    `确定要将当前网页的最新登录状态覆盖保存到「${profile.name}」吗？原有保存的 Cookie 和 Storage 将被更新。`,
    async () => {
      try {
        const cookies = await captureCookies(currentUrl, currentDomain);
        const storage = await captureStorage(currentTab.id);

        profile.cookies = cookies;
        profile.storage = storage;
        profile.updatedAt = Date.now();
        profile.originUrl = currentUrl;
        appData.activeProfiles[currentDomain] = profile.id;

        await saveData();
        updateActiveBadge();
        renderCurrentSiteProfiles();
        showToast(`已成功将最新凭证覆盖至「${profile.name}」`);
      } catch (err) {
        showToast('覆盖保存失败: ' + err.message);
      }
    }
  );
}

function handleDeleteProfile(profile) {
  openConfirmModal(
    '确认删除账号',
    `确定要删除保存的账号「${profile.name}」吗？此操作不可恢复。`,
    async () => {
      let profiles = appData.profiles[currentDomain] || [];
      appData.profiles[currentDomain] = profiles.filter(p => p.id !== profile.id);

      if (appData.activeProfiles[currentDomain] === profile.id) {
        delete appData.activeProfiles[currentDomain];
      }

      await saveData();
      updateActiveBadge();
      renderCurrentSiteProfiles();
      showToast(`已删除账号「${profile.name}」`);
    }
  );
}

function handlePrepareAddNextAccount() {
  if (!currentSiteValid) return;
  openConfirmModal(
    '清空并准备录入新账号',
    `将彻底清空「${currentDomain}」当前的登录状态（包括 Cookie、LocalStorage 及关联统一认证票据）并自动刷新网页。\n\n网页刷新后，请在网页中直接登录您的下一个账号；登录成功后，再次打开本插件点击「保存当前账号」即可录入。确定继续？`,
    async () => {
      showToast('正在清空当前会话并刷新网页...', 2000);
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabToUse = (tabs && tabs[0]) ? tabs[0] : currentTab;
      const tabId = tabToUse ? tabToUse.id : null;
      const urlToUse = (tabToUse && tabToUse.url) ? tabToUse.url : currentUrl;

      await clearDomainSession(urlToUse, currentDomain, tabId);

      if (!appData.onboardingDomains) appData.onboardingDomains = {};
      appData.onboardingDomains[currentDomain] = true;
      delete appData.activeProfiles[currentDomain];
      await saveData();

      if (tabId) {
        try {
          await chrome.tabs.reload(tabId, { bypassCache: true });
        } catch (e) {
          console.warn('Reload tab error:', e);
        }
      }
      updateActiveBadge();
      renderCurrentSiteProfiles();
      if (el.onboardingBanner) {
        el.onboardingBanner.classList.remove('hidden');
      }
      showToast('已清空当前登录。请在网页中登录新账号后点击「保存当前账号」', 4000);
    }
  );
}

function handleClearSessionConfirm() {
  if (!currentSiteValid) return;
  openConfirmModal(
    '深度注销登录',
    `确定要清空「${currentDomain}」的所有当前 Cookie、本地 Storage 以及关联单点登录凭据并刷新页面吗？这将使网站回到完全未登录状态。`,
    async () => {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabToUse = (tabs && tabs[0]) ? tabs[0] : currentTab;
      const tabId = tabToUse ? tabToUse.id : null;
      const urlToUse = (tabToUse && tabToUse.url) ? tabToUse.url : currentUrl;

      await clearDomainSession(urlToUse, currentDomain, tabId);
      delete appData.activeProfiles[currentDomain];
      if (appData.onboardingDomains) {
        delete appData.onboardingDomains[currentDomain];
      }
      await saveData();

      if (tabId) {
        try {
          await chrome.tabs.reload(tabId, { bypassCache: true });
        } catch (e) {
          console.warn('Reload tab error:', e);
        }
      }
      updateActiveBadge();
      renderCurrentSiteProfiles();
      if (el.onboardingBanner) {
        el.onboardingBanner.classList.add('hidden');
      }
      showToast('已深度清空登录凭据并刷新页面');
    }
  );
}

function handleExportSingleProfile(profile) {
  const exportData = {
    version: '1.0',
    type: 'single_profile',
    domain: currentDomain,
    exportedAt: new Date().toISOString(),
    profile: profile
  };
  const cleanName = profile.name.replace(/[/\\?%*:|"<>]/g, '_');
  downloadJson(`session_${currentDomain}_${cleanName}.json`, exportData);
  showToast(`已导出「${profile.name}」凭证`);
}

// ==========================================
// Rendering: Current Site Profiles
// ==========================================

function renderCurrentSiteProfiles() {
  if (!currentSiteValid) {
    el.profileList.innerHTML = '';
    el.profileEmpty.classList.add('hidden');
    el.profileCount.textContent = '0 个账号';
    return;
  }

  const profiles = getMatchedProfiles(currentDomain);
  const activeId = appData.activeProfiles[currentDomain];

  const hasAffiliated = profiles.some(p => p.isAffiliated);
  el.profileCount.textContent = `${profiles.length} 个账号${hasAffiliated ? ' (含关联站点)' : ''}`;

  if (profiles.length === 0) {
    el.profileList.innerHTML = '';
    el.profileEmpty.classList.remove('hidden');
    return;
  }

  el.profileEmpty.classList.add('hidden');
  el.profileList.innerHTML = '';

  profiles.forEach(profile => {
    const isActive = profile.id === activeId || (profile.domain && appData.activeProfiles[profile.domain] === profile.id);
    const card = document.createElement('div');
    card.className = `profile-card ${isActive ? 'active-card' : ''}`;

    const cookieNum = (profile.cookies || []).length;
    const localNum = Object.keys(profile.storage?.local || {}).length;
    const sessionNum = Object.keys(profile.storage?.session || {}).length;
    const storageTotal = localNum + sessionNum;
    const timeFormatted = formatDate(profile.updatedAt || profile.createdAt);

    card.innerHTML = `
      <div class="profile-header">
        <div class="profile-name-wrap">
          <span class="profile-name" title="${escapeHtml(profile.name)}">${escapeHtml(profile.name)}</span>
          ${isActive ? `
            <span class="active-tag">
              <span class="active-dot"></span>使用中
            </span>
          ` : ''}
          ${profile.isAffiliated ? `
            <span class="affiliated-tag" title="此账号是在关联系统 ${escapeHtml(profile.sourceDomain)} 中保存的，可直接在此处一键切换">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -1px; margin-right: 3px;"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>${escapeHtml(profile.sourceDomain)}
            </span>
          ` : ''}
        </div>
      </div>
      ${profile.note ? `<div class="profile-note" title="${escapeHtml(profile.note)}">${escapeHtml(profile.note)}</div>` : ''}
      <div class="profile-meta-row">
        <div class="profile-badges">
          <span class="pill-badge">${cookieNum} Cookies</span>
          <span class="pill-badge">${storageTotal} Storage</span>
        </div>
        <span class="profile-time">${timeFormatted}</span>
      </div>
      <div class="profile-actions">
        <button class="btn-switch ${isActive ? 'current-applied' : ''}" data-action="switch">
          ${isActive ? '当前账号' : '切换至此账号'}
        </button>
        <button class="btn-sub-action" data-action="overwrite" title="用当前页面最新状态覆盖更新此账号">更新</button>
        <button class="btn-sub-action" data-action="edit" title="重命名备注">重命名</button>
        <button class="btn-sub-action" data-action="export" title="导出单独 JSON">导出</button>
        <button class="btn-sub-action btn-sub-danger" data-action="delete" title="删除此记录">删除</button>
      </div>
    `;

    // Action button events
    card.querySelector('[data-action="switch"]').addEventListener('click', () => switchProfile(profile));
    card.querySelector('[data-action="overwrite"]').addEventListener('click', () => handleOverwriteProfile(profile));
    card.querySelector('[data-action="edit"]').addEventListener('click', () => handleOpenEditModal(profile));
    card.querySelector('[data-action="export"]').addEventListener('click', () => handleExportSingleProfile(profile));
    card.querySelector('[data-action="delete"]').addEventListener('click', () => handleDeleteProfile(profile));

    el.profileList.appendChild(card);
  });
}

// ==========================================
// Rendering: All Sites List
// ==========================================

function renderAllSitesList(query = '') {
  const domains = Object.keys(appData.profiles || {}).filter(d => (appData.profiles[d] || []).length > 0);

  if (domains.length === 0) {
    el.allSitesList.innerHTML = '';
    el.allSitesEmpty.classList.remove('hidden');
    return;
  }

  el.allSitesEmpty.classList.add('hidden');
  el.allSitesList.innerHTML = '';

  const filtered = domains.filter(d => {
    if (!query) return true;
    const q = query.toLowerCase();
    if (d.toLowerCase().includes(q)) return true;
    const profiles = appData.profiles[d] || [];
    return profiles.some(p => p.name.toLowerCase().includes(q) || (p.note && p.note.toLowerCase().includes(q)));
  });

  if (filtered.length === 0) {
    el.allSitesList.innerHTML = `
      <div class="empty-state">
        <div class="empty-title">未找到匹配站点</div>
        <div class="empty-desc">换个搜索词试试</div>
      </div>
    `;
    return;
  }

  filtered.forEach(domain => {
    const profiles = appData.profiles[domain] || [];
    const activeId = appData.activeProfiles[domain];

    const group = document.createElement('div');
    group.className = 'site-group-card';

    group.innerHTML = `
      <div class="site-group-header">
        <div class="site-group-title">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--text-muted);"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>
          <span>${escapeHtml(domain)}</span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span class="site-group-count">${profiles.length} 个账号</span>
          <button class="btn-sub-action btn-sub-danger" style="padding: 2px 6px; font-size: 10px;" data-domain="${escapeHtml(domain)}" data-action="delete-domain">清空</button>
        </div>
      </div>
      <div class="site-group-body">
        ${profiles.map(p => `
          <div class="site-sub-item">
            <div>
              <strong>${escapeHtml(p.name)}</strong>
              ${p.id === activeId ? '<span style="color: #16a34a; font-size: 10px; margin-left: 4px;">[当前激活]</span>' : ''}
              ${p.note ? `<span style="color: #64748b; font-size: 11px; margin-left: 6px;">${escapeHtml(p.note)}</span>` : ''}
            </div>
            <div style="display: flex; gap: 4px;">
              <span style="font-size: 10px; color: #94a3b8;">${formatDate(p.updatedAt || p.createdAt)}</span>
            </div>
          </div>
        `).join('')}
      </div>
    `;

    group.querySelector('[data-action="delete-domain"]').addEventListener('click', (e) => {
      e.stopPropagation();
      openConfirmModal(
        '清空该站点所有账号',
        `确定要删除「${domain}」下的所有 ${profiles.length} 个账号档案吗？`,
        async () => {
          delete appData.profiles[domain];
          delete appData.activeProfiles[domain];
          await saveData();
          renderAllSitesList(query);
          if (domain === currentDomain) {
            updateActiveBadge();
            renderCurrentSiteProfiles();
          }
          showToast(`已清空「${domain}」的所有账号`);
        }
      );
    });

    el.allSitesList.appendChild(group);
  });
}

// ==========================================
// Backup & Export / Import
// ==========================================

function handleExportAll() {
  const totalSites = Object.keys(appData.profiles).length;
  let totalProfiles = 0;
  for (const list of Object.values(appData.profiles)) {
    totalProfiles += list.length;
  }

  if (totalProfiles === 0) {
    showToast('暂无任何保存的账号可导出');
    return;
  }

  const exportPayload = {
    version: '1.0',
    type: 'full_backup',
    exportedAt: new Date().toISOString(),
    totalSites: totalSites,
    totalProfiles: totalProfiles,
    data: appData
  };

  const d = new Date();
  const dateStr = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}_${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}`;
  downloadJson(`SessionSwitch_backup_${dateStr}.json`, exportPayload);
  showToast(`已成功导出 ${totalSites} 个站点共 ${totalProfiles} 个账号备份`);
}

async function handleFileImport(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  const mode = document.querySelector('input[name="import-mode"]:checked')?.value || 'merge';

  try {
    const text = await file.text();
    const json = JSON.parse(text);

    let incomingProfiles = {};
    let incomingActive = {};

    if (json.type === 'single_profile' && json.profile && json.domain) {
      // Single profile format
      incomingProfiles[json.domain] = [json.profile];
    } else if (json.data && json.data.profiles) {
      // Full backup format
      incomingProfiles = json.data.profiles;
      incomingActive = json.data.activeProfiles || {};
    } else if (json.profiles) {
      // Direct state format
      incomingProfiles = json.profiles;
      incomingActive = json.activeProfiles || {};
    } else {
      throw new Error('未识别的备份文件格式');
    }

    if (mode === 'overwrite') {
      appData.profiles = incomingProfiles;
      appData.activeProfiles = incomingActive;
    } else {
      // Merge mode
      for (const [dom, list] of Object.entries(incomingProfiles)) {
        if (!appData.profiles[dom]) {
          appData.profiles[dom] = [];
        }
        for (const item of list) {
          // Avoid duplicate by matching id or name
          const exists = appData.profiles[dom].some(p => p.id === item.id || (p.name === item.name && p.createdAt === item.createdAt));
          if (!exists) {
            appData.profiles[dom].push(item);
          }
        }
      }
    }

    await saveData();
    updateActiveBadge();
    renderCurrentSiteProfiles();
    renderAllSitesList();
    showToast('备份文件导入成功');
  } catch (err) {
    console.error('Import error:', err);
    showToast('导入失败: ' + err.message);
  } finally {
    el.fileImport.value = '';
  }
}

function handleWipeAllConfirm() {
  openConfirmModal(
    '清空全部插件数据',
    '确定要彻底清空本插件保存的所有站点、所有账号凭据吗？该操作不可逆，强烈建议在清空前先导出备份。',
    async () => {
      appData = { profiles: {}, activeProfiles: {} };
      await saveData();
      updateActiveBadge();
      renderCurrentSiteProfiles();
      renderAllSitesList();
      showToast('已清空所有本地保存的会话数据');
    }
  );
}

// ==========================================
// Modal & Helper Functions
// ==========================================

function openModal() {
  el.modal.classList.remove('hidden');
  setTimeout(() => el.inputProfileName.focus(), 50);
}

function closeModal() {
  el.modal.classList.add('hidden');
  capturedBuffer = null;
  editingProfileId = null;
}

let confirmCallback = null;

function openConfirmModal(title, message, onOk) {
  el.confirmTitle.textContent = title;
  el.confirmMessage.textContent = message;
  confirmCallback = onOk;
  el.confirmModal.classList.remove('hidden');

  el.btnConfirmOk.onclick = async () => {
    const action = confirmCallback;
    closeConfirmModal();
    if (action) {
      try {
        await action();
      } catch (err) {
        console.error('Confirm action execution error:', err);
        showToast('执行失败: ' + err.message);
      }
    }
  };
}

function closeConfirmModal() {
  el.confirmModal.classList.add('hidden');
  confirmCallback = null;
}

let toastTimer = null;
function showToast(message, duration = 2500) {
  el.toastMessage.textContent = message;
  el.toast.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.toast.classList.add('hidden');
  }, duration);
}

function downloadJson(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 1000);
}

function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

  if (isToday) {
    return `今天 ${time}`;
  }
  return `${d.getMonth() + 1}/${d.getDate()} ${time}`;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

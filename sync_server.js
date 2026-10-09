#!/usr/bin/env node
/**
 * SessionSwitch - Local Sync Server
 * Enables seamless, automatic cross-profile data synchronization for Chrome/Edge extensions.
 * Runs locally on 127.0.0.1:49152 (no internet exposure).
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = 49152;
const HOST = '127.0.0.1';

// Shared data storage path
const DATA_DIR = path.join(os.homedir(), '.sessionswitch');
const DATA_FILE = path.join(DATA_DIR, 'shared_sessions.json');
const LOG_FILE = path.join(DATA_DIR, 'sync.log');

// Ensure storage directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try {
    fs.appendFileSync(LOG_FILE, line);
  } catch (e) {}
  if (process.stdout.isTTY) {
    process.stdout.write(line);
  }
}

// Initial empty data schema
function getDefaultData() {
  return {
    version: '1.0',
    lastModified: Date.now(),
    profiles: {},
    activeProfiles: {},
    onboardingDomains: {}
  };
}

// Read shared data from disk
function readSharedData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const content = fs.readFileSync(DATA_FILE, 'utf-8');
      const parsed = JSON.parse(content);
      if (!parsed.profiles) parsed.profiles = {};
      if (!parsed.activeProfiles) parsed.activeProfiles = {};
      return parsed;
    }
  } catch (err) {
    log(`Warning: Failed to read ${DATA_FILE}, using default data: ${err.message}`);
  }
  return getDefaultData();
}

// Write shared data atomically to disk
function writeSharedData(data) {
  try {
    data.lastModified = Date.now();
    const tempFile = `${DATA_FILE}.${Date.now()}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tempFile, DATA_FILE);
    return true;
  } catch (err) {
    log(`Error: Failed to write shared data: ${err.message}`);
    return false;
  }
}

// Deep merge profiles from different profiles/browsers
function mergeData(base, incoming) {
  const result = {
    version: '1.0',
    profiles: { ...(base.profiles || {}) },
    activeProfiles: { ...(base.activeProfiles || {}) },
    onboardingDomains: { ...(base.onboardingDomains || {}) }
  };

  if (incoming && incoming.profiles) {
    for (const [domain, inList] of Object.entries(incoming.profiles)) {
      if (!Array.isArray(inList)) continue;
      if (!result.profiles[domain]) {
        result.profiles[domain] = [];
      }

      for (const inProf of inList) {
        if (!inProf || !inProf.id) continue;
        const existingIdx = result.profiles[domain].findIndex(
          p => p.id === inProf.id || (p.name === inProf.name && p.createdAt === inProf.createdAt)
        );

        if (existingIdx >= 0) {
          const existing = result.profiles[domain][existingIdx];
          // Keep newer version
          if ((inProf.updatedAt || 0) >= (existing.updatedAt || 0)) {
            result.profiles[domain][existingIdx] = inProf;
          }
        } else {
          result.profiles[domain].push(inProf);
        }
      }
    }
  }

  // Active profile pointers
  if (incoming && incoming.activeProfiles) {
    for (const [domain, id] of Object.entries(incoming.activeProfiles)) {
      if (id) result.activeProfiles[domain] = id;
    }
  }

  return result;
}

// Create HTTP server
const server = http.createServer((req, res) => {
  // CORS Headers for Chrome Extensions
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Client-Profile');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = req.url || '';

  // 1. Health check & status
  if (req.method === 'GET' && (url === '/' || url === '/api/status')) {
    const data = readSharedData();
    let totalProfiles = 0;
    for (const list of Object.values(data.profiles || {})) {
      totalProfiles += (list || []).length;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      service: 'SessionSwitch Local Sync Server',
      port: PORT,
      storagePath: DATA_FILE,
      domainsCount: Object.keys(data.profiles || {}).length,
      profilesCount: totalProfiles,
      lastModified: data.lastModified || 0
    }));
    return;
  }

  // 2. GET /api/sessions: Fetch current shared sessions
  if (req.method === 'GET' && url === '/api/sessions') {
    const current = readSharedData();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      data: current,
      lastModified: current.lastModified || 0
    }));
    return;
  }

  // 3. POST /api/sessions: Sync / Merge local data into shared storage
  if (req.method === 'POST' && url === '/api/sessions') {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      // Safety limit: 50MB
      if (body.length > 50 * 1024 * 1024) {
        req.destroy();
      }
    });

    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const incomingData = payload.data || payload;
        const currentData = readSharedData();

        // Perform merge
        const merged = mergeData(currentData, incomingData);
        writeSharedData(merged);

        log(`Synced update from client: ${Object.keys(merged.profiles).length} domains`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          data: merged,
          lastModified: merged.lastModified
        }));
      } catch (err) {
        log(`Error processing POST /api/sessions: ${err.message}`);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

// Start listener
server.listen(PORT, HOST, () => {
  log(`SessionSwitch Sync Server listening on http://${HOST}:${PORT}`);
  log(`Shared data file: ${DATA_FILE}`);
});

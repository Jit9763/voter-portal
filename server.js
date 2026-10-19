// Auto-respawn with --experimental-sqlite if flag is missing
if (!process.execArgv.includes('--experimental-sqlite')) {
  try {
    const { spawn } = require('child_process');
    const child = spawn(process.execPath, ['--experimental-sqlite', ...process.execArgv, ...process.argv.slice(1)], {
      stdio: 'inherit',
      cwd: __dirname
    });
    child.on('exit', (code) => process.exit(code || 0));
    return;
  } catch(e) {}
}

/**
 * Panchayat Voter Portal - Standalone High-Speed Node.js + SQLite/JSON Server
 * Provides ultra-fast authentication, real-time user management & candidate slip profiles.
 * Completely immune to Google Sheet quotas and traffic bottlenecks.
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { DatabaseSync } = require('node:sqlite');

const staticCache = new Map();

const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'db.sqlite');
const JSON_PATH = path.join(__dirname, 'portal_users.json');

// Initialize SQLite Database
const db = new DatabaseSync(DB_PATH);
try {
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 10000;');
  db.exec('PRAGMA synchronous = NORMAL;');
} catch(e) {}

// Create Tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE,
    password TEXT,
    full_name TEXT,
    mobile TEXT,
    role TEXT,
    status TEXT,
    allowed_panchayats TEXT,
    allowed_wards TEXT,
    allowed_tabs TEXT,
    candidate_mode TEXT,
    created_at TEXT,
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS candidates (
    user_id TEXT PRIMARY KEY,
    candidate_name TEXT,
    post TEXT,
    panchayat TEXT,
    ward TEXT,
    symbol_name TEXT,
    symbol_icon TEXT,
    photo_url TEXT,
    slogan TEXT,
    election_time TEXT,
    mobile TEXT,
    show_banner_on_slip INTEGER,
    updated_at TEXT
  );
`);
try { db.prepare("ALTER TABLE candidates ADD COLUMN election_time TEXT").run(); } catch(e) {}
try { db.prepare("ALTER TABLE candidates ADD COLUMN election_date TEXT").run(); } catch(e) {}
try { db.prepare("ALTER TABLE candidates ADD COLUMN custom_symbol_url TEXT").run(); } catch(e) {}
try { db.prepare("ALTER TABLE users ADD COLUMN can_print INTEGER DEFAULT 1").run(); } catch(e) {}
try { db.prepare("ALTER TABLE users ADD COLUMN can_download INTEGER DEFAULT 1").run(); } catch(e) {}
try { db.prepare("ALTER TABLE users ADD COLUMN can_search INTEGER DEFAULT 1").run(); } catch(e) {}
try { db.prepare("ALTER TABLE users ADD COLUMN can_view INTEGER DEFAULT 1").run(); } catch(e) {}

// Seed from portal_users.json if empty
// Sync & Seed from portal_users.json
function seedDatabase() {
  if (fs.existsSync(JSON_PATH)) {
    try {
      const data = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
      const userList = Array.isArray(data) ? data : (data.users || []);
      try { db.exec('BEGIN TRANSACTION;'); } catch(_) {}
      const insertUser = db.prepare(`
        INSERT OR REPLACE INTO users (id, username, password, full_name, mobile, role, status, allowed_panchayats, allowed_wards, allowed_tabs, candidate_mode, can_print, can_download, can_search, can_view, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const toStr = (val, def = '') => {
        if (val === null || val === undefined) return def;
        if (typeof val === 'object') return JSON.stringify(val);
        return String(val);
      };

      userList.forEach(u => {
        insertUser.run(
          toStr(u.id || u.username),
          toStr(u.username || u.id),
          toStr(u.password || '123'),
          toStr(u.full_name || u.fullName || u.name || u.username),
          toStr(u.mobile || ''),
          toStr(u.role || 'BLO'),
          toStr(u.status || 'ACTIVE'),
          toStr(u.allowed_panchayats || u.panchayat || 'ALL'),
          toStr(u.allowed_wards || u.assigned_wards || u.wards || 'ALL'),
          toStr(Array.isArray(u.allowed_tabs) ? JSON.stringify(u.allowed_tabs) : (u.allowed_tabs || '[]')),
          toStr(u.candidate_mode || 'user_edit'),
          (u.can_print !== undefined && u.can_print !== null) ? (u.can_print ? 1 : 0) : 1,
          (u.can_download !== undefined && u.can_download !== null) ? (u.can_download ? 1 : 0) : 1,
          (u.can_search !== undefined && u.can_search !== null) ? (u.can_search ? 1 : 0) : 1,
          (u.can_view !== undefined && u.can_view !== null) ? (u.can_view ? 1 : 0) : 1,
          new Date().toISOString(),
          new Date().toISOString()
        );
      });

      const insertCand = db.prepare(`
        INSERT OR IGNORE INTO candidates (user_id, candidate_name, post, panchayat, ward, symbol_name, symbol_icon, photo_url, slogan, mobile, show_banner_on_slip, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      if (data.candidates) {
        Object.entries(data.candidates).forEach(([uId, c]) => {
          insertCand.run(
            uId,
            c.candidate_name || '',
            c.post || 'सरपंच',
            c.panchayat || '',
            c.ward || '',
            c.symbol_name || 'उगता सूरज',
            c.symbol_icon || 'sun',
            c.photo_url || '',
            c.slogan || '',
            c.mobile || '',
            c.show_banner_on_slip ? 1 : 0,
            new Date().toISOString()
          );
        });
      }
      try { db.exec('COMMIT;'); } catch(_) {}
      console.log('Database synced with portal_users.json. Users count in DB:', db.prepare('SELECT COUNT(*) AS c FROM users').get().c);
    } catch (e) {
      console.error('Seeding error:', e);
    }
  }
}
seedDatabase();

// Sync SQLite back to portal_users.json so static GitHub Pages can also read it
function exportToJson() {
  try {
    const rawUsers = db.prepare('SELECT * FROM users').all();
    const users = rawUsers.map(u => {
      let tabs = [];
      try { tabs = JSON.parse(u.allowed_tabs); } catch(e) { tabs = ['searchTab']; }
      const isCand = (u.role === 'CANDIDATE' || u.role === 'प्रत्याशी' || (u.id && String(u.id).startsWith('cand_')) || u.username === 'sarpanch') && u.role !== 'SUPER_ADMIN' && u.role !== 'BLO' && !String(u.role).includes('बी.एल.ओ') && !String(u.role).includes('प्रकोष्ठ') && !String(u.id).startsWith('cell_') && !String(u.id).startsWith('blo_');
      if (isCand && Array.isArray(tabs)) {
        tabs = tabs.filter(t => t !== 'directoryTab');
      }
      return {
        ...u,
        can_print: (u.can_print !== undefined && u.can_print !== null) ? Boolean(u.can_print) : true,
        can_download: (u.can_download !== undefined && u.can_download !== null) ? Boolean(u.can_download) : true,
        can_search: (u.can_search !== undefined && u.can_search !== null) ? Boolean(u.can_search) : true,
        can_view: (u.can_view !== undefined && u.can_view !== null) ? Boolean(u.can_view) : true,
        allowed_tabs: tabs
      };
    });

    const rawCandidates = db.prepare('SELECT * FROM candidates').all();
    const candidates = {};
    const pickBestCand = (existing, incoming) => {
      if (!existing) return incoming;
      if (incoming.custom_symbol_url && !existing.custom_symbol_url) return incoming;
      if (existing.custom_symbol_url && !incoming.custom_symbol_url) return existing;
      if (new Date(incoming.updated_at || 0) >= new Date(existing.updated_at || 0)) return incoming;
      return existing;
    };
    rawCandidates.forEach(c => {
      const candObj = {
        candidate_name: c.candidate_name,
        post: c.post,
        panchayat: c.panchayat,
        ward: c.ward,
        election_date: c.election_date || '15 अक्टूबर 2026',
        election_time: c.election_time || 'प्रातः 7:00 बजे से सायं 6:00 बजे तक',
        symbol_name: c.symbol_name,
        symbol_icon: c.symbol_icon,
        custom_symbol_url: c.custom_symbol_url || '',
        photo_url: c.photo_url || '',
        slogan: c.slogan || '',
        mobile: c.mobile || '',
        show_banner_on_slip: !!c.show_banner_on_slip,
        updated_at: c.updated_at
      };
      const key1 = c.user_id;
      const key2 = c.user_id.startsWith('cand_') ? c.user_id.replace('cand_', '') : ('cand_' + c.user_id);
      candidates[key1] = pickBestCand(candidates[key1], candObj);
      candidates[key2] = pickBestCand(candidates[key2], candObj);
    });

    let globalElectionDate = '15 अक्टूबर 2026';
    let globalElectionTime = 'प्रातः 7:00 बजे से सायं 6:00 बजे तक';
    try {
      const sp = path.join(__dirname, 'portal_settings.json');
      if (fs.existsSync(sp)) {
        const sData = JSON.parse(fs.readFileSync(sp, 'utf8'));
        if (sData.voter_portal?.election_date) globalElectionDate = sData.voter_portal.election_date;
        else if (sData.election_date) globalElectionDate = sData.election_date;
        if (sData.voter_portal?.election_time) globalElectionTime = sData.voter_portal.election_time;
        else if (sData.election_time) globalElectionTime = sData.election_time;
      }
    } catch(_) {}

    const payload = {
      version: '2.0.0',
      election_date: globalElectionDate,
      election_time: globalElectionTime,
      last_updated: new Date().toISOString(),
      users,
      candidates
    };
    isInternalExport = true;
    fs.writeFileSync(JSON_PATH, JSON.stringify(payload, null, 2), 'utf8');
    setTimeout(() => { isInternalExport = false; }, 800);

    // Synchronously copy updated portal_users.json to sibling repos (blo-portal and voter-portal)
    const siblingRepos = [
      'C:\\Users\\jiten\\OneDrive\\Documents\\GitHub\\blo-portal',
      'C:\\Users\\jiten\\OneDrive\\Documents\\GitHub\\voter-portal',
      'C:\\Users\\jiten\\Documents\\GitHub\\blo-portal',
      'C:\\Users\\jiten\\Documents\\GitHub\\voter-portal'
    ];
    siblingRepos.forEach(sDir => {
      if (fs.existsSync(sDir)) {
        try {
          fs.writeFileSync(path.join(sDir, 'portal_users.json'), JSON.stringify(payload, null, 2), 'utf8');
        } catch(_) {}
      }
    });
    if (typeof scheduleAutoPushToGithub === 'function') {
      scheduleAutoPushToGithub('database_json_export');
    }
  } catch (err) {
    console.error('JSON export error:', err);
  }
}

// Watch portal_users.json for external edits so settings/users change takes effect immediately without restart
let isInternalExport = false;
try {
  fs.watchFile(JSON_PATH, { interval: 1000 }, (curr, prev) => {
    if (curr.mtimeMs > prev.mtimeMs && !isInternalExport) {
      console.log('🔄 Disk file portal_users.json modified! Auto-syncing to SQLite database...');
      seedDatabase();
    }
  });
} catch(e) {
  console.log('File watcher not supported:', e);
}

// Request Body Parser Helper
function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 50 * 1024 * 1024) { // 50MB limit
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

// MIME types
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// Auto-Sync & Push to GitHub Engine
let autoPushTimer = null;
let isPushing = false;

function scheduleAutoPushToGithub(reason = 'update') {
  if (autoPushTimer) clearTimeout(autoPushTimer);
  console.log(`[AUTO-SYNC] Setting auto-push scheduled in 2.5s (Trigger: ${reason})...`);
  autoPushTimer = setTimeout(() => {
    executeGithubPush(reason);
  }, 2500);
}

function executeGithubPush(reason = 'update', callback = null) {
  if (isPushing) {
    console.log('[AUTO-SYNC] A deployment push is already running, will not overlap.');
    if (callback) callback(null, 'Already in progress');
    return;
  }
  isPushing = true;
  const { exec } = require('node:child_process');

    const runDirectGitPush = () => {
    console.log(`[AUTO-SYNC] Running Tri-Repo clash-free Git push (pan, blo-portal, voter-portal) (Reason: ${reason})...`);
    const pcName = process.env.COMPUTERNAME || 'PC';
    const gitDesktopCmd = 'C:/Users/jiten/AppData/Local/GitHubDesktop/app-3.6.7/resources/app/git/cmd/git.exe';
    const gitExe = fs.existsSync(gitDesktopCmd) ? `"${gitDesktopCmd}"` : 'git';
    const commitMsg = `Auto-sync settings & users from ${pcName} (${reason}) [${new Date().toISOString()}]`;

    // Tri-Repo Paths with forward slashes to avoid escaping issues
    const candidateDirs = [
      'C:/Users/jiten/OneDrive/Documents/GitHub/blo-portal',
      'C:/Users/jiten/Documents/GitHub/blo-portal',
      'C:/Users/jiten/OneDrive/Documents/GitHub/voter-portal',
      'C:/Users/jiten/Documents/GitHub/voter-portal'
    ];
    const seen = new Set();
    const otherRepos = candidateDirs.filter(d => {
      if (fs.existsSync(d) && !seen.has(path.resolve(d).toLowerCase())) {
        seen.add(path.resolve(d).toLowerCase());
        return true;
      }
      return false;
    });

    // Generate fresh build / deploy version
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const deployId = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

    const versionPayload = {
      deploy_version: deployId,
      timestamp: Date.now(),
      last_deploy: now.toISOString()
    };

    const allRepos = [__dirname, ...otherRepos];

    // Write version.json to all repos
    allRepos.forEach(rDir => {
      try {
        fs.writeFileSync(path.join(rDir, 'version.json'), JSON.stringify(versionPayload, null, 2), 'utf8');
      } catch(_) {}
    });

    // Update cache busters & deploy version in each portal's dedicated index.html
    allRepos.forEach(rDir => {
      const idxPath = path.join(rDir, 'index.html');
      if (fs.existsSync(idxPath)) {
        try {
          let html = fs.readFileSync(idxPath, 'utf8');
          html = html.replace(/app\.js\?v=[^'"]+/g, `app.js?v=${deployId}`);
          html = html.replace(/styles\.css\?v=[^'"]+/g, `styles.css?v=${deployId}`);
          html = html.replace(/symbols_master\.js\?v=[^'"]+/g, `symbols_master.js?v=${deployId}`);
          html = html.replace(/master_directory\.js\?v=[^'"]+/g, `master_directory.js?v=${deployId}`);
          html = html.replace(/window\.PORTAL_DEPLOY_VERSION\s*=\s*["'][^"']+["']/g, `window.PORTAL_DEPLOY_VERSION = "${deployId}"`);
          fs.writeFileSync(idxPath, html, 'utf8');
        } catch(_) {}
      }
    });

    // Copy shared files (preserving dedicated index.html)
    const syncFiles = ['portal_users.json', 'portal_settings.json', 'app.js', 'styles.css', 'master_directory.js', 'symbols_master.js', 'version.json', 'Code.gs', 'candidates_seed.csv'];
    otherRepos.forEach(rDir => {
      syncFiles.forEach(f => {
        const s = path.join(__dirname, f);
        const d = path.join(rDir, f);
        if (fs.existsSync(s)) {
          try { fs.copyFileSync(s, d); } catch(_) {}
        }
      });
    });

    // 2. Commit and push on all repositories without clash using git add -A
    let completed = 0;

    allRepos.forEach(rDir => {
      const rName = path.basename(rDir);
      const cmd = `${gitExe} add -A && (${gitExe} diff --staged --quiet || ${gitExe} commit -m "${commitMsg}") && ${gitExe} pull --rebase origin main && ${gitExe} push origin main`;
      
      exec(cmd, { cwd: rDir }, (gErr, gStdout, gStderr) => {
        completed++;
        if (gErr) {
          if ((gStderr && gStderr.includes('nothing to commit')) || (gStdout && gStdout.includes('nothing to commit'))) {
            console.log(`[AUTO-SYNC] ${rName} already in sync.`);
          } else {
            console.warn(`[AUTO-SYNC] Push notice for ${rName}:`, gErr.message);
          }
        } else {
          console.log(`[AUTO-SYNC] Push SUCCESS! ${rName} is now LIVE on GitHub!`);
        }

        if (completed === allRepos.length) {
          isPushing = false;
          if (callback) callback(null, 'Tri-Repo sync complete');
        }
      });
    });
  };

  let deployScript = 'c:\\Users\\jiten\\OneDrive\\Desktop\\New folder\\sync_and_deploy.py';
  if (!fs.existsSync(deployScript)) deployScript = path.join(path.dirname(__dirname), 'deploy_tri_portals.py');
  if (!fs.existsSync(deployScript)) deployScript = path.join(__dirname, 'deploy_tri_portals.py');
  if (!fs.existsSync(deployScript)) deployScript = 'C:\\Users\\jiten\\Desktop\\panchayat chunav\\deploy_tri_portals.py';
  if (!fs.existsSync(deployScript)) deployScript = 'C:\\Users\\jiten\\Desktop\\panchyt order\\deploy_tri_portals.py';

  if (fs.existsSync(deployScript)) {
    console.log(`[AUTO-SYNC] Running deployment script: python "${deployScript}" ...`);
    exec(`python "${deployScript}"`, { cwd: path.dirname(deployScript) }, (error, stdout, stderr) => {
      if (error) {
        console.warn('[AUTO-SYNC] Python deploy failed. Falling back to direct Git push...');
        runDirectGitPush();
      } else {
        isPushing = false;
        console.log('[AUTO-SYNC] Push SUCCESS via deploy script!');
        if (callback) callback(null, stdout);
      }
    });
  } else {
    runDirectGitPush();
  }
}

// =========================================================================
// GOOGLE SHEET CANDIDATE SYNC ENGINE (HOURLY AUTO-UPDATE & REALTIME CONTROL)
// =========================================================================
let isCandidateSyncing = false;
let lastCandidateSyncTime = null;

function getAppsScriptUrl() {
  let url = process.env.APPS_SCRIPT_URL || '';
  if (!url) {
    try {
      const spData = JSON.parse(fs.readFileSync(path.join(__dirname, 'portal_settings.json'), 'utf8'));
      url = spData.google_sheet_sync?.apps_script_url || spData.apps_script_url || '';
    } catch(_) {}
  }
  if (!url) {
    url = 'https://script.google.com/macros/s/AKfycbzhZ-VdcGJ_nUuG40vm-MyMNJEnLfTgk3kBqyhi1OIefCgW9Smw0XweLTUd7D6o710lpA/exec';
  }
  return url;
}

async function syncCandidatesFromGoogleSheet(isManual = false) {
  if (isCandidateSyncing) {
    console.log('[GOOGLE-SHEET-SYNC] Sync already running in background, skipping.');
    return { success: false, message: 'Sync already in progress' };
  }
  const url = getAppsScriptUrl();
  if (!url) {
    console.log('[GOOGLE-SHEET-SYNC] Apps Script URL not configured.');
    return { success: false, message: 'Apps Script URL not configured' };
  }

  isCandidateSyncing = true;
  console.log(`[GOOGLE-SHEET-SYNC] ${isManual ? 'Manual' : 'Hourly'} checking Google Sheet for candidate changes...`);

  try {
    const fetchUrl = `${url}${url.includes('?') ? '&' : '?'}action=getCandidates&_t=${Date.now()}`;
    const res = await fetch(fetchUrl, {
      redirect: 'follow',
      headers: { 'Cache-Control': 'no-cache' }
    });
    if (!res.ok) {
      throw new Error(`HTTP error ${res.status}: ${res.statusText}`);
    }
    const data = await res.json();
    if (!data || !data.success || !Array.isArray(data.candidates)) {
      throw new Error(data?.error || 'Invalid candidates data returned from Google Sheet');
    }

    const sheetCandidates = data.candidates;
    console.log(`[GOOGLE-SHEET-SYNC] Fetched ${sheetCandidates.length} candidate rows from Google Sheet.`);

    // Fetch existing candidate users from SQLite (preserving all other user roles!)
    const currentUsers = db.prepare(`
      SELECT * FROM users 
      WHERE (role = 'CANDIDATE' OR role = 'प्रत्याशी' OR id LIKE 'cand_%' OR username = 'sarpanch' OR username = 'b')
        AND role != 'SUPER_ADMIN' AND role != 'BLO'
        AND role NOT LIKE '%बी.एल.ओ%' AND role NOT LIKE '%प्रकोष्ठ%'
        AND id NOT LIKE 'cell_%' AND username NOT IN ('admin', 'incharge', 'vyavasthapak', 'block_prabhari')
    `).all();

    const currentUserMap = new Map();
    currentUsers.forEach(u => {
      currentUserMap.set(String(u.id).toLowerCase(), u);
      currentUserMap.set(String(u.username).toLowerCase(), u);
      currentUserMap.set(String(u.id).toLowerCase().replace(/^cand_/i, ''), u);
    });

    const currentCandProfiles = db.prepare('SELECT * FROM candidates').all();
    const currentCandMap = new Map();
    currentCandProfiles.forEach(c => {
      currentCandMap.set(String(c.user_id).toLowerCase(), c);
      currentCandMap.set(String(c.user_id).toLowerCase().replace(/^cand_/i, ''), c);
    });

    const upsertUser = db.prepare(`
      INSERT OR REPLACE INTO users (
        id, username, password, full_name, mobile, role, status,
        allowed_panchayats, allowed_wards, allowed_tabs, candidate_mode,
        can_print, can_download, can_search, can_view, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 1, 1, ?, ?)
    `);

    const upsertCand = db.prepare(`
      INSERT OR REPLACE INTO candidates (
        user_id, candidate_name, post, panchayat, ward, symbol_name, symbol_icon,
        custom_symbol_url, photo_url, slogan, election_date, election_time,
        mobile, show_banner_on_slip, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const deleteUserStmt = db.prepare('DELETE FROM users WHERE id = ? OR username = ?');
    const deleteCandStmt = db.prepare('DELETE FROM candidates WHERE user_id = ?');

    let addedCount = 0;
    let updatedCount = 0;
    let deletedCount = 0;
    let hasChanges = false;

    const sheetUsernames = new Set();
    const sheetIds = new Set();

    db.exec('BEGIN TRANSACTION;');
    try {
      // 1. Upsert all candidate rows from Google Sheet
      for (const sc of sheetCandidates) {
        const uId = (sc.id || ('cand_' + sc.username)).trim();
        const username = (sc.username || sc.raw_id || uId.replace(/^cand_/i, '')).trim();
        const altId = uId.startsWith('cand_') ? uId.replace('cand_', '') : ('cand_' + uId);

        sheetUsernames.add(username.toLowerCase());
        sheetIds.add(uId.toLowerCase());
        sheetIds.add(altId.toLowerCase());

        const existingUser = currentUserMap.get(username.toLowerCase()) || currentUserMap.get(uId.toLowerCase());
        const existingCand = currentCandMap.get(username.toLowerCase()) || currentCandMap.get(uId.toLowerCase());

        const candName = sc.candidate_name || sc.full_name || sc.name || username;
        const password = sc.password || existingUser?.password || 'cand@2026';
        const mobile = sc.mobile || '';
        const post = sc.post || 'सरपंच';
        const gp = sc.panchayat || sc.allowed_panchayats || '';
        const ward = sc.ward || sc.allowed_wards || 'ALL';
        const symName = sc.symbol_name || 'उगता सूरज';
        const symIcon = sc.symbol_icon || (sc.custom_symbol_url ? 'custom' : 'sun');
        const customSym = sc.custom_symbol_url || '';
        const photo = sc.photo_url || '';
        const slogan = sc.slogan || '';
        const eDate = sc.election_date || '15 अक्टूबर 2026';
        const eTime = sc.election_time || 'प्रातः 7:00 बजे से सायं 6:00 बजे तक';
        const status = (sc.status || 'ACTIVE').toUpperCase();
        const showBanner = sc.show_banner_on_slip !== false ? 1 : 0;
        const now = new Date().toISOString();

        let isDiff = false;
        if (!existingUser) {
          isDiff = true;
          addedCount++;
        } else if (
          existingUser.password !== password ||
          existingUser.full_name !== candName ||
          existingUser.mobile !== mobile ||
          existingUser.allowed_panchayats !== gp ||
          existingUser.allowed_wards !== ward ||
          existingUser.status !== status ||
          !existingCand ||
          existingCand.candidate_name !== candName ||
          existingCand.post !== post ||
          existingCand.symbol_name !== symName ||
          existingCand.symbol_icon !== symIcon ||
          existingCand.custom_symbol_url !== customSym ||
          existingCand.photo_url !== photo ||
          existingCand.slogan !== slogan ||
          existingCand.election_date !== eDate ||
          existingCand.election_time !== eTime ||
          existingCand.show_banner_on_slip !== showBanner
        ) {
          isDiff = true;
          updatedCount++;
        }

        if (isDiff) {
          hasChanges = true;
          const allowedTabsJson = JSON.stringify(['searchTab', 'alphaTab', 'bulkSlipTab', 'candidateProfileTab']);
          const createdAt = existingUser?.created_at || now;

          upsertUser.run(uId, username, password, candName, mobile, 'CANDIDATE', status, gp, ward, allowedTabsJson, 'user_edit', createdAt, now);
          upsertCand.run(uId, candName, post, gp, ward, symName, symIcon, customSym, photo, slogan, eDate, eTime, mobile, showBanner, now);
          upsertCand.run(altId, candName, post, gp, ward, symName, symIcon, customSym, photo, slogan, eDate, eTime, mobile, showBanner, now);
        }
      }

      // 2. Remove candidates deleted from Google Sheet
      for (const u of currentUsers) {
        const uLower = String(u.username || '').toLowerCase();
        const idLower = String(u.id || '').toLowerCase();
        const altLower = idLower.replace(/^cand_/i, '');

        if (!sheetUsernames.has(uLower) && !sheetIds.has(idLower) && !sheetIds.has(altLower)) {
          console.log(`[GOOGLE-SHEET-SYNC] Removing candidate '${u.username}' (deleted from Google Sheet).`);
          deleteUserStmt.run(u.id, u.username);
          deleteCandStmt.run(u.id);
          deleteCandStmt.run(altLower);
          deleteCandStmt.run('cand_' + altLower);
          deletedCount++;
          hasChanges = true;
        }
      }

      db.exec('COMMIT;');
    } catch (txErr) {
      db.exec('ROLLBACK;');
      throw txErr;
    }

    lastCandidateSyncTime = new Date().toISOString();

    if (hasChanges) {
      console.log(`[GOOGLE-SHEET-SYNC] ✅ Candidate Sync Complete! (+Added: ${addedCount}, ~Updated: ${updatedCount}, -Deleted: ${deletedCount})`);
      exportToJson();
      scheduleGitPush(`Candidate Google Sheet Sync (+Added: ${addedCount}, ~Updated: ${updatedCount}, -Deleted: ${deletedCount})`);
    } else {
      console.log('[GOOGLE-SHEET-SYNC] ✨ All candidates are in perfect sync with Google Sheet. No updates needed.');
    }

    return {
      success: true,
      hasChanges,
      added: addedCount,
      updated: updatedCount,
      deleted: deletedCount,
      total: sheetCandidates.length,
      lastSync: lastCandidateSyncTime
    };
  } catch (err) {
    console.error('[GOOGLE-SHEET-SYNC] Notice:', err.message);
    return { success: false, error: err.message };
  } finally {
    isCandidateSyncing = false;
  }
}

const server = http.createServer(async (req, res) => {
  // CORS & Cache Busting Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // =========================================================================
  // API ENDPOINTS
  // =========================================================================
  if (pathname.startsWith('/api/')) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    // Version & Heartbeat Endpoint (For Instant Live Permission Sync across tabs)
        // Server Graceful Restart Endpoint
    if (pathname === '/api/restart-server' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, message: 'Server restarting...' }));
      setTimeout(() => { process.exit(0); }, 400);
      return;
    }

    if (pathname === '/api/version' && req.method === 'GET') {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
      res.end(JSON.stringify({
        success: true,
        version: Date.now(),
        users_count: db.prepare('SELECT COUNT(*) AS c FROM users').get().c
      }));
      return;
    }

    // Password Change Endpoint (Self BLO or User password reset)
    if (pathname === '/api/change-password' && req.method === 'POST') {
      try {
        const { username, currentPassword, newPassword } = await parseJsonBody(req);
        if (!username || !newPassword) {
          res.writeHead(400);
          res.end(JSON.stringify({ success: false, error: 'यूजरनेम एवं नया पासवर्ड आवश्यक हैं।' }));
          return;
        }

        const user = db.prepare('SELECT * FROM users WHERE LOWER(username) = LOWER(?) OR id = ?').get(username.trim(), username.trim());
        if (!user) {
          res.writeHead(404);
          res.end(JSON.stringify({ success: false, error: 'उपयोगकर्ता नहीं मिला।' }));
          return;
        }

        if (currentPassword && user.password !== currentPassword.trim()) {
          res.writeHead(401);
          res.end(JSON.stringify({ success: false, error: 'वर्तमान पासवर्ड गलत है!' }));
          return;
        }

        db.prepare('UPDATE users SET password = ?, updated_at = ? WHERE id = ?').run(newPassword.trim(), new Date().toISOString(), user.id);
        exportToJson();
        res.end(JSON.stringify({ success: true, message: 'पासवर्ड सफलतापूर्वक बदल दिया गया!' }));
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
      return;
    }

    // Multi-Portal Settings & Master Sync Endpoints
    if (pathname === '/api/portal-settings' && req.method === 'GET') {
      const p = path.join(__dirname, 'portal_settings.json');
      if (fs.existsSync(p)) {
        res.end(fs.readFileSync(p, 'utf8'));
      } else {
        res.end(JSON.stringify({ error: 'Settings not found' }));
      }
      return;
    }

    if (pathname === '/api/portal-settings' && req.method === 'POST') {
      try {
        const data = await parseJsonBody(req);
        const p = path.join(__dirname, 'portal_settings.json');
        fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
        try { exportToJson(); } catch(_) {}
        scheduleAutoPushToGithub('portal_settings');
        res.end(JSON.stringify({ success: true, settings: data, auto_push_scheduled: true }));
      } catch(e) {
        res.writeHead(500);
        res.end(JSON.stringify({ success: false, error: e.message }));
      }
      return;
    }

    // Explicit manual push endpoint
    if ((pathname === '/api/push-to-github' || pathname === '/api/sync-all-portals') && req.method === 'POST') {
      executeGithubPush('api_manual', (err, output) => {
        if (err) {
          res.writeHead(500);
          res.end(JSON.stringify({ success: false, error: err.message }));
        } else {
          res.end(JSON.stringify({ success: true, message: 'तीनों पोर्टल्स (pan, blo-portal, voter-portal) गिटहब पर लाइव हो गए!', output }));
        }
      });
      return;
    }

    // Fetch Remote Settings from GitHub Endpoint
    if (pathname === '/api/fetch-remote-settings' && req.method === 'POST') {
      const { exec } = require('node:child_process');
      const gitBin = 'C:\\Users\\jiten\\AppData\\Local\\GitHubDesktop\\app-3.6.7\\resources\\app\\git\\cmd\\git.exe';
      exec(`"${gitBin}" fetch origin main && "${gitBin}" pull --rebase origin main`, { cwd: __dirname }, (error, stdout, stderr) => {
        try {
          seedDatabase();
          res.end(JSON.stringify({ 
            success: true, 
            message: 'रिमोट सेटिंग्स (GitHub) से सफलतापूर्वक फेच व लागू कर दी गईं!',
            output: stdout || stderr 
          }));
        } catch(e) {
          res.writeHead(500);
          res.end(JSON.stringify({ success: false, error: e.message }));
        }
      });
      return;
    }

    // Master Directory API Endpoint
    // Directory Update Endpoint
    if (pathname === '/api/directory/update' && req.method === 'POST') {
      try {
        const editData = await parseJsonBody(req);
        const dirPath = path.join(__dirname, 'master_directory.json');
        if (fs.existsSync(dirPath)) {
          const dirData = JSON.parse(fs.readFileSync(dirPath, 'utf8'));
          let updated = false;
          if (dirData.all_contacts) {
            const item = dirData.all_contacts.find(c => c.id === editData.id);
            if (item) { Object.assign(item, editData); updated = true; }
          }
          for (const listKey of ['patwari_list', 'supervisors_list', 'blo_list', 'peeo_list', 'male_staff_list', 'cell_personnel', 'officers_list']) {
            if (dirData[listKey]) {
              const item = dirData[listKey].find(c => c.id === editData.id);
              if (item) { Object.assign(item, editData); updated = true; }
            }
          }
          if (updated) {
            fs.writeFileSync(dirPath, JSON.stringify(dirData, null, 2), 'utf8');
            const jsPath = path.join(__dirname, 'master_directory.js');
            const jsContent = `// Master Directory Data for Panchayat Election 2026\nconst MASTER_DIRECTORY = ${JSON.stringify(dirData)};\nif (typeof module !== 'undefined' && module.exports) { module.exports = MASTER_DIRECTORY; }\n`;
              fs.writeFileSync(jsPath, jsContent, "utf8");
          }
          res.end(JSON.stringify({ success: true, updated }));
        } else {
          res.end(JSON.stringify({ success: false, error: 'Directory file not found' }));
        }
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
      return;
    }

    if (pathname === '/api/directory' && req.method === 'GET') {
      const dirPath = path.join(__dirname, 'master_directory.json');
      if (fs.existsSync(dirPath)) {
        res.end(fs.readFileSync(dirPath, 'utf8'));
      } else {
        res.end(JSON.stringify({ error: 'Directory not found' }));
      }
      return;
    }
    if (pathname === '/api/health' && req.method === 'GET') {
      const count = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
      res.end(JSON.stringify({ status: 'ok', server: 'Node-SQLite-Panchayat', user_count: count, time: new Date() }));
      return;
    }

    // Login Endpoint (Strict: ID + Password only)
    if (pathname === '/api/login' && req.method === 'POST') {
      try {
        const { username, password } = await parseJsonBody(req);
        if (!username || !password) {
          res.writeHead(400);
          res.end(JSON.stringify({ success: false, error: 'यूजरनेम एवं पासवर्ड आवश्यक हैं।' }));
          return;
        }

                let user = db.prepare('SELECT * FROM users WHERE LOWER(username) = LOWER(?)').get(username.trim());
        
        // If not in DB, check master_directory.json for BLOs and Cell members
        if (!user) {
          try {
            const dirPath = path.join(__dirname, 'master_directory.json');
            if (fs.existsSync(dirPath)) {
              const dirData = JSON.parse(fs.readFileSync(dirPath, 'utf8'));
              const uname = username.trim().toLowerCase();
              
              // 1. Check BLO list
              const bloMatch = (dirData.blo_list || []).find(b => 
                (b.username && b.username.toLowerCase() === uname) || 
                (b.id && b.id.toLowerCase() === uname) ||
                (`blo_${b.booth_no}`.toLowerCase() === uname) ||
                (String(b.booth_no) === uname)
              );
              
              if (bloMatch) {
                user = {
                  id: bloMatch.id || `blo_${bloMatch.booth_no}`,
                  username: bloMatch.username || `blo_${bloMatch.booth_no}`,
                  password: bloMatch.password || '123',
                  full_name: `${bloMatch.name} (BLO भाग ${bloMatch.booth_no})`,
                  mobile: bloMatch.mobile || '',
                  role: 'BLO',
                  status: 'ACTIVE',
                  allowed_panchayats: JSON.stringify([bloMatch.panchayat]),
                  allowed_wards: bloMatch.wards ? JSON.stringify(bloMatch.wards.split(',').map(w => w.trim())) : 'ALL',
                  allowed_tabs: JSON.stringify(['searchTab']),
                  candidate_mode: 'admin_locked',
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString()
                };
                // Cache into SQLite
                try {
                  db.prepare(`INSERT OR REPLACE INTO users (id, username, password, full_name, mobile, role, status, allowed_panchayats, allowed_wards, allowed_tabs, candidate_mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
                    user.id, user.username, user.password, user.full_name, user.mobile, user.role, user.status, user.allowed_panchayats, user.allowed_wards, user.allowed_tabs, user.candidate_mode, user.created_at, user.updated_at
                  );
                } catch(e) {}
              }
              
              // 2. Check Cell Personnel list
              if (!user) {
                const cellMatch = (dirData.cell_personnel || []).find(c => 
                  (c.username && c.username.toLowerCase() === uname) || 
                  (c.id && c.id.toLowerCase() === uname)
                );
                if (cellMatch) {
                  user = {
                    id: cellMatch.id,
                    username: cellMatch.username || cellMatch.id,
                    password: cellMatch.password || '123',
                    full_name: `${cellMatch.name} (${cellMatch.cell_name})`,
                    mobile: cellMatch.mobile || '',
                    role: 'CELL_MEMBER',
                    status: 'ACTIVE',
                    allowed_panchayats: 'ALL',
                    allowed_wards: 'ALL',
                    allowed_tabs: JSON.stringify(['searchTab']),
                    candidate_mode: 'admin_locked',
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                  };
                  try {
                    db.prepare(`INSERT OR REPLACE INTO users (id, username, password, full_name, mobile, role, status, allowed_panchayats, allowed_wards, allowed_tabs, candidate_mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
                      user.id, user.username, user.password, user.full_name, user.mobile, user.role, user.status, user.allowed_panchayats, user.allowed_wards, user.allowed_tabs, user.candidate_mode, user.created_at, user.updated_at
                    );
                  } catch(e) {}
                }
              }
            }
          } catch(e) {
            console.error('Directory lookup error:', e);
          }
        }

        if (!user || (user.password !== password.trim() && user.password.toLowerCase() !== password.trim().toLowerCase())) {
          res.writeHead(401);
          res.end(JSON.stringify({ success: false, error: 'अमान्य यूजर आईडी अथवा पासवर्ड!' }));
          return;
        }

        if (user.status && user.status.toUpperCase() !== 'ACTIVE') {
          res.writeHead(403);
          res.end(JSON.stringify({ success: false, error: 'यह खाता निष्क्रिय (Deactive) कर दिया गया है। एडमिन से संपर्क करें।' }));
          return;
        }

        const candidate = db.prepare('SELECT * FROM candidates WHERE user_id = ?').get(user.id) || null;
        let allowed_tabs = [];
        try { allowed_tabs = JSON.parse(user.allowed_tabs); } catch(e) { allowed_tabs = ['searchTab']; }

        res.end(JSON.stringify({
          success: true,
          user: {
            ...user,
            allowed_tabs
          },
          candidate
        }));
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
      return;
    }

    // Get All Users (Admin)
    if (pathname === '/api/users' && req.method === 'GET') {
      try {
        const users = db.prepare('SELECT * FROM users ORDER BY created_at DESC').all().map(u => ({
          ...u,
          allowed_tabs: (() => { try { return JSON.parse(u.allowed_tabs); } catch(e) { return []; } })()
        }));
        const candidates = db.prepare('SELECT * FROM candidates').all();
        const candMap = {};
        candidates.forEach(c => candMap[c.user_id] = c);

        const merged = users.map(u => ({
          ...u,
          candidate: candMap[u.id] || candMap[u.username] || null
        }));

        let spDate = '15 अक्टूबर 2026', spTime = 'प्रातः 7:00 बजे से सायं 6:00 बजे तक';
        try {
          const spData = JSON.parse(fs.readFileSync(path.join(__dirname, 'portal_settings.json'), 'utf8'));
          spDate = spData.voter_portal?.election_date || spData.election_date || spDate;
          spTime = spData.voter_portal?.election_time || spData.election_time || spTime;
        } catch(_) {}
        res.end(JSON.stringify({ success: true, users: merged, candidates: candMap, election_date: spDate, election_time: spTime }));
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
      return;
    }

    // Add or Update User
    if (pathname === '/api/users' && req.method === 'POST') {
      try {
        const u = await parseJsonBody(req);
        if (!u.username) {
          res.writeHead(400);
          res.end(JSON.stringify({ success: false, error: 'यूजरनेम अनिवार्य है।' }));
          return;
        }

        const toStr = (val, def = '') => {
          if (val === null || val === undefined) return def;
          if (typeof val === 'object') return JSON.stringify(val);
          return String(val);
        };

        const userId = toStr(u.id || u.username).trim().toLowerCase().replace(/\s+/g, '_');
        const usernameStr = toStr(u.username).trim();
        let parsedTabs = Array.isArray(u.allowed_tabs)
          ? u.allowed_tabs
          : (typeof u.allowed_tabs === 'string' ? (()=>{ try { return JSON.parse(u.allowed_tabs); } catch(e) { return ['searchTab']; } })() : ['searchTab']);
        const isCandUser = (u.role === 'CANDIDATE' || u.role === 'प्रत्याशी' || userId.startsWith('cand_') || usernameStr === 'sarpanch') && u.role !== 'SUPER_ADMIN' && u.role !== 'BLO' && !String(u.role).includes('बी.एल.ओ') && !String(u.role).includes('प्रकोष्ठ') && !userId.startsWith('cell_') && !userId.startsWith('blo_');
        if (isCandUser && Array.isArray(parsedTabs)) {
          parsedTabs = parsedTabs.filter(t => t !== 'directoryTab');
        }
        const tabsJson = JSON.stringify(parsedTabs);

        const existing = db.prepare('SELECT * FROM users WHERE id = ? OR username = ?').get(userId, usernameStr);
        const passwordToUse = toStr((u.password && String(u.password).trim()) || (existing ? existing.password : '123'));

        const canPrintVal = (u.can_print !== undefined && u.can_print !== null) ? (u.can_print ? 1 : 0) : (existing && existing.can_print !== undefined ? existing.can_print : 1);
        const canDownloadVal = (u.can_download !== undefined && u.can_download !== null) ? (u.can_download ? 1 : 0) : (existing && existing.can_download !== undefined ? existing.can_download : 1);
        const canSearchVal = (u.can_search !== undefined && u.can_search !== null) ? (u.can_search ? 1 : 0) : (existing && existing.can_search !== undefined ? existing.can_search : 1);
        const canViewVal = (u.can_view !== undefined && u.can_view !== null) ? (u.can_view ? 1 : 0) : (existing && existing.can_view !== undefined ? existing.can_view : 1);

        if (existing) {
          db.prepare(`
            UPDATE users SET
              username = ?, password = ?, full_name = ?, mobile = ?, role = ?, status = ?,
              allowed_panchayats = ?, allowed_wards = ?, allowed_tabs = ?, candidate_mode = ?,
              can_print = ?, can_download = ?, can_search = ?, can_view = ?, updated_at = ?
            WHERE id = ?
          `).run(
            usernameStr,
            passwordToUse,
            toStr(u.full_name || u.fullName || existing.full_name || usernameStr),
            toStr((u.mobile !== undefined ? u.mobile : existing.mobile) || ''),
            toStr(u.role || existing.role || 'PANCHAYAT_AGENT'),
            toStr(u.status || existing.status || 'ACTIVE'),
            toStr(u.allowed_panchayats || u.panchayat || existing.allowed_panchayats || 'ALL'),
            toStr(u.allowed_wards || u.ward || existing.allowed_wards || 'ALL'),
            toStr(tabsJson),
            toStr(u.candidate_mode || existing.candidate_mode || 'user_edit'),
            canPrintVal,
            canDownloadVal,
            canSearchVal,
            canViewVal,
            new Date().toISOString(),
            existing.id
          );
        } else {
          db.prepare(`
            INSERT INTO users (id, username, password, full_name, mobile, role, status, allowed_panchayats, allowed_wards, allowed_tabs, candidate_mode, can_print, can_download, can_search, can_view, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            userId,
            usernameStr,
            toStr(u.password || '123'),
            toStr(u.full_name || u.fullName || usernameStr),
            toStr(u.mobile || ''),
            toStr(u.role || 'PANCHAYAT_AGENT'),
            toStr(u.status || 'ACTIVE'),
            toStr(u.allowed_panchayats || u.panchayat || 'ALL'),
            toStr(u.allowed_wards || u.ward || 'ALL'),
            toStr(tabsJson),
            toStr(u.candidate_mode || 'user_edit'),
            canPrintVal,
            canDownloadVal,
            canSearchVal,
            canViewVal,
            new Date().toISOString(),
            new Date().toISOString()
          );
        }

        // Atomically upsert candidate details if provided
        if (u.candidate && typeof u.candidate === 'object') {
          const c = u.candidate;
          const candId = existing ? existing.id : userId;
          const existCand = db.prepare('SELECT user_id FROM candidates WHERE user_id = ?').get(candId);
      if (existCand) {
        const customSymToSave = (c.custom_symbol_url !== undefined) ? c.custom_symbol_url : (existCand.custom_symbol_url || '');
        db.prepare(`
          UPDATE candidates SET
            candidate_name = ?, post = ?, panchayat = ?, ward = ?, symbol_name = ?, symbol_icon = ?,
            custom_symbol_url = ?, photo_url = ?, slogan = ?, election_time = ?, mobile = ?, show_banner_on_slip = ?, updated_at = ?
          WHERE user_id = ?
        `).run(
          c.candidate_name || u.full_name || '',
          c.post || 'सरपंच',
          c.panchayat || u.allowed_panchayats || '',
          c.ward || u.allowed_wards || '',
          c.symbol_name || 'उगता सूरज',
          c.symbol_icon || 'sun',
          customSymToSave,
          c.photo_url || '',
          c.slogan || '',
          c.election_time || 'प्रातः 7:00 बजे से सायं 6:00 बजे तक',
          c.mobile || u.mobile || '',
          c.show_banner_on_slip ? 1 : 0,
          new Date().toISOString(),
          candId
        );
      } else {
        db.prepare(`
          INSERT INTO candidates (user_id, candidate_name, post, panchayat, ward, symbol_name, symbol_icon, custom_symbol_url, photo_url, slogan, election_time, mobile, show_banner_on_slip, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          candId,
          c.candidate_name || u.full_name || '',
          c.post || 'सरपंच',
          c.panchayat || u.allowed_panchayats || '',
          c.ward || u.allowed_wards || '',
          c.symbol_name || 'उगता सूरज',
          c.symbol_icon || 'sun',
          c.custom_symbol_url || '',
          c.photo_url || '',
          c.slogan || '',
          c.election_time || 'प्रातः 7:00 बजे से सायं 6:00 बजे तक',
          c.mobile || u.mobile || '',
          c.show_banner_on_slip ? 1 : 0,
          new Date().toISOString()
        );
      }
        }

        exportToJson();
        res.end(JSON.stringify({ success: true, message: 'उपयोगकर्ता एवं प्रत्याशी विवरण सफलतापूर्वक सुरक्षित!' }));
      } catch (err) {
        console.error('Save user error:', err);
        res.writeHead(500);
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
      return;
    }

    // Delete User
    if (pathname.startsWith('/api/users/') && req.method === 'DELETE') {
      try {
        const idToDelete = decodeURIComponent(pathname.replace('/api/users/', ''));
        db.prepare('DELETE FROM users WHERE id = ? OR username = ?').run(idToDelete, idToDelete);
        db.prepare('DELETE FROM candidates WHERE user_id = ?').run(idToDelete);
        exportToJson();
        res.end(JSON.stringify({ success: true, message: 'उपयोगकर्ता हटाया गया।' }));
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
      return;
    }

    // Get / Save Candidate Profile (with bi-directional alias support: cand_xxx <-> xxx)
    if (pathname.startsWith('/api/candidate/')) {
      const uId = decodeURIComponent(pathname.replace('/api/candidate/', ''));
      const altId = uId.startsWith('cand_') ? uId.replace('cand_', '') : ('cand_' + uId);

      if (req.method === 'GET') {
        const cand = db.prepare('SELECT * FROM candidates WHERE user_id = ? OR user_id = ? ORDER BY updated_at DESC').get(uId, altId) || null;
        res.end(JSON.stringify({ success: true, candidate: cand }));
        return;
      }

      if (req.method === 'POST') {
        try {
          const c = await parseJsonBody(req);
          const now = new Date().toISOString();
          const candDate = (c.election_date || '').trim() || '15 अक्टूबर 2026';
          const candTime = (c.election_time || '').trim() || 'प्रातः 7:00 बजे से सायं 6:00 बजे तक';

          // Update both uId and altId in candidates table
          db.prepare(`
            UPDATE candidates SET
              candidate_name = ?, post = ?, panchayat = ?, ward = ?, symbol_name = ?, symbol_icon = ?,
              custom_symbol_url = ?, photo_url = ?, slogan = ?, election_date = ?, election_time = ?, mobile = ?, show_banner_on_slip = ?, updated_at = ?
            WHERE user_id = ? OR user_id = ?
          `).run(
            c.candidate_name || '',
            c.post || 'सरपंच',
            c.panchayat || '',
            c.ward || '',
            c.symbol_name || 'उगता सूरज',
            c.symbol_icon || 'sun',
            c.custom_symbol_url || '',
            c.photo_url || '',
            c.slogan || '',
            candDate,
            candTime,
            c.mobile || '',
            c.show_banner_on_slip ? 1 : 0,
            now,
            uId,
            altId
          );

          const insertCandidateStmt = db.prepare(`
            INSERT OR REPLACE INTO candidates (user_id, candidate_name, post, panchayat, ward, symbol_name, symbol_icon, custom_symbol_url, photo_url, slogan, election_date, election_time, mobile, show_banner_on_slip, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);

          // Ensure both uId and altId exist in candidates table with identical freshest data
          insertCandidateStmt.run(uId, c.candidate_name || '', c.post || 'सरपंच', c.panchayat || '', c.ward || '', c.symbol_name || 'उगता सूरज', c.symbol_icon || 'sun', c.custom_symbol_url || '', c.photo_url || '', c.slogan || '', candDate, candTime, c.mobile || '', c.show_banner_on_slip ? 1 : 0, now);
          insertCandidateStmt.run(altId, c.candidate_name || '', c.post || 'सरपंच', c.panchayat || '', c.ward || '', c.symbol_name || 'उगता सूरज', c.symbol_icon || 'sun', c.custom_symbol_url || '', c.photo_url || '', c.slogan || '', candDate, candTime, c.mobile || '', c.show_banner_on_slip ? 1 : 0, now);

          exportToJson();
          res.end(JSON.stringify({ success: true, message: 'प्रत्याशी प्रोफाइल सफलतापूर्वक सुरक्षित!' }));
        } catch (err) {
          res.writeHead(500);
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
        return;
      }
    }

    // Entire State Sync
    
    // Sync Candidates with Google Sheet
    if (pathname === '/api/sync-candidates') {
      try {
        const syncResult = await syncCandidatesFromGoogleSheet(true);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(syncResult));
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
      return;
    }
    if (pathname === '/api/state' && req.method === 'GET') {
      if (fs.existsSync(JSON_PATH)) {
        res.end(fs.readFileSync(JSON_PATH, 'utf8'));
      } else {
        exportToJson();
        res.end(fs.readFileSync(JSON_PATH, 'utf8'));
      }
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Endpoint not found' }));
    return;
  }

  // =========================================================================
  // =========================================================================
    // =========================================================================
  // =========================================================================
  // HIGH-SPEED STATIC FILE SERVING WITH GZIP COMPRESSION & ZERO-CACHE HOT RELOAD
  // =========================================================================
  const portalParam = (url.searchParams.get('portal') || '').toLowerCase();
  const voterRepoDir = path.resolve(__dirname, '..', 'voter-portal');
  const bloRepoDir = path.resolve(__dirname, '..', 'blo-portal');

  let safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
  const isVoterRoute = portalParam === 'voter' || pathname.startsWith('/voter');
  const isBloRoute = portalParam === 'blo' || pathname.startsWith('/blo');

  let filePath;
  if (isVoterRoute && (pathname === '/' || pathname === '/index.html' || pathname === '/voter' || pathname === '/voter/' || pathname === '/voter-portal' || pathname === '/voter-portal/')) {
    filePath = path.join(voterRepoDir, 'index.html');
  } else if (isBloRoute && (pathname === '/' || pathname === '/index.html' || pathname === '/blo' || pathname === '/blo/' || pathname === '/blo-portal' || pathname === '/blo-portal/')) {
    filePath = path.join(bloRepoDir, 'index.html');
  } else {
    if (safePath === '/' || safePath === '\\') safePath = '/index.html';
    filePath = path.join(__dirname, safePath);
    if (!fs.existsSync(filePath)) {
      filePath = path.join(__dirname, 'index.html');
    }
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  const acceptGzip = Boolean(req.headers['accept-encoding'] && req.headers['accept-encoding'].includes('gzip'));

  // DYNAMIC ZERO-CACHE FOR HTML: Injects live timestamp into every JS/CSS request so user NEVER needs hard refresh
  if (ext === '.html') {
    try {
      let html = fs.readFileSync(filePath, 'utf8');
      const liveTs = Date.now();
      html = html.replace(/(app\.js|styles\.css|master_directory\.js|symbols_master\.js)\?v=[^"'\s>]+/g, `$1?v=${liveTs}`);
      const rawBuffer = Buffer.from(html, 'utf8');
      const gzipBuffer = acceptGzip ? zlib.gzipSync(rawBuffer, { level: 6 }) : null;
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0',
        'Surrogate-Control': 'no-store',
        ...(gzipBuffer ? { 'Content-Encoding': 'gzip', 'Content-Length': gzipBuffer.length } : { 'Content-Length': rawBuffer.length })
      });
      res.end(gzipBuffer || rawBuffer);
      return;
    } catch (err) {
      res.writeHead(500);
      res.end('Error serving dynamic HTML: ' + err.message);
      return;
    }
  }

  const isHtmlOrJson = (ext === '.html' || ext === '.json');
  const isCompressible = ['.html', '.css', '.js', '.json', '.svg', '.txt'].includes(ext);

  try {
    const stat = fs.statSync(filePath);
    let cached = !isHtmlOrJson ? staticCache.get(filePath) : null;
    if (!cached || cached.mtimeMs !== stat.mtimeMs) {
      const rawBuffer = fs.readFileSync(filePath);
      const gzipBuffer = isCompressible ? zlib.gzipSync(rawBuffer, { level: 6 }) : null;
      cached = { rawBuffer, gzipBuffer, mtimeMs: stat.mtimeMs };
      if (!isHtmlOrJson && (ext === '.js' || ext === '.css')) {
        staticCache.set(filePath, cached);
      }
    }

    if (acceptGzip && cached.gzipBuffer) {
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Encoding': 'gzip',
        'Vary': 'Accept-Encoding',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Content-Length': cached.gzipBuffer.length
      });
      res.end(cached.gzipBuffer);
    } else {
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Content-Length': cached.rawBuffer.length
      });
      res.end(cached.rawBuffer);
    }
  } catch (e) {
    res.writeHead(500);
    res.end('Server Error: ' + e.message);
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`⚠️ Port ${PORT} already in use. Cleaning up lingering process on port ${PORT}...`);
    try {
      const { execSync } = require('node:child_process');
      const out = execSync(`netstat -ano | findstr :${PORT} | findstr LISTENING`, { encoding: 'utf8' });
      const lines = out.trim().split('\n');
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && pid !== '0' && pid !== String(process.pid)) {
          try { execSync(`taskkill /F /PID ${pid}`); } catch(_) {}
        }
      }
      setTimeout(() => {
        server.listen(PORT, () => {
          console.log(`🚀 Panchayat Chunav 2026 High-Speed Node & SQLite Server is LIVE on port ${PORT}!`);
          console.log(`📁 Local DB: ${DB_PATH}`);
          console.log(`🌐 URL: http://localhost:${PORT}`);

// =========================================================================
// CANDIDATE GOOGLE SHEET HOURLY RECURRING SYNC TIMER
// =========================================================================
const CANDIDATE_HOURLY_SYNC_MS = 60 * 60 * 1000; // 1 Hour

// Initial sync 3 seconds after server start
setTimeout(() => {
  syncCandidatesFromGoogleSheet(false).catch(e => console.warn('[GOOGLE-SHEET-SYNC] Initial sync notice:', e.message));
}, 3000);

// Recurring hourly sync
setInterval(() => {
  syncCandidatesFromGoogleSheet(false).catch(e => console.warn('[GOOGLE-SHEET-SYNC] Hourly sync notice:', e.message));
}, CANDIDATE_HOURLY_SYNC_MS);

console.log('⏰ Candidate Google Sheet hourly sync active (Interval: 1 Hour / 3600000ms)');

        });
      }, 800);
      return;
    } catch(e) {
      console.error(`Could not auto-kill port ${PORT}:`, e.message);
    }
  }
  console.error('Server error:', err);
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`🚀 Panchayat Chunav 2026 High-Speed Node & SQLite Server is LIVE on port ${PORT}!`);
  console.log(`📁 Local DB: ${DB_PATH}`);
  console.log(`🌐 URL: http://localhost:${PORT}`);
});

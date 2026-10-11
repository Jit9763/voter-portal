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
      const isCand = (u.role === 'CANDIDATE' || u.role === 'प्रत्याशी' || (u.id && String(u.id).startsWith('cand_')) || u.username === 'sarpanch' || u.candidate_mode === 'user_edit') && u.role !== 'SUPER_ADMIN';
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
    rawCandidates.forEach(c => {
      candidates[c.user_id] = {
        candidate_name: c.candidate_name,
        post: c.post,
        panchayat: c.panchayat,
        ward: c.ward,
        symbol_name: c.symbol_name,
        symbol_icon: c.symbol_icon,
        photo_url: c.photo_url,
        slogan: c.slogan,
        mobile: c.mobile,
        show_banner_on_slip: !!c.show_banner_on_slip,
        updated_at: c.updated_at
      };
    });

    const payload = {
      version: '2.0.0',
      last_updated: new Date().toISOString(),
      users,
      candidates
    };
    isInternalExport = true;
    fs.writeFileSync(JSON_PATH, JSON.stringify(payload, null, 2), 'utf8');
    setTimeout(() => { isInternalExport = false; }, 800);

    const altDir = __dirname.includes('panchyt order') 
      ? 'C:\\Users\\jiten\\Desktop\\panchayat chunav\\voter_portal'
      : 'C:\\Users\\jiten\\Desktop\\panchyt order\\voter_portal';
    if (fs.existsSync(altDir)) {
      try {
        fs.writeFileSync(path.join(altDir, 'portal_users.json'), JSON.stringify(payload, null, 2), 'utf8');
      } catch(e) {}
    }
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
    const gitPath = 'C:\\Users\\jiten\\AppData\\Local\\GitHubDesktop\\app-3.6.7\\resources\\app\\git\\cmd';
    const commitMsg = `Auto-sync settings & users from ${pcName} (${reason}) [${new Date().toISOString()}]`;

    // Tri-Repo Paths
    const otherRepos = [
      'C:\\Users\\jiten\\Documents\\GitHub\\blo-portal',
      'C:\\Users\\jiten\\Documents\\GitHub\\voter-portal'
    ];

    const syncFiles = ['portal_users.json', 'portal_settings.json', 'app.js'];

    // 1. Copy updated files to blo-portal and voter-portal
    otherRepos.forEach(rDir => {
      if (fs.existsSync(rDir)) {
        syncFiles.forEach(f => {
          const s = path.join(__dirname, f);
          const d = path.join(rDir, f);
          if (fs.existsSync(s)) {
            try { fs.copyFileSync(s, d); } catch(_) {}
          }
        });
      }
    });

    // 2. Commit and push on all 3 repositories without clash
    const allRepos = [__dirname, ...otherRepos.filter(d => fs.existsSync(d))];
    let completed = 0;

    allRepos.forEach(rDir => {
      const rName = path.basename(rDir);
      const cmd = `"${gitPath}\\git.exe" add portal_settings.json portal_users.json app.js index.html && ("${gitPath}\\git.exe" diff --staged --quiet || "${gitPath}\\git.exe" commit -m "${commitMsg}") && "${gitPath}\\git.exe" pull --rebase origin main && "${gitPath}\\git.exe" push origin main`;
      
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

  let deployScript = path.join(path.dirname(__dirname), 'deploy_tri_portals.py');
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
          candidate: candMap[u.id] || null
        }));

        res.end(JSON.stringify({ success: true, users: merged }));
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
        const isCandUser = (u.role === 'CANDIDATE' || u.role === 'प्रत्याशी' || userId.startsWith('cand_') || usernameStr === 'sarpanch' || u.candidate_mode === 'user_edit') && u.role !== 'SUPER_ADMIN';
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
            db.prepare(`
              UPDATE candidates SET
                candidate_name = ?, post = ?, panchayat = ?, ward = ?, symbol_name = ?, symbol_icon = ?,
                photo_url = ?, slogan = ?, election_time = ?, mobile = ?, show_banner_on_slip = ?, updated_at = ?
              WHERE user_id = ?
            `).run(
              c.candidate_name || u.full_name || '',
              c.post || 'सरपंच',
              c.panchayat || u.allowed_panchayats || '',
              c.ward || u.allowed_wards || '',
              c.symbol_name || 'उगता सूरज',
              c.symbol_icon || 'sun',
              c.photo_url || '',
              c.slogan || '',
              c.election_time || 'प्रातः 7:00 बजे से सायं 5:00 बजे तक',
              c.mobile || u.mobile || '',
              c.show_banner_on_slip ? 1 : 0,
              new Date().toISOString(),
              candId
            );
          } else {
            db.prepare(`
              INSERT INTO candidates (user_id, candidate_name, post, panchayat, ward, symbol_name, symbol_icon, photo_url, slogan, election_time, mobile, show_banner_on_slip, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              candId,
              c.candidate_name || u.full_name || '',
              c.post || 'सरपंच',
              c.panchayat || u.allowed_panchayats || '',
              c.ward || u.allowed_wards || '',
              c.symbol_name || 'उगता सूरज',
              c.symbol_icon || 'sun',
              c.photo_url || '',
              c.slogan || '',
              c.election_time || 'प्रातः 7:00 बजे से सायं 5:00 बजे तक',
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

    // Get / Save Candidate Profile
    if (pathname.startsWith('/api/candidate/')) {
      const uId = decodeURIComponent(pathname.replace('/api/candidate/', ''));
      if (req.method === 'GET') {
        const cand = db.prepare('SELECT * FROM candidates WHERE user_id = ?').get(uId) || null;
        res.end(JSON.stringify({ success: true, candidate: cand }));
        return;
      }

      if (req.method === 'POST') {
        try {
          const c = await parseJsonBody(req);
          const existing = db.prepare('SELECT user_id FROM candidates WHERE user_id = ?').get(uId);
          if (existing) {
            db.prepare(`
              UPDATE candidates SET
                candidate_name = ?, post = ?, panchayat = ?, ward = ?, symbol_name = ?, symbol_icon = ?,
                photo_url = ?, slogan = ?, election_time = ?, mobile = ?, show_banner_on_slip = ?, updated_at = ?
              WHERE user_id = ?
            `).run(
              c.candidate_name || '',
              c.post || 'सरपंच',
              c.panchayat || '',
              c.ward || '',
              c.symbol_name || 'उगता सूरज',
              c.symbol_icon || 'sun',
              c.photo_url || '',
              c.slogan || '',
              c.election_time || 'प्रातः 7:00 बजे से सायं 5:00 बजे तक',
              c.mobile || '',
              c.show_banner_on_slip ? 1 : 0,
              new Date().toISOString(),
              uId
            );
          } else {
            db.prepare(`
              INSERT INTO candidates (user_id, candidate_name, post, panchayat, ward, symbol_name, symbol_icon, photo_url, slogan, election_time, mobile, show_banner_on_slip, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              uId,
              c.candidate_name || '',
              c.post || 'सरपंच',
              c.panchayat || '',
              c.ward || '',
              c.symbol_name || 'उगता सूरज',
              c.symbol_icon || 'sun',
              c.photo_url || '',
              c.slogan || '',
              c.election_time || 'प्रातः 7:00 बजे से सायं 5:00 बजे तक',
              c.mobile || '',
              c.show_banner_on_slip ? 1 : 0,
              new Date().toISOString()
            );
          }

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
  // HIGH-SPEED STATIC FILE SERVING WITH GZIP COMPRESSION & MEMORY CACHE
  // =========================================================================
  let safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
  if (safePath === '/' || safePath === '\\') safePath = '/index.html';

  let filePath = path.join(__dirname, safePath);
  if (!fs.existsSync(filePath)) {
    filePath = path.join(__dirname, 'index.html');
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  const isHtmlOrJson = (ext === '.html' || ext === '.json');
  const acceptGzip = Boolean(req.headers['accept-encoding'] && req.headers['accept-encoding'].includes('gzip'));
  const isCompressible = ['.html', '.css', '.js', '.json', '.svg', '.txt'].includes(ext);

  try {
    let cached = !isHtmlOrJson ? staticCache.get(filePath) : null;
    if (!cached) {
      const rawBuffer = fs.readFileSync(filePath);
      const gzipBuffer = isCompressible ? zlib.gzipSync(rawBuffer, { level: 6 }) : null;
      cached = { rawBuffer, gzipBuffer };
      if (!isHtmlOrJson && (ext === '.js' || ext === '.css')) {
        staticCache.set(filePath, cached);
      }
    }

    if (acceptGzip && cached.gzipBuffer) {
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Encoding': 'gzip',
        'Vary': 'Accept-Encoding',
        'Cache-Control': isHtmlOrJson ? 'no-cache, must-revalidate' : 'public, max-age=3600',
        'Content-Length': cached.gzipBuffer.length
      });
      res.end(cached.gzipBuffer);
    } else {
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': isHtmlOrJson ? 'no-cache, must-revalidate' : 'public, max-age=3600',
        'Content-Length': cached.rawBuffer.length
      });
      res.end(cached.rawBuffer);
    }
  } catch (e) {
    res.writeHead(500);
    res.end('Server Error: ' + e.message);
  }
});

server.listen(PORT, () => {
  console.log(`🚀 Panchayat Chunav 2026 High-Speed Node & SQLite Server is LIVE on port ${PORT}!`);
  console.log(`📁 Local DB: ${DB_PATH}`);
  console.log(`🌐 URL: http://localhost:${PORT}`);
});

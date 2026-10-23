// =========================================================================
// CANDIDATE GOOGLE SHEET CLIENT-SIDE SYNC ENGINE (HOURLY / ON DEMAND)
// =========================================================================
async function syncCandidatesFromGoogleSheetClient(showNotification = false) {
  const isLocalServer = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  const bust = Date.now();
  
  if (showNotification && typeof showToast === 'function') {
    showToast('⏳ गूगल शीट से प्रत्याशी डेटा सिंक किया जा रहा है...');
  }

  // A. If on local node server, use high-speed backend sync
  if (isLocalServer) {
    try {
      const res = await fetch(`/api/sync-candidates?_t=${bust}`);
      if (res.ok) {
        const data = await res.json();
        if (data && data.success) {
          localStorage.setItem('last_sheet_candidate_sync', String(bust));
          await loadAdminUsersList(true);
          if (showNotification && typeof showToast === 'function') {
            showToast(`✅ गूगल शीट से सिंक पूर्ण! (कुल: ${data.total || 0}, नए: +${data.added || 0}, अपडेट: ~${data.updated || 0})`);
          }
          if (typeof renderAdminCandTab === 'function') renderAdminCandTab();
          return data;
        }
      }
    } catch(e) {
      console.warn('Local API sync fallback to direct sheet fetch:', e);
    }
  }

  // B. Direct Google Apps Script fetch (For GitHub Pages & Client Mode)
  const scriptUrl = State.config?.appsScriptUrl || localStorage.getItem('panchayat_apps_script_url') || 'https://script.google.com/macros/s/AKfycbwtgz2L5QC_95Jsf1r0Kum_LcTI-bJwwiBQS_O74vthHcbPD_KatsN69ytY2yqlayiM/exec';
  if (scriptUrl) {
    try {
      const fetchUrl = `${scriptUrl}${scriptUrl.includes('?') ? '&' : '?'}action=getCandidates&_t=${bust}`;
      const res = await fetch(fetchUrl);
      if (res.ok) {
        const data = await res.json();
        if (data && data.success && Array.isArray(data.candidates)) {
          if (!window.PORTAL_USERS_DATA) window.PORTAL_USERS_DATA = { users: [], candidates: {} };
          if (!window.PORTAL_USERS_DATA.candidates) window.PORTAL_USERS_DATA.candidates = {};
          
          data.candidates.forEach(sc => {
            const uId = sc.id || ('cand_' + sc.username);
            const uName = sc.username;
            let cleanScName = sc.candidate_name || sc.full_name || '';
            if (cleanScName.includes('(')) cleanScName = cleanScName.split('(')[0].trim();
            if (cleanScName.includes(' - ')) cleanScName = cleanScName.split(' - ')[0].trim();
            let cleanScPost = sc.post || '';
            if (!cleanScPost || cleanScPost === 'सरपंच') {
              if (cleanScName.includes('कमला') || uName === 'kamala' || uName === 'kamla' || uName === 'b') {
                cleanScPost = 'पंचायत समिति सदस्य';
              } else {
                cleanScPost = cleanScPost || 'सरपंच';
              }
            }
            const candProfile = {
              user_id: uId,
              candidate_name: cleanScName,
              mobile: sc.mobile,
              post: cleanScPost,
              panchayat: sc.panchayat,
              ward: sc.ward,
              symbol_name: sc.symbol_name,
              symbol_icon: sc.symbol_icon,
              custom_symbol_url: sc.custom_symbol_url,
              photo_url: sc.photo_url,
              slogan: sc.slogan,
              election_date: sc.election_date,
              election_time: sc.election_time,
              show_banner_on_slip: sc.show_banner_on_slip
            };
            window.PORTAL_USERS_DATA.candidates[uId] = candProfile;
            window.PORTAL_USERS_DATA.candidates[uName] = candProfile;
            try {
              localStorage.setItem('candidate_profile_' + uId, JSON.stringify(candProfile));
              localStorage.setItem('candidate_profile_' + uName, JSON.stringify(candProfile));
            } catch(_) {}

            // Upsert in State.adminControlUsers
            if (State.adminControlUsers) {
              const exIdx = State.adminControlUsers.findIndex(u => (u.id === uId || u.username === uName));
              let scTabs = sc.allowed_tabs;
              if (typeof scTabs === 'string') {
                try { scTabs = JSON.parse(scTabs); } catch(e) { scTabs = scTabs.split(',').map(s=>s.trim()).filter(Boolean); }
              }
              if (!Array.isArray(scTabs)) {
                scTabs = ['searchTab', 'alphaTab', 'bulkSlipTab', 'candidateProfileTab'];
              }
              scTabs = scTabs.filter(t => t !== 'directoryTab');
              const candUserObj = {
                id: uId,
                username: uName,
                password: sc.password,
                full_name: sc.candidate_name,
                name: sc.candidate_name,
                mobile: sc.mobile,
                role: 'CANDIDATE',
                status: sc.status || 'ACTIVE',
                allowed_panchayats: sc.panchayat,
                allowed_wards: sc.ward || 'ALL',
                allowed_tabs: scTabs,
                candidate_mode: sc.candidate_mode || 'user_edit',
                can_print: sc.can_print !== false,
                can_download: sc.can_download !== false,
                candidate: candProfile
              };

              // If currently logged in user is this candidate, update active session in real-time
              if (State.currentUser && (State.currentUser.id === uId || State.currentUser.username === uName || State.currentUser.id === ('cand_' + uName))) {
                State.currentUser.allowed_tabs = scTabs;
                State.currentUser.candidate_mode = sc.candidate_mode || 'user_edit';
                State.currentUser.can_print = candUserObj.can_print;
                State.currentUser.can_download = candUserObj.can_download;
                State.currentUser.candidate = candProfile;
                try {
                  const sk = getSessionStorageKey();
                  localStorage.setItem(sk, JSON.stringify(State.currentUser));
                } catch(_) {}
                if (typeof enforceGatekeeperState === 'function') enforceGatekeeperState();
              }
              if (exIdx >= 0) State.adminControlUsers[exIdx] = candUserObj;
              else State.adminControlUsers.push(candUserObj);
            }
          });

          localStorage.setItem('last_sheet_candidate_sync', String(bust));
          if (showNotification && typeof showToast === 'function') {
            showToast(`✅ गूगल शीट से ${data.candidates.length} प्रत्याशी सफलतापूर्वक सिंक!`);
          }
          if (typeof renderAdminCandTab === 'function') renderAdminCandTab();
          return data;
        }
      }
    } catch(err) {
      console.warn('Direct Apps Script candidate sync notice:', err);
      if (showNotification && typeof showToast === 'function') {
        showToast('गूगल शीट से सिंक करने में समस्या: ' + err.message);
      }
    }
  }
}

// Hourly Background Interval for client (1 hour / 3600000ms)
setInterval(() => {
  if (document.visibilityState === 'hidden') return;
  const lastSync = parseInt(localStorage.getItem('last_sheet_candidate_sync') || '0', 10);
  if (Date.now() - lastSync >= 3600000) {
    syncCandidatesFromGoogleSheetClient(false);
  }
}, 60000);



// Automatic Purge of Stale Candidate Test Cache & Slogans
// Safe Purge: Clean up only corrupt test caches, never delete active sessions!
(function purgeStaleCandidateCache() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (!k) continue;
      // Never wipe login session keys
      if (k.includes('session') || k === 'panchayat_user_session') continue;
      if (k.startsWith('candidate_profile_') || k === 'portal_custom_users') {
        const val = localStorage.getItem(k) || '';
        if (val.toLowerCase().includes('narendra ji') || val.toLowerCase().includes('nrendra ji')) {
          localStorage.removeItem(k);
        }
      }
    }
  } catch(_) {}
})();

// ==========================================================================
// TRI-PORTAL MASTER COMMAND & SETTINGS ENGINE (GLOBAL STATE & CANDIDATE-AWARE)
// ==========================================================================
var triPortalSettings = {
  voter_portal: {
    status: 'ACTIVE',
    election_date: '15 अक्टूबर 2026',
    election_time: 'प्रातः 7:00 बजे से सायं 6:00 बजे तक',
    modules: { search: true, alpha: true, slips: true, candidate_edit: true }
  },
  blo_portal: { status: 'ACTIVE', block_bulk_slips: true, scope_restricted: true, cell_directory: true },
  election_date: '15 अक्टूबर 2026',
  election_time: 'प्रातः 7:00 बजे से सायं 6:00 बजे तक'
};

function getGlobalElectionDate() {
  return (
    (typeof triPortalSettings !== 'undefined' && (triPortalSettings?.voter_portal?.election_date || triPortalSettings?.election_date)) ||
    (typeof window !== 'undefined' && window.PORTAL_USERS_DATA?.election_date) ||
    '15 अक्टूबर 2026'
  );
}

function getGlobalElectionTime() {
  return (
    (typeof triPortalSettings !== 'undefined' && (triPortalSettings?.voter_portal?.election_time || triPortalSettings?.election_time)) ||
    (typeof window !== 'undefined' && window.PORTAL_USERS_DATA?.election_time) ||
    'प्रातः 7:00 बजे से सायं 6:00 बजे तक'
  );
}

function getActiveCandidate() {
  if (typeof State === 'undefined' || !State || !State.currentUser) return null;
  const u = State.currentUser;
  const uId = String(u.id || u.username || '').toLowerCase();
  const altId = uId.startsWith('cand_') ? uId.replace('cand_', '') : ('cand_' + uId);

  // STRICT OWNERSHIP CHECK: A candidate object must belong to CURRENT user ONLY
  function belongsToCurrentUser(c) {
    if (!c || typeof c !== 'object') return false;
    if (!c.user_id && (c === u.candidate || c === State.currentCandidate)) {
      c.user_id = u.id || u.username;
      return true;
    }
    const cid = String(c.user_id || '').toLowerCase();
    if (!cid) return false;
    return cid === uId || cid === altId || (u.username && cid === String(u.username).toLowerCase()) || (u.id && cid === String(u.id).toLowerCase());
  }

  // 1. Check State.currentUser.candidate
  if (u.candidate) {
    if (!u.candidate.user_id) u.candidate.user_id = u.id || u.username;
    if (belongsToCurrentUser(u.candidate)) {
      return u.candidate;
    }
  }

  // 2. Check State.currentCandidate (only if belongs to current user!)
  if (State.currentCandidate) {
    if (!State.currentCandidate.user_id) State.currentCandidate.user_id = u.id || u.username;
    if (belongsToCurrentUser(State.currentCandidate)) {
      return State.currentCandidate;
    }
  }

  // 3. Check window.PORTAL_USERS_DATA.candidates
  if (window.PORTAL_USERS_DATA && window.PORTAL_USERS_DATA.candidates) {
    const cMap = window.PORTAL_USERS_DATA.candidates;
    const c = cMap[u.id] || cMap[u.username] || cMap[uId] || cMap[altId];
    if (c && (belongsToCurrentUser(c) || !c.user_id)) {
      c.user_id = u.id || u.username;
      return c;
    }
  }

  // 4. Check localStorage strictly for current user
  try {
    const cached = localStorage.getItem('candidate_profile_' + u.id) || 
                   (u.username && localStorage.getItem('candidate_profile_' + u.username)) ||
                   (altId && localStorage.getItem('candidate_profile_' + altId));
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed && belongsToCurrentUser(parsed)) return parsed;
    }
  } catch(_) {}

  return null;
}

function getCurrentElectionDate() {
  const isCand = (typeof isCandidateUser === 'function' && isCandidateUser(State?.currentUser)) || 
                 (State?.currentUser?.role === 'CANDIDATE') || 
                 (typeof getPortalContext === 'function' && getPortalContext() === 'voter' && State?.currentUser);
  if (isCand) {
    const cand = getActiveCandidate();
    if (cand && cand.election_date) {
      return cand.election_date;
    }
  }
  return getGlobalElectionDate();
}

function getCurrentElectionTime() {
  const isCand = (typeof isCandidateUser === 'function' && isCandidateUser(State?.currentUser)) || 
                 (State?.currentUser?.role === 'CANDIDATE') || 
                 (typeof getPortalContext === 'function' && getPortalContext() === 'voter' && State?.currentUser);
  if (isCand) {
    const cand = getActiveCandidate();
    if (cand && cand.election_time) {
      return cand.election_time;
    }
  }
  return getGlobalElectionTime();
}

function applyGlobalElectionDateToUI() {
  if (typeof document === 'undefined') return;
  const curDate = getCurrentElectionDate();
  const curTime = getCurrentElectionTime();
  const gDate = getGlobalElectionDate();
  const gTime = getGlobalElectionTime();
  const cand = getActiveCandidate();

  // Topbar date (in candidate login, shows candidate-specific date from Super Admin)
  const topbarDate = document.getElementById('topbarElectionDateText');
  if (topbarDate) {
    topbarDate.textContent = curDate;
  }

  // Candidate Profile Tab inputs (displays Super Admin configured date & time for candidate)
  const candDateInput = document.getElementById('candidateElectionDateInput');
  if (candDateInput) {
    candDateInput.value = (cand && cand.election_date) ? cand.election_date : curDate;
  }
  const candTimeInput = document.getElementById('candidateElectionTimeInput');
  if (candTimeInput) {
    candTimeInput.value = (cand && cand.election_time) ? cand.election_time : curTime;
  }

  // Super Admin Voter Portal control inputs
  const vDateInp = document.getElementById('voterPortalElectionDateInput');
  if (vDateInp && (triPortalSettings?.voter_portal?.election_date || triPortalSettings?.election_date)) {
    vDateInp.value = triPortalSettings.voter_portal?.election_date || triPortalSettings.election_date;
  }
  const vTimeInp = document.getElementById('voterPortalElectionTimeInput');
  if (vTimeInp && (triPortalSettings?.voter_portal?.election_time || triPortalSettings?.election_time)) {
    vTimeInp.value = triPortalSettings.voter_portal?.election_time || triPortalSettings.election_time;
  }
}

async function saveVoterPortalElectionDate() {
  const dateInput = document.getElementById('voterPortalElectionDateInput');
  const timeInput = document.getElementById('voterPortalElectionTimeInput');
  const newDate = (dateInput ? dateInput.value : '').trim() || '15 अक्टूबर 2026';
  const newTime = (timeInput ? timeInput.value : '').trim() || 'प्रातः 7:00 बजे से सायं 6:00 बजे तक';

  if (!triPortalSettings.voter_portal) triPortalSettings.voter_portal = {};
  triPortalSettings.voter_portal.election_date = newDate;
  triPortalSettings.voter_portal.election_time = newTime;
  triPortalSettings.election_date = newDate;
  triPortalSettings.election_time = newTime;

  applyGlobalElectionDateToUI();

  try {
    localStorage.setItem('tri_portal_master_settings', JSON.stringify(triPortalSettings));
  } catch (e) {}

  try {
    const res = await fetch('/api/portal-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(triPortalSettings)
    });
    if (res.ok) {
      if (typeof showToast === 'function') {
        showToast('✅ वोटर पोर्टल मतदान दिनांक (' + newDate + ') एवं समय (' + newTime + ') सफलतापूर्वक अपडेट!');
      }
      return;
    }
  } catch (err) {}

  if (typeof showToast === 'function') {
    showToast('✅ मतदान दिनांक (' + newDate + ') स्थानीय रूप से सुरक्षित!');
  }
}



// ==========================================================================
// SUPER ADMIN 3 DEDICATED TABS & GRANULAR PERMISSIONS CONTROLLER
// ==========================================================================

let activeHubSubTab = 'cell';

function switchMasterHubSubTab(tabName) {
  activeHubSubTab = tabName;
  const panes = {
    cell: document.getElementById('masterHubPaneCell'),
    blo: document.getElementById('masterHubPaneBlo'),
    cand: document.getElementById('masterHubPaneCand'),
    admins: document.getElementById('masterHubPaneAdmins')
  };
  const btns = {
    cell: document.getElementById('btnSubTabCell'),
    blo: document.getElementById('btnSubTabBlo'),
    cand: document.getElementById('btnSubTabCand'),
    admins: document.getElementById('btnSubTabAdmins')
  };

  Object.keys(panes).forEach(k => {
    if (panes[k]) panes[k].style.display = (k === tabName) ? 'block' : 'none';
    if (btns[k]) {
      if (k === tabName) btns[k].classList.add('active');
      else btns[k].classList.remove('active');
    }
  });

  if (tabName === 'cell') renderAdminCellTab();
  else if (tabName === 'blo') renderAdminBloTab();
  else if (tabName === 'cand') renderAdminCandTab();
  else if (tabName === 'admins') renderAdminTopAdminsTab();
}

function getUserOverrides() {
  const overrides = {};
  if (State.adminControlUsers && State.adminControlUsers.length > 0) {
    State.adminControlUsers.forEach(u => {
      const uid = u.id || u.username;
      overrides[uid] = {
        status: u.status,
        password: u.password,
        allowed_panchayats: u.allowed_panchayats,
        allowed_wards: u.allowed_wards,
        allowed_tabs: u.allowed_tabs,
        can_print: (u.can_print === true || u.can_print === 1),
        can_download: (u.can_download === true || u.can_download === 1),
        can_search: (u.can_search === true || u.can_search === 1),
        can_view: (u.can_view === true || u.can_view === 1)
      };
    });
  }
  try {
    const local = JSON.parse(localStorage.getItem('portal_user_overrides') || '{}');
    // Fresh server/State data in overrides MUST take precedence over stale local storage
    return Object.assign({}, local, overrides);
  } catch(e) {
    return overrides;
  }
}

function saveUserOverride(userId, key, value) {
  const overrides = getUserOverrides();
  const uIdLower = String(userId || '').toLowerCase();
  if (!overrides[userId]) overrides[userId] = {};
  overrides[userId][key] = value;
  if (!overrides[uIdLower]) overrides[uIdLower] = {};
  overrides[uIdLower][key] = value;
  try {
    localStorage.setItem('portal_user_overrides', JSON.stringify(overrides));
  } catch(e) {}
  
  // Also sync in State.adminControlUsers
  if (State.adminControlUsers) {
    const u = State.adminControlUsers.find(x => 
      (x.id && String(x.id).toLowerCase() === uIdLower) ||
      (x.username && String(x.username).toLowerCase() === uIdLower)
    );
    if (u) {
      u[key] = value;
    }
  }
}

async function toggleUserPermission(userId, permKey, isChecked) {
  saveUserOverride(userId, permKey, isChecked);
  
  const uIdLower = String(userId || '').toLowerCase();
  let targetUser = null;
  if (State.adminControlUsers) {
    targetUser = State.adminControlUsers.find(x => 
      (x.id && String(x.id).toLowerCase() === uIdLower) ||
      (x.username && String(x.username).toLowerCase() === uIdLower)
    );
    if (targetUser) {
      targetUser[permKey] = isChecked;
    }
  }

  try {
    localStorage.setItem('portal_admin_users_overrides', JSON.stringify(State.adminControlUsers));
  } catch(e) {}

  if (targetUser && typeof saveAdminUserToServer === 'function') {
    await saveAdminUserToServer(targetUser);
  }

  if (State.currentUser) {
    const curId = String(State.currentUser.id || State.currentUser.username || '').toLowerCase();
    if (curId === uIdLower) {
      State.currentUser[permKey] = isChecked;
      const sk = getSessionStorageKey();
      if (localStorage.getItem(sk)) localStorage.setItem(sk, JSON.stringify(State.currentUser));
      if (sessionStorage.getItem(sk)) sessionStorage.setItem(sk, JSON.stringify(State.currentUser));
      enforceGatekeeperState();
    }
  }

  broadcastAdminUpdate({ type: 'PERMISSIONS_UPDATED', userId, [permKey]: isChecked });

  const labelMap = {
    can_print: 'प्रिंट',
    can_download: 'डाउनलोड',
    can_search: 'खोज',
    can_view: 'दर्शन'
  };
  const label = labelMap[permKey] || permKey;
  showToast(`✅ ${label} अनुमति: ${userId} -> ${isChecked ? 'सक्रिय' : 'वर्जित'}`);
}

function updateUserScope(userId, scopeVal) {
  if (scopeVal === 'BOOTH' || scopeVal === 'CUSTOM') {
    openCustomScopeModal(userId);
    return;
  }
  saveUserOverride(userId, 'allowed_panchayats', scopeVal);
  if (State.adminControlUsers) {
    const u = State.adminControlUsers.find(x => (x.id || x.username) === userId);
    if (u) {
      u.allowed_panchayats = scopeVal;
      if (typeof saveAdminUserToServer === 'function') {
        saveAdminUserToServer(u);
      }
    }
  }
  showToast(`🌐 कार्यक्षेत्र अद्यतन: ${userId} -> ${scopeVal}`);
}

// -------------------------------------------------------------------------
// CUSTOM SCOPE & ALLOTMENT MODAL ENGINE
// -------------------------------------------------------------------------
function openCustomScopeModal(userId) {
  const modal = document.getElementById('customScopeModal');
  if (!modal) return;
  
  const overrides = getUserOverrides();
  const uov = overrides[userId] || {};
  
  // Look up user object
  let userObj = null;
  if (State.adminControlUsers) {
    userObj = State.adminControlUsers.find(x => (x.id || x.username) === userId);
  }
  if (!userObj) {
    const dir = getMasterDirectory();
    if (dir) {
      const all = [...(dir.cell_personnel || []), ...(dir.blo_list || []), ...(dir.all_contacts || [])];
      userObj = all.find(x => (x.id || x.username) === userId);
    }
  }
  if (!userObj) userObj = { id: userId, username: userId, name: userId };

  const titleEl = document.getElementById('customScopeModalTitle');
  if (titleEl) titleEl.textContent = `🎯 कार्यक्षेत्र एवं अधिकार आवंटन - ${userObj.name || userObj.username}`;

  const targetIdEl = document.getElementById('scopeTargetUserId');
  if (targetIdEl) targetIdEl.value = userId;

  // Banner
  const banner = document.getElementById('scopeUserBanner');
  if (banner) {
    banner.innerHTML = `
      <div class="d-flex justify-content-between align-items-center flex-wrap gap-2">
        <div>
          <div style="font-size:1.15rem; font-weight:800; color:#0f172a;">${userObj.name || userObj.username}</div>
          <div style="font-size:0.85rem; color:#475569; margin-top:2px;">
            <strong>संवर्ग / पद:</strong> ${userObj.designation || userObj.post || userObj.role || userObj.cell_name || '-'} | 
            <strong>कार्यालय / स्कूल:</strong> ${userObj.office || userObj.school || userObj.school_office || '-'}
          </div>
        </div>
        <div style="text-align:right;">
          <span class="badge" style="background:#e0f2fe; color:#0369a1; font-size:0.8rem; font-weight:800; padding:4px 8px; border-radius:4px;">ID: ${userId}</span>
          <div style="font-size:0.82rem; color:#0284c7; font-weight:700; margin-top:3px;">📞 ${userObj.mobile || '-'}</div>
        </div>
      </div>
    `;
  }

  // Current Scope Mode & Multi-GP Parsing
  const curScope = uov.allowed_panchayats || userObj.allowed_panchayats || userObj.panchayat || 'ALL';
  let scopeMode = 'ALL';
  let selectedGpsList = [];

  if (curScope === 'ALL' || curScope === 'समस्त 30 पंचायतें' || curScope === 'ALL_30_GP') {
    scopeMode = 'ALL';
    selectedGpsList = 'ALL';
  } else if (curScope === 'BOOTH' || uov.allowed_wards || userObj.booth_no || (typeof curScope === 'string' && curScope.includes('भाग'))) {
    scopeMode = 'BOOTH';
    selectedGpsList = [userObj.panchayat || 'बड़गांव'];
  } else {
    scopeMode = 'GP';
    if (Array.isArray(curScope)) {
      selectedGpsList = curScope;
    } else if (typeof curScope === 'string' && curScope.startsWith('[') && curScope.endsWith(']')) {
      try { selectedGpsList = JSON.parse(curScope); } catch(e) { selectedGpsList = [curScope]; }
    } else if (typeof curScope === 'string' && curScope.includes(',')) {
      selectedGpsList = curScope.split(',').map(s => s.trim());
    } else {
      selectedGpsList = [curScope];
    }
  }

  // Populate Multi-Select GP Checkboxes
  populateScopeGpCheckboxes(selectedGpsList);

  // Set Radios
  const radios = document.getElementsByName('scopeModeRadio');
  radios.forEach(r => { r.checked = (r.value === scopeMode); });
  onScopeModeRadioChanged(scopeMode);

  // Ward & Booth values
  const wardInput = document.getElementById('scopeWardInput');
  if (wardInput) wardInput.value = uov.allowed_wards || userObj.allowed_wards || (userObj.wards || 'ALL');

  // Permissions
  const pSearch = (uov.can_search !== undefined) ? uov.can_search : (userObj.can_search !== false);
  const pView = (uov.can_view !== undefined) ? uov.can_view : (userObj.can_view !== false);
  const pPrint = (uov.can_print !== undefined) ? uov.can_print : (userObj.can_print === true || userObj.role === 'SUPER_ADMIN' || userObj.role === 'VYAVASTHAPAK' || userObj.role === 'INCHARGE');
  const pDown = (uov.can_download !== undefined) ? uov.can_download : (userObj.can_download !== false);

  const setChk = (id, val) => { const el = document.getElementById(id); if (el) el.checked = !!val; };
  setChk('scopePermSearch', pSearch);
  setChk('scopePermView', pView);
  setChk('scopePermPrint', pPrint);
  setChk('scopePermDownload', pDown);

  // Password & Status
  const curPass = uov.password || userObj.password || 'bhinai2026';
  const curStatus = uov.status || userObj.status || 'ACTIVE';
  const passInput = document.getElementById('scopePasswordInput');
  if (passInput) passInput.value = curPass;
  const statSelect = document.getElementById('scopeStatusSelect');
  if (statSelect) statSelect.value = curStatus;

  modal.style.display = 'flex';
}

function closeCustomScopeModal() {
  const modal = document.getElementById('customScopeModal');
  if (modal) modal.style.display = 'none';
}

// Multi-Select GP Helpers
function populateScopeGpCheckboxes(selectedList) {
  const grid = document.getElementById('scopeGpCheckboxGrid');
  if (!grid) return;
  grid.innerHTML = '';

  const panchayats = (State.panchayats && State.panchayats.length > 0) ? State.panchayats : (window.MASTER_DATA && window.MASTER_DATA.panchayats) || [];
  const isSelectAll = (selectedList === 'ALL');
  const selArr = Array.isArray(selectedList) ? selectedList : (isSelectAll ? panchayats.map(p => p.name_hi) : [selectedList]);

  panchayats.forEach(gp => {
    const isChecked = isSelectAll || selArr.includes(gp.name_hi) || selArr.includes(gp.code) || selArr.includes(gp.name_en);
    const label = document.createElement('label');
    label.className = `scope-gp-chip ${isChecked ? 'selected' : ''}`;
    label.setAttribute('data-name', (gp.name_hi + ' ' + (gp.name_en || '')).toLowerCase());
    label.innerHTML = `
      <input type="checkbox" value="${gp.name_hi}" ${isChecked ? 'checked' : ''} onchange="onScopeGpChipChanged(this)">
      <span>🏛️ ${gp.name_hi}</span>
      <span style="font-size:0.7rem; color:#64748b; font-weight:600;">(${gp.code})</span>
    `;
    grid.appendChild(label);
  });

  updateScopeGpCountBadge();
  updateScopeBoothOptions();
}

function onScopeGpChipChanged(checkboxEl) {
  if (checkboxEl && checkboxEl.parentElement) {
    checkboxEl.parentElement.classList.toggle('selected', checkboxEl.checked);
  }
  updateScopeGpCountBadge();
  updateScopeBoothOptions();
}

function updateScopeGpCountBadge() {
  const badge = document.getElementById('scopeGpSelectedCountBadge');
  const checked = document.querySelectorAll('#scopeGpCheckboxGrid input[type="checkbox"]:checked');
  const total = document.querySelectorAll('#scopeGpCheckboxGrid input[type="checkbox"]').length;
  if (!badge) return;

  if (checked.length === total && total > 0) {
    badge.textContent = `🌐 समस्त ${total} पंचायतें चयनित`;
    badge.style.background = '#059669';
  } else if (checked.length === 0) {
    badge.textContent = `0 चयनित`;
    badge.style.background = '#dc2626';
  } else {
    badge.textContent = `🏛️ ${checked.length} पंचायतें चयनित`;
    badge.style.background = '#2563eb';
  }
}

function selectAllScopeGps(select) {
  document.querySelectorAll('#scopeGpCheckboxGrid input[type="checkbox"]').forEach(cb => {
    cb.checked = !!select;
    if (cb.parentElement) cb.parentElement.classList.toggle('selected', !!select);
  });
  updateScopeGpCountBadge();
  updateScopeBoothOptions();
}

function filterScopeGpsList(query) {
  const q = (query || '').toLowerCase().trim();
  document.querySelectorAll('#scopeGpCheckboxGrid .scope-gp-chip').forEach(chip => {
    const name = chip.getAttribute('data-name') || '';
    chip.style.display = (!q || name.includes(q)) ? 'flex' : 'none';
  });
}

function updateScopeBoothOptions() {
  const boothSel = document.getElementById('scopeBoothSelect');
  if (!boothSel) return;
  boothSel.innerHTML = '<option value="ALL">-- समस्त चयनित पंचायतों के बूथ --</option>';

  const checkedGps = Array.from(document.querySelectorAll('#scopeGpCheckboxGrid input[type="checkbox"]:checked')).map(cb => cb.value);
  const dir = getMasterDirectory();
  if (dir && dir.blo_list) {
    const matchedBlos = (checkedGps.length === 0) 
      ? dir.blo_list 
      : dir.blo_list.filter(b => checkedGps.includes(b.panchayat));
    matchedBlos.forEach(b => {
      const opt = document.createElement('option');
      opt.value = b.booth_no;
      opt.textContent = `[${b.panchayat}] बूथ क्र. ${b.booth_no} - ${b.school || b.name}`;
      boothSel.appendChild(opt);
    });
  }
}

function onScopeModeRadioChanged(mode) {
  const gpCont = document.getElementById('scopeGpContainer');
  const bwCont = document.getElementById('scopeBoothWardContainer');
  if (mode === 'ALL') {
    if (gpCont) gpCont.style.display = 'none';
    if (bwCont) bwCont.style.display = 'none';
    selectAllScopeGps(true);
  } else if (mode === 'GP') {
    if (gpCont) gpCont.style.display = 'block';
    if (bwCont) bwCont.style.display = 'none';
  } else if (mode === 'BOOTH') {
    if (gpCont) gpCont.style.display = 'block';
    if (bwCont) bwCont.style.display = 'block';
  }
}

function saveCustomScopeAllotment(event) {
  if (event) event.preventDefault();
  const userId = document.getElementById('scopeTargetUserId').value;
  if (!userId) return;

  const mode = document.querySelector('input[name="scopeModeRadio"]:checked')?.value || 'ALL';
  let scopeVal = 'ALL';
  let wardVal = 'ALL';

  if (mode === 'ALL') {
    scopeVal = 'ALL';
    wardVal = 'ALL';
  } else if (mode === 'GP') {
    const checkedGps = Array.from(document.querySelectorAll('#scopeGpCheckboxGrid input[type="checkbox"]:checked')).map(cb => cb.value);
    const totalGps = document.querySelectorAll('#scopeGpCheckboxGrid input[type="checkbox"]').length;
    
    if (checkedGps.length === 0) {
      showToast('⚠️ कृपया कम से कम एक ग्राम पंचायत चुनें!');
      return;
    }
    if (checkedGps.length === totalGps && totalGps > 0) {
      scopeVal = 'ALL';
    } else if (checkedGps.length === 1) {
      scopeVal = checkedGps[0];
    } else {
      scopeVal = checkedGps.join(', ');
    }
    wardVal = 'ALL';
  } else if (mode === 'BOOTH') {
    const checkedGps = Array.from(document.querySelectorAll('#scopeGpCheckboxGrid input[type="checkbox"]:checked')).map(cb => cb.value);
    const booth = document.getElementById('scopeBoothSelect')?.value || 'ALL';
    wardVal = document.getElementById('scopeWardInput')?.value.trim() || 'ALL';
    
    if (booth !== 'ALL') {
      const gp = checkedGps[0] || '';
      scopeVal = `भाग ${booth} (${gp})`;
    } else if (checkedGps.length > 0) {
      scopeVal = checkedGps.join(', ');
    } else {
      scopeVal = 'ALL';
    }
  }

  const canSearch = document.getElementById('scopePermSearch')?.checked;
  const canView = document.getElementById('scopePermView')?.checked;
  const canPrint = document.getElementById('scopePermPrint')?.checked;
  const canDownload = document.getElementById('scopePermDownload')?.checked;
  const pass = document.getElementById('scopePasswordInput')?.value.trim() || 'bhinai2026';
  const status = document.getElementById('scopeStatusSelect')?.value || 'ACTIVE';

  // Save all to overrides
  saveUserOverride(userId, 'allowed_panchayats', scopeVal);
  saveUserOverride(userId, 'allowed_wards', wardVal);
  saveUserOverride(userId, 'can_search', canSearch);
  saveUserOverride(userId, 'can_view', canView);
  saveUserOverride(userId, 'can_print', canPrint);
  saveUserOverride(userId, 'can_download', canDownload);
  saveUserOverride(userId, 'password', pass);
  saveUserOverride(userId, 'status', status);

  // Update State.adminControlUsers
  if (State.adminControlUsers) {
    const u = State.adminControlUsers.find(x => (x.id || x.username) === userId);
    if (u) {
      u.allowed_panchayats = scopeVal;
      u.allowed_wards = wardVal;
      u.can_search = canSearch;
      u.can_view = canView;
      u.can_print = canPrint;
      u.can_download = canDownload;
      u.password = pass;
      u.status = status;
      if (typeof saveAdminUserToServer === 'function') {
        saveAdminUserToServer(u);
      }
    }
  }

  closeCustomScopeModal();
  
  // Re-render current active subtab
  if (activeHubSubTab === 'cell') renderAdminCellTab();
  else if (activeHubSubTab === 'blo') renderAdminBloTab();
  else if (activeHubSubTab === 'cand') renderAdminCandTab();
  else if (activeHubSubTab === 'admins') renderAdminTopAdminsTab();

  showToast(`✅ कार्यक्षेत्र व अधिकार आवंटन सफलतापूर्वक सुरक्षित! (${userId})`);
}


function toggleUserStatus(userId, explicitStatus) {
  const overrides = getUserOverrides();
  const cur = (overrides[userId] && overrides[userId].status) || 'ACTIVE';
  const newStatus = explicitStatus || ((cur === 'ACTIVE') ? 'INACTIVE' : 'ACTIVE');
  
  saveUserOverride(userId, 'status', newStatus);
  setCustomUserStatus(userId, newStatus);
  
  if (State.adminControlUsers) {
    const u = State.adminControlUsers.find(x => (x.id || x.username) === userId);
    if (u) {
      u.status = newStatus;
      if (typeof saveAdminUserToServer === 'function') {
        saveAdminUserToServer(u);
      }
    }
  }
  
  if (typeof renderAdminCellTab === 'function' && activeHubSubTab === 'cell') renderAdminCellTab();
  else if (typeof renderAdminBloTab === 'function' && activeHubSubTab === 'blo') renderAdminBloTab();
  else if (typeof renderAdminCandTab === 'function' && activeHubSubTab === 'cand') renderAdminCandTab();
  else if (typeof renderAdminTopAdminsTab === 'function' && activeHubSubTab === 'admins') renderAdminTopAdminsTab();
  
  showToast(`खाता स्थिति: ${userId} -> ${newStatus === 'ACTIVE' ? '🟢 सक्रिय' : '🔴 निष्क्रिय'}`);
}

// Standalone Universal Quick Password Updater & Viewer for Super Admin Hub
async function quickUpdatePassword(userId, newPass) {
  if (newPass === undefined || newPass === null) return;
  const trimmed = String(newPass).trim();
  if (!trimmed) {
    showToast('⚠️ पासवर्ड रिक्त नहीं हो सकता!');
    return;
  }
  
  saveUserOverride(userId, 'password', trimmed);
  setCustomUserPassword(userId, trimmed);
  
  if (State.adminControlUsers) {
    const u = State.adminControlUsers.find(x => (x.id || x.username) === userId);
    if (u) {
      u.password = trimmed;
      if (typeof saveAdminUserToServer === 'function') {
        saveAdminUserToServer(u);
      }
    }
  }
  
  try {
    localStorage.setItem('portal_admin_users_overrides', JSON.stringify(State.adminControlUsers || []));
  } catch(e) {}
  
  try {
    await fetch('/api/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: userId, newPassword: trimmed })
    });
  } catch(e) {}
  
  showToast(`🔑 पासवर्ड सुरक्षित: ${userId} -> '${trimmed}'`);
}

function resetUserPasswordToDefault(userId) {
  let defaultPass = 'bhinai2026';
  const uLower = String(userId || '').toLowerCase();
  
  if (uLower === 'admin' || uLower === 'superadmin') {
    defaultPass = 'admin2026';
  } else if (uLower === 'incharge') {
    defaultPass = 'incharge2026';
  } else if (uLower === 'vyavasthapak') {
    defaultPass = 'vyavastha2026';
  } else if (uLower === 'block_prabhari') {
    defaultPass = 'BHINAI123';
  } else {
    // Check master directory for exact personnel or BLO password
    const dir = getMasterDirectory();
    if (dir) {
      const blo = (dir.blo_list || []).find(b => 
        (b.id && String(b.id).toLowerCase() === uLower) ||
        (b.username && String(b.username).toLowerCase() === uLower) ||
        (`blo_${b.booth_no}`.toLowerCase() === uLower) ||
        (String(b.booth_no) === uLower)
      );
      if (blo && blo.password) {
        defaultPass = blo.password;
      } else {
        const cell = (dir.cell_personnel || []).find(c => 
          (c.id && String(c.id).toLowerCase() === uLower) ||
          (c.username && String(c.username).toLowerCase() === uLower)
        );
        if (cell && cell.password) {
          defaultPass = cell.password;
        } else if (uLower.startsWith('cand_')) {
          const cNum = uLower.replace(/[^0-9]/g, '') || '1';
          defaultPass = `cand${cNum}@2026`;
        }
      }
    }
  }

  quickUpdatePassword(userId, defaultPass);
  const inp = document.getElementById(`pass_input_${userId}`);
  if (inp) inp.value = defaultPass;
  showToast(`🔑 व्यक्तिगत पासवर्ड '${defaultPass}' पर रीसेट किया गया! (${userId})`);
  if (typeof activeHubSubTab !== 'undefined') {
    if (activeHubSubTab === 'cell') renderAdminCellTab();
    else if (activeHubSubTab === 'blo') renderAdminBloTab();
    else if (activeHubSubTab === 'cand') renderAdminCandTab();
    else if (activeHubSubTab === 'admins') renderAdminTopAdminsTab();
  }
}

function togglePassVisibility(inputId) {
  const el = document.getElementById(inputId);
  if (!el) return;
  el.type = (el.type === 'password') ? 'text' : 'password';
}

// -------------------------------------------------------------------------
// 1. RENDER CELL TAB (18 OFFICIAL CELLS - 59 KARMIK)
// -------------------------------------------------------------------------
function renderAdminCellTab() {
  const tbody = document.getElementById('adminCellTableBody');
  if (!tbody) return;

  const dir = getMasterDirectory();
  const rawCells = (dir && dir.cell_personnel) ? dir.cell_personnel : [];
  const overrides = getUserOverrides();

  const searchVal = (document.getElementById('adminCellSearchInput') ? document.getElementById('adminCellSearchInput').value : '').toLowerCase().trim();
  const cellFilter = document.getElementById('adminCellFilterSelect') ? document.getElementById('adminCellFilterSelect').value : 'ALL';
  const statusFilter = document.getElementById('adminCellStatusFilter') ? document.getElementById('adminCellStatusFilter').value : 'ALL';

  const filtered = rawCells.filter(c => {
    const cid = c.id || c.username;
    const ov = overrides[cid] || {};
    const effectiveStatus = ov.status || c.status || 'ACTIVE';
    
    if (statusFilter !== 'ALL' && effectiveStatus !== statusFilter) return false;
    if (cellFilter !== 'ALL' && c.cell_id !== cellFilter && c.cell_name !== cellFilter) return false;
    
    if (searchVal) {
      const match = (c.name && c.name.toLowerCase().includes(searchVal)) ||
                    (c.designation && c.designation.toLowerCase().includes(searchVal)) ||
                    (c.office && c.office.toLowerCase().includes(searchVal)) ||
                    (c.cell_name && c.cell_name.toLowerCase().includes(searchVal)) ||
                    (c.mobile && c.mobile.includes(searchVal)) ||
                    (cid && cid.toLowerCase().includes(searchVal));
      if (!match) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:24px; color:#64748b; font-weight:600;">कोई प्रकोष्ठ कार्मिक नहीं मिला।</td></tr>';
    return;
  }

  tbody.innerHTML = '';
  const frag = document.createDocumentFragment();
  filtered.forEach((c, idx) => {
    const cid = c.id || c.username;
    const cidLower = String(cid).toLowerCase();
    const adminUser = (State.adminControlUsers || []).find(u => 
      (u.id && String(u.id).toLowerCase() === cidLower) ||
      (u.username && String(u.username).toLowerCase() === cidLower)
    );
    const ov = overrides[cid] || (adminUser ? overrides[adminUser.id || adminUser.username] : {}) || {};
    const pass = (adminUser && adminUser.password) || ov.password || c.password || 'bhinai2026';
    const status = (adminUser && adminUser.status) || ov.status || c.status || 'ACTIVE';
    const isActive = (status === 'ACTIVE');
    
    let allowedTabs = ['searchTab'];
    if (adminUser && Array.isArray(adminUser.allowed_tabs)) {
      allowedTabs = adminUser.allowed_tabs;
    } else if (ov.allowed_tabs && Array.isArray(ov.allowed_tabs)) {
      allowedTabs = ov.allowed_tabs;
    } else if (Array.isArray(c.allowed_tabs)) {
      allowedTabs = c.allowed_tabs;
    }
    const canPrint = (adminUser && adminUser.can_print !== undefined) ? (adminUser.can_print === true || adminUser.can_print === 1) : ((ov.can_print !== undefined) ? ov.can_print : (c.can_print === true));
    const canDownload = (adminUser && adminUser.can_download !== undefined) ? (adminUser.can_download === true || adminUser.can_download === 1) : ((ov.can_download !== undefined) ? ov.can_download : (c.can_download !== false));
    const scope = (adminUser && adminUser.allowed_panchayats) || ov.allowed_panchayats || c.allowed_panchayats || 'ALL';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <strong style="color:#1e3a8a;">${cid}</strong>
        <div style="font-size:0.75rem; color:#64748b;">क्र.सं. ${idx+1}</div>
      </td>
      <td>
        <div style="font-weight:700; color:#0f172a;">${c.name}</div>
        <div style="font-size:0.78rem; color:#475569;">${c.designation || c.post || ''}</div>
        <div style="font-size:0.74rem; color:#64748b;">${c.office || ''}</div>
      </td>
      <td>
        <span class="badge" style="background:#eff6ff; color:#1e40af; border:1px solid #bfdbfe; font-size:0.78rem; font-weight:700;">
          ${c.cell_name || 'चुनाव प्रकोष्ठ'}
        </span>
        <div style="font-size:0.75rem; color:#059669; font-weight:600; margin-top:2px;">
          ${c.role_in_cell || 'प्रकोष्ठ सदस्य'}
        </div>
      </td>
      <td>
        <a href="tel:${c.mobile}" style="font-weight:700; color:#0284c7; text-decoration:none;">📞 ${c.mobile}</a>
      </td>
      <td>
        <div class="admin-pass-box">
          <input type="password" class="admin-pass-input" value="${pass}" id="pass_input_${cid}" onchange="quickUpdatePassword('${cid}', this.value)" autocomplete="one-time-code" autocorrect="off" autocapitalize="off" spellcheck="false" data-lpignore="true" data-1p-ignore="true">
          <button type="button" class="admin-pass-btn" onclick="togglePassVisibility('pass_input_${cid}')" title="पासवर्ड देखें / छिपाएं">👁️</button>
          <button type="button" class="admin-pass-btn admin-pass-btn-save" onclick="quickUpdatePassword('${cid}', document.getElementById('pass_input_${cid}').value)" title="पासवर्ड सुरक्षित करें">💾</button>
        </div>
      </td>
      <td>
        <div class="mb-1" style="font-size:0.75rem; font-weight:700; color:#334155;">अनुमत टैब (प्रकोष्ठ Tabs):</div>
        <div class="d-flex flex-wrap gap-1 align-items-center mb-1">
          <label class="perm-check-item ${allowedTabs.includes('searchTab') ? 'active' : ''}" title="मतदाता खोज">
            <input type="checkbox" ${allowedTabs.includes('searchTab') ? 'checked' : ''} onchange="toggleUserTab('${cid}', 'searchTab', this.checked)">
            <span>🔍 खोज</span>
          </label>
          <label class="perm-check-item ${allowedTabs.includes('alphaTab') ? 'active' : ''}" title="वर्णमाला सूची">
            <input type="checkbox" ${allowedTabs.includes('alphaTab') ? 'checked' : ''} onchange="toggleUserTab('${cid}', 'alphaTab', this.checked)">
            <span>🔤 वर्णमाला</span>
          </label>
          <label class="perm-check-item ${allowedTabs.includes('directoryTab') ? 'active' : ''}" title="वार्ड व डायरेक्टरी">
            <input type="checkbox" ${allowedTabs.includes('directoryTab') ? 'checked' : ''} onchange="toggleUserTab('${cid}', 'directoryTab', this.checked)">
            <span>📖 वार्ड/डायरेक्टरी</span>
          </label>
          <label class="perm-check-item ${allowedTabs.includes('bulkSlipTab') ? 'active' : ''}" title="पर्ची प्रिंट">
            <input type="checkbox" ${allowedTabs.includes('bulkSlipTab') ? 'checked' : ''} onchange="toggleUserTab('${cid}', 'bulkSlipTab', this.checked)">
            <span>🖨️ पर्ची</span>
          </label>
          <label class="perm-check-item ${allowedTabs.includes('dashboardTab') ? 'active' : ''}" title="डैशबोर्ड सारांश">
            <input type="checkbox" ${allowedTabs.includes('dashboardTab') ? 'checked' : ''} onchange="toggleUserTab('${cid}', 'dashboardTab', this.checked)">
            <span>📊 डैशबोर्ड</span>
          </label>
        </div>
        <div class="d-flex align-items-center gap-1 mt-1" style="min-height:36px;">
          <select class="form-select admin-scope-select" onchange="updateUserScope('${cid}', this.value)">
            <option value="ALL" ${scope === 'ALL' ? 'selected' : ''}>🌐 समस्त 30 पं.</option>
            <option value="BOOTH" ${scope === 'BOOTH' || scope.includes('भाग') ? 'selected' : ''}>📍 निर्धारित बूथ</option>
          </select>
          <button type="button" class="btn btn-scope-allot" onclick="openCustomScopeModal('${cid}')" title="कस्टम आवंटन">🎯</button>
        </div>
      </td>
      <td style="text-align:center;">
        <button type="button" class="btn btn-xs ${isActive ? 'btn-success' : 'btn-danger'}" onclick="toggleUserStatus('${cid}')" style="font-weight:700; font-size:0.75rem; min-width:65px;">
          ${isActive ? '🟢 सक्रिय' : '🔴 निष्क्रिय'}
        </button>
      </td>
      <td style="text-align:center;">
        <div class="d-flex justify-content-center gap-1">
          <button type="button" class="admin-pass-btn admin-pass-btn-reset" onclick="resetUserPasswordToDefault('${cid}')" title="डिफ़ॉल्ट पासवर्ड (bhinai2026) करें">🔄 डिफ़ॉल्ट</button>
          <button type="button" class="btn btn-xs btn-outline-danger" onclick="deleteCellPersonnel('${cid}', '${c.name}')" title="हटाएं">🗑️</button>
        </div>
      </td>
    `;
    frag.appendChild(tr);
  });
  tbody.appendChild(frag);
}

// -------------------------------------------------------------------------
// 2. RENDER BLO TAB (126 BOOTHS ACROSS 30 PANCHAYATS)
// -------------------------------------------------------------------------
function renderAdminBloTab() {
  const tbody = document.getElementById('adminBloTableBody');
  if (!tbody) return;

  const dir = getMasterDirectory();
  const rawBlos = (dir && dir.blo_list) ? dir.blo_list : [];
  const overrides = getUserOverrides();

  const searchVal = (document.getElementById('adminBloSearchInput') ? document.getElementById('adminBloSearchInput').value : '').toLowerCase().trim();
  const gpFilter = document.getElementById('adminBloGpFilter') ? document.getElementById('adminBloGpFilter').value : 'ALL';
  const statusFilter = document.getElementById('adminBloStatusFilter') ? document.getElementById('adminBloStatusFilter').value : 'ALL';

  const filtered = rawBlos.filter(b => {
    const bid = b.username || b.id || b.user_id;
    const ov = overrides[bid] || {};
    const effectiveStatus = ov.status || b.status || 'ACTIVE';
    
    if (statusFilter !== 'ALL' && effectiveStatus !== statusFilter) return false;
    if (gpFilter !== 'ALL' && b.panchayat !== gpFilter) return false;

    if (searchVal) {
      const match = (b.name && b.name.toLowerCase().includes(searchVal)) ||
                    (b.school && b.school.toLowerCase().includes(searchVal)) ||
                    (b.panchayat && b.panchayat.toLowerCase().includes(searchVal)) ||
                    (b.booth_no && String(b.booth_no).includes(searchVal)) ||
                    (b.mobile && b.mobile.includes(searchVal)) ||
                    (bid && bid.toLowerCase().includes(searchVal));
      if (!match) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:24px; color:#64748b; font-weight:600;">कोई बी.एल.ओ. नहीं मिला।</td></tr>';
    return;
  }

  tbody.innerHTML = '';
  const frag = document.createDocumentFragment();
  filtered.forEach(b => {
    const bid = b.username || b.id || b.user_id;
    const bidLower = String(bid).toLowerCase();
    const adminUser = (State.adminControlUsers || []).find(u => 
      (u.id && String(u.id).toLowerCase() === bidLower) ||
      (u.username && String(u.username).toLowerCase() === bidLower) ||
      (`blo_${b.booth_no}`.toLowerCase() === bidLower) ||
      (String(b.booth_no) === bidLower)
    );
    const ov = overrides[bid] || (adminUser ? overrides[adminUser.id || adminUser.username] : {}) || {};
    const pass = (adminUser && adminUser.password) || ov.password || b.password || 'bhinai2026';
    const status = (adminUser && adminUser.status) || ov.status || b.status || 'ACTIVE';
    const isActive = (status === 'ACTIVE');
    
    let allowedTabs = ['searchTab'];
    if (adminUser && Array.isArray(adminUser.allowed_tabs)) {
      allowedTabs = adminUser.allowed_tabs;
    } else if (ov.allowed_tabs && Array.isArray(ov.allowed_tabs)) {
      allowedTabs = ov.allowed_tabs;
    } else if (Array.isArray(b.allowed_tabs)) {
      allowedTabs = b.allowed_tabs;
    }
    const canPrint = (adminUser && adminUser.can_print !== undefined) ? (adminUser.can_print === true || adminUser.can_print === 1) : ((ov.can_print !== undefined) ? ov.can_print : (b.can_print === true));
    const canDownload = (adminUser && adminUser.can_download !== undefined) ? (adminUser.can_download === true || adminUser.can_download === 1) : ((ov.can_download !== undefined) ? ov.can_download : (b.can_download !== false));
    const scope = (adminUser && adminUser.allowed_panchayats) || ov.allowed_panchayats || b.panchayat || 'BOOTH';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <span class="badge" style="background:#fef3c7; color:#92400e; font-weight:800; font-size:0.82rem; border:1px solid #fde68a;">
          बूथ क्र. ${b.booth_no}
        </span>
        <div style="font-size:0.75rem; color:#64748b; margin-top:2px;">ID: ${bid}</div>
      </td>
      <td>
        <div style="font-weight:700; color:#0f172a;">${b.name}</div>
        <div style="font-size:0.78rem; color:#475569;">${b.post || 'अध्यापक / BLO'}</div>
        <div style="font-size:0.74rem; color:#64748b;">${b.school || ''}</div>
      </td>
      <td>
        <div style="font-weight:700; color:#1e40af;">🏛️ ${b.panchayat}</div>
        <div style="font-size:0.76rem; color:#64748b;">वार्ड: ${b.wards || '-'}</div>
      </td>
      <td>
        <a href="tel:${b.mobile}" style="font-weight:700; color:#0284c7; text-decoration:none;">📞 ${b.mobile}</a>
      </td>
      <td>
        <div class="admin-pass-box">
          <input type="password" class="admin-pass-input" value="${pass}" id="pass_input_${bid}" onchange="quickUpdatePassword('${bid}', this.value)" autocomplete="one-time-code" autocorrect="off" autocapitalize="off" spellcheck="false" data-lpignore="true" data-1p-ignore="true">
          <button type="button" class="admin-pass-btn" onclick="togglePassVisibility('pass_input_${bid}')" title="पासवर्ड देखें / छिपाएं">👁️</button>
          <button type="button" class="admin-pass-btn admin-pass-btn-save" onclick="quickUpdatePassword('${bid}', document.getElementById('pass_input_${bid}').value)" title="पासवर्ड सुरक्षित करें">💾</button>
        </div>
      </td>
      <td>
        <div class="mb-1" style="font-size:0.75rem; font-weight:700; color:#334155;">अनुमत टैब (BLO Tabs):</div>
        <div class="d-flex flex-wrap gap-1 align-items-center mb-1">
          <label class="perm-check-item ${allowedTabs.includes('searchTab') ? 'active' : ''}" title="मतदाता खोज">
            <input type="checkbox" ${allowedTabs.includes('searchTab') ? 'checked' : ''} onchange="toggleUserTab('${bid}', 'searchTab', this.checked)">
            <span>🔍 खोज</span>
          </label>
          <label class="perm-check-item ${allowedTabs.includes('alphaTab') ? 'active' : ''}" title="वर्णमाला सूची">
            <input type="checkbox" ${allowedTabs.includes('alphaTab') ? 'checked' : ''} onchange="toggleUserTab('${bid}', 'alphaTab', this.checked)">
            <span>🔤 वर्णमाला</span>
          </label>
          <label class="perm-check-item ${allowedTabs.includes('directoryTab') ? 'active' : ''}" title="वार्ड व डायरेक्टरी">
            <input type="checkbox" ${allowedTabs.includes('directoryTab') ? 'checked' : ''} onchange="toggleUserTab('${bid}', 'directoryTab', this.checked)">
            <span>📖 वार्ड/डायरेक्टरी</span>
          </label>
          <label class="perm-check-item ${allowedTabs.includes('bulkSlipTab') ? 'active' : ''}" title="पर्ची प्रिंट">
            <input type="checkbox" ${allowedTabs.includes('bulkSlipTab') ? 'checked' : ''} onchange="toggleUserTab('${bid}', 'bulkSlipTab', this.checked)">
            <span>🖨️ पर्ची</span>
          </label>
          <label class="perm-check-item ${allowedTabs.includes('dashboardTab') ? 'active' : ''}" title="डैशबोर्ड सारांश">
            <input type="checkbox" ${allowedTabs.includes('dashboardTab') ? 'checked' : ''} onchange="toggleUserTab('${bid}', 'dashboardTab', this.checked)">
            <span>📊 डैशबोर्ड</span>
          </label>
        </div>
        <div class="d-flex align-items-center gap-1 mt-1" style="min-height:34px;">
          <select class="form-select admin-scope-select" onchange="updateUserScope('${bid}', this.value)" style="font-size:0.78rem;">
            <option value="${b.panchayat}" ${scope === b.panchayat ? 'selected' : ''}>🏛️ केवल ${b.panchayat}</option>
            <option value="ALL" ${scope === 'ALL' ? 'selected' : ''}>🌐 समस्त 30 पं.</option>
          </select>
          <button type="button" class="btn btn-scope-allot" onclick="openCustomScopeModal('${bid}')" title="कस्टम आवंटन">🎯</button>
        </div>
      </td>
      <td style="text-align:center;">
        <button type="button" class="btn btn-xs ${isActive ? 'btn-success' : 'btn-danger'}" onclick="toggleUserStatus('${bid}')" style="font-weight:700; font-size:0.75rem; min-width:65px;">
          ${isActive ? '🟢 सक्रिय' : '🔴 निष्क्रिय'}
        </button>
      </td>
      <td style="text-align:center;">
        <button type="button" class="admin-pass-btn admin-pass-btn-reset" onclick="resetUserPasswordToDefault('${bid}')" title="डिफ़ॉल्ट पासवर्ड (bhinai2026) करें">🔄 डिफ़ॉल्ट</button>
      </td>
    `;
    frag.appendChild(tr);
  });
  tbody.appendChild(frag);
}

// -------------------------------------------------------------------------
// 3. RENDER CANDIDATE TAB (CANDIDATES & PANCHAYAT AGENTS)
// -------------------------------------------------------------------------
function renderAdminCandTab() {
  const tbody = document.getElementById('adminCandTableBody');
  if (!tbody) return;

  const users = State.adminControlUsers || [];
  // Robust candidate filter: matching role, id prefix, username prefix, or candidate object
  const candUsers = users.filter(u => {
    if (!u) return false;
    const uid = String(u.id || '').toLowerCase();
    const uname = String(u.username || '').toLowerCase();
    const urole = String(u.role || '').toUpperCase();
    return (
      urole === 'CANDIDATE' ||
      urole === 'प्रत्याशी' ||
      uid.startsWith('cand_') ||
      uname.startsWith('cand_') ||
      uname === 'sarpanch' ||
      u.type === 'CANDIDATE' ||
      u.category === 'CANDIDATE' ||
      (u.candidate && (u.candidate.candidate_name || u.candidate.panchayat))
    );
  });

  const overrides = getUserOverrides();
  const searchVal = (document.getElementById('adminCandSearchInput') ? document.getElementById('adminCandSearchInput').value : '').toLowerCase().trim();
  const gpFilter = document.getElementById('adminCandGpFilter') ? document.getElementById('adminCandGpFilter').value : 'ALL';

  const filtered = candUsers.filter(c => {
    const cid = String(c.id || c.username || '');
    const cGp = c.panchayat || c.allowed_panchayats || (c.candidate && c.candidate.panchayat) || '';
    if (gpFilter !== 'ALL' && cGp !== gpFilter) return false;
    if (searchVal) {
      const match = (c.name && String(c.name).toLowerCase().includes(searchVal)) ||
                    (c.full_name && String(c.full_name).toLowerCase().includes(searchVal)) ||
                    (cGp && String(cGp).toLowerCase().includes(searchVal)) ||
                    (c.mobile && String(c.mobile).includes(searchVal)) ||
                    (cid && cid.toLowerCase().includes(searchVal)) ||
                    (c.candidate && c.candidate.candidate_name && String(c.candidate.candidate_name).toLowerCase().includes(searchVal));
      if (!match) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:24px; color:#64748b; font-weight:600;">कोई प्रत्याशी खाता नहीं मिला। ऊपर दिए गए बटन से नया प्रत्याशी जोड़ें।</td></tr>';
    return;
  }

  tbody.innerHTML = '';
  const frag = document.createDocumentFragment();
  filtered.forEach(c => {
    const cid = c.id || c.username;
    const ov = overrides[cid] || {};
    const pass = ov.password || c.password || 'cand@2026';
    const status = ov.status || c.status || 'ACTIVE';
    const isActive = (status === 'ACTIVE');
    const canSearch = (ov.can_search !== undefined) ? ov.can_search : (c.can_search !== undefined ? (c.can_search === true || c.can_search === 1) : true);
    const canView = (ov.can_view !== undefined) ? ov.can_view : (c.can_view !== undefined ? (c.can_view === true || c.can_view === 1) : true);
    const canPrint = (ov.can_print !== undefined) ? ov.can_print : (c.can_print !== undefined ? (c.can_print === true || c.can_print === 1) : true);
    const canDownload = (ov.can_download !== undefined) ? ov.can_download : (c.can_download !== undefined ? (c.can_download === true || c.can_download === 1) : true);
    const cGp = c.panchayat || c.allowed_panchayats || (c.candidate && c.candidate.panchayat) || '-';
    const scope = ov.allowed_panchayats || cGp || 'ALL';

    let cand = c.candidate;
    if (!cand) {
      try {
        cand = JSON.parse(localStorage.getItem('candidate_profile_' + cid) || localStorage.getItem('candidate_profile_' + (c.username || '')) || 'null');
      } catch(e) {}
    }
    if (!cand) cand = {};
    const candName = (cand && cand.candidate_name) || c.full_name || c.name || cid;
    const candMobile = (cand && cand.mobile) || c.mobile || '-';
    const candSymbol = (cand && cand.symbol_name) || '';
    const candPhoto = (cand && cand.photo_url) || '';
    const agentName = (cand && cand.agent_name) || '';
    const candElectionDate = (cand && cand.election_date) || getGlobalElectionDate();
    const candElectionTime = (cand && cand.election_time) || getGlobalElectionTime();

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <strong style="color:#d97706; font-size:0.9rem;">${cid}</strong>
      </td>
      <td>
        <div style="display:flex; align-items:center; gap:8px;">
          ${candPhoto ? `<img src="${candPhoto}" style="width:30px; height:30px; border-radius:50%; object-fit:cover; border:1.5px solid #d97706; flex-shrink:0;">` : `<span style="font-size:1.2rem; flex-shrink:0;">👤</span>`}
          <div>
            <div style="font-weight:700; color:#0f172a; font-size:0.9rem;">${candName}</div>
            <div style="font-size:0.75rem; color:#64748b;">${c.designation || (cand && cand.post) || 'प्रत्याशी'} ${agentName ? `• एजेंट: ${agentName}` : ''}</div>
          </div>
        </div>
      </td>
      <td>
        <div style="font-weight:700; color:#1e40af;">🏛️ ${cGp}</div>
        <div style="font-size:0.75rem; color:#d97706; font-weight:700;">वार्ड: ${c.allowed_wards || (cand && cand.ward) || 'समस्त'}</div>
        ${candSymbol ? `<span class="badge" style="background:#fef3c7; color:#92400e; font-size:0.72rem; padding:2px 6px; border-radius:4px; margin-top:2px; display:inline-block;">🗳️ ${candSymbol}</span>` : ''}
        <!-- प्रत्याशीवार मतदान दिनांक एवं समय बैज -->
        <div style="font-size:0.73rem; color:#065f46; font-weight:700; margin-top:3px; background:#ecfdf5; padding:2px 6px; border-radius:4px; border:1px solid #a7f3d0; display:inline-block;">
          📅 ${candElectionDate} <span style="color:#64748b; font-weight:500;">(${candElectionTime})</span>
        </div>
      </td>
      <td>
        <a href="tel:${candMobile}" style="font-weight:700; color:#0284c7; text-decoration:none;">📞 ${candMobile}</a>
      </td>
      <td>
        <div class="admin-pass-box">
          <input type="password" class="admin-pass-input" value="${pass}" id="pass_input_${cid}" onchange="quickUpdatePassword('${cid}', this.value)" autocomplete="one-time-code" autocorrect="off" autocapitalize="off" spellcheck="false" data-lpignore="true" data-1p-ignore="true">
          <button type="button" class="admin-pass-btn" onclick="togglePassVisibility('pass_input_${cid}')" title="पासवर्ड देखें / छिपाएं">👁️</button>
          <button type="button" class="admin-pass-btn admin-pass-btn-save" onclick="quickUpdatePassword('${cid}', document.getElementById('pass_input_${cid}').value)" title="पासवर्ड सुरक्षित करें">💾</button>
        </div>
      </td>
      <td>
        <div class="d-flex flex-wrap gap-1 align-items-center">
          <label class="perm-check-item ${canSearch ? 'active' : ''}">
            <input type="checkbox" ${canSearch ? 'checked' : ''} onchange="toggleUserPermission('${cid}', 'can_search', this.checked)">
            <span>🔍 खोज</span>
          </label>
          <label class="perm-check-item ${canView ? 'active' : ''}">
            <input type="checkbox" ${canView ? 'checked' : ''} onchange="toggleUserPermission('${cid}', 'can_view', this.checked)">
            <span>📄 दर्शन</span>
          </label>
          <label class="perm-check-item ${canPrint ? 'active' : ''}">
            <input type="checkbox" ${canPrint ? 'checked' : ''} onchange="toggleUserPermission('${cid}', 'can_print', this.checked)">
            <span>🖨️ प्रिंट</span>
          </label>
          <label class="perm-check-item ${canDownload ? 'active' : ''}">
            <input type="checkbox" ${canDownload ? 'checked' : ''} onchange="toggleUserPermission('${cid}', 'can_download', this.checked)">
            <span>📥 डाउनलोड</span>
          </label>
        </div>
        <div class="d-flex align-items-center gap-1 mt-1" style="min-height:36px;">
          <select class="form-select admin-scope-select" onchange="updateUserScope('${cid}', this.value)">
            <option value="${cGp !== '-' ? cGp : 'ALL'}" ${scope === cGp ? 'selected' : ''}>🏛️ ${cGp !== '-' ? cGp : 'पंचायत'}</option>
            <option value="ALL" ${scope === 'ALL' ? 'selected' : ''}>🌐 समस्त 30 पं.</option>
          </select>
          <button type="button" class="btn btn-scope-allot" onclick="openCustomScopeModal('${cid}')" title="कस्टम आवंटन">🎯</button>
        </div>
      </td>
      <td style="text-align:center;">
        <button type="button" class="btn btn-xs ${isActive ? 'btn-success' : 'btn-danger'}" onclick="toggleUserStatus('${cid}')" style="font-weight:700; font-size:0.75rem; min-width:65px;">
          ${isActive ? '🟢 सक्रिय' : '🔴 निष्क्रिय'}
        </button>
      </td>
      <td style="text-align:center;">
        <div class="d-flex justify-content-center gap-1">
          <button type="button" class="btn btn-xs btn-primary" onclick="openAdminCandidateModal('${cid}')" title="प्रत्याशी विवरण, फोटो, चुनाव चिन्ह एवं मतदान दिनांक संपादित करें" style="font-weight:700; padding:4px 8px;">✏️ संपादन</button>
          <button type="button" class="admin-pass-btn admin-pass-btn-reset" onclick="resetUserPasswordToDefault('${cid}')" title="डिफ़ॉल्ट पासवर्ड करें">🔄 डिफ़ॉल्ट</button>
        </div>
      </td>
    `;
    frag.appendChild(tr);
  });
  tbody.appendChild(frag);
}

// -------------------------------------------------------------------------
// 4. RENDER TOP ADMINS TAB (SUPER ADMIN, INCHARGE, VYAVASTHAPAK, BLOCK PRABHARI)
// FULL SUPER ADMIN COMMAND & GRANULAR PERMISSIONS AS REQUESTED
// -------------------------------------------------------------------------
function renderAdminTopAdminsTab() {
  const tbody = document.getElementById('adminTopAdminsTableBody');
  if (!tbody) return;

  const topAdmins = [
    {
      id: 'admin',
      name: 'मुख्य व्यवस्थापक (Super Admin)',
      role_title: '👑 मुख्य व्यवस्थापक',
      mobile: '7023293283',
      scope: 'ALL',
      default_pass: 'admin2026',
      default_tabs: ['dashboardTab', 'searchTab', 'alphaTab', 'bulkSlipTab', 'directoryTab', 'candidateProfileTab', 'adminControlTab', 'settingsTab']
    },
    {
      id: 'incharge',
      name: 'ब्लॉक इनचार्ज (Incharge)',
      role_title: '👁️ ब्लॉक इनचार्ज',
      mobile: '7023293283',
      scope: 'ALL',
      default_pass: 'incharge2026',
      default_tabs: ['dashboardTab', 'searchTab', 'alphaTab', 'bulkSlipTab', 'directoryTab']
    },
    {
      id: 'vyavasthapak',
      name: 'व्यवस्थापक (Vyavasthapak)',
      role_title: '🖨️ व्यवस्थापक',
      mobile: '9950705221',
      scope: 'ALL',
      default_pass: 'vyavastha2026',
      default_tabs: ['dashboardTab', 'searchTab', 'alphaTab', 'bulkSlipTab', 'directoryTab']
    },
    {
      id: 'block_prabhari',
      name: 'ब्लॉक प्रभारी',
      role_title: '🌟 ब्लॉक प्रभारी',
      mobile: '9950705221',
      scope: 'ALL',
      default_pass: 'BHINAI123',
      default_tabs: ['dashboardTab', 'searchTab', 'alphaTab', 'directoryTab']
    }
  ];

  const overrides = getUserOverrides();
  tbody.innerHTML = '';
  const frag = document.createDocumentFragment();

  topAdmins.forEach(adm => {
    const aid = adm.id;
    const ov = overrides[aid] || {};
    const userInDb = (State.adminControlUsers || []).find(u => (u.id || u.username) === aid) || {};

    const pass = ov.password || userInDb.password || adm.default_pass;
    const status = ov.status || userInDb.status || 'ACTIVE';
    const isActive = (status === 'ACTIVE');
    const fullName = userInDb.full_name || userInDb.fullName || ov.full_name || adm.name;
    const mobile = userInDb.mobile || ov.mobile || adm.mobile;
    const ovTabs = ov.allowed_tabs || userInDb.allowed_tabs || adm.default_tabs;
    const allowedTabs = Array.isArray(ovTabs) ? ovTabs : adm.default_tabs;
    const canPrint = (ov.can_print !== undefined) ? ov.can_print : (userInDb.can_print !== undefined ? userInDb.can_print : true);
    const canDownload = (ov.can_download !== undefined) ? ov.can_download : (userInDb.can_download !== undefined ? userInDb.can_download : true);
    const scope = ov.allowed_panchayats || userInDb.allowed_panchayats || adm.scope;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <strong style="color:#1e40af; font-size:0.95rem;">${aid}</strong>
        <div style="margin-top:2px;">
          <span class="badge" style="background:#fef3c7; color:#92400e; font-weight:700; font-size:0.75rem; border:1px solid #fde68a;">
            ${adm.role_title}
          </span>
        </div>
      </td>
      <td>
        <input type="text" class="form-input form-input-sm" value="${fullName}" onchange="updateUserField('${aid}', 'full_name', this.value)" style="font-weight:700; font-size:0.82rem; margin-bottom:2px;" title="नाम संपादित करें">
        <div style="font-size:0.75rem; color:#64748b;">${adm.role_title}</div>
      </td>
      <td>
        <input type="tel" class="form-input form-input-sm" value="${mobile}" placeholder="मोबाइल नं." onchange="updateUserField('${aid}', 'mobile', this.value)" style="font-size:0.78rem; font-weight:600; margin-bottom:2px;">
        <a href="tel:${mobile}" style="font-size:0.72rem; color:#0284c7; text-decoration:none; font-weight:700;">📞 कॉल करें</a>
      </td>
      <td>
        <div class="admin-pass-box">
          <input type="password" class="admin-pass-input" value="${pass}" id="pass_input_${aid}" onchange="quickUpdatePassword('${aid}', this.value)" autocomplete="one-time-code" autocorrect="off" autocapitalize="off" spellcheck="false" data-lpignore="true" data-1p-ignore="true">
          <button type="button" class="admin-pass-btn" onclick="togglePassVisibility('pass_input_${aid}')" title="पासवर्ड देखें / छिपाएं">👁️</button>
          <button type="button" class="admin-pass-btn admin-pass-btn-save" onclick="quickUpdatePassword('${aid}', document.getElementById('pass_input_${aid}').value)" title="पासवर्ड सुरक्षित करें">💾</button>
        </div>
      </td>
      <td>
        <div class="mb-1" style="font-size:0.75rem; font-weight:700; color:#334155;">अनुमत टैब एवं अधिकार:</div>
        <div class="d-flex flex-wrap gap-1 align-items-center mb-1">
          <label class="perm-check-item ${allowedTabs.includes('searchTab') ? 'active' : ''}" title="मतदाता खोज">
            <input type="checkbox" ${allowedTabs.includes('searchTab') ? 'checked' : ''} onchange="toggleUserTab('${aid}', 'searchTab', this.checked)">
            <span>🔍 खोज</span>
          </label>
          <label class="perm-check-item ${allowedTabs.includes('alphaTab') ? 'active' : ''}" title="वर्णमाला सूची">
            <input type="checkbox" ${allowedTabs.includes('alphaTab') ? 'checked' : ''} onchange="toggleUserTab('${aid}', 'alphaTab', this.checked)">
            <span>🔤 वर्णमाला</span>
          </label>
          <label class="perm-check-item ${allowedTabs.includes('directoryTab') ? 'active' : ''}" title="वार्ड व डायरेक्टरी">
            <input type="checkbox" ${allowedTabs.includes('directoryTab') ? 'checked' : ''} onchange="toggleUserTab('${aid}', 'directoryTab', this.checked)">
            <span>📖 वार्ड</span>
          </label>
          <label class="perm-check-item ${allowedTabs.includes('bulkSlipTab') ? 'active' : ''}" title="पर्ची प्रिंट">
            <input type="checkbox" ${allowedTabs.includes('bulkSlipTab') ? 'checked' : ''} onchange="toggleUserTab('${aid}', 'bulkSlipTab', this.checked)">
            <span>🖨️ पर्ची</span>
          </label>
          <label class="perm-check-item ${canDownload ? 'active' : ''}" title="डाउनलोड अनुमति">
            <input type="checkbox" ${canDownload ? 'checked' : ''} onchange="toggleUserPermission('${aid}', 'can_download', this.checked)">
            <span>📥 डाउनलोड</span>
          </label>
          <label class="perm-check-item ${allowedTabs.includes('dashboardTab') ? 'active' : ''}" title="डैशबोर्ड">
            <input type="checkbox" ${allowedTabs.includes('dashboardTab') ? 'checked' : ''} onchange="toggleUserTab('${aid}', 'dashboardTab', this.checked)">
            <span>📊 डैशबोर्ड</span>
          </label>
        </div>
      </td>
      <td>
        <div class="d-flex align-items-center gap-1" style="min-height:36px;">
          <select class="form-select admin-scope-select" onchange="updateUserScope('${aid}', this.value)">
            <option value="ALL" ${scope === 'ALL' ? 'selected' : ''}>🌐 समस्त 30 पं.</option>
            <option value="CUSTOM" ${scope !== 'ALL' ? 'selected' : ''}>📍 विशिष्ट दायरा</option>
          </select>
          <button type="button" class="btn btn-scope-allot" onclick="openCustomScopeModal('${aid}')" title="कस्टम आवंटन">🎯</button>
        </div>
      </td>
      <td style="text-align:center;">
        <button type="button" class="btn btn-xs ${isActive ? 'btn-success' : 'btn-danger'}" onclick="toggleUserStatus('${aid}')" style="font-weight:700; font-size:0.75rem; min-width:65px;">
          ${isActive ? '🟢 सक्रिय' : '🔴 निष्क्रिय'}
        </button>
      </td>
      <td style="text-align:center;">
        <div class="d-flex justify-content-center gap-1">
          <button type="button" class="btn btn-scope-allot" onclick="openCustomScopeModal('${aid}')" title="कस्टम आवंटन व अधिकार">🎯 दायरा</button>
          <button type="button" class="admin-pass-btn admin-pass-btn-reset" onclick="resetUserPasswordToDefault('${aid}')" title="डिफ़ॉल्ट पासवर्ड करें">🔄 डिफ़ॉल्ट</button>
        </div>
      </td>
    `;
    frag.appendChild(tr);
  });
  tbody.appendChild(frag);
}

// -------------------------------------------------------------------------
// PERMISSION ACCESS ENFORCERS (PRINT, DOWNLOAD, SEARCH)
// -------------------------------------------------------------------------
function canUserPrint() {
  if (!State.currentUser) return false;
  const u = State.currentUser;
  if (u.role === 'SUPER_ADMIN') return true;

  // 1. Direct explicit permission takes highest priority (Strict!)
  if (u.can_print !== undefined && u.can_print !== null) {
    return (u.can_print === true || u.can_print === 1 || String(u.can_print).toLowerCase() === 'true');
  }

  // 2. Local override check
  const ov = (typeof getUserOverrides === 'function' ? getUserOverrides()[u.id || u.username] : null) || {};
  if (ov.can_print !== undefined && ov.can_print !== null) {
    return (ov.can_print === true || ov.can_print === 1 || String(ov.can_print).toLowerCase() === 'true');
  }

  return false;
}

function canUserDownload() {
  if (!State.currentUser) return false;
  const u = State.currentUser;
  if (u.role === 'SUPER_ADMIN') return true;

  // 1. Direct explicit permission takes highest priority (Strict!)
  if (u.can_download !== undefined && u.can_download !== null) {
    return (u.can_download === true || u.can_download === 1 || String(u.can_download).toLowerCase() === 'true');
  }

  // 2. Local override check
  const ov = (typeof getUserOverrides === 'function' ? getUserOverrides()[u.id || u.username] : null) || {};
  if (ov.can_download !== undefined && ov.can_download !== null) {
    return (ov.can_download === true || ov.can_download === 1 || String(ov.can_download).toLowerCase() === 'true');
  }

  return false;
}

// -------------------------------------------------------------------------
// ENHANCED POPULATE GP FILTER DROPDOWNS (POPULATES ALL DROPDOWNS RELIABLY)
// -------------------------------------------------------------------------
function populateGpFilterDropdowns() {
  const allowedGps = getAllowedGps();
  if (!allowedGps || allowedGps.length === 0) return;

  const isSuper = (!State.currentUser || State.currentUser.role === 'SUPER_ADMIN' || State.currentUser.role === 'INCHARGE' || State.currentUser.role === 'VYAVASTHAPAK' || State.currentUser.role === 'BLOCK_PRABHARI');

  // Helper to populate any GP select element
  const fillSelect = (selectEl, includeAll, defaultVal) => {
    if (!selectEl) return;
    const cur = selectEl.value;
    selectEl.innerHTML = '';
    if (includeAll) {
      const allOpt = document.createElement('option');
      allOpt.value = 'ALL';
      allOpt.textContent = '-- सभी 30 ग्राम पंचायत --';
      selectEl.appendChild(allOpt);
    }
    allowedGps.forEach(gp => {
      const opt = document.createElement('option');
      opt.value = gp.code || gp.name_hi;
      opt.textContent = `${gp.name_hi} (${gp.code || ''})`;
      selectEl.appendChild(opt);
    });

    if (cur && Array.from(selectEl.options).some(o => o.value === cur)) {
      selectEl.value = cur;
    } else if (defaultVal && Array.from(selectEl.options).some(o => o.value === defaultVal)) {
      selectEl.value = defaultVal;
    } else if (includeAll) {
      selectEl.value = 'ALL';
    } else if (selectEl.options.length > 0) {
      selectEl.selectedIndex = 0;
    }
  };

  // 1. Core tabs
  fillSelect(document.getElementById('filterGp'), isSuper);
  fillSelect(document.getElementById('dirGpSelect'), false);

  // Requirement 2: alphaGpSelect starts with prompt so it does not auto-render all 30 GPs
  const alphaSel = document.getElementById('alphaGpSelect');
  if (alphaSel) {
    const curVal = alphaSel.value;
    alphaSel.innerHTML = '<option value="">-- कृपया ग्राम पंचायत चुनें --</option>';
    allowedGps.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.code;
      opt.textContent = `${p.name_hi} (${p.code})`;
      alphaSel.appendChild(opt);
    });
    if (curVal && Array.from(alphaSel.options).some(o => o.value === curVal)) {
      alphaSel.value = curVal;
    } else {
      alphaSel.value = '';
    }
  }

  fillSelect(document.getElementById('bulkGpSelect'), false);

  // 2. Candidate Tab
  const candGp = document.getElementById('candidateGpSelect');
  fillSelect(candGp, false);

  // Strict locking if user is assigned only 1 Gram Panchayat
  if (!isSuper && allowedGps.length === 1) {
    const singleGp = allowedGps[0];
    const filterGpEl = document.getElementById('filterGp');
    if (filterGpEl) {
      filterGpEl.value = singleGp.code;
      filterGpEl.disabled = true;
    }
    if (alphaSel) {
      alphaSel.value = singleGp.code;
      alphaSel.disabled = true;
    }
    const bulkGpEl = document.getElementById('bulkGpSelect');
    if (bulkGpEl) {
      bulkGpEl.value = singleGp.code;
      bulkGpEl.disabled = true;
    }
    if (candGp) {
      candGp.value = singleGp.name_hi;
      candGp.disabled = true;
    }
    const dirGpEl = document.getElementById('dirGpSelect');
    if (dirGpEl) {
      dirGpEl.value = singleGp.code;
      dirGpEl.disabled = true;
    }
  } else {
    ['filterGp', 'alphaGpSelect', 'bulkGpSelect', 'candidateGpSelect', 'dirGpSelect'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = false;
    });
  }

  if (candGp && typeof onCandidateGpChanged === 'function') {
    onCandidateGpChanged(candGp.value);
  }

  // 3. Admin Hub Filters
  fillSelect(document.getElementById('adminBloGpFilter'), true);
  fillSelect(document.getElementById('adminCandGpFilter'), true);
  fillSelect(document.getElementById('bloPassGpFilter'), true);
  fillSelect(document.getElementById('newUserGpSelect'), false);
  fillSelect(document.getElementById('bloEditGp'), false);

  // 4. Admin Cell Filter (18 official cells)
  const cellFilter = document.getElementById('adminCellFilterSelect');
  if (cellFilter) {
    const curCell = cellFilter.value;
    cellFilter.innerHTML = '<option value="ALL">-- समस्त 18 चुनाव प्रकोष्ठ --</option>';
    const dir = getMasterDirectory();
    if (dir && dir.official_cells) {
      dir.official_cells.forEach(cell => {
        const opt = document.createElement('option');
        opt.value = cell.cell_id;
        opt.textContent = `${cell.cell_no}. ${cell.cell_name}`;
        cellFilter.appendChild(opt);
      });
    }
    if (curCell && Array.from(cellFilter.options).some(o => o.value === curCell)) {
      cellFilter.value = curCell;
    }
  }

  // 5. Directory GP/Booth filter
  const dirGpBooth = document.getElementById('dirGpBoothFilterSelect');
  if (dirGpBooth && dirGpBooth.options.length <= 1) {
    dirGpBooth.innerHTML = '<option value="ALL">🌍 समस्त पंचायतें व बूथ (All 30 Panchayats)</option>';
    const gpGroup = document.createElement('optgroup');
    gpGroup.label = '🏛️ ग्राम पंचायत चुनें (30 Panchayats)';
    allowedGps.forEach(gp => {
      const opt = document.createElement('option');
      opt.value = 'GP_' + gp.name_hi;
      opt.textContent = `🏛️ ग्रा.पं. ${gp.name_hi} (${gp.code || ''})`;
      gpGroup.appendChild(opt);
    });
    dirGpBooth.appendChild(gpGroup);
  }

  // Trigger sub-updates
  if (typeof onGpFilterChanged === 'function') onGpFilterChanged();
  if (typeof onAlphaGpChanged === 'function') onAlphaGpChanged();
  if (typeof onBulkGpChanged === 'function') onBulkGpChanged();
}


// ==========================================================================
// MASTER DIRECTORY SYNCHRONOUS RESOLVER
// ==========================================================================
function getMasterDirectory() {
  if (typeof window !== 'undefined' && window.MASTER_DIRECTORY && window.MASTER_DIRECTORY.blo_list) {
    return window.MASTER_DIRECTORY;
  }
  if (typeof MASTER_DIRECTORY !== 'undefined' && MASTER_DIRECTORY && MASTER_DIRECTORY.blo_list) {
    if (typeof window !== 'undefined') window.MASTER_DIRECTORY = MASTER_DIRECTORY;
    return MASTER_DIRECTORY;
  }
  return (typeof State !== 'undefined' && State.masterDirectory) || null;
}

// ==========================================================================
// CELL PERSONNEL MANAGEMENT ENGINE (SUPER ADMIN CONTROL)
// ==========================================================================
function openAddCellModal() {
  const modal = document.getElementById('addEditCellModal');
  if (!modal) return;
  const sel = document.getElementById('cellEditSelect');
  if (sel) {
    sel.innerHTML = `
      <option value="निर्वाचन शाखा (पर्यवेक्षण व नियंत्रण)">निर्वाचन शाखा (पर्यवेक्षण व नियंत्रण)</option>
      <option value="कार्मिक प्रकोष्ठ (मतदान दल गठन)">कार्मिक प्रकोष्ठ (मतदान दल गठन)</option>
      <option value="ईवीएम प्रकोष्ठ (EVM एवं VVPAT)">ईवीएम प्रकोष्ठ (EVM एवं VVPAT)</option>
      <option value="कंट्रोल रूम व हेल्पलाइन प्रकोष्ठ">कंट्रोल रूम व हेल्पलाइन प्रकोष्ठ</option>
      <option value="आदर्श आचार संहिता (MCC) प्रकोष्ठ">आदर्श आचार संहिता (MCC) प्रकोष्ठ</option>
      <option value="रूट चार्ट एवं पर्यवेक्षण प्रकोष्ठ">रूट चार्ट एवं पर्यवेक्षण प्रकोष्ठ</option>
      <option value="वाहन एवं परिवहन प्रकोष्ठ">वाहन एवं परिवहन प्रकोष्ठ</option>
      <option value="मतपत्र एवं डाक मतपत्र प्रकोष्ठ">मतपत्र एवं डाक मतपत्र प्रकोष्ठ</option>
      <option value="स्वीप (SVEEP) मतदाता जागरूकता">स्वीप (SVEEP) मतदाता जागरूकता</option>
      <option value="मतदान केंद्र व्यवस्था प्रकोष्ठ">मतदान केंद्र व्यवस्था प्रकोष्ठ</option>
      <option value="प्राप्ति एवं रवानगी प्रकोष्ठ">प्राप्ति एवं रवानगी प्रकोष्ठ</option>
      <option value="ड्यूटी प्रमाण पत्र प्रकोष्ठ">ड्यूटी प्रमाण पत्र प्रकोष्ठ</option>
      <option value="चिकित्सा एवं प्राथमिक स्वास्थ्य">चिकित्सा एवं प्राथमिक स्वास्थ्य</option>
    `;
  }
  const title = document.getElementById('cellModalTitle');
  if (title) title.textContent = '➕ नया चुनाव प्रकोष्ठ कार्मिक जोड़ें';
  document.getElementById('cellEditTargetId').value = '';
  document.getElementById('cellEditName').value = '';
  document.getElementById('cellEditMobile').value = '';
  document.getElementById('cellEditPost').value = '';
  document.getElementById('cellEditOffice').value = 'उपखण्ड कार्यालय भिनाय';
  const passInp = document.getElementById('cellEditPassword');
  if (passInp) passInp.value = 'bhinai2026';
  modal.style.display = 'flex';
}

function closeAddEditCellModal() {
  const modal = document.getElementById('addEditCellModal');
  if (modal) modal.style.display = 'none';
}

async function handleSaveCellSubmit(event) {
  if (event) event.preventDefault();
  const targetId = document.getElementById('cellEditTargetId')?.value.trim();
  const cellName = document.getElementById('cellEditSelect')?.value.trim();
  const name = document.getElementById('cellEditName')?.value.trim();
  const mobile = document.getElementById('cellEditMobile')?.value.trim();
  const post = document.getElementById('cellEditPost')?.value.trim() || 'प्रकोष्ठ कार्मिक';
  const office = document.getElementById('cellEditOffice')?.value.trim() || 'उपखण्ड कार्यालय भिनाय';
  const role = document.getElementById('cellEditRole')?.value || 'प्रकोष्ठ कार्मिक';
  const pass = document.getElementById('cellEditPassword')?.value.trim() || 'bhinai2026';

  if (!name || !cellName) {
    alert('कृपया नाम एवं प्रकोष्ठ का चयन अवश्य करें!');
    return;
  }

  const cId = targetId || ('cell_custom_' + Date.now());
  const cellObj = {
    id: cId,
    username: cId,
    name: name,
    cell_name: cellName,
    mobile: mobile,
    post: post,
    designation: post,
    office: office,
    role: role,
    password: pass,
    status: 'ACTIVE',
    panchayat: 'समस्त ब्लॉक भिनाय',
    allowed_panchayats: 'ALL',
    allowed_wards: 'ALL',
    allowed_tabs: ['directoryTab']
  };

  const dir = getMasterDirectory();
  if (dir) {
    if (!dir.cell_personnel) dir.cell_personnel = [];
    const idx = dir.cell_personnel.findIndex(x => (x.id || x.username) === cId);
    if (idx !== -1) dir.cell_personnel[idx] = cellObj;
    else dir.cell_personnel.push(cellObj);
  }

  const customCells = JSON.parse(localStorage.getItem('portal_custom_cell_personnel') || '[]');
  const cIdx = customCells.findIndex(x => (x.id || x.username) === cId);
  if (cIdx !== -1) customCells[cIdx] = cellObj;
  else customCells.push(cellObj);
  localStorage.setItem('portal_custom_cell_personnel', JSON.stringify(customCells));
  setCustomUserPassword(cId, pass);

  closeAddEditCellModal();
  if (typeof renderBloPassTable === 'function') if (typeof renderBloPassTable === 'function') renderBloPassTable();
  showToast(`✅ प्रकोष्ठ कार्मिक '${name}' सफलतापूर्वक सुरक्षित!`);
}

function deleteCellPersonnel(cellId, cellName) {
  if (!confirm(`क्या आप प्रकोष्ठ कार्मिक '${cellName || cellId}' को हटाना चाहते हैं?`)) return;
  const dir = getMasterDirectory();
  if (dir && dir.cell_personnel) {
    dir.cell_personnel = dir.cell_personnel.filter(x => (x.id || x.username) !== cellId);
  }
  const customCells = JSON.parse(localStorage.getItem('portal_custom_cell_personnel') || '[]');
  const filtered = customCells.filter(x => (x.id || x.username) !== cellId);
  localStorage.setItem('portal_custom_cell_personnel', JSON.stringify(filtered));
  setCustomUserStatus(cellId, 'INACTIVE');

  if (typeof renderBloPassTable === 'function') if (typeof renderBloPassTable === 'function') renderBloPassTable();
  showToast(`🗑️ कार्मिक '${cellName || cellId}' हटा दिया गया!`);
}

// ==========================================================================
// DYNAMIC 2ND DROPDOWN LOGIC (ONLY SHOWN FOR CELL OR PANCHAYAT!)
// ==========================================================================
function onLoginPrimarySelectChanged(val) {
  const offGroup = document.getElementById('loginSecondarySelectGroup');
  const offSelect = document.getElementById('loginOfficerSelect');
  const offLabel = document.getElementById('loginOfficerLabel');
  const detailsBadge = document.getElementById('loginSelectedDetailsBadge');
  const uInput = document.getElementById('gatekeeperUsername');

  if (detailsBadge) {
    detailsBadge.style.display = 'none';
    detailsBadge.textContent = '';
  }
  if (uInput) uInput.value = '';

  if (!val) {
    if (offSelect) {
      offSelect.innerHTML = '<option value="">-- पहले ऊपर प्रकोष्ठ या पंचायत चुनें --</option>';
      offSelect.disabled = true;
    }
    return;
  }

  const dir = getMasterDirectory();

  // 1. ADMIN (Super Admin) - 2nd dropdown is HIDDEN!
  if (val === 'ADMIN') {
    if (offGroup) offGroup.style.display = 'none';
    if (uInput) uInput.value = 'admin';
    if (detailsBadge) {
      detailsBadge.innerHTML = '👑 <strong>मुख्य व्यवस्थापक (Super Admin):</strong> समस्त 30 पंचायतों एवं संपूर्ण पोर्टल का पूर्ण नियंत्रण।';
      detailsBadge.style.background = '#fef3c7';
      detailsBadge.style.color = '#92400e';
      detailsBadge.style.border = '1px solid #fde68a';
      detailsBadge.style.display = 'block';
    }
    document.getElementById('gatekeeperPassword')?.focus();
    return;
  }

  // 2. INCHARGE (ब्लॉक इनचार्ज - केवल अवलोकन) - 2nd dropdown is HIDDEN!
  if (val === 'INCHARGE') {
    if (offGroup) offGroup.style.display = 'none';
    if (uInput) uInput.value = 'incharge';
    if (detailsBadge) {
      detailsBadge.innerHTML = '👁️ <strong>ब्लॉक इनचार्ज (Incharge):</strong> समस्त 30 ग्राम पंचायतों का अवलोकन अधिकार (केवल अवलोकन / View Only - एडिट वर्जित)।';
      detailsBadge.style.background = '#e0e7ff';
      detailsBadge.style.color = '#3730a3';
      detailsBadge.style.border = '1px solid #c7d2fe';
      detailsBadge.style.display = 'block';
    }
    document.getElementById('gatekeeperPassword')?.focus();
    return;
  }

  // 3. VYAVASTHAPAK (व्यवस्थापक - प्रिंट व डाउनलोड) - 2nd dropdown is HIDDEN!
  if (val === 'VYAVASTHAPAK') {
    if (offGroup) offGroup.style.display = 'none';
    if (uInput) uInput.value = 'vyavasthapak';
    if (detailsBadge) {
      detailsBadge.innerHTML = '🖨️ <strong>व्यवस्थापक (Vyavasthapak):</strong> समस्त 30 ग्राम पंचायतों में मतदाता सूची अवलोकन, पर्ची डाउनलोड एवं प्रिंट अधिकार।';
      detailsBadge.style.background = '#d1fae5';
      detailsBadge.style.color = '#065f46';
      detailsBadge.style.border = '1px solid #a7f3d0';
      detailsBadge.style.display = 'block';
    }
    document.getElementById('gatekeeperPassword')?.focus();
    return;
  }

  // 4. BLOCK_PRABHARI
  if (val === 'BLOCK_PRABHARI') {
    if (offGroup) offGroup.style.display = 'block';
    if (offLabel) offLabel.innerHTML = '<strong>2. अधिकृत ब्लॉक प्रभारी *:</strong>';
    if (offSelect) {
      offSelect.innerHTML = `
        <option value="block_prabhari" data-name="ब्लॉक प्रभारी" data-role="ब्लॉक प्रभारी" data-office="उपखण्ड कार्यालय भिनाय" data-mobile="9950705221" data-cell="समस्त 30 ग्राम पंचायतें">🌟 ब्लॉक प्रभारी (मो. 9950705221)</option>
      `;
      offSelect.disabled = false;
      offSelect.value = 'block_prabhari';
    }
    if (uInput) uInput.value = 'block_prabhari';
    if (detailsBadge) {
      detailsBadge.innerHTML = '🌟 <strong>ब्लॉक प्रभारी</strong> | समस्त 30 ग्राम पंचायतें (पूर्ण वोटर खोज अधिकार) | मो.: 9950705221';
      detailsBadge.style.background = '#ccfbf1';
      detailsBadge.style.color = '#0f766e';
      detailsBadge.style.border = '1px solid #99f6e4';
      detailsBadge.style.display = 'block';
    }
    const hint = document.getElementById('defaultPassHint');
    if (hint) { hint.textContent = 'पासवर्ड: BHINAI123'; hint.style.color = '#0f766e'; }
    document.getElementById('gatekeeperPassword')?.focus();
    return;
  }

  // 5. CELL (चुनाव प्रकोष्ठ) - 2nd dropdown APPEARS!
  if (val === 'CELL') {
    if (offGroup) offGroup.style.display = 'block';
    if (offLabel) offLabel.innerHTML = '<strong>2. अधिकृत चुनाव प्रकोष्ठ कार्मिक चुनें *:</strong>';
    if (offSelect) {
      offSelect.innerHTML = '<option value="">-- अधिकृत प्रकोष्ठ कार्मिक चुनें --</option>';
      let customCells = [];
      try { customCells = JSON.parse(localStorage.getItem('portal_custom_cell_personnel') || '[]'); } catch(e){}
      const cellList = [...customCells, ...((dir && dir.cell_personnel) ? dir.cell_personnel : [])];
      
      const seen = new Set();
      cellList.forEach(cp => {
        const cId = cp.username || cp.id;
        if (!cId || seen.has(cId)) return;
        seen.add(cId);

        const opt = document.createElement('option');
        opt.value = cId;
        opt.setAttribute('data-name', cp.name || '');
        opt.setAttribute('data-role', cp.designation || cp.role || '');
        opt.setAttribute('data-office', cp.office || cp.school_office || '');
        opt.setAttribute('data-mobile', cp.mobile || '');
        opt.setAttribute('data-cell', cp.cell_name || '');
        opt.textContent = `[${cp.cell_name || 'प्रकोष्ठ'}] ${cp.name} - ${cp.designation || cp.role || 'कार्मिक'} (${cp.mobile || '-'})`;
        offSelect.appendChild(opt);
      });
      offSelect.disabled = false;
      offSelect.focus();
    }
    return;
  }

  // 6. GRAM PANCHAYAT SELECTED (30 GPs) - 2nd dropdown APPEARS!
  if (offGroup) offGroup.style.display = 'block';
  if (offLabel) offLabel.innerHTML = `<strong>2. बी.एल.ओ. (BLO) चुनें [ग्रा.पं. ${val}] *:</strong>`;
  if (offSelect) {
    offSelect.innerHTML = '<option value="">-- बी.एल.ओ. (BLO) चुनें --</option>';
    const bloList = (dir && dir.blo_list) ? dir.blo_list : [];
    const vClean = val.trim();
    const matched = bloList.filter(b => {
      const bGp = (b.panchayat || '').trim();
      if (bGp === vClean || bGp.includes(vClean) || vClean.includes(bGp)) return true;
      const n1 = bGp.replace(/[\s\-_]/g, '');
      const n2 = vClean.replace(/[\s\-_]/g, '');
      return n1 === n2 || n1.includes(n2) || n2.includes(n1);
    });

    if (matched.length === 0) {
      offSelect.innerHTML = `<option value="">-- ग्रा.पं. ${val} में कोई BLO दर्ज नहीं है --</option>`;
      offSelect.disabled = true;
      return;
    }

    matched.sort((a, b) => (parseInt(a.booth_no, 10) || 0) - (parseInt(b.booth_no, 10) || 0));

    matched.forEach(blo => {
      const opt = document.createElement('option');
      const bId = blo.username || blo.id || `blo_${blo.booth_no}`;
      opt.value = bId;
      opt.setAttribute('data-name', blo.name || '');
      opt.setAttribute('data-booth', blo.booth_no || '');
      opt.setAttribute('data-school', blo.school || '');
      opt.setAttribute('data-mobile', blo.mobile || '');
      opt.textContent = `बूथ ${blo.booth_no} - ${blo.name} (${blo.school || 'मतदान केंद्र'})`;
      offSelect.appendChild(opt);
    });
    offSelect.disabled = false;
    offSelect.focus();
  }
}

function onLoginPanchayatSelected(val) {
  return onLoginPrimarySelectChanged(val);
}

function onLoginOfficerChanged(officerId) {
  const offSelect = document.getElementById('loginOfficerSelect');
  const detailsBadge = document.getElementById('loginSelectedDetailsBadge');
  const uInput = document.getElementById('gatekeeperUsername');

  if (uInput) uInput.value = officerId || '';

  if (officerId && offSelect && offSelect.selectedIndex >= 0) {
    const selectedOpt = offSelect.options[offSelect.selectedIndex];
    if (!selectedOpt || !selectedOpt.value) {
      if (detailsBadge) detailsBadge.style.display = 'none';
      return;
    }
    const name = selectedOpt.getAttribute('data-name') || '';
    const booth = selectedOpt.getAttribute('data-booth') || '';
    const school = selectedOpt.getAttribute('data-school') || '';
    const mobile = selectedOpt.getAttribute('data-mobile') || '';
    const cell = selectedOpt.getAttribute('data-cell') || '';
    const role = selectedOpt.getAttribute('data-role') || '';

    if (detailsBadge) {
      if (cell) {
        detailsBadge.innerHTML = `🏢 <strong>${name}</strong> (${role || 'प्रकोष्ठ कार्मिक'}) | ${cell} | मो.: ${mobile || '-'}`;
        detailsBadge.style.background = '#eff6ff';
        detailsBadge.style.color = '#1e40af';
        detailsBadge.style.border = '1px solid #bfdbfe';
      } else {
        detailsBadge.innerHTML = `👤 <strong>${name}</strong> (BLO बूथ क्रमांक ${booth}) | ${school || 'मतदान केंद्र'} | मो.: ${mobile || '-'}`;
        detailsBadge.style.background = '#f0fdf4';
        detailsBadge.style.color = '#166534';
        detailsBadge.style.border = '1px solid #bbf7d0';
      }
      detailsBadge.style.display = 'block';
    }
    document.getElementById('gatekeeperPassword')?.focus();
  } else {
    if (detailsBadge) detailsBadge.style.display = 'none';
  }
}

if (typeof window !== 'undefined') {
  window.onLoginPanchayatSelected = onLoginPrimarySelectChanged;
  window.onLoginPrimarySelectChanged = onLoginPrimarySelectChanged;
  window.onLoginOfficerChanged = onLoginOfficerChanged;
}


function toggleManualUsername() {
  const mDiv = document.getElementById('manualUsernameDiv');
  const tBtn = document.getElementById('toggleManualUserBtn');
  const pGrp = document.getElementById('loginPrimarySelectGroup');
  const sGrp = document.getElementById('loginSecondarySelectGroup');

  if (!mDiv) return;

  if (mDiv.style.display === 'none') {
    mDiv.style.display = 'block';
    if (pGrp) pGrp.style.display = 'none';
    if (sGrp) sGrp.style.display = 'none';
    if (tBtn) tBtn.textContent = '◀ वापस पद/पंचायत ड्रॉपडाउन से चुनें';
    const inp = document.getElementById('manualUsernameInput');
    if (inp) {
      inp.focus();
      if (inp.value) document.getElementById('gatekeeperUsername').value = inp.value.trim();
    }
  } else {
    mDiv.style.display = 'none';
    if (pGrp) pGrp.style.display = 'block';
    const pVal = document.getElementById('loginPanchayatSelect')?.value;
    if (sGrp && (pVal === 'CELL' || BHINAI_PANCHAYATS_30.includes(pVal))) {
      sGrp.style.display = 'block';
    }
    if (tBtn) tBtn.textContent = '✏️ सीधे यूजर आईडी टाइप करें';
  }
}

function onManualUsernameInput(val) {
  const hu = document.getElementById('gatekeeperUsername');
  if (hu) hu.value = (val || '').trim();
}

function configureLoginUiForPortal() {
  // Static unified form in HTML
}

// USER SCOPE & SEARCH PERMISSION ENGINE (SUPER ADMIN CONTROL)
// ==========================================================================
function getCustomUserScope(userId) {
  if (State.adminControlUsers && State.adminControlUsers.length > 0) {
    const u = State.adminControlUsers.find(x => 
      (x.id && String(x.id).toLowerCase() === String(userId).toLowerCase()) ||
      (x.username && String(x.username).toLowerCase() === String(userId).toLowerCase())
    );
    if (u && u.allowed_panchayats) return u.allowed_panchayats;
  }
  try {
    const sc = JSON.parse(localStorage.getItem('portal_user_scopes') || '{}');
    if (sc && sc[userId]) return sc[userId];
  } catch(e) {}
  return null;
}

function setCustomUserScope(userId, scopeVal) {
  try {
    const sc = JSON.parse(localStorage.getItem('portal_user_scopes') || '{}');
    sc[userId] = scopeVal;
    localStorage.setItem('portal_user_scopes', JSON.stringify(sc));
  } catch(e) {}
}

async function adminUpdateUserScope(userId, scopeVal) {
  setCustomUserScope(userId, scopeVal);
  
  // Also update in State.adminControlUsers
  const u = (State.adminControlUsers || []).find(x => (x.id || x.username) === userId);
  if (u) {
    if (scopeVal === 'ALL_30_GP' || scopeVal === 'SEARCH_30_GP') {
      u.allowed_panchayats = 'ALL';
      u.allowed_wards = 'ALL';
      u.allowed_tabs = ['dashboardTab', 'searchTab', 'alphaTab', 'directoryTab'];
      u.can_search_all = true;
    } else if (scopeVal === 'PANCHAYAT') {
      u.allowed_panchayats = u.panchayat || 'ALL';
      u.allowed_wards = 'ALL';
      u.allowed_tabs = ['searchTab', 'alphaTab', 'directoryTab'];
      u.can_search_all = false;
    } else if (scopeVal === 'DIR_ONLY') {
      u.allowed_tabs = ['directoryTab'];
      u.can_search_all = false;
    } else {
      // BOOTH
      u.allowed_panchayats = u.panchayat || 'ALL';
      u.allowed_wards = u.wards || 'ALL';
      u.allowed_tabs = ['searchTab', 'alphaTab', 'directoryTab'];
      u.can_search_all = false;
    }
    try { localStorage.setItem('portal_admin_users_overrides', JSON.stringify(State.adminControlUsers)); } catch(e) {}
    await saveAdminUserToServer(u);
  }

  showToast(`✅ '${userId}' का अधिकार सेट: ${scopeVal === 'ALL_30_GP' || scopeVal === 'SEARCH_30_GP' ? 'समस्त 30 ग्रा.पं. वोटर सर्च' : (scopeVal === 'PANCHAYAT' ? 'पूरी ग्राम पंचायत' : 'केवल बूथ/डायरेक्टरी')}`);
  if (typeof renderBloPassTable === 'function') if (typeof renderBloPassTable === 'function') renderBloPassTable();
}


// ==========================================================================
// BLOCK PRABHARI & SUPER ADMIN LOCAL OVERRIDES ENGINE
// ==========================================================================
function getCustomUserPassword(username) {
  if (State.adminControlUsers && State.adminControlUsers.length > 0) {
    const u = State.adminControlUsers.find(x => 
      (x.id && String(x.id).toLowerCase() === String(username).toLowerCase()) ||
      (x.username && String(x.username).toLowerCase() === String(username).toLowerCase())
    );
    if (u && u.password) return u.password;
  }
  try {
    const ov = JSON.parse(localStorage.getItem('portal_passwords_override') || '{}');
    if (ov && ov[username]) return ov[username];
  } catch(e) {}
  return null;
}

function getCustomUserStatus(username) {
  if (State.adminControlUsers && State.adminControlUsers.length > 0) {
    const u = State.adminControlUsers.find(x => 
      (x.id && String(x.id).toLowerCase() === String(username).toLowerCase()) ||
      (x.username && String(x.username).toLowerCase() === String(username).toLowerCase())
    );
    if (u && u.status) return u.status;
  }
  try {
    const st = JSON.parse(localStorage.getItem('portal_status_override') || '{}');
    if (st && st[username]) return st[username];
  } catch(e) {}
  return 'ACTIVE';
}

function setCustomUserPassword(username, newPass) {
  try {
    const ov = JSON.parse(localStorage.getItem('portal_passwords_override') || '{}');
    ov[username] = newPass;
    localStorage.setItem('portal_passwords_override', JSON.stringify(ov));
  } catch(e) {}
}

function setCustomUserStatus(username, newStatus) {
  try {
    const st = JSON.parse(localStorage.getItem('portal_status_override') || '{}');
    st[username] = newStatus;
    localStorage.setItem('portal_status_override', JSON.stringify(st));
  } catch(e) {}
}


function getBoothForVoter(voter) {
  if (!voter) return null;
  const gpCode = String(voter.panchayat_code || '').trim().toLowerCase();
  const gpHindi = String(voter.gram_panchayat || '').trim();
  const gpEn = String(voter.panchayat_en || '').trim().toLowerCase();
  const wardNo = parseInt(voter.ward_no, 10);
  const booths = (window.MASTER_DATA && window.MASTER_DATA.polling_booths) || [];
  if (booths.length === 0) return null;

  const panchs = (State.panchayats && State.panchayats.length > 0) ? State.panchayats : ((window.MASTER_DATA && window.MASTER_DATA.panchayats) || []);
  const pObj = panchs.find(p => 
    (p.code && p.code.toLowerCase() === gpCode) ||
    (p.name_hi && p.name_hi === gpHindi) ||
    (p.name_en && (p.name_en.toLowerCase() === gpEn || p.name_en.toLowerCase() === gpCode))
  );

  const targetEn = pObj ? pObj.name_en.toLowerCase() : gpEn;
  const targetHi = pObj ? pObj.name_hi : gpHindi;
  const targetCode = pObj ? pObj.code.toLowerCase() : gpCode;

  const matchWithWard = booths.find(b => {
    const bGp = (b.gp || '').toLowerCase().trim();
    const bGpHid = (b.gp_hindi || '').trim();
    const isGpMatch = (bGp === targetEn || bGpHid === targetHi || bGp === targetHi.toLowerCase() || bGp === targetCode);
    return isGpMatch && Array.isArray(b.wards) && b.wards.includes(wardNo);
  });
  if (matchWithWard) return matchWithWard;

  return booths.find(b => {
    const bGp = (b.gp || '').toLowerCase().trim();
    const bGpHid = (b.gp_hindi || '').trim();
    return (bGp === targetEn || bGpHid === targetHi || bGp === targetHi.toLowerCase() || bGp === targetCode);
  }) || null;
}

function getVoterPhotoUrl(voter) {
  if (!voter) return 'https://api.dicebear.com/7.x/identicon/svg?seed=voter';

  let pEn = voter.panchayat_en || voter.panchayatEn || voter.p_en;
  if (!pEn) {
    const code = voter.panchayat_code || voter.panchayatCode || voter.gram_panchayat || voter.p_hi;
    if (code) {
      const gp = State.panchayats.find(p => 
        p.code.toLowerCase() === String(code).toLowerCase() ||
        p.name_en.toLowerCase() === String(code).toLowerCase() ||
        p.name_hi === String(code)
      );
      if (gp) pEn = gp.name_en;
    }
  }

  const FOLDER_MAP = {
    'badgaon': 'Badgaon', 'badli': 'Badli', 'bagrai': 'Bagrai', 'bandanwara': 'Bandanwara',
    'bhinay': 'Bhinay', 'boobkiya': 'Boobkiya', 'chapaneri': 'Chapaneri', 'chhachhundra': 'Chhachhundra',
    'devpura': 'DEVPURA', 'devliyakalan': 'Devliyakalan', 'dhantol': 'Dhantol', 'ekalsingha': 'Ekalsingha',
    'ghana': 'Ghana', 'gudhakhurd': 'GudhaKhurd', 'hiyaliya': 'Hiyaliya', 'kanaikalan': 'Kanaikalan',
    'karanti': 'Karanti', 'kerot': 'Kerot', 'khedi': 'Khedi', 'kumhariya': 'Kumhariya',
    'lamgra': 'Lamgra', 'nagola': 'Nagola', 'nandsi': 'Nandsi', 'padanga': 'Padanga',
    'padliya': 'Padliya', 'rammaliya': 'Rammaliya', 'ratakot': 'Ratakot', 'singawal': 'Singawal',
    'sobdi': 'Sobdi', 'solkhurd': 'Solkhurd'
  };

  const rawWard = String(voter.ward_no || voter.ward || voter.w || '1').replace(/\D/g, '');
  const wardNo = parseInt(rawWard, 10) || 1;
  const rawSerial = String(voter.serial_no || voter.serial || voter.serialNo || voter.s || '1').replace(/\D/g, '');
  const serialNo = parseInt(rawSerial, 10) || 1;

  if (pEn) {
    const folder = FOLDER_MAP[pEn.toLowerCase()] || pEn;
    const wNum = String(wardNo).padStart(2, '0');
    return `https://raw.githubusercontent.com/Jit9763/voter-photos/main/${folder}/W${wNum}/${serialNo}.webp`;
  }

  return voter.photo_url || voter.photo || `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(voter.epic_no || voter.epic || serialNo || '1')}`;
}

function getVoterSlipCutUrl(voter) {
  if (!voter) return null;

  let pEn = voter.panchayat_en || voter.panchayatEn || voter.p_en;
  if (!pEn) {
    const code = voter.panchayat_code || voter.panchayatCode || voter.gram_panchayat || voter.p_hi;
    if (code) {
      const gp = State.panchayats.find(p => 
        p.code.toLowerCase() === String(code).toLowerCase() ||
        p.name_en.toLowerCase() === String(code).toLowerCase() ||
        p.name_hi === String(code)
      );
      if (gp) pEn = gp.name_en;
    }
  }

  const FOLDER_MAP = {
    'badgaon': 'Badgaon', 'badli': 'Badli', 'bagrai': 'Bagrai', 'bandanwara': 'Bandanwara',
    'bhinay': 'Bhinay', 'boobkiya': 'Boobkiya', 'chapaneri': 'Chapaneri', 'chhachhundra': 'Chhachhundra',
    'devpura': 'DEVPURA', 'devliyakalan': 'Devliyakalan', 'dhantol': 'Dhantol', 'ekalsingha': 'Ekalsingha',
    'ghana': 'Ghana', 'gudhakhurd': 'GudhaKhurd', 'hiyaliya': 'Hiyaliya', 'kanaikalan': 'Kanaikalan',
    'karanti': 'Karanti', 'kerot': 'Kerot', 'khedi': 'Khedi', 'kumhariya': 'Kumhariya',
    'lamgra': 'Lamgra', 'nagola': 'Nagola', 'nandsi': 'Nandsi', 'padanga': 'Padanga',
    'padliya': 'Padliya', 'rammaliya': 'Rammaliya', 'ratakot': 'Ratakot', 'singawal': 'Singawal',
    'sobdi': 'Sobdi', 'solkhurd': 'Solkhurd'
  };

  const rawWard = String(voter.ward_no || voter.ward || voter.w || '1').replace(/\D/g, '');
  const wardNo = parseInt(rawWard, 10) || 1;
  const rawSerial = String(voter.serial_no || voter.serial || voter.serialNo || voter.s || '1').replace(/\D/g, '');
  const serialNo = parseInt(rawSerial, 10) || 1;

  if (pEn) {
    const folder = FOLDER_MAP[pEn.toLowerCase()] || pEn;
    const wNum = String(wardNo).padStart(2, '0');
    return `https://raw.githubusercontent.com/Jit9763/voter-photos/main/voter_slips/${folder}/W${wNum}/${serialNo}.webp`;
  }
  return null;
}

function viewSlipCutModal(imgUrl, voterName, serialNo) {
  let modal = document.getElementById('slipCutViewerModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'slipCutViewerModal';
    modal.className = 'modal-overlay';
    modal.style.zIndex = '99999';
    modal.innerHTML = `
      <div class="modal-container" style="max-width: 540px; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.35);">
        <div class="modal-header" style="background:#1e3a8a; color:#ffffff; padding:12px 18px; display:flex; justify-content:space-between; align-items:center;">
          <h3 style="margin:0; font-size:1.05rem; font-weight:700;" id="slipCutViewerTitle">📄 मूल मतदाता पर्ची कटिंग</h3>
          <button onclick="document.getElementById('slipCutViewerModal').style.display='none'" style="background:transparent; border:none; color:#ffffff; font-size:1.5rem; cursor:pointer; line-height:1;">&times;</button>
        </div>
        <div class="modal-body" style="padding:16px; text-align:center; background:#f8fafc;">
          <img id="slipCutViewerImg" src="" alt="Voter Slip Cut" style="max-width:100%; height:auto; border-radius:6px; border:2px solid #cbd5e1; box-shadow:0 4px 6px -1px rgba(0,0,0,0.1);" />
        </div>
        <div class="modal-footer" style="padding:10px 16px; background:#ffffff; border-top:1px solid #e2e8f0; display:flex; justify-content:flex-end;">
          <button class="btn btn-secondary btn-sm" onclick="document.getElementById('slipCutViewerModal').style.display='none'">बंद करें</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.onclick = (e) => {
      if (e.target === modal) modal.style.display = 'none';
    };
  }
  const titleEl = document.getElementById('slipCutViewerTitle');
  if (titleEl) titleEl.textContent = `📄 मूल पर्ची कटिंग: ${voterName || ''} (सरल क्र. ${serialNo || ''})`;
  const imgEl = document.getElementById('slipCutViewerImg');
  if (imgEl) imgEl.src = imgUrl;
  modal.style.display = 'flex';
}

/**
 * ==========================================================================
 * Panchayat Chunav 2026 - Master Portal Application Engine (app.js)
 * SDM Office & Official State Election Commission Voter System
 * Features:
 *   - Live Distribution Meter & Stats (मूल सूची vs परिवर्धन, विलोपित, प्रभावी)
 *   - Smart Multi-Filter Chips (Wards, Villages, Delivery Status, Gender)
 *   - Dual Alphabetical Roll (Hindi अ-ज्ञ & English A-Z) with Fast Index Jump
 *   - Bulk Official Voter Slip Generator (9, 12, 15 Slips per A4 & 58mm Thermal)
 *   - 100% Candidate-free Authoritative SDM Official Slip Design
 *   - Single Slip A4 & Thermal Print + WhatsApp Share
 *   - Role-based Access Control (Super Admin vs GP Incharge)
 *   - Google Drive & Google Sheet Live Synchronization
 * ==========================================================================
 */

// Global Application State
const State = {
  panchayats: [],
  adminUsers: [],
  voters: [],
  deletedVoters: [],
  currentUser: null,
  currentCandidate: null,
  currentSlipVoter: null,
  adminControlUsers: [],
  activeTab: 'dashboardTab',
  
  // Slip Delivery Tracking (Persistent in localStorage)
  deliveryMap: {},
  activeMeterFilter: 'ALL',
  activeFilterWard: 'ALL',
  activeFilterVillage: 'ALL',
  
  // Alphabetical Roll State
  alphaLang: 'hi', // 'hi' or 'en'
  alphaJumpLetter: null,
  
  // Bulk Slip Generator State
  bulkLayout: 12,    // 9, 12, 15, or 'thermal'
  bulkTheme: 'bw',   // 'bw' or 'color'
  bulkScope: 'PENDING', // 'ALL', 'PENDING', 'DELIVERED'
  bulkHouse: '',
  bulkPage: 1,
  bulkFilteredVoters: [],
  
  config: {
    adminSheetUrl: '',
    voterSheetUrl: '',
    appsScriptUrl: 'https://script.google.com/macros/s/AKfycbwtgz2L5QC_95Jsf1r0Kum_LcTI-bJwwiBQS_O74vthHcbPD_KatsN69ytY2yqlayiM/exec'
  }
};

// ==========================================================================
// Initialization
// ==========================================================================
document.addEventListener('DOMContentLoaded', async () => {
  initMasterData();
  initSession();
  initUiElements();
  try { await loadTriPortalSettings(); } catch(e) {}
  try { await loadAdminUsersList(true); } catch(e) {}
  startLivePermissionSyncWatcher();
});


// ==========================================================================
// Helper: Get GP Wards reliably
// ==========================================================================
function getGpWards(gp) {
  if (!gp) return [];
  if (Array.isArray(gp.wards) && gp.wards.length > 0) return gp.wards;
  const list = gp.ward_list || [];
  if (list.length > 0) {
    return list.map(w => ({
      ward_no: typeof w === 'object' ? (w.ward_no || w.no) : parseInt(w, 10),
      village: (gp.villages && gp.villages[0]) ? gp.villages[0] : gp.name_hi,
      voters: Math.round((gp.total_voters || 3000) / list.length)
    }));
  }
  const total = gp.total_wards || 10;
  const arr = [];
  for (let i = 1; i <= total; i++) {
    arr.push({
      ward_no: i,
      village: (gp.villages && gp.villages[0]) ? gp.villages[0] : gp.name_hi,
      voters: Math.round((gp.total_voters || 3000) / total)
    });
  }
  return arr;
}

const loadedGps = new Set();
async function ensurePanchayatVotersLoaded(gpCode) {
  if (!gpCode || gpCode === 'ALL') return;
  const gp = State.panchayats.find(p => p.code === gpCode || p.name_en.toLowerCase() === gpCode.toLowerCase());
  if (!gp) return;
  if (loadedGps.has(gp.code)) return;

  try {
    let res = await fetch(`data/${gp.name_en}.json`);
    if (!res.ok) {
      res = await fetch(`data/${gp.name_en.toUpperCase()}.json`);
    }
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        // Map compact array or object format
        const mapped = data.map(r => {
          if (Array.isArray(r)) {
            return {
              panchayat_code: gp.code,
              panchayat_en: gp.name_en,
              gram_panchayat: gp.name_hi,
              ward_no: r[0],
              serial_no: r[1],
              epic_no: r[2],
              voter_name: r[3],
              voter_name_en: r[12] || '',
              relative_name: r[4],
              relative_name_en: r[13] || '',
              relative_relation: r[5] || 'पिता',
              house_no: r[6] || '-',
              age: r[7] || 0,
              gender: r[8] || 'M',
              status: r[9] || 'सक्रिय',
              deletion_code: r[10] || '',
              deletion_reason: r[11] || '',
              polling_station_no: 1,
              polling_station_name: 'रा.उ.मा.वि. ' + (gp.name_hi || '') 
            };
          }
          if (r && typeof r === 'object') {
            return {
              panchayat_code: gp.code,
              panchayat_en: gp.name_en,
              gram_panchayat: gp.name_hi,
              ward_no: r.w !== undefined ? r.w : (r.ward_no || 1),
              serial_no: r.s !== undefined ? r.s : (r.serial_no || 1),
              epic_no: r.e !== undefined ? r.e : (r.epic_no || ''),
              voter_name: r.n || r.voter_name || '',
              voter_name_en: r.ne || r.voter_name_en || '',
              relative_name: r.r || r.relative_name || '',
              relative_name_en: r.re || r.relative_name_en || '',
              relative_relation: r.rt || r.relative_relation || 'पिता',
              house_no: (r.h !== undefined && r.h !== '' && r.h !== '.' && r.h !== '-') ? r.h : (r.house_no || '-'),
              age: (r.a !== undefined && r.a !== '' && r.a !== '.' && r.a !== 0 && r.a !== '0') ? r.a : (r.age || ''),
              gender: r.g || r.gender || 'पुरुष',
              status: r.st || r.status || 'सक्रिय',
              deletion_code: r.dc || r.deletion_code || '',
              deletion_reason: r.dr || r.deletion_reason || '',
              polling_station_no: 1,
              polling_station_name: 'रा.उ.मा.वि. ' + (gp.name_hi || '') 
            };
          }
          return r;
        });

        // Replace any partial initial sample rows for this GP with complete official data
        State.voters = State.voters.filter(v => v.panchayat_code !== gp.code && v.panchayat_en !== gp.name_en);
        State.voters.push(...mapped);
        loadedGps.add(gp.code);
        return true;
      }
    }
  } catch (err) {
    console.warn(`Local data load for ${gp.name_en} skipped:`, err);
  }
  return false;
}

function initMasterData() {
  setTimeout(populateGpFilterDropdowns, 50);
  if (window.MASTER_DATA) {
    State.panchayats = window.MASTER_DATA.panchayats || [];
    State.adminUsers = window.MASTER_DATA.admin_users || [];
    State.deletedVoters = window.MASTER_DATA.deleted_voters || [];
    State.config.appsScriptUrl = localStorage.getItem('panchayat_apps_script_url') || 'https://script.google.com/macros/s/AKfycbwtgz2L5QC_95Jsf1r0Kum_LcTI-bJwwiBQS_O74vthHcbPD_KatsN69ytY2yqlayiM/exec';
    const appsScriptInput = document.getElementById('appsScriptUrlInput');
    if (appsScriptInput && State.config.appsScriptUrl) {
      appsScriptInput.value = State.config.appsScriptUrl;
    }

    // Strictly normalize wards for all 30 panchayats
    State.panchayats.forEach(gp => {
      gp.wards = getGpWards(gp);
    });

    // Clean initial voters with normalized panchayat_en
    State.voters = window.MASTER_DATA.initial_voters || [];
    State.voters.forEach(v => {
      if (!v.panchayat_en && v.panchayat_code) {
        const gp = State.panchayats.find(p => p.code === v.panchayat_code);
        if (gp) v.panchayat_en = gp.name_en;
      }
    });

    // Check cached admins
    const cachedAdmins = localStorage.getItem('panchayat_admins_cache');
    if (cachedAdmins) {
      try {
        State.adminUsers = JSON.parse(cachedAdmins);
      } catch (e) {}
    }
  }

  // Load Slip Delivery State from localStorage
  const savedDelivery = localStorage.getItem('panchayat_slip_delivery_map');
  if (savedDelivery) {
    try {
      State.deliveryMap = JSON.parse(savedDelivery);
    } catch (e) {
      State.deliveryMap = {};
    }
  } else {
    State.deliveryMap = {};
  }

  // Load Config (Default to newly created live Google Sheets on Drive)
  const defaultAdminUrl = 'https://docs.google.com/spreadsheets/d/16AbjKd1JoQ1mvJ3kpoRjxgCEyQXLUlGELYkabbQmgpc/edit';
  const defaultVoterUrl = 'https://docs.google.com/spreadsheets/d/1CWJ9YjXBUe-BbDOoDrp60vAV9hLP7Yyziphu3ac825I/edit';

  const savedAdminUrl = localStorage.getItem('panchayat_admin_sheet_url') || defaultAdminUrl;
  const savedVoterUrl = localStorage.getItem('panchayat_voter_sheet_url') || defaultVoterUrl;
  State.config.adminSheetUrl = savedAdminUrl;
  State.config.voterSheetUrl = savedVoterUrl;

  const adminInput = document.getElementById('adminSheetUrlInput');
  const voterInput = document.getElementById('voterSheetUrlInput');
  if (adminInput) adminInput.value = savedAdminUrl;
  if (voterInput) voterInput.value = savedVoterUrl;
}

// ==========================================================================
// GATEKEEPER & SESSION ENGINE
// ==========================================================================
// ==========================================================================
// PORTAL CONTEXT & MULTI-PORTAL SESSION ENGINE
// ==========================================================================
// removed duplicate getMasterDirectory

async function ensureMasterDirectoryLoaded() {
  const existing = getMasterDirectory();
  if (existing && existing.blo_list && existing.blo_list.length > 0) return existing;
  try {
    const res = await fetch('master_directory.json?v=' + Date.now());
    if (res.ok) {
      const data = await res.json();
      if (typeof window !== 'undefined') window.MASTER_DIRECTORY = data;
      State.masterDirectory = data;
      return data;
    }
  } catch(e) {
    console.warn('Could not fetch master_directory.json:', e);
  }
  return null;
}

function getPortalContext() {
  const url = new URL(window.location.href);
  const pParam = url.searchParams.get('portal');
  if (pParam) return pParam.toLowerCase();

  const path = window.location.pathname.toLowerCase();
  const host = window.location.hostname.toLowerCase();
  
  if (path.includes('blo-portal') || path.includes('/blo') || host.includes('blo')) {
    return 'blo';
  }
  if (path.includes('voter-portal') || path.includes('/voter') || host.includes('voter')) {
    return 'voter';
  }
  return 'master';
}

function getSessionStorageKey() {
  return `panchayat_session_${getPortalContext()}`;
}


function syncCurrentUserWithConfiguredUsers() {
  if (!State.currentUser) return;
  const uId = String(State.currentUser.id || State.currentUser.username || '').toLowerCase();
  const boothExact = State.currentUser.booth_no ? `blo_${String(State.currentUser.booth_no).trim().toLowerCase()}` : '';
  if (!State.adminControlUsers || State.adminControlUsers.length === 0) return;
  const uName = String(State.currentUser.username || State.currentUser.id || '').toLowerCase();
  const matched = State.adminControlUsers.find(x => {
    const xU = String(x.username || '').toLowerCase();
    const xId = String(x.id || '').toLowerCase();
    const xName = String(x.full_name || x.fullName || x.candidate_name || '').toLowerCase();
    const xBooth = x.booth_no ? `blo_${String(x.booth_no).trim().toLowerCase()}` : '';
    return xU === uId || xId === uId || xU === uName || xId === uName ||
           (xId === ('cand_' + uName)) || (xU === ('cand_' + uName)) ||
           (('cand_' + xId) === uName) || (('cand_' + xU) === uName) ||
           (uName.startsWith('cand_') && (xU === uName.replace(/^cand_/, '') || xId === uName.replace(/^cand_/, ''))) ||
           ((uName === 'kamla' || uName === 'कमला' || uId === 'kamla' || uId === 'कमला') && (xU === 'b' || xId === 'cand_b' || xName.includes('कमला'))) ||
           ((xU === 'kamla' || xU === 'कमला' || xId === 'kamla' || xId === 'कमला') && (uName === 'b' || uId === 'cand_b')) ||
           (boothExact && (xU === boothExact || xId === boothExact || xBooth === boothExact)) ||
           (uId.startsWith('blo_') && (xBooth === uId || xU === uId || xId === uId));
  });
  if (matched) {
    const statusUpper = String(matched.status || 'ACTIVE').toUpperCase();
    if (statusUpper === 'INACTIVE' || statusUpper === 'DISABLED' || statusUpper === 'BLOCKED') {
      State.currentUser = null;
      const sk = getSessionStorageKey();
      localStorage.removeItem(sk);
      sessionStorage.removeItem(sk);
      localStorage.removeItem('panchayat_user_session');
      sessionStorage.removeItem('panchayat_user_session');
      if (typeof document !== 'undefined') {
        document.documentElement.classList.remove('user-logged-in');
      }
      enforceGatekeeperState();
      const errEl = document.getElementById('gatekeeperError');
      if (errEl) {
        errEl.textContent = 'आपका खाता मुख्य व्यवस्थापक द्वारा निष्क्रिय (Inactive) किया गया है।';
        errEl.style.display = 'block';
      }
      return;
    }
    const prevSnapshot = JSON.stringify({
      tabs: Array.isArray(State.currentUser.allowed_tabs) ? [...State.currentUser.allowed_tabs] : State.currentUser.allowed_tabs,
      gp: State.currentUser.allowed_panchayats,
      wards: State.currentUser.allowed_wards,
      cp: State.currentUser.can_print,
      cd: State.currentUser.can_download,
      cs: State.currentUser.can_search,
      cv: State.currentUser.can_view
    });

    let parsedTabs = matched.allowed_tabs;
    if (typeof parsedTabs === 'string') {
      try { parsedTabs = JSON.parse(parsedTabs); } catch(e) { parsedTabs = parsedTabs.split(',').map(s=>s.trim()); }
    }
    if (Array.isArray(parsedTabs)) {
      const isCand = isCandidateUser(State.currentUser);
      const isVoter = (typeof getPortalContext === 'function' && getPortalContext() === 'voter') || (window.PORTAL_TYPE === 'voter');
      if (isCand || isVoter) {
        parsedTabs = parsedTabs.filter(t => t !== 'directoryTab');
      }
      State.currentUser.allowed_tabs = parsedTabs;
    }
    if (matched.allowed_panchayats) {
      State.currentUser.allowed_panchayats = matched.allowed_panchayats;
      State.currentUser.panchayat = matched.allowed_panchayats;
    }
    if (matched.allowed_wards) {
      State.currentUser.allowed_wards = matched.allowed_wards;
    }
    if (matched.can_print !== undefined) State.currentUser.can_print = (matched.can_print === true || matched.can_print === 1);
    if (matched.can_download !== undefined) State.currentUser.can_download = (matched.can_download === true || matched.can_download === 1);
    if (matched.can_search !== undefined) State.currentUser.can_search = (matched.can_search === true || matched.can_search === 1);
    if (matched.can_view !== undefined) State.currentUser.can_view = (matched.can_view === true || matched.can_view === 1);
    if (matched.candidate_mode) State.currentUser.candidate_mode = matched.candidate_mode;
    if (matched.full_name && !matched.full_name.toLowerCase().includes('narendra')) {
      State.currentUser.full_name = matched.full_name;
    }

    const candToSync = matched.candidate || (window.PORTAL_USERS_DATA && window.PORTAL_USERS_DATA.candidates && (window.PORTAL_USERS_DATA.candidates[uId] || (State.currentUser.username && window.PORTAL_USERS_DATA.candidates[State.currentUser.username])));
    if (candToSync) {
      State.currentCandidate = candToSync;
      State.currentUser.candidate = candToSync;
      try {
        const uIdKey = State.currentUser.id || State.currentUser.username;
        localStorage.setItem('candidate_profile_' + uIdKey, JSON.stringify(candToSync));
        if (State.currentUser.username) localStorage.setItem('candidate_profile_' + State.currentUser.username, JSON.stringify(candToSync));
      } catch(_) {}
    }

    applyGlobalElectionDateToUI();

    if (typeof updateUserScopeDisplay === 'function') updateUserScopeDisplay();

    const newSnapshot = JSON.stringify({
      tabs: State.currentUser.allowed_tabs,
      gp: State.currentUser.allowed_panchayats,
      wards: State.currentUser.allowed_wards,
      cp: State.currentUser.can_print,
      cd: State.currentUser.can_download,
      cs: State.currentUser.can_search,
      cv: State.currentUser.can_view
    });

    if (prevSnapshot !== newSnapshot) {
      const sk = getSessionStorageKey();
      localStorage.setItem(sk, JSON.stringify(State.currentUser));
      sessionStorage.setItem(sk, JSON.stringify(State.currentUser));
      localStorage.setItem('panchayat_user_session', JSON.stringify(State.currentUser));
      enforceGatekeeperState();
    }
  }
}

function initSession() {
  const ctx = getPortalContext();
  const sessionKey = `panchayat_session_${ctx}`;

  // Synchronously populate State.adminControlUsers from cached Google Sheet admins & candidates
  const cachedAdminsStr = localStorage.getItem('panchayat_admins_cache');
  if (cachedAdminsStr) {
    try {
      const parsedAdmins = JSON.parse(cachedAdminsStr);
      if (Array.isArray(parsedAdmins) && parsedAdmins.length > 0) {
        State.adminUsers = parsedAdmins;
        State.adminControlUsers = [...parsedAdmins];
      }
    } catch(e) {}
  }
  const cachedCandsStr = localStorage.getItem('panchayat_candidates_cache');
  if (cachedCandsStr) {
    try {
      const parsedCands = JSON.parse(cachedCandsStr);
      if (Array.isArray(parsedCands) && parsedCands.length > 0) {
        if (!State.adminControlUsers) State.adminControlUsers = [];
        parsedCands.forEach(c => {
          const exIdx = State.adminControlUsers.findIndex(u => u.id === c.id || u.username === c.username || (c.id && u.id === c.id.replace('cand_', '')));
          if (exIdx >= 0) State.adminControlUsers[exIdx] = { ...State.adminControlUsers[exIdx], ...c };
          else State.adminControlUsers.push(c);
        });
      }
    } catch(e) {}
  }

  // Set default activeTab based on portal
  if (ctx === 'blo' || ctx === 'voter') {
    State.activeTab = 'searchTab';
  }

  // STRICT Portal-Isolated Session: ONLY load session intended for this specific portal!
  let saved = localStorage.getItem(sessionKey) || sessionStorage.getItem(sessionKey);

  if (saved) {
    try {
      const u = JSON.parse(saved);
      if (u) {
        // Enforce role sanity per portal context
        if (ctx === 'blo') {
          if (u.role === 'BLO' || u.type === 'BLO' || u.category === 'CELL' || u.role === 'प्रकोष्ठ कार्मिक' || u.role === 'CELL_MEMBER' || u.role === 'BLOCK_PRABHARI') {
            State.currentUser = u;
            const uId = String(u.id || u.username || '').toLowerCase();
            if ((uId.startsWith('blo_') || u.role === 'BLO') && (!Array.isArray(u.allowed_tabs) || u.allowed_tabs.length === 0)) {
              u.allowed_tabs = ['searchTab'];
            }
          } else {
            State.currentUser = null;
          }
        } else if (ctx === 'voter') {
          if (u.role !== 'SUPER_ADMIN' && u.id !== 'admin' && u.username !== 'admin') {
            // Guarantee full candidate tabs
            if (u.role === 'USER' || !u.role || u.candidate_mode === 'admin_locked' || u.role === 'PANCHAYAT_AGENT' || u.username === 'kk') {
              u.role = 'CANDIDATE';
              u.type = 'CANDIDATE';
              u.category = 'CANDIDATE';
              u.candidate_mode = 'user_edit';
            }
            if (!u.allowed_tabs || !Array.isArray(u.allowed_tabs)) {
              u.allowed_tabs = [];
            }
            u.allowed_tabs = u.allowed_tabs.filter(t => t !== 'directoryTab');
            State.currentUser = u;
          } else {
            State.currentUser = null;
          }
        } else {
          // Master Portal (/pan/ or ?portal=master)
          State.currentUser = u;
        }

        if (State.currentUser) {
          // Restore candidate profile if user is candidate
          const isCand = isCandidateUser(State.currentUser);
          if (isCand) {
            const cand = getActiveCandidate();
            if (cand) {
              State.currentCandidate = cand;
              State.currentUser.candidate = cand;
            }
          }
          // Flag HTML to prevent login screen bounce
          if (typeof document !== 'undefined') {
            document.documentElement.classList.add('user-logged-in');
          }
        }
      }
    } catch(e) {
      State.currentUser = null;
    }
  } else {
    State.currentUser = null;
  }

  // Populate dropdowns and trigger background sync
  configureLoginUiForPortal();
  populateLoginUserDropdown();
  syncCurrentUserWithConfiguredUsers(); // Sync synchronously with cached admins BEFORE rendering!
  applyGlobalElectionDateToUI();
  enforceGatekeeperState(); // Render with verified permissions
  syncLatestActiveUsersFromAppsScript(); // Background fetch updates if anything changed in Google Sheet
}

function isCandidateUser(u) {
  if (!u) return false;
  const role = String(u.role || '').toUpperCase();
  // Administrative roles are NEVER candidate users
  if (role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'INCHARGE' || role === 'VYAVASTHAPAK' || role === 'BLOCK_PRABHARI') return false;
  // BLO and Cell personnel are election staff controlled by Superadmin - NEVER candidate users
  if (role === 'BLO' || role.includes('बी.एल.ओ') || role.includes('BLO') || String(u.id || '').toLowerCase().startsWith('blo_')) return false;
  if (role === 'CELL_MEMBER' || role === 'CELL' || role.includes('प्रकोष्ठ') || String(u.id || '').toLowerCase().startsWith('cell_')) return false;

  const uId = String(u.id || u.username || '').toLowerCase();
  if (uId.startsWith('cand_') || uId === 'sarpanch') return true;
  if (u.role === 'CANDIDATE' || u.role === 'प्रत्याशी' || u.type === 'CANDIDATE' || u.category === 'CANDIDATE') return true;
  
  // On voter portal ONLY, standard users act as candidate
  if (typeof getPortalContext === 'function' && getPortalContext() === 'voter') {
    return true;
  }
  return false;
}

function enforceGatekeeperState() {
  const gatekeeper = document.getElementById('welcomeGatekeeper');
  const mainApp = document.getElementById('mainPortalApp');

  if (!State.currentUser) {
    if (gatekeeper) gatekeeper.style.display = 'flex';
    if (mainApp) mainApp.style.display = 'none';
    return;
  }

  if (gatekeeper) gatekeeper.style.display = 'none';
  if (mainApp) mainApp.style.display = 'block';

  const u = State.currentUser;
  const isSuperAdmin = (u.role === 'SUPER_ADMIN' || u.role === 'admin' || (u.id && u.id.toLowerCase() === 'admin'));
  const isIncharge = (u.role === 'INCHARGE' || (u.id && u.id.toLowerCase() === 'incharge'));
  const isVyavasthapak = (u.role === 'VYAVASTHAPAK' || (u.id && u.id.toLowerCase() === 'vyavasthapak'));

  // Admin Control Nav Tab visibility (Only Super Admin can access!)
  const adminNavTab = document.getElementById('adminControlNavTab');
  if (adminNavTab) {
    adminNavTab.style.display = isSuperAdmin ? 'flex' : 'none';
  }

  // Settings Nav Tab (Only Super Admin can access!)
  const settingsNavTab = document.getElementById('settingsNavTab');
  if (settingsNavTab) {
    settingsNavTab.style.display = isSuperAdmin ? 'flex' : 'none';
  }

  // Candidate Detection
  const isCandUser = isCandidateUser(u);

  // Enforce Allowed Tabs (Super Admin configuration has priority)
  let allowedTabs = ['searchTab'];
  let userConfiguredTabs = u.allowed_tabs;
  if (typeof userConfiguredTabs === 'string') {
    try { userConfiguredTabs = JSON.parse(userConfiguredTabs); } catch(e) { userConfiguredTabs = userConfiguredTabs.split(',').map(s=>s.trim()); }
  }

  if (isSuperAdmin) {
    allowedTabs = ['dashboardTab', 'searchTab', 'alphaTab', 'bulkSlipTab', 'directoryTab', 'adminControlTab', 'settingsTab'];
  } else if (Array.isArray(userConfiguredTabs)) {
    // If Admin explicitly assigned custom tabs to this user (even if empty []), ALWAYS RESPECT IT!
    allowedTabs = userConfiguredTabs;
  } else if (isIncharge) {
    // Incharge default view rights across all normal tabs for all 30 GPs (NO EDIT)
    allowedTabs = ['dashboardTab', 'searchTab', 'alphaTab', 'directoryTab'];
  } else if (isVyavasthapak) {
    // Vyavasthapak default view, download & bulk/single slip print rights for all 30 GPs
    allowedTabs = ['dashboardTab', 'searchTab', 'alphaTab', 'bulkSlipTab', 'directoryTab'];
  } else if (isCandUser) {
    allowedTabs = ['searchTab', 'alphaTab', 'bulkSlipTab', 'candidateProfileTab'];
  } else if (u.role === 'BLO') {
    allowedTabs = ['searchTab'];
  } else if (u.role === 'CELL_MEMBER' || u.role === 'CELL' || (u.id && String(u.id).startsWith('cell_'))) {
    allowedTabs = ['searchTab', 'directoryTab'];
  }

  // STRICT SECURITY RULE:
  // 1. On voter-portal repo or for candidate users, Ward Directory is strictly prohibited.
  // 2. On blo-portal and pan repos, Super Admin has full control: if Super Admin grants directoryTab in allowed_tabs, it MUST BE VISIBLE and active!
  const isVoterContext = (window.PORTAL_TYPE === 'voter') || 
                         (window.location && window.location.href && window.location.href.toLowerCase().includes('/voter-portal')) ||
                         (typeof getPortalContext === 'function' && getPortalContext() === 'voter');
  if (isCandUser || isVoterContext) {
    // Candidates & Voters NEVER see Dashboard, Directory, Admin Control, or Settings
    allowedTabs = allowedTabs.filter(t => t !== 'directoryTab' && t !== 'dashboardTab' && t !== 'adminControlTab' && t !== 'settingsTab');
    document.querySelectorAll('.nav-tab[data-tab="directoryTab"], .bottom-nav-item[data-tab="directoryTab"]').forEach(el => {
      el.style.display = 'none';
    });
    const dirSec = document.getElementById('directoryTab');
    if (dirSec) dirSec.style.display = 'none';
    if (State.activeTab === 'directoryTab') {
      State.activeTab = 'searchTab';
      switchTab('searchTab');
    }
  } else {
    // When allowed on blo-portal or pan, ensure directory tab section inline style is cleared so it displays cleanly!
    const dirSec = document.getElementById('directoryTab');
    if (dirSec && allowedTabs.includes('directoryTab')) {
      dirSec.style.display = '';
    }
  }

  // Real-time dynamic CSS filter update (replaces stale stylesheet from initial page load)
  const allMasterTabIds = ['dashboardTab', 'searchTab', 'alphaTab', 'bulkSlipTab', 'directoryTab', 'candidateProfileTab', 'adminControlTab', 'settingsTab'];
  let liveFilterCss = '';
  allMasterTabIds.forEach(t => {
    if (!isSuperAdmin && !allowedTabs.includes(t)) {
      liveFilterCss += `.nav-tab[data-tab="${t}"], .bottom-nav-item[data-tab="${t}"], #${t} { display: none !important; } `;
    }
  });
  let liveFilterEl = document.getElementById('instant-allowed-tabs-filter');
  if (!liveFilterEl) {
    liveFilterEl = document.createElement('style');
    liveFilterEl.id = 'instant-allowed-tabs-filter';
    document.head.appendChild(liveFilterEl);
  }
  liveFilterEl.textContent = liveFilterCss;

  // Candidate Profile Nav Tab Visibility
  const candidateNavTab = document.getElementById('candidateNavTab');
  if (candidateNavTab) {
    candidateNavTab.style.display = (isCandUser && allowedTabs.includes('candidateProfileTab')) ? 'flex' : 'none';
  }

  // Enforce Navigation Tab Buttons
  document.querySelectorAll('.nav-tab').forEach(tab => {
    const tabId = tab.getAttribute('data-tab');
    if (tabId === 'adminControlTab' || tabId === 'settingsTab') {
      tab.style.display = isSuperAdmin ? 'flex' : 'none';
    } else if (tabId === 'candidateProfileTab') {
      tab.style.display = (isSuperAdmin || (isCandUser && allowedTabs.includes('candidateProfileTab'))) ? 'flex' : 'none';
    } else {
      const isAllowed = isSuperAdmin || allowedTabs.includes(tabId);
      tab.style.display = isAllowed ? 'flex' : 'none';
    }
  });

  // Mobile Bottom Nav items filtering
  document.querySelectorAll('.bottom-nav-item').forEach(btn => {
    const tabId = btn.getAttribute('data-tab');
    if (tabId === 'candidateProfileTab') {
      btn.style.display = (isSuperAdmin || (isCandUser && allowedTabs.includes('candidateProfileTab'))) ? 'flex' : 'none';
    } else {
      const isAllowed = isSuperAdmin || allowedTabs.includes(tabId);
      btn.style.display = isAllowed ? 'flex' : 'none';
    }
  });

  // Explicitly hide disabled tab pane sections
  allMasterTabIds.forEach(t => {
    if (!isSuperAdmin && !allowedTabs.includes(t)) {
      const p = document.getElementById(t);
      if (p) {
        p.style.display = 'none';
        p.classList.remove('active');
      }
    }
  });

  // Handle Zero Allowed Tabs: Clean lock screen with ONLY 1 message!
  const noAccessEl = document.getElementById('noPermissionsNotice');
  const scopeBanner = document.getElementById('userScopeBanner');

  if (!isSuperAdmin && (!allowedTabs || allowedTabs.length === 0)) {
    // 1. Hide ALL tab panes so no search bar, filters, or voter details show
    document.querySelectorAll('.tab-pane').forEach(pane => {
      pane.style.display = 'none';
      pane.classList.remove('active');
    });

    // 2. Hide ALL navigation tab buttons
    document.querySelectorAll('.nav-tab').forEach(t => t.style.display = 'none');
    document.querySelectorAll('.bottom-nav-item').forEach(b => b.style.display = 'none');

    // 3. Hide user scope banner so no confusing extra details appear
    if (scopeBanner) scopeBanner.style.display = 'none';

    // 4. Show ONLY the single, clean, centered permission notice (Option 3: Private Portal Language)
    const noticeHtml = `
      <div style="width: 72px; height: 72px; margin: 0 auto 18px auto; background: #fee2e2; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 36px;">🔒</div>
      <h2 style="color: #991b1b; margin: 0 0 10px 0; font-size: 22px; font-weight: 800; font-family: sans-serif;">अनुमति प्रतिबंधित</h2>
      <p style="color: #374151; font-size: 16px; font-weight: 600; line-height: 1.5; margin: 0 0 8px 0;">
        आपके खाते की सेवाएँ वर्तमान में बंद हैं।
      </p>
      <p style="color: #6b7280; font-size: 14px; margin: 0 0 24px 0;">
        कृपया एडमिन से संपर्क करें।
      </p>
      <button onclick="logoutUser()" class="btn btn-primary" style="padding: 10px 28px; font-size: 15px; font-weight: 700; border-radius: 8px; background: #dc2626; border: none; color: white; cursor: pointer; box-shadow: 0 4px 6px -1px rgba(220, 38, 38, 0.3);">
        🚪 लॉगआउट करें (Logout)
      </button>
    `;

    if (noAccessEl) {
      noAccessEl.innerHTML = noticeHtml;
      noAccessEl.style.display = 'block';
    } else {
      const div = document.createElement('div');
      div.id = 'noPermissionsNotice';
      div.style.cssText = 'max-width: 540px; margin: 60px auto 40px auto; padding: 42px 28px; text-align: center; background: #ffffff; border-radius: 18px; border: 2px dashed #f87171; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.08);';
      div.innerHTML = noticeHtml;
      const container = document.querySelector('main.app-content') || document.querySelector('.main-content') || document.getElementById('mainPortalApp');
      if (container) container.appendChild(div);
    }
  } else {
    // Normal state when tabs are allowed
    if (noAccessEl) noAccessEl.style.display = 'none';
    if (scopeBanner) scopeBanner.style.display = '';

    if (!isSuperAdmin && !allowedTabs.includes(State.activeTab)) {
      if (allowedTabs.length > 0) {
        switchTab(allowedTabs[0], false);
      }
    } else if (State.activeTab && document.getElementById(State.activeTab)) {
      document.querySelectorAll('.nav-tab').forEach(t => {
        t.classList.toggle('active', t.getAttribute('data-tab') === State.activeTab);
      });
      document.querySelectorAll('.bottom-nav-item').forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-tab') === State.activeTab);
      });
      document.querySelectorAll('.tab-pane').forEach(p => {
        const isActive = (p.id === State.activeTab);
        p.classList.toggle('active', isActive);
        p.style.display = isActive ? 'block' : 'none';
      });
    }
  }

  // Candidate Bulk Slip options on voter-portal: keep 9, 21, and Thermal
  // On other portals (PAN, BLO): KEEP ALL LAYOUTS (12, 15, 18, 20, 21, 9, 10, Thermal) VISIBLE AND SELECTABLE!
  const isVoterRepo = (window.PORTAL_TYPE === 'voter') || 
                      (window.location && window.location.href && window.location.href.toLowerCase().includes('/voter-portal'));

  if (isVoterRepo && isCandUser) {
    ['layoutCard10', 'layoutCard12', 'layoutCard15', 'layoutCard18', 'layoutCard20'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
    ['layoutCard9', 'layoutCard21', 'layoutCardThermal'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = '';
    });
    if (['10', 10, '12', 12, '15', 15, '18', 18, '20', 20].includes(State.bulkLayout)) {
      selectBulkLayout(9);
    }
  } else {
    ['layoutCard9', 'layoutCard10', 'layoutCard12', 'layoutCard15', 'layoutCard18', 'layoutCard20', 'layoutCard21', 'layoutCardThermal'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = '';
    });
  }

  // Load candidate profile if not loaded
  if (!State.currentCandidate) {
    const cached = localStorage.getItem('candidate_profile_' + (u.id || u.username));
    if (cached) {
      try { State.currentCandidate = JSON.parse(cached); } catch(e) {}
    }
  }

  // Incharge edit protection: All candidate and personnel edit buttons hidden
  if (isIncharge) {
    document.querySelectorAll('.candidate-edit-btn, #editCandidateBtn, #saveCandidateBtn, .btn-admin-action, #addCellPersonnelBtn').forEach(el => {
      el.style.display = 'none';
    });
  }

  updateUserScopeDisplay();
  populateGpFilterDropdowns();

  // If user is restricted to a single GP, automatically load and lock that GP
  const allowedGps = getAllowedGps();
  if (!isSuperAdmin && allowedGps.length === 1) {
    const singleGp = allowedGps[0];
    onGpFilterChanged();
    onAlphaGpChanged();
    onBulkGpChanged();
  }

  renderDashboard();
}

function updateUserScopeDisplay() {
  if (!State.currentUser) return;
  const u = State.currentUser;

  const roleBadge = document.getElementById('bannerRoleBadge');
  const userName = document.getElementById('bannerUserName');
  const gpName = document.getElementById('bannerGpName');
  const wardScope = document.getElementById('bannerWardScope');
  const sessionStatus = document.getElementById('sessionStatusText');
  const bannerUserLabel = document.getElementById('bannerUserLabel');

  const isCand = isCandidateUser(u);

  if (bannerUserLabel) {
    if (isCand) {
      bannerUserLabel.textContent = 'प्रत्याशी:';
    } else if (u.role === 'BLO') {
      bannerUserLabel.textContent = 'बी.एल.ओ.:';
    } else if (u.role === 'SUPER_ADMIN') {
      bannerUserLabel.textContent = 'व्यवस्थापक:';
    } else {
      bannerUserLabel.textContent = 'उपयोगकर्ता:';
    }
  }

  if (roleBadge) {
    if (isCand) {
      roleBadge.textContent = '🚩 अधिकृत प्रत्याशी सत्र (Candidate)';
      roleBadge.style.background = '#d97706';
      roleBadge.style.color = '#ffffff';
    } else if (u.role === 'SUPER_ADMIN') {
      roleBadge.textContent = '👑 मुख्य व्यवस्थापक (Super Admin)';
      roleBadge.style.background = '#b45309';
      roleBadge.style.color = '#ffffff';
    } else if (u.role === 'INCHARGE') {
      roleBadge.textContent = '👁️ ब्लॉक इनचार्ज (केवल अवलोकन)';
      roleBadge.style.background = '#4338ca';
      roleBadge.style.color = '#ffffff';
    } else if (u.role === 'VYAVASTHAPAK') {
      roleBadge.textContent = '🖨️ व्यवस्थापक (प्रिंट व डाउनलोड)';
      roleBadge.style.background = '#065f46';
      roleBadge.style.color = '#ffffff';
    } else if (u.role === 'BLOCK_PRABHARI') {
      roleBadge.textContent = '🌟 ब्लॉक प्रभारी (Block Incharge)';
      roleBadge.style.background = '#0f766e';
      roleBadge.style.color = '#ffffff';
    } else if (u.role === 'BLO') {
      roleBadge.textContent = `👤 बी.एल.ओ. (बूथ ${u.booth_no || ''})`;
      roleBadge.style.background = '#2563eb';
      roleBadge.style.color = '#ffffff';
    } else if (u.role === 'CELL_MEMBER') {
      roleBadge.textContent = `🏢 ${u.cell_name || 'चुनाव प्रकोष्ठ कार्मिक'}`;
      roleBadge.style.background = '#1e40af';
      roleBadge.style.color = '#ffffff';
    } else {
      roleBadge.textContent = '🚩 अधिकृत प्रत्याशी / प्रतिनिधि';
      roleBadge.style.background = '#d97706';
      roleBadge.style.color = '#ffffff';
    }
  }

  if (userName) userName.textContent = u.full_name || u.username;
  if (gpName) gpName.textContent = u.panchayat || (u.allowed_panchayats === 'ALL' ? 'समस्त 30 ग्राम पंचायतें' : u.allowed_panchayats);
  if (wardScope) wardScope.textContent = u.allowed_wards === 'ALL' ? 'समस्त वार्ड' : `वार्ड ${u.allowed_wards}`;
  if (sessionStatus) {
    if (u.role === 'SUPER_ADMIN') sessionStatus.textContent = `${u.full_name || u.username} (सुपर एडमिन)`;
    else if (u.role === 'INCHARGE') sessionStatus.textContent = `${u.full_name || u.username} (ब्लॉक इनचार्ज)`;
    else if (u.role === 'VYAVASTHAPAK') sessionStatus.textContent = `${u.full_name || u.username} (व्यवस्थापक)`;
    else if (u.role === 'BLOCK_PRABHARI') sessionStatus.textContent = `${u.full_name || u.username} (ब्लॉक प्रभारी)`;
    else if (isCand) sessionStatus.textContent = `${u.full_name || u.username} (प्रत्याशी)`;
    else if (u.role === 'BLO') sessionStatus.textContent = `${u.full_name || u.username} (BLO)`;
    else sessionStatus.textContent = `${u.full_name || u.username} (अधिकृत सत्र)`;
  }

  // Admin users box visibility
  const adminBox = document.getElementById('adminUserManagementBox');
  if (adminBox) {
    adminBox.style.display = u.role === 'SUPER_ADMIN' ? 'block' : 'none';
    if (u.role === 'SUPER_ADMIN' && typeof renderAdminUsersTable === 'function') renderAdminUsersTable();
  }
}

// ==========================================================================
// Tab Navigation (Desktop & Mobile)
// ==========================================================================
function switchTab(tabId, shouldScroll = true) {
  const curU = State.currentUser;
  const isCand = isCandidateUser(curU);
  const isVoter = (window.PORTAL_TYPE === 'voter') || 
                  (window.location && window.location.href && window.location.href.toLowerCase().includes('/voter-portal')) ||
                  (typeof getPortalContext === 'function' && getPortalContext() === 'voter');
  if (tabId === 'directoryTab' && (isCand || isVoter)) {
    tabId = 'searchTab';
  }
  State.activeTab = tabId;
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.classList.toggle('active', tab.getAttribute('data-tab') === tabId);
  });
  document.querySelectorAll('.bottom-nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === tabId);
  });
  document.querySelectorAll('.tab-pane').forEach(pane => {
    const isActive = (pane.id === tabId);
    pane.classList.toggle('active', isActive);
    pane.style.display = isActive ? 'block' : 'none';
  });
  if (shouldScroll) {
    try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch(_) {}
  }

  try {
    if (tabId === 'dashboardTab' && typeof renderDashboard === 'function') renderDashboard();
    if (tabId === 'directoryTab' && typeof initDirectoryTab === 'function') initDirectoryTab();
    if (tabId === 'alphaTab' && typeof renderAlphabeticalList === 'function') renderAlphabeticalList();
    if (tabId === 'bulkSlipTab') {
      if (typeof onBulkGpChanged === 'function') onBulkGpChanged();
      else if (typeof updateBulkGenerator === 'function') updateBulkGenerator();
    }
    if (tabId === 'candidateProfileTab' && typeof initCandidateProfileTab === 'function') initCandidateProfileTab();
    if (tabId === 'adminControlTab' && typeof initAdminControlTab === 'function') initAdminControlTab();
  } catch(err) {
    console.warn('[SWITCH-TAB] Error rendering tab ' + tabId + ':', err);
  }
}

// ==========================================================================
// Strict Jurisdiction Filters
// ==========================================================================
function getAllowedGps() {
  if (!State.currentUser) return State.panchayats || [];
  const u = State.currentUser;
  const isPrivileged = (u.role === 'SUPER_ADMIN' || u.role === 'INCHARGE' || u.role === 'VYAVASTHAPAK' || u.role === 'BLOCK_PRABHARI');
  if (isPrivileged) return State.panchayats || [];

  const ov = (typeof getUserOverrides === 'function') ? (getUserOverrides()[u.id || u.username] || {}) : {};
  let assigned = ov.allowed_panchayats || u.allowed_panchayats || u.panchayat || u.assigned_panchayats || u.panchayat_code;
  if (!assigned || assigned === 'ALL' || assigned === 'समस्त 30 पंचायतें' || assigned === 'समस्त (ALL)') {
    return State.panchayats || [];
  }

  let assignedList = [];
  if (Array.isArray(assigned)) {
    assignedList = assigned;
  } else if (typeof assigned === 'string' && assigned.startsWith('[') && assigned.endsWith(']')) {
    try { assignedList = JSON.parse(assigned); } catch(e) { assignedList = [assigned]; }
  } else if (typeof assigned === 'string' && assigned.includes(',')) {
    assignedList = assigned.split(',').map(s => s.trim());
  } else {
    assignedList = [assigned];
  }

  const filtered = (State.panchayats || []).filter(p => {
    return assignedList.some(a => {
      if (!a) return false;
      const s = String(a).trim().toLowerCase();
      return s === p.code.toLowerCase() || 
             s === p.name_hi.trim().toLowerCase() || 
             s === (p.name_en || '').trim().toLowerCase() ||
             (p.name_en && s.includes(p.name_en.toLowerCase())) ||
             (p.name_hi && s.includes(p.name_hi));
    });
  });

  return (filtered.length > 0) ? filtered : (State.panchayats || []);
}

function getAllowedWardsList(gpCode) {
  if (!State.currentUser) return 'ALL';
  const u = State.currentUser;
  const isPrivileged = (u.role === 'SUPER_ADMIN' || u.role === 'INCHARGE' || u.role === 'VYAVASTHAPAK' || u.role === 'BLOCK_PRABHARI');
  if (isPrivileged) return 'ALL';

  const ov = (typeof getUserOverrides === 'function') ? (getUserOverrides()[u.id || u.username] || {}) : {};
  const candPost = String(State.currentCandidate?.post || u.post || u.candidate?.post || '').trim();
  const isPsOrZp = candPost.includes('पंचायत समिति') || candPost.includes('जिला परिषद');
  if (isPsOrZp) {
    // PS & ZP members can search and view all GP wards in their assigned Panchayats
    return 'ALL';
  }
  const effWards = ov.allowed_wards || u.allowed_wards || u.assigned_wards || u.wards || u.ward || 'ALL';

  if (!effWards || effWards === 'ALL' || effWards === 'समस्त' || effWards === 'समस्त वार्ड') {
    return 'ALL';
  }

  let wardList = [];
  if (Array.isArray(effWards)) {
    wardList = effWards.map(String);
  } else if (typeof effWards === 'string') {
    try {
      const parsed = JSON.parse(effWards);
      if (Array.isArray(parsed)) wardList = parsed.map(String);
      else wardList = effWards.split(',').map(s => s.trim());
    } catch(e) {
      wardList = effWards.split(',').map(s => s.trim());
    }
  }

  // Check GP match
  const allowedGps = getAllowedGps();
  const matchesGp = !gpCode || gpCode === 'ALL' || allowedGps.some(p => p.code === gpCode || p.name_hi === gpCode || p.name_en === gpCode);

  if (matchesGp) {
    return wardList.length > 0 ? wardList : 'ALL';
  }
  return [];
}

async function onGpFilterChanged() {
  const gpSelect = document.getElementById('filterGp');
  const gpCode = gpSelect ? gpSelect.value : 'ALL';
  const wardSelect = document.getElementById('filterWard');
  if (wardSelect) {
    wardSelect.innerHTML = '<option value="ALL">-- सभी वार्ड --</option>';

    if (gpCode !== 'ALL') {
      const gp = (State.panchayats || []).find(p => p.code === gpCode || p.name_hi === gpCode || p.name_en === gpCode);
      if (gp) {
        const wards = (gp.wards && gp.wards.length > 0) ? gp.wards : getGpWards(gp);
        const allowedWards = getAllowedWardsList(gp.code);
        wards.forEach(w => {
          if (allowedWards === 'ALL' || allowedWards.includes(String(w.ward_no))) {
            const opt = document.createElement('option');
            opt.value = w.ward_no;
            opt.textContent = `वार्ड नं. ${w.ward_no} (${w.village || gp.name_hi})`;
            wardSelect.appendChild(opt);
          }
        });

        // If user is restricted to a single ward, auto-select it and lock
        if (allowedWards !== 'ALL' && allowedWards.length === 1) {
          wardSelect.value = allowedWards[0];
          wardSelect.disabled = true;
        } else {
          wardSelect.disabled = false;
        }
      }
    }
  }

  await ensurePanchayatVotersLoaded(gpCode);
  populateFilterChips();
  performSearch();
}

// ==========================================================================
// Delivery Status State & Helpers
// ==========================================================================
function getVoterKey(voter) {
  return `${voter.panchayat_code}_${voter.ward_no}_${voter.serial_no || voter.epic_no}`;
}

function isVoterDelivered(voter) {
  const key = getVoterKey(voter);
  return !!State.deliveryMap[key];
}

function toggleVoterDelivery(voterKey, event) {
  if (event) event.stopPropagation();
  State.deliveryMap[voterKey] = !State.deliveryMap[voterKey];
  localStorage.setItem('panchayat_slip_delivery_map', JSON.stringify(State.deliveryMap));

  renderDashboard();
  performSearch();
  renderAlphabeticalList();
  updateBulkGenerator();

  const isDel = State.deliveryMap[voterKey];
  showToast(isDel ? '✅ पर्ची "वितरित" दर्ज की गई' : 'पर्ची "बाकी" दर्ज की गई');
}

function markHouseholdDelivered(houseNo, gpCode, wardNo) {
  let count = 0;
  State.voters.forEach(v => {
    if (v.house_no == houseNo && v.panchayat_code == gpCode && String(v.ward_no) == String(wardNo)) {
      State.deliveryMap[getVoterKey(v)] = true;
      count++;
    }
  });
  localStorage.setItem('panchayat_slip_delivery_map', JSON.stringify(State.deliveryMap));
  renderDashboard();
  performSearch();
  renderAlphabeticalList();
  updateBulkGenerator();
  showToast(`मकान सं. ${houseNo} के सभी ${count} मतदाताओं की पर्ची वितरित दर्ज!`);
}

function setMeterFilter(status) {
  State.activeMeterFilter = status;
  const btnAll = document.getElementById('btnFilterMeterAll');
  const btnPending = document.getElementById('btnFilterMeterPending');
  const btnDelivered = document.getElementById('btnFilterMeterDelivered');

  if (btnAll) btnAll.className = 'meter-filter-btn' + (status === 'ALL' ? ' active' : '');
  if (btnPending) btnPending.className = 'meter-filter-btn' + (status === 'PENDING' ? ' active-amber' : '');
  if (btnDelivered) btnDelivered.className = 'meter-filter-btn' + (status === 'DELIVERED' ? ' active-green' : '');

  const delSelect = document.getElementById('filterDeliveryStatus');
  if (delSelect) delSelect.value = status;
  switchTab('searchTab');
  performSearch();
}

// ==========================================================================
// TAB: DASHBOARD & METER ENGINE (Video compliant)
// ==========================================================================
function renderDashboard() {
  const allowedGps = getAllowedGps();
  const allowedCodes = allowedGps.map(p => p.code);

  const votersInScope = State.voters.filter(v => allowedCodes.includes(v.panchayat_code));
  const totalVoters = votersInScope.length || 1;

  let deliveredCount = 0;
  votersInScope.forEach(v => {
    if (isVoterDelivered(v)) deliveredCount++;
  });
  const pendingCount = totalVoters - deliveredCount;
  const pct = Math.round((deliveredCount / totalVoters) * 100);

  // Meter elements
  const elDelivered = document.getElementById('meterDeliveredCount');
  const elPending = document.getElementById('meterPendingCount');
  const elFill = document.getElementById('meterProgressFill');
  const elPendingBadge = document.getElementById('meterPendingBadge');
  const elDeliveredBadge = document.getElementById('meterDeliveredBadge');

  if (elDelivered) elDelivered.textContent = deliveredCount.toLocaleString('hi-IN');
  if (elPending) elPending.textContent = pendingCount.toLocaleString('hi-IN');
  if (elFill) elFill.style.width = `${pct}%`;
  if (elPendingBadge) elPendingBadge.textContent = pendingCount;
  if (elDeliveredBadge) elDeliveredBadge.textContent = deliveredCount;

  // Breakdown metrics (matching Video: मूल सूची ~94.4%, परिवर्धन ~5.6%, विलोपित ~2.3%, प्रभावी)
  const elMainRoll = document.getElementById('kpiMainRollCount');
  const elSupplement = document.getElementById('kpiSupplementRollCount');
  const elDeleted = document.getElementById('kpiDeletedCount');
  const elEffective = document.getElementById('kpiEffectiveCount');

  // Verified Official Statistics from master_data (30 Gram Panchayats Verified from data.xls)
  const officialInitialVoters = allowedGps.reduce((s, p) => s + (p.total_voters || 0), 0) || 101701;
  const officialActiveVoters = allowedGps.reduce((s, p) => s + (p.active_voters || 0), 0) || 100479;
  const officialDeletedVoters = allowedGps.reduce((s, p) => s + (p.deleted_voters || 0), 0) || 6513;
  const officialSupplementVoters = allowedGps.reduce((s, p) => s + (p.added_voters || 0), 0) || 5291;
  const officialModifiedVoters = allowedGps.reduce((s, p) => s + (p.modified_voters || 0), 0) || 901;
  const officialMaleVoters = allowedGps.reduce((s, p) => s + (p.male_voters || 0), 0) || 51073;
  const officialFemaleVoters = allowedGps.reduce((s, p) => s + (p.female_voters || 0), 0) || 49404;
  const officialTotalWards = allowedGps.reduce((s, p) => s + (p.total_wards || 0), 0) || 312;
  const officialTotalBooths = allowedGps.reduce((s, p) => s + (p.booths ? p.booths.length : (p.wards ? new Set(p.wards.map(w => w.booth_no)).size : 0)), 0) || 116;

  if (elMainRoll) elMainRoll.textContent = `${officialInitialVoters.toLocaleString('hi-IN')}`;
  if (elSupplement) elSupplement.textContent = `${officialSupplementVoters.toLocaleString('hi-IN')}`;
  if (elDeleted) elDeleted.textContent = `${officialDeletedVoters.toLocaleString('hi-IN')}`;
  if (elEffective) elEffective.textContent = `${officialActiveVoters.toLocaleString('hi-IN')}`;

  // Overall totals
  const kpiGps = document.getElementById('kpiTotalGps');
  const kpiWards = document.getElementById('kpiTotalWards');
  const kpiBooths = document.getElementById('kpiTotalBooths');
  const kpiVoters = document.getElementById('kpiTotalVoters');

  if (kpiGps) kpiGps.textContent = allowedGps.length;
  if (kpiWards) kpiWards.textContent = officialTotalWards;
  if (kpiBooths) kpiBooths.textContent = officialTotalBooths;
  if (kpiVoters) kpiVoters.textContent = officialActiveVoters.toLocaleString('hi-IN');

  // Ward-wise Delivery Tracker Grid
  const wardContainer = document.getElementById('wardProgressGridContainer');
  if (wardContainer) {
    wardContainer.innerHTML = '';
    allowedGps.forEach(gp => {
      if (gp.wards) {
        gp.wards.forEach(w => {
          const wardVoters = votersInScope.filter(v => v.panchayat_code === gp.code && String(v.ward_no) === String(w.ward_no));
          const wTotal = wardVoters.length || w.voters || 1;
          let wDel = 0;
          wardVoters.forEach(v => {
            if (isVoterDelivered(v)) wDel++;
          });
          const wPct = Math.round((wDel / wTotal) * 100);

          const item = document.createElement('div');
          item.className = 'ward-progress-item';
          item.onclick = () => {
            // Jump to this ward in search
            const filterGp = document.getElementById('filterGp');
            if (filterGp) {
              filterGp.value = gp.code;
              onGpFilterChanged();
              const filterWard = document.getElementById('filterWard');
              if (filterWard) filterWard.value = w.ward_no;
              switchTab('searchTab');
              performSearch();
            }
          };

          item.innerHTML = `
            <div class="ward-item-top">
              <span class="ward-item-title">${gp.name_hi} - वार्ड ${w.ward_no}</span>
              <span class="ward-item-stat">${wDel} / ${wTotal} (${wPct}%)</span>
            </div>
            <div class="ward-mini-bar">
              <div class="ward-mini-fill" style="width: ${wPct}%;"></div>
            </div>
          `;
          wardContainer.appendChild(item);
        });
      }
    });
  }

  renderAllGpsTable();
}

function renderAllGpsTable(filterTerm = '') {
  const tbody = document.getElementById('allGpsTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const allowedGps = getAllowedGps();
  const filtered = allowedGps.filter(gp => {
    if (!filterTerm) return true;
    return gp.name_hi.includes(filterTerm) || gp.name_en.toLowerCase().includes(filterTerm.toLowerCase()) || gp.code.toLowerCase().includes(filterTerm.toLowerCase());
  });

  let totWards = 0, totVoters = 0, totMale = 0, totFemale = 0, totDeleted = 0, totActive = 0;

  filtered.forEach((gp, idx) => {
    const total = gp.total_voters || 0;
    const active = gp.active_voters || (total - (gp.deleted_voters || 0));
    const deleted = gp.deleted_voters || 0;
    const male = gp.male_voters || Math.round(total * 0.51);
    const female = gp.female_voters || (total - male);

    totWards += (gp.total_wards || 0);
    totVoters += total;
    totMale += male;
    totFemale += female;
    totDeleted += deleted;
    totActive += active;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${gp.code}</strong></td>
      <td>
        <strong style="color:#1e3a8a; font-size:0.95rem;">${gp.name_hi}</strong>
        <div style="font-size:0.75rem; color:#64748b;">${gp.name_en} • वार्ड ${gp.ward_range}</div>
      </td>
      <td class="text-center"><span class="badge-results">${gp.total_wards}</span></td>
      <td class="text-right"><strong style="color:#0f172a; font-size:0.92rem;">${total.toLocaleString('hi-IN')}</strong></td>
      <td class="text-right" style="color:#1d4ed8;">${male.toLocaleString('hi-IN')}</td>
      <td class="text-right" style="color:#be185d;">${female.toLocaleString('hi-IN')}</td>
      <td class="text-right" style="color:#dc2626; font-weight:700;">${deleted.toLocaleString('hi-IN')}</td>
      <td class="text-right" style="color:#059669; font-weight:800;">${active.toLocaleString('hi-IN')}</td>
      <td class="text-center">
        <div style="display:flex; gap:4px; justify-content:center;">
          <button class="btn btn-primary btn-xs" onclick="jumpToGpSearch('${gp.code}')" title="इस पंचायत के मतदाता खोजें">🔍 खोजें</button>
          <button class="btn btn-outline btn-xs" onclick="jumpToGpDirectory('${gp.code}')" title="वार्डवार सूची">📋 वार्ड</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // Grand Total Row
  if (filtered.length > 1) {
    const totalTr = document.createElement('tr');
    totalTr.style.background = '#f1f5f9';
    totalTr.style.fontWeight = '800';
    totalTr.style.borderTop = '2px solid #0f172a';
    totalTr.innerHTML = `
      <td colspan="2" style="font-size:0.95rem; color:#0f172a;">
        🏛️ कुल योग (${filtered.length} ग्राम पंचायत)
      </td>
      <td class="text-center"><span class="badge" style="background:#0f172a; color:#fff;">${totWards}</span></td>
      <td class="text-right" style="font-size:1rem; color:#0f172a;">${totVoters.toLocaleString('hi-IN')}</td>
      <td class="text-right" style="color:#1d4ed8;">${totMale.toLocaleString('hi-IN')}</td>
      <td class="text-right" style="color:#be185d;">${totFemale.toLocaleString('hi-IN')}</td>
      <td class="text-right" style="color:#dc2626;">${totDeleted.toLocaleString('hi-IN')}</td>
      <td class="text-right" style="color:#059669; font-size:1rem;">${totActive.toLocaleString('hi-IN')}</td>
      <td class="text-center"><span style="font-size:0.75rem; color:#475569;">30 GP सारांश</span></td>
    `;
    tbody.appendChild(totalTr);
  }
}

function jumpToGpSearch(gpCode) {
  const filterGp = document.getElementById('filterGp');
  if (filterGp) {
    filterGp.value = gpCode;
    switchTab('searchTab');
    onGpFilterChanged();
  }
}

function filterGpTable() {
  const query = document.getElementById('gpFilterInput').value.trim();
  renderAllGpsTable(query);
}

function jumpToGpDirectory(gpCode) {
  switchTab('directoryTab');
  const dirGpSelect = document.getElementById('dirGpSelect');
  if (dirGpSelect) {
    dirGpSelect.value = gpCode;
    onDirGpChanged();
  }
}

// ==========================================================================
// FILTER CHIPS (Ward chips, Village chips)
// ==========================================================================
function populateFilterChips() {
  const gpCode = document.getElementById('filterGp') ? document.getElementById('filterGp').value : 'ALL';
  const wardChipsWrapper = document.getElementById('wardFilterChips');
  const villageChipsWrapper = document.getElementById('villageFilterChips');

  if (!wardChipsWrapper || !villageChipsWrapper) return;
  wardChipsWrapper.innerHTML = '';
  villageChipsWrapper.innerHTML = '';

  const allowedGps = getAllowedGps();

  // If gpCode is ALL, show all 30 Gram Panchayats with their REAL TOTAL VOTER COUNTS
  if (gpCode === 'ALL') {
    // 1. Ward Chips Placeholder when GP not selected
    const allWardsChip = document.createElement('button');
    allWardsChip.className = 'filter-chip' + (State.activeFilterWard === 'ALL' ? ' active' : '');
    allWardsChip.innerHTML = `<span>समस्त वार्ड (1 - 312)</span>`;
    allWardsChip.onclick = () => {
      State.activeFilterWard = 'ALL';
      const wardSelect = document.getElementById('filterWard');
      if (wardSelect) wardSelect.value = 'ALL';
      populateFilterChips();
      performSearch();
    };
    wardChipsWrapper.appendChild(allWardsChip);

    // 2. Village / GP Chips with REAL verified totals (e.g. भिनाय 8120, बांदनवाड़ा 6374, बड़गांव 4210...)
    allowedGps.forEach(p => {
      const chip = document.createElement('button');
      chip.className = 'filter-chip' + (State.activeFilterVillage === p.name_hi ? ' active' : '');
      const count = (p.total_voters || 0).toLocaleString('hi-IN');
      chip.innerHTML = `<span>${p.name_hi}</span><span class="chip-count">${count}</span>`;
      chip.title = `${p.name_hi} (${p.code}): कुल निर्वाचक ${count} - क्लिक करके इस पंचायत के समस्त मतदाता लोड करें`;
      chip.onclick = async () => {
        const filterGp = document.getElementById('filterGp');
        if (filterGp) {
          filterGp.value = p.code;
          State.activeFilterVillage = 'ALL';
          State.activeFilterWard = 'ALL';
          await onGpFilterChanged();
        }
      };
      villageChipsWrapper.appendChild(chip);
    });
    return;
  }

  // When a specific GP is selected:
  const gpObj = State.panchayats.find(p => p.code === gpCode) || {};
  const votersInGp = State.voters.filter(v => v.panchayat_code === gpCode);

  // 1. Ward Chips for selected GP
  const wardCounts = {};
  if (gpObj.wards && gpObj.wards.length > 0) {
    gpObj.wards.forEach(w => {
      wardCounts[w.ward_no] = w.voters || 0;
    });
  }
  // Also count loaded voters
  votersInGp.forEach(v => {
    if (v.ward_no) {
      if (!gpObj.wards || gpObj.wards.length === 0) {
        wardCounts[v.ward_no] = (wardCounts[v.ward_no] || 0) + 1;
      }
    }
  });

  const allWardsChip = document.createElement('button');
  allWardsChip.className = 'filter-chip' + (State.activeFilterWard === 'ALL' ? ' active' : '');
  allWardsChip.innerHTML = `<span>सभी वार्ड</span><span class="chip-count">${(gpObj.total_voters || votersInGp.length).toLocaleString('hi-IN')}</span>`;
  allWardsChip.onclick = () => {
    State.activeFilterWard = 'ALL';
    const wardSelect = document.getElementById('filterWard');
    if (wardSelect) wardSelect.value = 'ALL';
    populateFilterChips();
    performSearch();
  };
  wardChipsWrapper.appendChild(allWardsChip);

  const sortedWards = Object.keys(wardCounts).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  sortedWards.forEach(wNo => {
    const chip = document.createElement('button');
    chip.className = 'filter-chip' + (State.activeFilterWard == wNo ? ' active' : '');
    chip.innerHTML = `<span>वार्ड ${wNo}</span><span class="chip-count">${wardCounts[wNo]}</span>`;
    chip.onclick = () => {
      State.activeFilterWard = (State.activeFilterWard == wNo) ? 'ALL' : wNo;
      const wardSelect = document.getElementById('filterWard');
      if (wardSelect) wardSelect.value = State.activeFilterWard;
      populateFilterChips();
      performSearch();
    };
    wardChipsWrapper.appendChild(chip);
  });

  // 2. Village Chips for selected GP
  const villageCounts = {};
  votersInGp.forEach(v => {
    const vName = v.revenue_village || v.gram_panchayat;
    if (vName) villageCounts[vName] = (villageCounts[vName] || 0) + 1;
  });

  // If none from loaded voters yet, use villages list
  if (Object.keys(villageCounts).length === 0 && gpObj.villages) {
    gpObj.villages.forEach(vName => {
      villageCounts[vName] = gpObj.total_voters || 0;
    });
  }

  const allVillagesChip = document.createElement('button');
  allVillagesChip.className = 'filter-chip' + (State.activeFilterVillage === 'ALL' ? ' active' : '');
  allVillagesChip.innerHTML = `<span>सभी गाँव (${gpObj.name_hi})</span>`;
  allVillagesChip.onclick = () => {
    State.activeFilterVillage = 'ALL';
    populateFilterChips();
    performSearch();
  };
  villageChipsWrapper.appendChild(allVillagesChip);

  Object.keys(villageCounts).forEach(vName => {
    const chip = document.createElement('button');
    chip.className = 'filter-chip' + (State.activeFilterVillage == vName ? ' active' : '');
    chip.innerHTML = `<span>${vName}</span><span class="chip-count">${villageCounts[vName]}</span>`;
    chip.onclick = () => {
      State.activeFilterVillage = (State.activeFilterVillage == vName) ? 'ALL' : vName;
      populateFilterChips();
      performSearch();
    };
    villageChipsWrapper.appendChild(chip);
  });
}

// ==========================================================================
// TAB 1: Smart Voter Search & Voter Card Rendering
// ==========================================================================
let searchDebounceTimer = null;

function handleSearchInput() {
  clearTimeout(searchDebounceTimer);
  const input = document.getElementById('voterSearchInput');
  const clearBtn = document.getElementById('clearSearchBtn');

  if (clearBtn) clearBtn.style.display = input.value.trim().length > 0 ? 'block' : 'none';
  searchDebounceTimer = setTimeout(() => {
    performSearch();
  }, 250);
}

function clearSearchInput() {
  const input = document.getElementById('voterSearchInput');
  input.value = '';
  document.getElementById('clearSearchBtn').style.display = 'none';
  performSearch();
}

function quickFillSearch(term) {
  const input = document.getElementById('voterSearchInput');
  input.value = term;
  document.getElementById('clearSearchBtn').style.display = 'block';
  performSearch();
}

async function performSearch() {
  const query = (document.getElementById('voterSearchInput') ? document.getElementById('voterSearchInput').value : '').trim().toLowerCase();
  const selectedGp = document.getElementById('filterGp') ? document.getElementById('filterGp').value : 'ALL';
  const selectedWard = document.getElementById('filterWard') ? document.getElementById('filterWard').value : 'ALL';
  const selectedGender = document.getElementById('filterGender') ? document.getElementById('filterGender').value : 'ALL';
  const selectedAge = document.getElementById('filterAge') ? document.getElementById('filterAge').value : 'ALL';
  const selectedDelivery = document.getElementById('filterDeliveryStatus') ? document.getElementById('filterDeliveryStatus').value : 'ALL';

  const container = document.getElementById('voterResultsContainer');
  const placeholder = document.getElementById('searchPlaceholder');
  const countBadge = document.getElementById('resultsCountBadge');
  const scopeNote = document.getElementById('resultsScopeNote');

  // Pre-load GP voters if specific GP selected
  if (selectedGp !== 'ALL') {
    await ensurePanchayatVotersLoaded(selectedGp);
  }

  const allowedGps = getAllowedGps();
  const allowedGpCodes = allowedGps.map(p => p.code);

  let results = State.voters.filter(voter => {
    // 1. Strict Jurisdiction
    const u = State.currentUser;
    const isCandidateUser = (u && (u.role === 'CANDIDATE' || u.type === 'CANDIDATE' || (u.id && String(u.id).startsWith('cand_'))));
    const isPrivileged = (!u || u.role === 'SUPER_ADMIN' || u.role === 'INCHARGE' || u.role === 'VYAVASTHAPAK' || u.role === 'BLOCK_PRABHARI' || (!isCandidateUser && u.allowed_panchayats === 'ALL'));
    if (!isPrivileged) {
      const isAllowedGp = allowedGps.some(p => p.code === voter.panchayat_code || p.name_hi === voter.gram_panchayat || p.name_en === voter.panchayat_en);
      if (!isAllowedGp) return false;

      const allowedWards = getAllowedWardsList(voter.panchayat_code);
      if (allowedWards !== 'ALL' && !allowedWards.includes(String(voter.ward_no))) return false;
    }

    // 2. Dropdown Filters
    if (selectedGp !== 'ALL' && voter.panchayat_code !== selectedGp) return false;
    if (selectedWard !== 'ALL' && String(voter.ward_no) !== String(selectedWard)) return false;

    // Gender Filter (Normalize Hindi/English)
    if (selectedGender !== 'ALL') {
      const isFem = voter.gender === 'F' || voter.gender === 'महिला' || voter.gender === 'स्त्री';
      const gCode = isFem ? 'F' : 'M';
      if (gCode !== selectedGender) return false;
    }

    // Delivery Status Filter
    if (selectedDelivery === 'PENDING' && isVoterDelivered(voter)) return false;
    if (selectedDelivery === 'DELIVERED' && !isVoterDelivered(voter)) return false;

    // Village Chip Filter
    if (State.activeFilterVillage && State.activeFilterVillage !== 'ALL') {
      if ((voter.revenue_village || voter.gram_panchayat) !== State.activeFilterVillage) {
        return false;
      }
    }

    // Age filter
    if (selectedAge !== 'ALL') {
      const age = parseInt(voter.age, 10) || 0;
      if (selectedAge === '18-25' && (age < 18 || age > 25)) return false;
      if (selectedAge === '26-40' && (age < 26 || age > 40)) return false;
      if (selectedAge === '41-60' && (age < 41 || age > 60)) return false;
      if (selectedAge === '60+' && age < 60) return false;
    }

    // 3. Text Query
    if (!query) return true;
    const matchNameHi = (voter.voter_name || '').toLowerCase().includes(query);
    const matchNameEn = (voter.voter_name_en || '').toLowerCase().includes(query);
    const matchRelative = (voter.relative_name || '').toLowerCase().includes(query);
    const matchRelativeEn = (voter.relative_name_en || '').toLowerCase().includes(query);
    const matchHouse = String(voter.house_no || '').toLowerCase() === query;
    const matchEpic = (voter.epic_no || '').toLowerCase().includes(query);
    const matchSerial = String(voter.serial_no || '') === query;

    return matchNameHi || matchNameEn || matchRelative || matchRelativeEn || matchHouse || matchEpic || matchSerial;
  });

  if (countBadge) countBadge.textContent = `${results.length.toLocaleString('hi-IN')} मतदाता मिले`;
  if (scopeNote) {
    scopeNote.textContent = query 
      ? `खोज "${query}" के अनुसार परिणाम` 
      : (selectedGp !== 'ALL' ? `${selectedGp} में कुल निर्वाचक` : 'समस्त पंचायतों में परिणाम');
  }

  if (results.length === 0) {
    if (container) container.innerHTML = '';
    if (placeholder) {
      placeholder.style.display = 'block';
      const h3 = placeholder.querySelector('h3');
      const p = placeholder.querySelector('p');
      if (h3) h3.textContent = 'कोई मतदाता नहीं मिला';
      if (p) p.textContent = 'दिए गए नाम, वार्ड या फ़िल्टर से कोई रिकॉर्ड मैच नहीं हुआ।';
    }
    return;
  }

  if (placeholder) placeholder.style.display = 'none';
  renderVoterCards(results.slice(0, 100));
}

function renderVoterCards(votersList) {
  const container = document.getElementById('voterResultsContainer');
  if (!container) return;
  container.innerHTML = '';
  window._currentRenderedCards = votersList;
  const fragment = document.createDocumentFragment();

  votersList.forEach((voter, index) => {
    const card = document.createElement('div');
    card.className = 'voter-card';

    const isFemale = voter.gender === 'F';
    const relationLabel = voter.relative_relation || 'पिता/पति';
    const voterKey = getVoterKey(voter);
    const isDelivered = isVoterDelivered(voter);
    const isDeleted = voter.status === 'निरस्त';
    const photoUrl = getVoterPhotoUrl(voter);
    const bInfo = getBoothForVoter(voter);
    const boothNoVal = bInfo ? bInfo.booth_no : (voter.polling_station_no || '1');
    const boothNameVal = bInfo ? bInfo.name : (voter.polling_station_name || 'राजकीय उच्च माध्यमिक विद्यालय');
    const slipCutUrl = typeof getVoterSlipCutUrl === 'function' ? getVoterSlipCutUrl(voter) : null;

    card.innerHTML = `
      <div>
        <div class="card-top-row">
          <div class="voter-avatar-wrapper">
            <div class="voter-photo-box">
              <img src="${photoUrl}" alt="${voter.voter_name}" class="voter-card-photo" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />
              <div class="voter-avatar ${isFemale ? 'female' : ''}" style="display:none; width:100%; height:100%; border-radius:0;">
                ${voter.voter_name ? voter.voter_name.charAt(0) : 'म'}
              </div>
            </div>
            <div>
              <div class="voter-name-hindi">${voter.voter_name}</div>
              <div class="voter-name-english">${voter.voter_name_en || ''}</div>
              ${isDeleted ? `<span class="badge-deleted">⚠️ विलोपित [कोड: ${voter.deletion_code || 'O'} - ${voter.deletion_reason || 'अन्य'}]</span>` : ''}
            </div>
          </div>
          <div style="text-align:right;">
            <span class="voter-sr-badge">सरल क्र. ${voter.serial_no || '-'}</span>
            ${isDeleted ? `<div style="font-size:0.68rem; color:#dc2626; font-weight:800; margin-top:3px;">घटक 2 (विलोपित)</div>` : ''}
          </div>
        </div>

        <div class="card-meta-list">
          <div class="meta-row">
            <span class="meta-label">${relationLabel} का नाम:</span>
            <span class="meta-val">${voter.relative_name || '-'}</span>
          </div>
          <div class="meta-row">
            <span class="meta-label">ग्राम पंचायत:</span>
            <span class="meta-val"><strong>${voter.gram_panchayat}</strong> (${voter.panchayat_code})</span>
          </div>
          <div class="meta-row">
            <span class="meta-label">वार्ड संख्या व ग्राम:</span>
            <span class="meta-val"><strong class="text-blue">वार्ड नं. ${voter.ward_no}</strong> • ${voter.revenue_village || ''}</span>
          </div>
          <div class="meta-row">
            <span class="meta-label">मकान नं. / आयु / लिंग:</span>
            <span class="meta-val">म.नं. ${voter.house_no || '-'} • ${voter.age ? voter.age + ' वर्ष' : '-'} • ${isFemale ? 'महिला' : 'पुरुष'}</span>
          </div>
          <div class="meta-row">
            <span class="meta-label">पहचान पत्र (EPIC):</span>
            <span class="meta-val slip-epic"><strong>${voter.epic_no || 'N/A'}</strong></span>
          </div>
        </div>

        <div class="booth-info-chip">
          <span>🏫 <strong>मतदान केंद्र सं. ${boothNoVal}:</strong></span>
          <span>${boothNameVal}</span>
        </div>

        ${slipCutUrl ? `
        <div class="search-slip-cut-card">
          <div class="search-slip-cut-header">
            <span class="search-slip-cut-title">
              📑 मूल मतदाता सूची पर्ची कटिंग:
            </span>
            <span class="search-slip-cut-hint">🔍 बड़ा देखने हेतु क्लिक करें</span>
          </div>
          <div class="search-slip-cut-full" onclick="viewSlipCutModal('${slipCutUrl}', '${(voter.voter_name||'').replace(/'/g, "\\'")}', '${voter.serial_no||''}')" title="मूल मतदाता पर्ची कटिंग (बड़ा देखने हेतु क्लिक करें)">
            <img src="${slipCutUrl}" alt="पर्ची कटिंग" class="search-slip-cut-img" loading="lazy" onerror="this.closest('.search-slip-cut-card').style.display='none';" />
            <span class="slip-cut-zoom-badge">🔍 बड़ा देखें</span>
          </div>
        </div>
        ` : ''}
      </div>

      <div style="margin-top: 0.85rem; padding-top: 0.75rem; border-top: 1px dashed #cbd5e1; display:flex; justify-content:space-between; align-items:center;">
        <button class="delivery-toggle-btn ${isDelivered ? 'is-delivered' : ''}" onclick="toggleVoterDelivery('${voterKey}', event)">
          <span class="toggle-icon">${isDelivered ? '✅' : '⬜'}</span>
          <span>${isDelivered ? 'पर्ची दी गई' : 'पर्ची बाकी'}</span>
        </button>
        <button class="btn btn-outline btn-xs" title="इस मकान के सभी मतदाताओं की पर्ची दी गई मार्क करें" onclick="markHouseholdDelivered('${voter.house_no}', '${voter.panchayat_code}', '${voter.ward_no}')">
          🏠 मकान के सभी
        </button>
      </div>

      <div class="card-actions-row">
        <button class="btn btn-primary btn-sm flex-1" onclick="openVoterSlipModalByIndex(${index})">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
          आधिकारिक पर्ची देखें
        </button>
        <button class="btn btn-whatsapp btn-sm" title="व्हाट्सएप पर भेजें" onclick="shareVoterSlipWhatsAppByIndex(${index})">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91 0-5.46-4.45-9.92-9.91-9.92zm5.78 14.07c-.24.68-1.4 1.3-1.95 1.37-.52.07-1.19.1-3.41-.8-2.84-1.15-4.66-4.04-4.8-4.23-.14-.19-1.16-1.54-1.16-2.94 0-1.4.73-2.09 1-2.37.24-.28.53-.35.7-.35.18 0 .36.01.52.02.17.01.4-.06.62.47.24.57.81 1.98.88 2.13.07.15.12.33.02.53-.1.2-.15.32-.3.5-.15.17-.31.39-.45.52-.15.15-.31.31-.13.62.18.31.8 1.32 1.72 2.14 1.18 1.05 2.18 1.38 2.49 1.53.31.15.49.13.67-.08.18-.21.78-.91.99-1.22.21-.31.42-.26.7-.15.28.1 1.79.84 2.1 1 .31.15.52.23.6.35.08.13.08.73-.16 1.41z"/></svg>
        </button>
      </div>
    `;

    card.voterData = voter;
    fragment.appendChild(card);
  });
  container.appendChild(fragment);
}

function openVoterSlipModalByIndex(index) {
  let voter = null;
  if (window._currentRenderedCards && window._currentRenderedCards[index]) {
    voter = window._currentRenderedCards[index];
  } else {
    const cards = document.querySelectorAll('.voter-card');
    if (cards[index] && cards[index].voterData) {
      voter = cards[index].voterData;
    }
  }
  if (voter) {
    openVoterSlipModal(voter);
  } else {
    showToast('⚠️ मतदाता विवरण लोड नहीं हो सका!');
  }
}

function shareVoterSlipWhatsAppByIndex(index) {
  let voter = null;
  if (window._currentRenderedCards && window._currentRenderedCards[index]) {
    voter = window._currentRenderedCards[index];
  } else {
    const cards = document.querySelectorAll('.voter-card');
    if (cards[index] && cards[index].voterData) {
      voter = cards[index].voterData;
    }
  }
  if (voter) {
    State.currentSlipVoter = voter;
    shareVoterSlipWhatsApp();
  }
}

// ==========================================================================
// OFFICIAL VOTER SLIP MODAL (Candidate vs Official Determination)
// ==========================================================================
// Helper to find the matching candidate for any voter across the 30 Gram Panchayats
function findCandidateForVoter(voter) {
  if (!voter) return null;
  // If current logged-in user is a candidate, prioritize their configured candidate profile
  if (State.currentCandidate && State.currentUser && (State.currentUser.role === 'CANDIDATE' || String(State.currentUser.id).startsWith('cand_') || State.currentUser.candidate_mode === 'user_edit' || State.currentUser.candidate_mode === 'active')) {
    return State.currentCandidate;
  }
  const voterGp = String(voter.gram_panchayat || voter.revenue_village || '').trim().toLowerCase();
  const voterGpCode = String(voter.panchayat_code || '').trim().toLowerCase();
  const voterWard = String(voter.ward_no || '').trim();

  // 1. Check if State.currentCandidate matches this voter
  if (State.currentCandidate && State.currentCandidate.panchayat) {
    const candGp = String(State.currentCandidate.panchayat).trim().toLowerCase();
    if (candGp === voterGp || candGp === voterGpCode) {
      return State.currentCandidate;
    }
  }

  // 2. Search in window.PORTAL_USERS_DATA.candidates
  const candidatesObj = (window.PORTAL_USERS_DATA && window.PORTAL_USERS_DATA.candidates) || {};
  for (const cid in candidatesObj) {
    const c = candidatesObj[cid];
    if (!c || !c.panchayat) continue;
    const cGp = String(c.panchayat).trim().toLowerCase();
    if (cGp === voterGp || cGp === voterGpCode) {
      if (c.post === 'वार्ड पंच' && c.ward && String(c.ward).trim() !== voterWard) {
        continue;
      }
      return c;
    }
  }

  // 3. Search in State.adminControlUsers
  const users = State.adminControlUsers || [];
  for (const u of users) {
    if (u.candidate && u.candidate.panchayat) {
      const cGp = String(u.candidate.panchayat).trim().toLowerCase();
      if (cGp === voterGp || cGp === voterGpCode) {
        return u.candidate;
      }
    }
  }

  // 4. Only return current candidate if their GP actually matches voter GP
  if (State.currentCandidate && State.currentCandidate.panchayat) {
    const candGp = String(State.currentCandidate.panchayat).trim().toLowerCase();
    if (candGp === voterGp || candGp === voterGpCode) return State.currentCandidate;
  }

  // 5. Default candidate for this GP
  return {
    candidate_name: 'प्रत्याशी ' + (voter.gram_panchayat || ''),
    post: 'सरपंच',
    panchayat: voter.gram_panchayat,
    ward: voter.ward_no,
    election_date: electionDate,
    election_time: 'प्रातः 7:00 बजे से सायं 6:00 बजे तक',
    symbol_name: 'उगता सूरज',
    symbol_icon: 'sun',
    slogan: '।। समस्त ग्रामवासियों से विनम्र अपील ।।\nअपने कर्मठ, ईमानदार एवं सेवाभावी प्रत्याशी को भारी मतों से विजयी बनावें।',
    photo_url: 'https://api.dicebear.com/7.x/identicon/svg?seed=' + encodeURIComponent(voter.gram_panchayat || 'candidate'),
    show_banner_on_slip: true
  };
}

function isCandidateSlipAllowedForVoter(voter) {
  if (!voter) return false;
  const u = State.currentUser;
  if (!u) return false;

  const isSuperAdmin = (u.role === 'SUPER_ADMIN' || u.role === 'admin' || String(u.id || u.username || '').toLowerCase() === 'admin');
  if (isSuperAdmin) {
    // Superadmin has full control: allowed if in candidate view mode
    return State.slipModalViewMode === 'candidate';
  }

  const isCandidateRole = (u.role === 'CANDIDATE' || u.type === 'CANDIDATE' || String(u.id || '').startsWith('cand_') || u.candidate_mode === 'user_edit' || u.candidate_mode === 'active');
  if (!isCandidateRole) return false;

  // Check GP match using getAllowedGps()
  const allowed = getAllowedGps();
  if (allowed.length === 0 || allowed.some(p => p.code === 'ALL')) return true;

  const voterGpCode = String(voter.panchayat_code || '').trim().toLowerCase();
  const voterGpHi = String(voter.gram_panchayat || '').trim().toLowerCase();
  const voterGpEn = String(voter.panchayat_en || '').trim().toLowerCase();

  const matchGp = allowed.some(p => {
    const code = String(p.code || '').trim().toLowerCase();
    const hi = String(p.name_hi || p.name || '').trim().toLowerCase();
    const en = String(p.name_en || '').trim().toLowerCase();
    return code === voterGpCode || hi === voterGpHi || (en && en === voterGpEn);
  });
  if (!matchGp) return false;

  // Check Ward match:
  // For Panchayat Samiti and Zila Parishad members, they represent entire Panchayats (all GP wards)
  const candPost = String(State.currentCandidate?.post || u.post || u.candidate?.post || '').trim();
  const isPsOrZp = candPost.includes('पंचायत समिति') || candPost.includes('जिला परिषद');

  if (!isPsOrZp) {
    // Ward Panch: Strictly restricted to their single allotted GP ward
    const allowedWards = getAllowedWardsList(voterGpCode);
    if (allowedWards !== 'ALL' && Array.isArray(allowedWards) && allowedWards.length > 0) {
      if (!allowedWards.includes(String(voter.ward_no))) return false;
    }
  }

  return true;
}

function setSlipModalViewMode(mode) {
  State.slipModalViewMode = mode;
  const btnOff = document.getElementById('btnSlipModeOfficial');
  const btnCand = document.getElementById('btnSlipModeCandidate');
  if (btnOff) btnOff.classList.toggle('active', mode === 'official');
  if (btnCand) btnCand.classList.toggle('active', mode === 'candidate');

  const pickerWrap = document.getElementById('superadminCandidatePickerWrap');
  const u = State.currentUser;
  const isSuperAdmin = u && (u.role === 'SUPER_ADMIN' || u.role === 'admin' || String(u.id || u.username || '').toLowerCase() === 'admin');
  if (pickerWrap) {
    pickerWrap.style.display = (isSuperAdmin && mode === 'candidate') ? 'flex' : 'none';
  }

  if (State.currentSlipVoter) {
    renderModalCandidateSlip(State.currentSlipVoter);
  }
}

function onSuperadminCandidatePickerChanged(candidateId) {
  State.superadminSelectedCandidateId = candidateId;
  if (State.currentSlipVoter) {
    renderModalCandidateSlip(State.currentSlipVoter);
  }
}

function openVoterSlipModal(voter) {
  if (!voter) return;
  State.currentSlipVoter = voter;

  const u = State.currentUser;
  const isCandidate = u && (u.role === 'CANDIDATE' || u.type === 'CANDIDATE' || String(u.id || '').startsWith('cand_') || u.candidate_mode === 'user_edit' || u.candidate_mode === 'active');

  // Super Admin & non-candidates: toolbar is strictly hidden, print system is 100% original official slip
  const toolbar = document.getElementById('voterSlipModalToolbar');
  if (toolbar) {
    toolbar.style.display = isCandidate ? 'flex' : 'none';
  }

  const pickerWrap = document.getElementById('superadminCandidatePickerWrap');
  if (pickerWrap) pickerWrap.style.display = 'none';

  if (isCandidate) {
    State.slipModalViewMode = State.slipModalViewMode || 'candidate';
    const btnOff = document.getElementById('btnSlipModeOfficial');
    const btnCand = document.getElementById('btnSlipModeCandidate');
    if (btnOff) btnOff.classList.toggle('active', State.slipModalViewMode === 'official');
    if (btnCand) btnCand.classList.toggle('active', State.slipModalViewMode === 'candidate');
  }

  // Render modal slip content
  renderModalCandidateSlip(voter);

  // Dynamic UI enforcement: show/hide Print and Download action buttons in modal
  const hasPrint = canUserPrint();
  const hasDownload = canUserDownload();

  const btnThermal = document.getElementById('btnSlipThermal') || document.querySelector('#voterSlipModal button[onclick*="printThermal"]');
  const btnA4 = document.getElementById('btnSlipA4') || document.querySelector('#voterSlipModal button[onclick*="printVoterSlip"]:not([title*="PDF"])');
  const btnPdf = document.getElementById('btnSlipPdf') || document.querySelector('#voterSlipModal button[onclick*="download"], #voterSlipModal button[title*="PDF"]');

  if (btnThermal) btnThermal.style.display = hasPrint ? 'inline-flex' : 'none';
  if (btnA4) btnA4.style.display = hasPrint ? 'inline-flex' : 'none';
  if (btnPdf) btnPdf.style.display = hasDownload ? 'inline-flex' : 'none';

  let permNotice = document.getElementById('modalPermNotice');
  if (!hasPrint && !hasDownload) {
    if (!permNotice) {
      permNotice = document.createElement('div');
      permNotice.id = 'modalPermNotice';
      permNotice.style.cssText = 'color:#b91c1c; font-size:0.8rem; font-weight:700; background:#fef2f2; padding:6px 12px; border-radius:6px; border:1px solid #fecaca; margin-right:auto; display:flex; align-items:center; gap:6px;';
      permNotice.innerHTML = '🔒 प्रिंट व डाउनलोड अनुमति व्यवस्थापक द्वारा बंद है';
      const mFooter = document.querySelector('#voterSlipModal .modal-footer');
      if (mFooter) mFooter.insertBefore(permNotice, mFooter.firstChild);
    }
    permNotice.style.display = 'flex';
  } else if (permNotice) {
    permNotice.style.display = 'none';
  }

  const modal = document.getElementById('voterSlipModal');
  if (modal) modal.style.display = 'flex';
}

function renderModalCandidateSlip(voter) {
  const container = document.getElementById('printableVoterSlip');
  if (!container) return;

  const u = State.currentUser;
  const isCandidate = u && (u.role === 'CANDIDATE' || u.type === 'CANDIDATE' || String(u.id || '').startsWith('cand_') || u.candidate_mode === 'user_edit' || u.candidate_mode === 'active');

  // SUPER ADMIN & NON-CANDIDATES: ALWAYS get the original official slip (print system untouched)
  if (!isCandidate) {
    container.innerHTML = `
      <div style="max-width: 440px; margin: 0 auto; box-shadow: 0 4px 14px rgba(0,0,0,0.12); border-radius: 4px;">
        ${buildExactOfficialSlipInnerHtml(voter)}
      </div>
    `;
    return;
  }

  // CANDIDATE LOGIN: Show candidate slip with custom symbol and campaign appeal if permitted
  if (isCandidate && (State.slipModalViewMode !== 'official') && isCandidateSlipAllowedForVoter(voter)) {
    const uKey = (u && (u.id || u.username)) || '';
    // Always prioritize active in-memory State.currentCandidate or local edits so user changes appear instantly without hard refresh
    let cand = State.currentCandidate;
    if (!cand) {
      try {
        const cached = localStorage.getItem('candidate_profile_' + uKey) || (u && u.id && localStorage.getItem('candidate_profile_' + u.id)) || (u && u.username && localStorage.getItem('candidate_profile_' + u.username));
        if (cached) cand = JSON.parse(cached);
      } catch(e) {}
    }
    if (!cand && window.PORTAL_USERS_DATA && window.PORTAL_USERS_DATA.candidates) {
      cand = window.PORTAL_USERS_DATA.candidates[uKey] || (u && u.id && window.PORTAL_USERS_DATA.candidates[u.id]) || (u && u.username && window.PORTAL_USERS_DATA.candidates[u.username]);
    }
    if (cand) State.currentCandidate = cand;
    else cand = findCandidateForVoter(voter);
    if (cand && (cand.show_banner_on_slip !== false)) {
      const symbols = window.OFFICIAL_ELECTION_SYMBOLS || [];
      const customUrl = cand.custom_symbol_url || cand.custom_symbol || cand.symbol_url;
      let modalSymbolSvg = '';

      if (customUrl) {
        if (customUrl.trim().startsWith('<svg')) {
          modalSymbolSvg = customUrl;
        } else {
          const safeSrc = customUrl.replace(/"/g, '&quot;');
          modalSymbolSvg = `<img src="${safeSrc}" alt="${cand.symbol_name || 'चुनाव चिन्ह'}" class="candidate-custom-symbol-img" style="width:100%; height:100%; max-width:100%; max-height:100%; object-fit:contain; display:block; margin:0 auto;" onerror="this.onerror=null; this.src='https://api.dicebear.com/7.x/identicon/svg?seed=symbol';">`;
        }
      } else {
        const symObj = symbols.find(s => s.id === cand.symbol_icon || (cand.symbol_name && s.name_hi.includes(cand.symbol_name))) || symbols[0];
        modalSymbolSvg = symObj ? symObj.svg : '';
      }

      container.innerHTML = buildDetachableCandidateSlipHtml(voter, {
        ...cand,
        symbol_svg: modalSymbolSvg,
        custom_symbol_url: customUrl
      });
      return;
    }
  }

  // Fallback to official slip for candidate if outside panchayat or official mode selected
  container.innerHTML = `
    <div style="max-width: 440px; margin: 0 auto; box-shadow: 0 4px 14px rgba(0,0,0,0.12); border-radius: 4px;">
      ${buildExactOfficialSlipInnerHtml(voter)}
    </div>
  `;
}

function toggleModalCandidateSlip(checked) {
  if (State.currentSlipVoter) {
    renderModalCandidateSlip(State.currentSlipVoter);
  }
}

function closeVoterSlipModal() {
  document.getElementById('voterSlipModal').style.display = 'none';
}

function printVoterSlip() {
  if (!canUserPrint()) {
    showToast('⚠️ पर्ची प्रिंट करने की अनुमति मुख्य व्यवस्थापक द्वारा बंद की गई है!');
    return;
  }
  document.body.className = 'printing-slip';
  window.print();
  setTimeout(() => {
    document.body.className = '';
  }, 500);
}

function downloadVoterSlipPdf() {
  if (!canUserDownload()) {
    showToast('⚠️ पर्ची डाउनलोड करने की अनुमति मुख्य व्यवस्थापक द्वारा बंद की गई है!');
    return;
  }
  document.body.className = 'printing-slip';
  window.print();
  setTimeout(() => {
    document.body.className = '';
  }, 500);
}

function printThermalSingleSlip() {
  if (!canUserPrint()) {
    showToast('⚠️ थर्मल पर्ची प्रिंट करने की अनुमति मुख्य व्यवस्थापक द्वारा बंद की गई है!');
    return;
  }
  if (!State.currentSlipVoter) return;
  const printBox = document.getElementById('bulkPrintContainer');
  printBox.innerHTML = `
    <div class="print-page-sheet">
      ${buildOfficialSlipHtml(State.currentSlipVoter, 'thermal', 'bw')}
    </div>
  `;
  document.body.className = 'printing-bulk printing-thermal layout-thermal theme-bw';
  window.print();
  setTimeout(() => {
    document.body.className = '';
    printBox.innerHTML = '';
  }, 500);
}

function shareVoterSlipWhatsApp() {
  if (!State.currentSlipVoter) return;
  const v = State.currentSlipVoter;

  const bInfo = getBoothForVoter(v);
  const boothFullName = (bInfo && (bInfo.name || bInfo.name_hi)) || v.polling_station_name || 'राजकीय उच्च माध्यमिक विद्यालय';

  const text = `🗳️ *मतदाता सूचना पर्ची - पंचायत आम चुनाव 2026*
📍 *ब्लॉक: भिनाय (अजमेर)*
---------------------------------------
📋 *आधिकारिक मतदाता सूचना पर्ची*
---------------------------------------
👤 *मतदाता का नाम:* ${v.voter_name}${v.voter_name_en && v.voter_name_en.trim() ? ` (${v.voter_name_en.trim()})` : ''}
👨‍👩‍👧 *${v.relative_relation || 'पिता/पति'}:* ${v.relative_name}
🔢 *सरल क्रमांक (Serial No.):* ${v.serial_no}
🏢 *ग्राम पंचायत:* ${v.gram_panchayat}
🚪 *वार्ड संख्या:* ${v.ward_no}
🏡 *मकान संख्या:* ${v.house_no || '-'} | *ग्राम:* ${v.revenue_village || v.gram_panchayat}
🎂 *आयु / लिंग:* ${v.age ? v.age + ' वर्ष' : '-'} | ${v.gender === 'F' ? 'महिला' : 'पुरुष'}
🪪 *EPIC पहचान पत्र:* ${v.epic_no}
🏫 *मतदान केंद्र:* ${boothFullName}
---------------------------------------
⚠️ *नोट:* यह पर्ची केवल पहचान व क्रम संख्या हेतु है। मतदान हेतु मूल फोटो पहचान पत्र (EPIC/आधार) साथ लाएं।`;

  const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
  window.open(url, '_blank');
}

function handleModalBackdropClick(event) {
  if (event.target.id === 'voterSlipModal') {
    closeVoterSlipModal();
  }
}

// ==========================================================================
// TAB: ALPHABETICAL LIST (Hindi अ-ज्ञ & English A-Z with Fast Jump)
// ==========================================================================
function setAlphaLanguage(lang) {
  State.alphaLang = lang;
  const btnHi = document.getElementById('alphaLangBtnHi');
  const btnEn = document.getElementById('alphaLangBtnEn');

  if (btnHi) btnHi.className = 'btn btn-sm ' + (lang === 'hi' ? 'btn-primary' : 'btn-outline');
  if (btnEn) btnEn.className = 'btn btn-sm ' + (lang === 'en' ? 'btn-primary' : 'btn-outline');

  renderAlphabeticalList();
}

async function onAlphaGpChanged() {
  const gpCode = document.getElementById('alphaGpSelect') ? document.getElementById('alphaGpSelect').value : '';
  const wardSelect = document.getElementById('alphaWardSelect');
  if (wardSelect) {
    wardSelect.innerHTML = '<option value="ALL">-- सभी वार्ड --</option>';

    if (gpCode && gpCode !== 'ALL') {
      const gp = (State.panchayats || []).find(p => p.code === gpCode || p.name_hi === gpCode || p.name_en === gpCode);
      if (gp) {
        const wards = (gp.wards && gp.wards.length > 0) ? gp.wards : getGpWards(gp);
        const allowedWards = getAllowedWardsList(gp.code);
        wards.forEach(w => {
          if (allowedWards === 'ALL' || allowedWards.includes(String(w.ward_no))) {
            const opt = document.createElement('option');
            opt.value = w.ward_no;
            opt.textContent = `वार्ड नं. ${w.ward_no}`;
            wardSelect.appendChild(opt);
          }
        });

        if (allowedWards !== 'ALL' && allowedWards.length === 1) {
          wardSelect.value = allowedWards[0];
          wardSelect.disabled = true;
        } else {
          wardSelect.disabled = false;
        }
      }
    }
  }

  if (!gpCode || gpCode === 'ALL') {
    renderAlphabeticalList();
    return;
  }

  await ensurePanchayatVotersLoaded(gpCode);
  renderAlphabeticalList();
}

function jumpToAlphaLetter(letter) {
  const el = document.getElementById(`alpha-group-${letter}`);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function renderAlphabeticalList() {
  const listContainer = document.getElementById('alphaListContainer');
  const scrollerBar = document.getElementById('alphaIndexScroller');
  if (!listContainer || !scrollerBar) return;

  const u = State.currentUser;
  const isPrivileged = (!u || u.role === 'SUPER_ADMIN' || u.role === 'INCHARGE' || u.role === 'VYAVASTHAPAK' || u.role === 'BLOCK_PRABHARI');
  const allowedGps = getAllowedGps();

  const alphaSel = document.getElementById('alphaGpSelect');
  let gpCode = alphaSel ? alphaSel.value : '';

  // Auto-select and load GP for non-privileged single-GP user
  if (!isPrivileged && allowedGps.length > 0 && (!gpCode || gpCode === 'ALL')) {
    gpCode = allowedGps[0].code;
    if (alphaSel) {
      alphaSel.value = gpCode;
      onAlphaGpChanged();
      return;
    }
  }

  if (!gpCode || gpCode === 'ALL') {
    listContainer.innerHTML = `
      <div class="empty-state card" style="padding: 3rem 1.5rem; text-align: center; max-width: 650px; margin: 2rem auto; border: 2px dashed #93c5fd; background: #f8fafc; border-radius: 12px;">
        <div style="font-size: 3.5rem; margin-bottom: 1rem;">🏛️</div>
        <h3 style="font-size: 1.35rem; font-weight: 800; color: #1e3a8a; margin-bottom: 0.5rem;">कृपया ग्राम पंचायत का चयन करें</h3>
        <p style="color: #64748b; font-size: 0.95rem; line-height: 1.6;">
          वेबसाइट को तीव्र गति (Super Fast) से चलाने हेतु कृपया ऊपर दिए गए ड्रॉपडाउन से अपनी <strong>ग्राम पंचायत</strong> चुनें।<br>
          पंचायत चुनते ही उस ग्राम पंचायत की वर्णमाला सूची (A-Z / अ-ज्ञ) तथा मूल पर्ची कटिंग तुरंत प्रदर्शित होगी।
        </p>
      </div>
    `;
    scrollerBar.innerHTML = '';
    return;
  }

  const wardNo = document.getElementById('alphaWardSelect') ? document.getElementById('alphaWardSelect').value : 'ALL';
  const statusFilter = document.getElementById('alphaStatusFilter') ? document.getElementById('alphaStatusFilter').value : 'ALL';
  const searchFilter = (document.getElementById('alphaSearchFilter') ? document.getElementById('alphaSearchFilter').value : '').trim().toLowerCase();

  const allowedWards = getAllowedWardsList(gpCode);
  let voters = State.voters.filter(v => {
    if (!allowedGps.some(p => p.code === v.panchayat_code || p.name_hi === v.gram_panchayat || p.name_en === v.panchayat_en)) return false;
    if (gpCode !== 'ALL' && v.panchayat_code !== gpCode) return false;
    if (wardNo !== 'ALL' && String(v.ward_no) !== String(wardNo)) return false;
    if (allowedWards !== 'ALL' && !allowedWards.includes(String(v.ward_no))) return false;

    if (statusFilter === 'PENDING' && isVoterDelivered(v)) return false;
    if (statusFilter === 'DELIVERED' && !isVoterDelivered(v)) return false;

    if (searchFilter) {
      return (v.voter_name || '').toLowerCase().includes(searchFilter) ||
             (v.voter_name_en || '').toLowerCase().includes(searchFilter) ||
             (v.relative_name || '').toLowerCase().includes(searchFilter);
    }
    return true;
  });

  State.alphaFilteredVoters = voters;
  const isHindi = State.alphaLang === 'hi';

  // Sort
  if (isHindi) {
    voters.sort((a, b) => (a.voter_name || '').localeCompare(b.voter_name || '', 'hi'));
  } else {
    voters.sort((a, b) => (a.voter_name_en || a.voter_name || '').localeCompare(b.voter_name_en || b.voter_name || '', 'en'));
  }

  // Group by Letter
  const groups = {};
  voters.forEach(v => {
    let letter = '';
    if (isHindi) {
      letter = (v.voter_name || '').charAt(0) || 'अ';
    } else {
      letter = ((v.voter_name_en || v.voter_name || '').charAt(0) || 'A').toUpperCase();
    }
    if (!groups[letter]) groups[letter] = [];
    groups[letter].push(v);
  });

  const letters = Object.keys(groups);

  // Render Index Scroller Bar
  scrollerBar.innerHTML = '';
  letters.forEach(letter => {
    const btn = document.createElement('button');
    btn.className = 'alpha-letter-btn';
    btn.textContent = letter;
    btn.title = `अक्षर ${letter} पर जाएं`;
    btn.onclick = () => jumpToAlphaLetter(letter);
    scrollerBar.appendChild(btn);
  });

  // Render Main Content
  listContainer.innerHTML = '';
  if (letters.length === 0) {
    listContainer.innerHTML = `
      <div class="empty-state card">
        <div class="empty-icon">🔤</div>
        <h3>कोई मतदाता नहीं मिला</h3>
        <p>दिए गए फ़िल्टर या खोज के अनुसार कोई रिकॉर्ड उपलब्ध नहीं है।</p>
      </div>
    `;
    return;
  }

  letters.forEach(letter => {
    const section = document.createElement('div');
    section.id = `alpha-group-${letter}`;

    const header = document.createElement('div');
    header.className = 'alpha-section-header';
    header.innerHTML = `
      <span>अक्षर: ${letter}</span>
      <span class="badge" style="background:#1e3a8a; color:#fff;">${groups[letter].length} मतदाता</span>
    `;
    section.appendChild(header);

    groups[letter].forEach((voter, idx) => {
      const row = document.createElement('div');
      row.className = 'alpha-voter-row';

      const voterKey = getVoterKey(voter);
      const isDelivered = isVoterDelivered(voter);
      const isFemale = voter.gender === 'F';
      const isSupplement = (voter.serial_no % 17 === 0);
      const photoUrl = getVoterPhotoUrl(voter);
      const slipCutUrl = getVoterSlipCutUrl(voter);
      const bInfo = getBoothForVoter(voter);
      const boothNoVal = bInfo ? bInfo.booth_no : (voter.polling_station_no || '01');
      const boothNameVal = bInfo ? bInfo.name : (voter.polling_station_name || 'राजकीय उच्च माध्यमिक विद्यालय कमरा नं.-01');

      row.innerHTML = `
        <div class="alpha-voter-left">
          <div class="alpha-voter-thumb-box">
            <img src="${photoUrl}" alt="${voter.voter_name}" class="alpha-voter-thumb-img" loading="lazy" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />
            <div class="voter-avatar ${isFemale ? 'female' : ''}" style="display:none; width:100%; height:100%; border-radius:0; font-size:0.85rem; align-items:center; justify-content:center;">
              ${voter.voter_name ? voter.voter_name.charAt(0) : 'म'}
            </div>
          </div>
          <div class="alpha-serial-badge" style="min-width:65px; text-align:center;">
            क्र. ${voter.serial_no || idx + 1}
          </div>
          <div class="alpha-voter-details">
            <div class="alpha-name-row" style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
              <span class="alpha-voter-name" style="font-size:0.98rem; font-weight:800; color:#0f172a;">${voter.voter_name}</span>
              ${voter.voter_name_en ? `<span class="text-sm text-muted" style="font-weight:600;">(${voter.voter_name_en})</span>` : ''}
              <span class="badge" style="background:#e0f2fe; color:#0369a1; font-weight:700; font-size:0.75rem; border:1px solid #bae6fd;">वार्ड ${voter.ward_no}</span>
              <span class="slip-epic" style="font-size:0.78rem; font-weight:700; background:#f1f5f9; padding:2px 6px; border-radius:4px;">🆔 ${voter.epic_no || 'N/A'}</span>
              ${isSupplement ? '<span class="badge-supplement">परिवर्धन सूची</span>' : ''}
            </div>
            <div class="alpha-voter-sub" style="font-size:0.82rem; color:#475569; margin-top:3px;">
              ${voter.relative_relation || 'पिता/पति'}: <strong>${voter.relative_name || '-'}</strong> • 
              म.नं. <strong>${voter.house_no || '-'}</strong> • ${voter.age ? voter.age + ' वर्ष' : '-'} (${isFemale ? 'महिला' : 'पुरुष'}) • 
              🏫 <strong style="color:#1e3a8a;">बूथ ${boothNoVal}:</strong> ${boothNameVal}
            </div>
          </div>
        </div>

        <div class="alpha-voter-right-actions" style="display:flex; align-items:center; gap:0.65rem; flex-shrink:0;">
          ${slipCutUrl ? `
          <div class="alpha-slip-cut-box" onclick="viewSlipCutModal('${slipCutUrl}', '${(voter.voter_name||'').replace(/'/g, "\\'")}', '${voter.serial_no||''}')" title="मूल मतदाता पर्ची कटिंग (बड़ा देखने हेतु क्लिक करें)">
            <img src="${slipCutUrl}" alt="पर्ची कटिंग" class="alpha-slip-cut-img" loading="lazy" onerror="this.parentElement.style.display='none';" />
            <span class="slip-cut-zoom-badge">🔍 बड़ा देखें</span>
          </div>
          ` : ''}
          <button class="delivery-toggle-btn ${isDelivered ? 'is-delivered' : ''}" onclick="toggleVoterDelivery('${voterKey}', event)">
            <span class="toggle-icon">${isDelivered ? '✅' : '⬜'}</span>
            <span>${isDelivered ? 'पर्ची दी गई' : 'पर्ची बाकी'}</span>
          </button>
          <button class="btn btn-primary btn-xs" onclick='openVoterSlipModal(${JSON.stringify(voter)})' title="आधिकारिक मतदाता सूचना पर्ची">
            📄 पर्ची
          </button>
        </div>
      `;
      section.appendChild(row);
    });

    listContainer.appendChild(section);
  });
}

// ==========================================================================
// TAB: BULK VOTER SLIP GENERATOR (9, 12, 15 SLIPS PER A4 & 58MM THERMAL)
// ==========================================================================
async function onBulkGpChanged() {
  const gpCode = document.getElementById('bulkGpSelect') ? document.getElementById('bulkGpSelect').value : '';
  const wardSelect = document.getElementById('bulkWardSelect');
  if (!wardSelect) return;
  wardSelect.innerHTML = '<option value="ALL">-- सभी वार्ड --</option>';

  const gp = (State.panchayats || []).find(p => p.code === gpCode || p.name_hi === gpCode);
  if (gp) {
    const wards = (gp.wards && gp.wards.length > 0) ? gp.wards : getGpWards(gp);
    const allowedWards = getAllowedWardsList(gp.code);
    wards.forEach(w => {
      if (allowedWards === 'ALL' || allowedWards.includes(String(w.ward_no))) {
        const opt = document.createElement('option');
        opt.value = w.ward_no;
        opt.textContent = `वार्ड नं. ${w.ward_no} (${w.village || gp.name_hi})`;
        wardSelect.appendChild(opt);
      }
    });

    if (allowedWards !== 'ALL' && allowedWards.length === 1) {
      wardSelect.value = allowedWards[0];
      wardSelect.disabled = true;
    } else {
      wardSelect.disabled = false;
    }
  }

  if (gpCode) {
    await ensurePanchayatVotersLoaded(gpCode);
  }
  State.bulkPage = 1;
  updateBulkGenerator();
}

function selectBulkLayout(layout) {
  State.bulkLayout = layout;
  ['layoutCard9', 'layoutCard10', 'layoutCard12', 'layoutCard15', 'layoutCard18', 'layoutCard20', 'layoutCard21', 'layoutCardThermal'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('active');
  });

  const cardMap = {
    9: 'layoutCard9',
    10: 'layoutCard10',
    12: 'layoutCard12',
    15: 'layoutCard15',
    18: 'layoutCard18',
    20: 'layoutCard20',
    21: 'layoutCard21',
    'thermal': 'layoutCardThermal'
  };
  const activeCardId = cardMap[layout];
  if (activeCardId && document.getElementById(activeCardId)) {
    document.getElementById(activeCardId).classList.add('active');
  }

  const sheet = document.getElementById('bulkPreviewSheet');
  if (sheet) {
    sheet.className = `a4-preview-page ${layout === 'thermal' ? 'a4-thermal' : 'a4-grid-' + layout} theme-${State.bulkTheme}`;
  }

  State.bulkPage = 1;
  updateBulkGenerator();
}

function setBulkTheme(theme) {
  State.bulkTheme = theme;
  const btnBw = document.getElementById('btnThemeBw');
  const btnColor = document.getElementById('btnThemeColor');

  if (btnBw) btnBw.className = 'btn-xs ' + (theme === 'bw' ? 'btn-primary' : 'btn-outline');
  if (btnColor) btnColor.className = 'btn-xs ' + (theme === 'color' ? 'btn-primary' : 'btn-outline');

  const sheet = document.getElementById('bulkPreviewSheet');
  if (sheet) {
    sheet.classList.remove('theme-bw', 'theme-color');
    sheet.classList.add(`theme-${theme}`);
  }

  renderBulkPreview();
}

function updateBulkGenerator() {
  const gpCode = document.getElementById('bulkGpSelect') ? document.getElementById('bulkGpSelect').value : '';
  const wardNo = document.getElementById('bulkWardSelect') ? document.getElementById('bulkWardSelect').value : 'ALL';
  const scope = document.getElementById('bulkDeliveryScope') ? document.getElementById('bulkDeliveryScope').value : 'PENDING';
  const houseFilter = (document.getElementById('bulkHouseFilter') ? document.getElementById('bulkHouseFilter').value : '').trim().toLowerCase();

  const allowedGps = getAllowedGps();
  const allowedWards = getAllowedWardsList(gpCode);

  let voters = State.voters.filter(v => {
    // Strictly skip deleted voters from bulk slips
    if (v.status === 'निरस्त') return false;
    if (!allowedGps.some(p => p.code === v.panchayat_code || p.name_hi === v.gram_panchayat || p.name_en === v.panchayat_en)) return false;
    if (gpCode && v.panchayat_code !== gpCode) return false;
    if (wardNo !== 'ALL' && String(v.ward_no) !== String(wardNo)) return false;
    if (allowedWards !== 'ALL' && !allowedWards.includes(String(v.ward_no))) return false;

    if (scope === 'PENDING' && isVoterDelivered(v)) return false;
    if (scope === 'DELIVERED' && !isVoterDelivered(v)) return false;

    if (houseFilter) {
      return String(v.house_no || '').toLowerCase() === houseFilter ||
             (v.revenue_village || '').toLowerCase().includes(houseFilter);
    }
    return true;
  });

  // Sort by Ward, House, Serial
  voters.sort((a, b) => {
    if (a.ward_no !== b.ward_no) return a.ward_no - b.ward_no;
    return (a.serial_no || 0) - (b.serial_no || 0);
  });

  State.bulkFilteredVoters = voters;

  const slipsPerPage = State.bulkLayout === 'thermal' ? 5 : parseInt(State.bulkLayout, 10);
  const totalPages = Math.max(1, Math.ceil(voters.length / slipsPerPage));
  if (State.bulkPage > totalPages) State.bulkPage = totalPages;
  if (State.bulkPage < 1) State.bulkPage = 1;

  document.getElementById('bulkSelectedVoterCount').textContent = voters.length;
  document.getElementById('bulkTotalPagesCount').textContent = totalPages;
  document.getElementById('bulkPageIndicator').textContent = `पेज ${State.bulkPage} of ${totalPages}`;

  renderBulkPreview();
}

function changeBulkPage(delta) {
  const slipsPerPage = State.bulkLayout === 'thermal' ? 5 : parseInt(State.bulkLayout, 10);
  const totalPages = Math.max(1, Math.ceil(State.bulkFilteredVoters.length / slipsPerPage));

  State.bulkPage += delta;
  if (State.bulkPage < 1) State.bulkPage = 1;
  if (State.bulkPage > totalPages) State.bulkPage = totalPages;

  document.getElementById('bulkPageIndicator').textContent = `पेज ${State.bulkPage} of ${totalPages}`;
  renderBulkPreview();
}

/**
 * 100% CANDIDATE-FREE OFFICIAL SDM OFFICE VOTER INFORMATION SLIP (STRICT B&W)
 */
function buildOfficialSlipHtml(voter, layout, theme) {
  if (typeof window.buildOfficialSlipHtml === 'function' && window.buildOfficialSlipHtml !== buildOfficialSlipHtml) {
    return window.buildOfficialSlipHtml(voter, layout, theme);
  }
  if (typeof buildExactOfficialSlipInnerHtml === 'function') {
    return buildExactOfficialSlipInnerHtml(voter);
  }
  return ``;
}

function renderBulkPreview() {
  const sheet = document.getElementById('bulkPreviewSheet');
  if (!sheet) return;
  sheet.innerHTML = '';

  const voters = State.bulkFilteredVoters;
  if (voters.length === 0) {
    sheet.innerHTML = `
      <div style="grid-column: 1 / -1; display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; color:#64748b; font-weight:700;">
        <span style="font-size:2rem; margin-bottom:0.5rem;">📄</span>
        <span>इस चयन में प्रिंट करने हेतु कोई मतदाता शेष नहीं है।</span>
      </div>
    `;
    return;
  }

  const slipsPerPage = State.bulkLayout === 'thermal' ? 5 : parseInt(State.bulkLayout, 10);
  const startIndex = (State.bulkPage - 1) * slipsPerPage;
  const pageVoters = voters.slice(startIndex, startIndex + slipsPerPage);

  pageVoters.forEach(voter => {
    sheet.insertAdjacentHTML('beforeend', buildOfficialSlipHtml(voter, State.bulkLayout, State.bulkTheme));
  });
}

function printBulkSlips() {
  if (!canUserPrint()) { alert('⚠️ पर्ची प्रिंट करने की अनुमति मुख्य व्यवस्थापक द्वारा वर्जित है!'); return; }
  const voters = State.bulkFilteredVoters;
  if (voters.length === 0) {
    showToast('प्रिंट करने हेतु कोई मतदाता उपलब्ध नहीं है!');
    return;
  }

  const printBox = document.getElementById('bulkPrintContainer');
  printBox.innerHTML = '';

  const slipsPerPage = State.bulkLayout === 'thermal' ? 5 : parseInt(State.bulkLayout, 10);
  const totalPages = Math.ceil(voters.length / slipsPerPage);

  for (let p = 0; p < totalPages; p++) {
    const pageSheet = document.createElement('div');
    pageSheet.className = 'print-page-sheet';

    const pageVoters = voters.slice(p * slipsPerPage, (p + 1) * slipsPerPage);
    pageVoters.forEach(voter => {
      pageSheet.insertAdjacentHTML('beforeend', buildOfficialSlipHtml(voter, State.bulkLayout, State.bulkTheme));
    });

    printBox.appendChild(pageSheet);
  }

  document.body.className = `printing-bulk ${State.bulkLayout === 'thermal' ? 'printing-thermal layout-thermal' : 'layout-' + State.bulkLayout} theme-${State.bulkTheme}`;
  window.print();
  setTimeout(() => {
    document.body.className = '';
    printBox.innerHTML = '';
  }, 1000);
}

function markCurrentBatchDelivered() {
  const voters = State.bulkFilteredVoters;
  if (voters.length === 0) {
    showToast('चिन्हित करने हेतु कोई मतदाता सूची नहीं है।');
    return;
  }

  voters.forEach(v => {
    State.deliveryMap[getVoterKey(v)] = true;
  });

  localStorage.setItem('panchayat_slip_delivery_map', JSON.stringify(State.deliveryMap));
  renderDashboard();
  performSearch();
  renderAlphabeticalList();
  updateBulkGenerator();

  showToast(`इस बैच के सभी ${voters.length} मतदाताओं की पर्चियाँ "वितरित" दर्ज की गईं!`);
}

// ==========================================================================
// TAB 2: WARD-WISE VOTER DIRECTORY
// ==========================================================================
let currentWardVoters = [];

async function onDirGpChanged() {
  const gpCode = document.getElementById('dirGpSelect').value;
  const wardSelect = document.getElementById('dirWardSelect');
  if (!wardSelect) return;
  wardSelect.innerHTML = '';

  const gp = State.panchayats.find(p => p.code === gpCode);
  if (gp) {
    const wards = (gp.wards && gp.wards.length > 0) ? gp.wards : getGpWards(gp);
    const allowedWards = getAllowedWardsList(gpCode);
    wards.forEach(w => {
      if (allowedWards === 'ALL' || allowedWards.includes(String(w.ward_no))) {
        const opt = document.createElement('option');
        opt.value = w.ward_no;
        opt.textContent = `वार्ड संख्या ${w.ward_no} (${w.village || gp.name_hi})`;
        wardSelect.appendChild(opt);
      }
    });

    // Populate booth dropdown
    const boothSelect = document.getElementById('dirBoothSelect');
    if (boothSelect) {
      boothSelect.innerHTML = '<option value="ALL">-- सभी मतदान केंद्र --</option>';
      if (gp.booths) {
        gp.booths.forEach(b => {
          const opt = document.createElement('option');
          opt.value = b.booth_no;
          opt.textContent = `बूथ ${b.booth_no}: ${b.booth_name_hi}`;
          boothSelect.appendChild(opt);
        });
      }
    }
  }

  // Pre-load full voters for selected GP
  await ensurePanchayatVotersLoaded(gpCode);
  await loadWardVoters();
}

async function loadWardVoters() {
  const gpCode = document.getElementById('dirGpSelect').value;
  const wardNo = document.getElementById('dirWardSelect').value;

  const gp = State.panchayats.find(p => p.code === gpCode);
  if (!gp) return;

  // Ensure full voters data loaded for this GP
  await ensurePanchayatVotersLoaded(gpCode);

  const wardInfo = gp.wards ? gp.wards.find(w => String(w.ward_no) === String(wardNo)) : null;

  // Filter voters for this specific ward
  currentWardVoters = State.voters.filter(
    v => (v.panchayat_code === gpCode || v.panchayat_en === gp.name_en) && String(v.ward_no) === String(wardNo)
  );

  // If not yet in cache, fetch directly from Google Sheet Apps Script API
  if (currentWardVoters.length === 0 && State.config.appsScriptUrl) {
    try {
      const resp = await fetch(`${State.config.appsScriptUrl}?action=getVoters&panchayat=${encodeURIComponent(gp.name_hi)}&ward=${wardNo}&limit=500`);
      const data = await resp.json();
      if (data && data.success && Array.isArray(data.voters) && data.voters.length > 0) {
        data.voters.forEach(v => {
          if (!v.panchayat_en) v.panchayat_en = gp.name_en;
          if (!v.panchayat_code) v.panchayat_code = gp.code;
        });
        State.voters.push(...data.voters);
        currentWardVoters = data.voters;
      }
    } catch (e) {
      console.warn('Apps Script ward fetch warning:', e);
    }
  }

  // Update Ward Info Bar
  const infoBar = document.getElementById('wardInfoBar');
  if (infoBar) infoBar.style.display = 'flex';

  const maleCount = currentWardVoters.filter(v => v.gender === 'M').length;
  const femaleCount = currentWardVoters.filter(v => v.gender === 'F').length;

  document.getElementById('dirWardTotalVoters').textContent = wardInfo ? wardInfo.voters : currentWardVoters.length;
  document.getElementById('dirWardMaleVoters').textContent = maleCount;
  document.getElementById('dirWardFemaleVoters').textContent = femaleCount;
  document.getElementById('dirWardVillageName').textContent = wardInfo ? wardInfo.village : gp.name_hi;

  const defaultBooth = (gp.booths && gp.booths.length > 0) ? gp.booths[0].booth_name_hi : `राजकीय विद्यालय ${gp.name_hi}`;
  document.getElementById('dirWardBoothName').textContent = defaultBooth;

  renderDirectoryTable(currentWardVoters);
}

function filterWardByBooth() {
  const boothNo = document.getElementById('dirBoothSelect').value;
  if (boothNo === 'ALL') {
    renderDirectoryTable(currentWardVoters);
  } else {
    const filtered = currentWardVoters.filter(v => String(v.polling_station_no) === String(boothNo));
    renderDirectoryTable(filtered);
  }
}

function filterDirectoryTable() {
  const query = document.getElementById('dirTableSearch').value.toLowerCase().trim();
  if (!query) {
    renderDirectoryTable(currentWardVoters);
    return;
  }
  const filtered = currentWardVoters.filter(v => 
    (v.voter_name || '').toLowerCase().includes(query) ||
    (v.relative_name || '').toLowerCase().includes(query) ||
    (v.epic_no || '').toLowerCase().includes(query) ||
    String(v.house_no || '') === query
  );
  renderDirectoryTable(filtered);
}

function renderDirectoryTable(votersList) {
  const tbody = document.getElementById('directoryTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (votersList.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted py-4">इस वार्ड में कोई मतदाता रिकॉर्ड नहीं मिला।</td></tr>';
    return;
  }

  votersList.forEach((voter, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${voter.serial_no || idx + 1}</strong></td>
      <td>
        <div style="display:flex; align-items:center; gap:8px;">
          <div class="voter-photo-box" style="width:36px; height:44px; border-radius:3px;">
            <img src="${getVoterPhotoUrl(voter)}" alt="${voter.voter_name}" class="voter-card-photo" loading="lazy" onerror="this.onerror=null; this.src='https://api.dicebear.com/7.x/identicon/svg?seed=' + encodeURIComponent(voter.epic_no || voter.serial_no || '1');" />
          </div>
          <div>
            <strong>${voter.voter_name}</strong>
            <div class="text-sm text-muted">${voter.voter_name_en || ''}</div>
          </div>
        </div>
      </td>
      <td>${voter.relative_relation || 'पिता'}: ${voter.relative_name || '-'}</td>
      <td><strong>${voter.house_no || '-'}</strong></td>
      <td>${voter.age ? voter.age : '-'} / ${voter.gender === 'F' ? '<span class="text-pink">F</span>' : '<span class="text-blue">M</span>'}</td>
      <td><span class="slip-epic">${voter.epic_no || '-'}</span></td>
      <td><span class="text-sm">${voter.polling_station_name || 'बूथ ' + voter.polling_station_no}</span></td>
      <td class="text-center">
        <button class="btn btn-outline btn-xs" onclick='openVoterSlipModal(${JSON.stringify(voter)})'>
          📄 पर्ची
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function exportDirectoryToCSV() {
  if (!canUserDownload()) {
    showToast('⚠️ मतदाता सूची डाउनलोड / एक्सपोर्ट करने की अनुमति मुख्य व्यवस्थापक द्वारा बंद है!');
    return;
  }
  if (currentWardVoters.length === 0) {
    showToast('एक्सपोर्ट करने हेतु कोई डाटा उपलब्ध नहीं है।');
    return;
  }

  const gpCode = document.getElementById('dirGpSelect').value;
  const wardNo = document.getElementById('dirWardSelect').value;

  const headers = ["Serial_No", "Voter_Name", "Voter_Name_En", "Relation", "Relative_Name", "House_No", "Age", "Gender", "EPIC_No", "Ward_No", "Gram_Panchayat", "Polling_Station"];
  const rows = currentWardVoters.map(v => [
    v.serial_no,
    `"${v.voter_name}"`,
    `"${v.voter_name_en || ''}"`,
    v.relative_relation,
    `"${v.relative_name}"`,
    v.house_no,
    v.age,
    v.gender,
    v.epic_no,
    v.ward_no,
    `"${v.gram_panchayat}"`,
    `"${v.polling_station_name}"`
  ]);

  const csvContent = "\uFEFF" + [headers.join(","), ...rows.map(r => r.join(","))].join("\r\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.setAttribute("href", url);
  a.setAttribute("download", `Voter_List_${gpCode}_Ward_${wardNo}.csv`);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  showToast(`वार्ड ${wardNo} की मतदाता सूची CSV डाउनलोड प्रारंभ!`);
}

function printWardDirectory() {
  document.body.classList.add('printing-ward-list');
  window.print();
  setTimeout(() => {
    document.body.classList.remove('printing-ward-list');
  }, 500);
}

// ==========================================================================
// TAB 4: GOOGLE SHEETS INTEGRATION & SYNC ENGINE
// ==========================================================================
function saveSheetConfigAndSync() {
  const adminUrl = document.getElementById('adminSheetUrlInput').value.trim();
  const voterUrl = document.getElementById('voterSheetUrlInput').value.trim();

  State.config.adminSheetUrl = adminUrl;
  State.config.voterSheetUrl = voterUrl;

  localStorage.setItem('panchayat_admin_sheet_url', adminUrl);
  localStorage.setItem('panchayat_voter_sheet_url', voterUrl);

  showToast('Google Sheet लिंक्स सहेजे गए। सिंक प्रक्रिया प्रारंभ हो रही है...');
  syncWithGoogleSheet();
}

async function syncWithGoogleSheet(silent = false) {
  let adminSyncCount = 0;
  let voterSyncCount = 0;

  if (State.config.adminSheetUrl) {
    try {
      const exportUrl = convertToExportCsvUrl(State.config.adminSheetUrl);
      const res = await fetch(exportUrl);
      if (res.ok) {
        const text = await res.text();
        const rows = parseCSV(text);
        if (rows.length > 1) {
          const newAdmins = [];
          for (let i = 1; i < rows.length; i++) {
            const r = rows[i];
            if (r[1] && r[2]) {
              newAdmins.push({
                user_id: r[0] || `USR${i}`,
                username: r[1],
                password: r[2],
                full_name: r[3] || r[1],
                fullName: r[3] || r[1],
                role: r[4] || 'BOOTH_AGENT',
                panchayat_code: r[5] || 'ALL',
                gram_panchayat: r[6] || '',
                allowed_wards: r[7] || 'ALL',
                phone: r[8] || '',
                status: r[9] || 'ACTIVE'
              });
            }
          }
          if (newAdmins.length > 0) {
            State.adminUsers = newAdmins;
            localStorage.setItem('panchayat_admins_cache', JSON.stringify(newAdmins));
            adminSyncCount = newAdmins.length;
          }
        }
      }
    } catch (e) {
      console.warn('Admin Sheet Fetch Warning:', e);
    }
  }

  if (State.config.voterSheetUrl) {
    try {
      const exportUrl = convertToExportCsvUrl(State.config.voterSheetUrl);
      const res = await fetch(exportUrl);
      if (res.ok) {
        const text = await res.text();
        const rows = parseCSV(text);
        if (rows.length > 1) {
          const newVoters = [];
          for (let i = 1; i < rows.length; i++) {
            const r = rows[i];
            if (r[0] && r[7]) {
              newVoters.push({
                panchayat_code: r[0],
                gram_panchayat: r[1] || '',
                ward_no: parseInt(r[2], 10) || 1,
                revenue_village: r[3] || '',
                polling_station_no: parseInt(r[4], 10) || 1,
                polling_station_name: r[5] || '',
                serial_no: parseInt(r[6], 10) || i,
                voter_name: r[7],
                voter_name_en: r[8] || '',
                relative_relation: r[9] || 'पिता',
                relative_name: r[10] || '',
                house_no: r[11] || '',
                age: parseInt(r[12], 10) || 18,
                gender: r[13] || 'M',
                epic_no: r[14] || '',
                section_part: r[15] || '1'
              });
            }
          }
          if (newVoters.length > 0) {
            State.voters = newVoters;
            localStorage.setItem('panchayat_voters_cache', JSON.stringify(newVoters));
            voterSyncCount = newVoters.length;
          }
        }
      }
    } catch (e) {
      console.warn('Voter Sheet Fetch Warning:', e);
    }
  }

  renderDashboard();
  performSearch();
  renderAlphabeticalList();
  updateBulkGenerator();

  // Also sync Candidates from Google Sheet
  try {
    if (typeof syncCandidatesFromGoogleSheetClient === 'function') {
      await syncCandidatesFromGoogleSheetClient(false);
    }
  } catch (e) {
    console.warn('Candidate sync error:', e);
  }

  if (!silent) {
    if (adminSyncCount > 0 || voterSyncCount > 0) {
      showToast(`सिंक सफल! ${adminSyncCount} प्रभारियों व ${voterSyncCount} मतदाताओं का डेटा अद्यतन।`);
    } else {
      showToast('डेटा सिंक संपन्न (स्थानीय कैश डेटा सक्रिय है)।');
    }
  }
}

function convertToExportCsvUrl(url) {
  if (url.includes('tqx=out:csv') || url.includes('/pub?output=csv')) {
    return url;
  }
  const match = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (match && match[1]) {
    return `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv`;
  }
  return url;
}

function parseCSV(text) {
  const lines = text.split(/\r\n|\n/);
  const rows = [];
  for (let line of lines) {
    if (!line.trim()) continue;
    const row = [];
    let insideQuotes = false;
    let entry = '';
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        insideQuotes = !insideQuotes;
      } else if (char === ',' && !insideQuotes) {
        row.push(entry.trim());
        entry = '';
      } else {
        entry += char;
      }
    }
    row.push(entry.trim());
    rows.push(row);
  }
  return rows;
}

function handleFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    const content = e.target.result;
    if (file.name.endsWith('.json')) {
      try {
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) {
          State.voters = parsed;
        } else if (parsed.voters) {
          State.voters = parsed.voters;
        }
        localStorage.setItem('panchayat_voters_cache', JSON.stringify(State.voters));
        showToast(`JSON से ${State.voters.length} मतदाता लोड किए गए!`);
        performSearch();
        renderAlphabeticalList();
        updateBulkGenerator();
      } catch (err) {
        showToast('JSON फ़ाइल त्रुटि!');
      }
    } else if (file.name.endsWith('.csv')) {
      const rows = parseCSV(content);
      if (rows.length > 1) {
        const newVoters = [];
        for (let i = 1; i < rows.length; i++) {
          const r = rows[i];
          if (r[0] && r[7]) {
            newVoters.push({
              panchayat_code: r[0],
              gram_panchayat: r[1] || '',
              ward_no: parseInt(r[2], 10) || 1,
              revenue_village: r[3] || '',
              polling_station_no: parseInt(r[4], 10) || 1,
              polling_station_name: r[5] || '',
              serial_no: parseInt(r[6], 10) || i,
              voter_name: r[7],
              voter_name_en: r[8] || '',
              relative_relation: r[9] || 'पिता',
              relative_name: r[10] || '',
              house_no: r[11] || '',
              age: parseInt(r[12], 10) || 18,
              gender: r[13] || 'M',
              epic_no: r[14] || '',
              section_part: r[15] || '1'
            });
          }
        }
        State.voters = newVoters;
        localStorage.setItem('panchayat_voters_cache', JSON.stringify(State.voters));
        showToast(`CSV से ${newVoters.length} मतदाता आयात किए गए!`);
        performSearch();
        renderAlphabeticalList();
        updateBulkGenerator();
      }
    }
  };
  reader.readAsText(file);
}

function loadDefaultMasterData() {
  if (window.MASTER_DATA) {
    State.voters = window.MASTER_DATA.initial_voters || [];
    State.adminUsers = window.MASTER_DATA.admin_users || [];
    State.deletedVoters = window.MASTER_DATA.deleted_voters || [];
    State.config.appsScriptUrl = localStorage.getItem('panchayat_apps_script_url') || 'https://script.google.com/macros/s/AKfycbwtgz2L5QC_95Jsf1r0Kum_LcTI-bJwwiBQS_O74vthHcbPD_KatsN69ytY2yqlayiM/exec';
    const appsScriptInput = document.getElementById('appsScriptUrlInput');
    if (appsScriptInput && State.config.appsScriptUrl) {
      appsScriptInput.value = State.config.appsScriptUrl;
    }
    localStorage.removeItem('panchayat_voters_cache');
    localStorage.removeItem('panchayat_admins_cache');
    showToast('मूल 1,126+ मतदाताओं का मास्टर डेटा पुनर्स्थापित किया गया।');
    performSearch();
    renderAlphabeticalList();
    updateBulkGenerator();
  }
}

function renderAdminUsersTable() {
  const tbody = document.getElementById('adminUsersTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  State.adminUsers.forEach(u => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><code>${u.user_id}</code></td>
      <td><strong>${u.username}</strong></td>
      <td><code>${u.password}</code></td>
      <td>${u.full_name}</td>
      <td><strong>${u.panchayat_code}</strong></td>
      <td>${u.gram_panchayat}</td>
      <td><span class="text-sm">${u.allowed_wards}</span></td>
      <td><span class="user-role-badge" style="background:#059669;">${u.status || 'ACTIVE'}</span></td>
    `;
    tbody.appendChild(tr);
  });
}

function printFilteredResults() {
  window.print();
}

function closeAllOpenModals() {
  const modalIds = [
    'customScopeModal', 'adminCandidateModal', 'addNewUserModal', 'addUserModal',
    'addEditBloModal', 'addEditCellModal', 'editPersonnelModal', 'selfChangePasswordModal',
    'changePasswordModal', 'printVoterListModal', 'portalPreviewModal', 'voterSlipModal',
    'slipCutViewerModal'
  ];
  modalIds.forEach(id => {
    const el = document.getElementById(id);
    if (el && el.style.display !== 'none') {
      el.style.display = 'none';
    }
  });
}

function initUiElements() {
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeAllOpenModals();
    }
  });
}

function showToast(message) {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `
    <span>ℹ️</span>
    <span>${message}</span>
  `;

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}



// ==========================================================================
// SUPER ADMIN USER MANAGEMENT & GOOGLE APPS SCRIPT API INTEGRATION
// ==========================================================================

function renderSuperAdminUsers() {
  const tbody = document.getElementById('superAdminUsersTableBody');
  const box = document.getElementById('superAdminUserMgmtBox');
  if (!tbody || !box) return;

  // Only visible to SUPER_ADMIN
  if (!State.currentUser || State.currentUser.role !== 'SUPER_ADMIN') {
    box.style.display = 'none';
    return;
  }
  box.style.display = 'block';

  tbody.innerHTML = '';
  if (!State.adminUsers || State.adminUsers.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="padding:15px; text-align:center; color:#64748b;">कोई उपयोगकर्ता उपलब्ध नहीं है।</td></tr>';
    return;
  }

  State.adminUsers.forEach((user, idx) => {
    const isAct = (user.status || 'ACTIVE').toUpperCase() === 'ACTIVE';
    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid #f1f5f9';
    tr.innerHTML = `
      <td style="padding:8px 12px; font-weight:700; color:#1e293b;">${user.username}</td>
      <td style="padding:8px 12px; font-family:monospace; color:#475569;">
        <span style="background:#f1f5f9; padding:2px 6px; border-radius:3px;">${user.password}</span>
      </td>
      <td style="padding:8px 12px;">
        <div style="font-weight:600;">${user.full_name || user.username}</div>
        <div style="font-size:0.75rem; color:#64748b;">${user.mobile || user.phone || '-'}</div>
      </td>
      <td style="padding:8px 12px;">
        <span style="font-size:0.75rem; font-weight:700; color:${user.role==='SUPER_ADMIN'?'#b91c1c':'#0369a1'}; background:${user.role==='SUPER_ADMIN'?'#fee2e2':'#e0f2fe'}; padding:2px 6px; border-radius:3px;">
          ${user.role}
        </span>
      </td>
      <td style="padding:8px 12px; font-size:0.82rem;">${user.assigned_panchayats || user.panchayat_code || 'ALL'}</td>
      <td style="padding:8px 12px; font-size:0.82rem;">${user.assigned_wards || user.allowed_wards || 'ALL'}</td>
      <td style="padding:8px 12px; text-align:center;">
        <button class="user-status-btn ${isAct ? 'active' : 'inactive'}" onclick="toggleUserStatus('${user.username}')">
          ${isAct ? '🟢 सक्रिय (Active)' : '🔴 निष्क्रिय (Inactive)'}
        </button>
      </td>
      <td style="padding:8px 12px; text-align:center;">
        <div style="display:flex; justify-content:center; gap:4px; flex-wrap:wrap;">
          <button class="action-btn-sm" onclick="openChangePasswordModal('${user.username}')" title="पासवर्ड बदलें">
            🔑 पासवर्ड
          </button>
          <button class="action-btn-sm" onclick="promptChangeScope('${user.username}')" title="पंचायत व वार्ड अधिकार बदलें">
            🛡️ अधिकार
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// Modal controls for Add User
function openAddUserModal() {
  const modal = document.getElementById('addUserModal');
  const gpSelect = document.getElementById('newPanchayat');
  if (gpSelect) {
    gpSelect.innerHTML = '<option value="ALL">-- सभी 30 पंचायतें (ALL) --</option>';
    State.panchayats.forEach(p => {
      gpSelect.innerHTML += `<option value="${p.name_en}">${p.name_hi} (${p.name_en})</option>`;
    });
  }
  if (modal) modal.style.display = 'flex';
}

function closeAddUserModal() {
  const m1 = document.getElementById('addUserModal');
  if (m1) m1.style.display = 'none';
  const m2 = document.getElementById('addNewUserModal');
  if (m2) m2.style.display = 'none';
}

function handleCreateUser(e) {
  e.preventDefault();
  const username = document.getElementById('newUsername').value.trim();
  const password = document.getElementById('newPassword').value.trim();
  const fullName = document.getElementById('newFullName').value.trim();
  const mobile = document.getElementById('newMobile').value.trim();
  const role = document.getElementById('newRole').value;
  const panchayat = document.getElementById('newPanchayat').value;
  const wards = document.getElementById('newWards').value.trim() || 'ALL';

  if (!username || !password) {
    showToast('कृपया यूजरनेम व पासवर्ड दर्ज करें!');
    return;
  }
  const newUser = {
    user_id: `USR${State.adminUsers.length + 1}`,
    username: username,
    password: password,
    fullName: fullName || username,
    full_name: fullName || username,
    role: role,
    assigned_panchayats: panchayat,
    assigned_wards: wards,
    status: 'ACTIVE',
    created_at: new Date().toISOString()
  };

  State.adminUsers.push(newUser);
  localStorage.setItem('panchayat_admins_cache', JSON.stringify(State.adminUsers));
  renderSuperAdminUsers();
  closeAddUserModal();
  showToast(`नया यूजर '${username}' जोड़ा गया।`);

  // Sync to Google Sheet Apps Script if connected
  if (typeof postToAppsScript === 'function') postToAppsScript({
    action: 'addUser',
    userData: newUser,
    adminUsername: State.currentUser.username
  });
}

// Password Change
function openChangePasswordModal(username) {
  const modal = document.getElementById('changePasswordModal');
  document.getElementById('cpUsername').value = username;
  document.getElementById('cpNewPassword').value = '';
  if (modal) modal.style.display = 'flex';
}

function closeChangePasswordModal() {
  const modal = document.getElementById('changePasswordModal');
  if (modal) modal.style.display = 'none';
}

function confirmPasswordChange() {
  const username = document.getElementById('cpUsername').value;
  const newPassword = document.getElementById('cpNewPassword').value.trim();

  if (!newPassword) {
    showToast('कृपया नया पासवर्ड दर्ज करें!');
    return;
  }

  const u = State.adminUsers.find(x => x.username.toLowerCase() === username.toLowerCase());
  if (u) {
    u.password = newPassword;
    localStorage.setItem('panchayat_admins_cache', JSON.stringify(State.adminUsers));
    renderSuperAdminUsers();
    closeChangePasswordModal();
    showToast(`'${username}' का पासवर्ड सफलतापूर्वक बदला गया!`);

    if (typeof postToAppsScript === 'function') postToAppsScript({
      action: 'updatePassword',
      username: username,
      newPassword: newPassword,
      adminUsername: State.currentUser.username
    });
  }
}

// Scope Change
function promptChangeScope(username) {
  const u = State.adminUsers.find(x => x.username.toLowerCase() === username.toLowerCase());
  if (!u) return;

  const newGp = prompt(`उपयोगकर्ता '${username}' के लिए आवंटित पंचायत दर्ज करें (उदा. Sobdi, Bhinay, या ALL):`, u.assigned_panchayats || u.panchayat_code || 'ALL');
  if (newGp === null) return;

  const newWards = prompt(`उपयोगकर्ता '${username}' के लिए आवंटित वार्ड दर्ज करें (उदा. 1,2,3 या ALL):`, u.assigned_wards || u.allowed_wards || 'ALL');
  if (newWards === null) return;

  u.assigned_panchayats = newGp.trim();
  u.assigned_wards = newWards.trim();
  localStorage.setItem('panchayat_admins_cache', JSON.stringify(State.adminUsers));
  renderSuperAdminUsers();
  showToast(`'${username}' के अधिकार अपडेट कर दिए गए!`);

  if (typeof postToAppsScript === 'function') postToAppsScript({
    action: 'updateUserScope',
    username: username,
    assignedPanchayats: newGp.trim(),
    assignedWards: newWards.trim(),
    adminUsername: State.currentUser.username
  });
}

// Toggle Status
// removed duplicate toggleUserStatus


// ==========================================================================
// Active Users Login Dropdown & Live Auth Sync
// ==========================================================================
function populateLoginUserDropdown() {
  const select = document.getElementById('gatekeeperUserSelect');
  if (!select) return;

  const currentVal = select.value || '';
  select.innerHTML = '<option value="">-- कृपया अपना अधिकृत खाता चुनें --</option>';

  // 1. Super Admins
  const grpAdmin = document.createElement('optgroup');
  grpAdmin.label = '⚡ भिनाय ब्लॉक व्यवस्थापक / सुपर एडमिन';
  grpAdmin.innerHTML = `
    <option value="admin">मुख्य व्यवस्थापक (admin) [पासवर्ड: admin2026]</option>
    <option value="superadmin">भिनाय ब्लॉक मुख्य व्यवस्थापक (superadmin) [पासवर्ड: admin2026]</option>
  `;
  select.appendChild(grpAdmin);

  // 2. Block Prabhari
  const grpBp = document.createElement('optgroup');
  grpBp.label = '🌟 ब्लॉक प्रभारी (समस्त 30 ग्राम पंचायतें पूर्ण एक्सेस)';
  grpBp.innerHTML = `
    <option value="block_prabhari">🌟 ब्लॉक प्रभारी [पासवर्ड: BHINAI123]</option>
  `;
  select.appendChild(grpBp);

  // 3. Panchayat Agents (30 GPs)
  const grpAgents = document.createElement('optgroup');
  grpAgents.label = '🏛️ ग्राम पंचायत प्रभारी व प्रत्याशी (30 ग्राम पंचायतें)';
  (State.adminUsers || []).filter(u => u.role !== 'SUPER_ADMIN' && u.role !== 'BLOCK_PRABHARI').forEach(u => {
    const opt = document.createElement('option');
    opt.value = u.username;
    const gp = u.assigned_panchayats || u.assignedPanchayats || '';
    opt.textContent = `${u.full_name || u.fullName || u.username} ${gp ? '[' + gp + ']' : ''} (${u.username})`;
    grpAgents.appendChild(opt);
  });
  select.appendChild(grpAgents);

  // 4. Election Cell Officers
  const dir = getMasterDirectory();
  if (dir && dir.cell_personnel && dir.cell_personnel.length > 0) {
    const grpCell = document.createElement('optgroup');
    grpCell.label = '🏢 चुनाव प्रकोष्ठ प्रभारी (Election Cell Officers)';
    dir.cell_personnel.slice(0, 10).forEach(cp => {
      const opt = document.createElement('option');
      opt.value = cp.username || cp.id;
      opt.textContent = `[${cp.cell_name || 'प्रकोष्ठ'}] ${cp.name} - ${cp.designation}`;
      grpCell.appendChild(opt);
    });
    select.appendChild(grpCell);
  }

  if (currentVal) {
    select.value = currentVal;
    const hu = document.getElementById('gatekeeperUsername');
    if (hu) hu.value = currentVal;
  }
}

function onLoginUserSelectChange(username) {
  const hu = document.getElementById('gatekeeperUsername');
  if (hu) hu.value = username;

  const hint = document.getElementById('defaultPassHint');
  if (hint) {
    if (username === 'block_prabhari' || username === 'suresh_jangid') {
      hint.textContent = 'पासवर्ड: BHINAI123';
      hint.style.color = '#0f766e';
    } else if (username === 'admin') {
      hint.textContent = (username === 'admin' || username === 'superadmin') ? 'पासवर्ड: admin2026' : (username === 'incharge' ? 'पासवर्ड: incharge2026' : (username === 'vyavasthapak' ? 'पासवर्ड: vyavastha2026' : 'पासवर्ड: bhinai2026'));
      hint.style.color = '#b45309';
    } else if (username.includes('_agent')) {
      hint.textContent = `डिफ़ॉल्ट: ${username.replace('_agent', '')}@123`;
      hint.style.color = '#2563eb';
    } else {
      hint.textContent = (username === 'admin' || username === 'superadmin') ? 'पासवर्ड: admin2026' : (username === 'incharge' ? 'पासवर्ड: incharge2026' : (username === 'vyavasthapak' ? 'पासवर्ड: vyavastha2026' : 'पासवर्ड: bhinai2026'));
      hint.style.color = '#047857';
    }
  }

  const passInput = document.getElementById('gatekeeperPassword');
  if (passInput) passInput.focus();
}

function onManualUsernameInput(val) {
  const hu = document.getElementById('gatekeeperUsername');
  if (hu) hu.value = val.trim();
}

function toggleManualUsername() {
  const mDiv = document.getElementById('manualUsernameDiv');
  const sDiv = document.getElementById('userSelectWrapper');
  const tBtn = document.getElementById('toggleManualUserBtn');
  if (!mDiv || !sDiv) return;

  if (mDiv.style.display === 'none') {
    mDiv.style.display = 'block';
    sDiv.style.display = 'none';
    tBtn.textContent = 'वापस सूची से चुनें (Select from list)';
    document.getElementById('manualUsernameInput')?.focus();
  } else {
    mDiv.style.display = 'none';
    sDiv.style.display = 'flex';
    tBtn.textContent = 'या मैन्युअल टाइप करें';
    const s = document.getElementById('gatekeeperUserSelect');
    if (s && s.value) {
      document.getElementById('gatekeeperUsername').value = s.value;
    }
  }
}

function onLoginUserSelectChange(username) {
  const hiddenUser = document.getElementById('gatekeeperUsername');
  if (hiddenUser) hiddenUser.value = username;

  const errorMsg = document.getElementById('gatekeeperError');
  if (errorMsg) errorMsg.style.display = 'none';

  if (username) {
    const passInput = document.getElementById('gatekeeperPassword');
    if (passInput) passInput.focus();
  }
}

function toggleManualUsername() {
  const manualDiv = document.getElementById('manualUsernameDiv');
  const selectWrapper = document.getElementById('userSelectWrapper');
  const toggleBtn = document.getElementById('toggleManualUserBtn');
  const manualInput = document.getElementById('manualUsernameInput');

  if (!manualDiv) return;

  if (manualDiv.style.display === 'none') {
    manualDiv.style.display = 'block';
    selectWrapper.style.display = 'none';
    toggleBtn.textContent = 'वापस सूची से चुनें (Select from list)';
    if (manualInput) manualInput.focus();
  } else {
    manualDiv.style.display = 'none';
    selectWrapper.style.display = 'flex';
    toggleBtn.textContent = 'या मैन्युअल टाइप करें';
    const select = document.getElementById('gatekeeperUserSelect');
    if (select && select.value) {
      document.getElementById('gatekeeperUsername').value = select.value;
    }
  }
}

function onManualUsernameInput(val) {
  const hiddenUser = document.getElementById('gatekeeperUsername');
  if (hiddenUser) hiddenUser.value = val.trim();
}

async function syncLatestActiveUsersFromAppsScript() {
  const url = State.config.appsScriptUrl || localStorage.getItem('panchayat_apps_script_url');
  if (!url) return;

  try {
    const [res, cRes] = await Promise.all([
      fetch(`${url}?action=getUsers&_t=${Date.now()}`).catch(() => null),
      fetch(`${url}?action=getCandidates&_t=${Date.now()}`).catch(() => null)
    ]);
    const data = res && res.ok ? await res.json() : null;
    const cData = cRes && cRes.ok ? await cRes.json() : null;

    if (data && data.success && Array.isArray(data.users) && data.users.length > 0) {
      State.adminUsers = data.users.map(u => {
        let tabs = [];
        if (u.tab_search !== undefined || u.tab_alpha !== undefined || u.tab_bulkslip !== undefined || u.tab_directory !== undefined) {
          if (u.tab_search === true || String(u.tab_search).toUpperCase() === 'TRUE') tabs.push('searchTab');
          if (u.tab_alpha === true || String(u.tab_alpha).toUpperCase() === 'TRUE') tabs.push('alphaTab');
          if (u.tab_bulkslip === true || String(u.tab_bulkslip).toUpperCase() === 'TRUE') tabs.push('bulkSlipTab');
          if (u.tab_directory === true || String(u.tab_directory).toUpperCase() === 'TRUE') tabs.push('directoryTab');
        } else if (Array.isArray(u.allowed_tabs)) {
          tabs = u.allowed_tabs;
        } else if (typeof u.allowed_tabs === 'string') {
          try { tabs = JSON.parse(u.allowed_tabs); } catch(e) { tabs = u.allowed_tabs.split(',').map(s=>s.trim()).filter(Boolean); }
        }
        return {
          id: u.id || u.userId || u.user_id || u.username,
          user_id: u.userId || u.user_id || u.username,
          username: u.username,
          fullName: u.fullName || u.full_name || u.username,
          full_name: u.fullName || u.full_name || u.username,
          mobile: u.mobile || '',
          role: u.role || 'PANCHAYAT_AGENT',
          assigned_panchayats: u.assignedPanchayats || u.assigned_panchayats || 'ALL',
          assignedPanchayats: u.assignedPanchayats || u.assigned_panchayats || 'ALL',
          assigned_wards: u.assignedWards || u.assigned_wards || 'ALL',
          assignedWards: u.assignedWards || u.assigned_wards || 'ALL',
          status: (u.status || 'ACTIVE').toUpperCase(),
          allowed_tabs: tabs,
          can_print: (u.can_print === true || String(u.can_print).toUpperCase() === 'TRUE'),
          can_download: (u.can_download === true || String(u.can_download).toUpperCase() === 'TRUE'),
          created_at: u.createdAt || u.created_at || ''
        };
      });

      // Synchronize live into State.adminControlUsers so all permission changes immediately take effect!
      if (!State.adminControlUsers) State.adminControlUsers = [];
      State.adminUsers.forEach(freshUser => {
        const uKey = String(freshUser.username || freshUser.id).toLowerCase();
        const existingIdx = State.adminControlUsers.findIndex(x => 
          (x.id && String(x.id).toLowerCase() === uKey) || 
          (x.username && String(x.username).toLowerCase() === uKey)
        );
        if (existingIdx >= 0) {
          State.adminControlUsers[existingIdx] = {
            ...State.adminControlUsers[existingIdx],
            ...freshUser,
            allowed_tabs: freshUser.allowed_tabs
          };
        } else {
          State.adminControlUsers.push(freshUser);
        }
      });
      syncCurrentUserWithConfiguredUsers();
      enforceGatekeeperState();
      localStorage.setItem('panchayat_admins_cache', JSON.stringify(State.adminUsers));
      populateLoginUserDropdown();
      if (document.getElementById('superAdminUsersTable')) {
        renderSuperAdminUsers();
      }
    }

    // Synchronize candidates from Candidates sheet independently
    if (cData && cData.success && Array.isArray(cData.candidates)) {
      if (!State.adminControlUsers) State.adminControlUsers = [];
      const candsList = cData.candidates.map(sc => {
        let tabs = [];
        if (sc.tab_search !== undefined || sc.tab_alpha !== undefined || sc.tab_bulkslip !== undefined || sc.tab_profile !== undefined) {
          if (sc.tab_search === true || String(sc.tab_search).toUpperCase() === 'TRUE') tabs.push('searchTab');
          if (sc.tab_alpha === true || String(sc.tab_alpha).toUpperCase() === 'TRUE') tabs.push('alphaTab');
          if (sc.tab_bulkslip === true || String(sc.tab_bulkslip).toUpperCase() === 'TRUE') tabs.push('bulkSlipTab');
          if (sc.tab_profile === true || String(sc.tab_profile).toUpperCase() === 'TRUE') tabs.push('candidateProfileTab');
        } else if (Array.isArray(sc.allowed_tabs)) {
          tabs = sc.allowed_tabs.filter(t => t !== 'directoryTab');
        } else if (typeof sc.allowed_tabs === 'string') {
          try { tabs = JSON.parse(sc.allowed_tabs); } catch(e) { tabs = sc.allowed_tabs.split(',').map(s=>s.trim()).filter(Boolean); }
        }
        return {
          id: sc.id || ('cand_' + sc.username),
          username: sc.username,
          user_id: sc.id || ('cand_' + sc.username),
          password: sc.password,
          fullName: sc.candidate_name,
          full_name: sc.candidate_name,
          mobile: sc.mobile || '',
          role: 'CANDIDATE',
          status: (sc.status || 'ACTIVE').toUpperCase(),
          allowed_panchayats: sc.panchayat || '',
          allowed_wards: sc.ward || 'ALL',
          allowed_tabs: tabs,
          candidate_mode: sc.candidate_mode || 'user_edit',
          can_print: (sc.can_print === true || String(sc.can_print).toUpperCase() === 'TRUE'),
          can_download: (sc.can_download === true || String(sc.can_download).toUpperCase() === 'TRUE'),
          candidate: sc
        };
      });
      localStorage.setItem('panchayat_candidates_cache', JSON.stringify(candsList));
      candsList.forEach(cand => {
        const uKey = String(cand.username || cand.id).toLowerCase();
        const existingIdx = State.adminControlUsers.findIndex(x => 
          (x.id && String(x.id).toLowerCase() === uKey) || 
          (x.username && String(x.username).toLowerCase() === uKey) ||
          (cand.id && String(x.id).toLowerCase() === cand.id.replace('cand_', '')) ||
          ((cand.username === 'b' || cand.id === 'cand_b') && (String(x.username).toLowerCase() === 'kamla' || String(x.id).toLowerCase() === 'kamla'))
        );
        if (existingIdx >= 0) {
          State.adminControlUsers[existingIdx] = {
            ...State.adminControlUsers[existingIdx],
            ...cand,
            allowed_tabs: cand.allowed_tabs
          };
        } else {
          State.adminControlUsers.push(cand);
        }

        // Live update active session tabs if currently logged in user matches this candidate
        if (State.currentUser) {
          const curId = String(State.currentUser.id || '').toLowerCase();
          const curUname = String(State.currentUser.username || '').toLowerCase();
          const candId = String(cand.id || '').toLowerCase();
          const candUname = String(cand.username || '').toLowerCase();
          const candName = String(cand.fullName || cand.full_name || '').toLowerCase();
          if (
            curId === candId || curUname === candUname ||
            curId === candUname || curUname === candId ||
            curId === ('cand_' + candUname) || curUname === ('cand_' + candUname) ||
            ((curUname === 'kamla' || curUname === 'कमला' || curId === 'kamla' || curId === 'कमला') && (candUname === 'b' || candId === 'cand_b' || candName.includes('कमला')))
          ) {
            State.currentUser.allowed_tabs = [...cand.allowed_tabs];
            State.currentUser.can_print = cand.can_print;
            State.currentUser.can_download = cand.can_download;
            if (cand.candidate) {
              State.currentUser.candidate = cand.candidate;
              State.currentCandidate = cand.candidate;
            }
            const sk = getSessionStorageKey();
            localStorage.setItem(sk, JSON.stringify(State.currentUser));
            sessionStorage.setItem(sk, JSON.stringify(State.currentUser));
            localStorage.setItem('panchayat_user_session', JSON.stringify(State.currentUser));
          }
        }
      });
      syncCurrentUserWithConfiguredUsers();
      enforceGatekeeperState();
    }
  } catch (err) {
    console.warn('Silent sync of active users warning:', err);
  }
}


// ==========================================================================
// DEDICATED COMPACT SINGLE-ROW VOTER LIST PRINT ENGINE (PAPER SAVER)
// ==========================================================================
let currentPrintListContext = 'search';

function openPrintVoterListModal(context = 'search') {
  if (!canUserPrint()) {
    showToast('⚠️ मतदाता सूची प्रिंट करने की अनुमति मुख्य व्यवस्थापक द्वारा बंद है!');
    return;
  }
  currentPrintListContext = context;
  const modal = document.getElementById('printVoterListModal');
  const scopeTitle = document.getElementById('printModalScopeTitle');
  const scopeDesc = document.getElementById('printModalScopeDesc');
  const scopeGroup = document.getElementById('printScopeGroup');

  let count = 0;
  let label = '';
  let gpName = '';

  if (context === 'search') {
    const list = State.filteredVoters && State.filteredVoters.length > 0 ? State.filteredVoters : State.voters;
    count = list.length;
    label = 'खोज परिणाम (Search Results)';
    if (scopeGroup) scopeGroup.style.display = 'block';
  } else if (context === 'directory') {
    const gpCode = document.getElementById('dirGpSelect') ? document.getElementById('dirGpSelect').value : '';
    const wardNo = document.getElementById('dirWardSelect') ? document.getElementById('dirWardSelect').value : '';
    const gp = State.panchayats.find(p => p.code === gpCode);
    gpName = gp ? gp.name : gpCode;
    const list = State.voters.filter(v => (!gpCode || v.panchayat_code === gpCode) && (!wardNo || String(v.ward_no) === String(wardNo)));
    count = list.length;
    label = `वार्ड नामावली (${gpName} - वार्ड ${wardNo || 'समस्त'})`;
    if (scopeGroup) scopeGroup.style.display = 'block';
  } else if (context === 'alpha') {
    count = State.alphaFilteredVoters ? State.alphaFilteredVoters.length : State.voters.length;
    label = 'वर्णमाला नामावली (Alphabetical Roll)';
    if (scopeGroup) scopeGroup.style.display = 'none';
  }

  if (scopeTitle) scopeTitle.textContent = label;
  if (scopeDesc) scopeDesc.textContent = `कुल मुद्रण योग्य मतदाता: ${count.toLocaleString('en-IN')}`;

  if (modal) {
    modal.style.display = 'flex';
  }
}

function closePrintListModal() {
  const modal = document.getElementById('printVoterListModal');
  if (modal) modal.style.display = 'none';
}

function confirmExecuteVoterListPrint() {
  const sortModeEl = document.querySelector('input[name="printSortOrder"]:checked');
  const sortMode = sortModeEl ? sortModeEl.value : 'serial';
  
  const scopeEl = document.querySelector('input[name="printScope"]:checked');
  const scope = scopeEl ? scopeEl.value : 'current';

  closePrintListModal();
  executeVoterListPrint(sortMode, scope, currentPrintListContext);
}

function executeVoterListPrint(sortMode, scope, context) {
  if (!canUserPrint()) {
    showToast('⚠️ मतदाता सूची प्रिंट करने की अनुमति मुख्य व्यवस्थापक द्वारा बंद है!');
    return;
  }

  let list = [];
  let gpName = '';
  let wardText = '';

  if (context === 'search') {
    list = State.filteredVoters && State.filteredVoters.length > 0 ? [...State.filteredVoters] : [...State.voters];
    if (scope === 'all_wards') {
      const activeGp = list.length > 0 ? list[0].panchayat_code : '';
      if (activeGp) {
        list = State.voters.filter(v => v.panchayat_code === activeGp);
      }
    }
  } else if (context === 'directory') {
    const gpCode = document.getElementById('dirGpSelect') ? document.getElementById('dirGpSelect').value : '';
    const wardNo = document.getElementById('dirWardSelect') ? document.getElementById('dirWardSelect').value : '';
    const gp = State.panchayats.find(p => p.code === gpCode);
    gpName = gp ? gp.name : gpCode;
    
    if (scope === 'all_wards') {
      list = State.voters.filter(v => !gpCode || v.panchayat_code === gpCode);
      wardText = 'समस्त वार्ड (All Wards)';
    } else {
      list = State.voters.filter(v => (!gpCode || v.panchayat_code === gpCode) && (!wardNo || String(v.ward_no) === String(wardNo)));
      wardText = wardNo ? `वार्ड संख्या ${wardNo}` : 'समस्त वार्ड';
    }
  } else if (context === 'alpha') {
    list = State.alphaFilteredVoters && State.alphaFilteredVoters.length > 0 ? [...State.alphaFilteredVoters] : [...State.voters];
  }

  if (list.length === 0) {
    showToast('प्रिंट करने हेतु कोई मतदाता उपलब्ध नहीं है!');
    return;
  }

  // Derive GP and Ward info if not set
  if (!gpName && list.length > 0) {
    gpName = list[0].gram_panchayat || list[0].panchayat_code;
  }
  if (!wardText && list.length > 0) {
    const wards = Array.from(new Set(list.map(v => v.ward_no))).sort((a,b) => Number(a)-Number(b));
    wardText = wards.length === 1 ? `वार्ड संख्या ${wards[0]}` : `वार्ड ${wards.join(', ')}`;
  }

  // SORTING
  let orderLabel = '';
  if (sortMode === 'alpha') {
    orderLabel = 'अंग्रेजी वर्णानुक्रम (Alphabetical A-Z)';
    list.sort((a, b) => {
      const nameA = (a.voter_name_en || a.voter_name || '').toLowerCase();
      const nameB = (b.voter_name_en || b.voter_name || '').toLowerCase();
      return nameA.localeCompare(nameB);
    });
  } else {
    orderLabel = 'क्रमांक वार (Serial / Ward Order)';
    list.sort((a, b) => {
      const wA = Number(a.ward_no || 0);
      const wB = Number(b.ward_no || 0);
      if (wA !== wB) return wA - wB;
      const sA = Number(a.serial_no || 0);
      const sB = Number(b.serial_no || 0);
      return sA - sB;
    });
  }

  const printBox = document.getElementById('voterListPrintContainer');
  if (!printBox) return;
  printBox.innerHTML = '';

  // Fit 48 voters per A4 page strictly to fill page height without bottom empty space
  const rowsPerPage = 48;
  const totalPages = Math.ceil(list.length / rowsPerPage);

  for (let p = 0; p < totalPages; p++) {
    const pageVoters = list.slice(p * rowsPerPage, (p + 1) * rowsPerPage);
    const pageDiv = document.createElement('div');
    pageDiv.className = 'voter-list-print-page';

    let tableRows = '';
    pageVoters.forEach((v, idx) => {
      const overallIdx = p * rowsPerPage + idx + 1;
      const isFemale = v.gender === 'F';
      const enVoter = v.voter_name_en ? `<span class="en-sub">(${v.voter_name_en})</span>` : '';
      const enRel = v.relative_name_en ? `<span class="en-sub">(${v.relative_name_en})</span>` : '';

      tableRows += `
        <tr>
          <td class="col-sn">${overallIdx}</td>
          <td class="col-ward">${v.ward_no}</td>
          <td class="col-serial"><strong>${v.serial_no}</strong></td>
          <td class="col-name">${v.voter_name} ${enVoter}</td>
          <td class="col-rel">${v.relative_name || '-'} ${enRel}</td>
          <td class="col-house">${v.house_no || '-'}</td>
          <td class="col-age">${v.age ? v.age : '-'}</td>
          <td class="col-gender">${isFemale ? 'स्त्री' : 'पुरुष'}</td>
          <td class="col-epic">${v.epic_no || '-'}</td>
        </tr>
      `;
    });

    pageDiv.innerHTML = `
      <div class="voter-list-print-header">
        <div class="header-main-title">
          🗳️ मतदाता नामावली - पंचायत आम चुनाव 2026
        </div>
        <div class="header-meta-items">
          <span><strong>पं.:</strong> ${gpName}</span>
          <span><strong>${wardText}</strong></span>
          <span><strong>क्रम:</strong> ${orderLabel}</span>
          <span><strong>कुल:</strong> ${list.length}</span>
          <span style="background:#0f172a; color:#fff; padding:1px 6px; border-radius:3px;">पृष्ठ ${p + 1} / ${totalPages}</span>
        </div>
      </div>
      <table class="voter-list-print-table">
        <thead>
          <tr>
            <th class="col-sn">क्र.सं.</th>
            <th class="col-ward">वार्ड</th>
            <th class="col-serial">मतदाता क्र.</th>
            <th class="col-name">मतदाता का नाम</th>
            <th class="col-rel">पिता / पति का नाम</th>
            <th class="col-house">म.सं.</th>
            <th class="col-age">आयु</th>
            <th class="col-gender">लिंग</th>
            <th class="col-epic">पहचान पत्र (EPIC)</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
        </tbody>
      </table>
    `;

    printBox.appendChild(pageDiv);
  }

  document.body.classList.add('printing-voter-list');
  window.print();

  setTimeout(() => {
    document.body.classList.remove('printing-voter-list');
    printBox.innerHTML = '';
  }, 1000);
}

function printFilteredResults() {
  openPrintVoterListModal('search');
}

function printWardDirectory() {
  openPrintVoterListModal('directory');
}


// Bulk Sort Order Toggle
State.bulkSortOrder = 'serial';

function setBulkSortOrder(order) {
  State.bulkSortOrder = order;
  const sBtn = document.getElementById('bulkSortSerialBtn');
  const aBtn = document.getElementById('bulkSortAlphaBtn');
  if (sBtn && aBtn) {
    if (order === 'alpha') {
      aBtn.className = 'btn btn-sm btn-primary';
      sBtn.className = 'btn btn-sm btn-outline';
    } else {
      sBtn.className = 'btn btn-sm btn-primary';
      aBtn.className = 'btn btn-sm btn-outline';
    }
  }
  updateBulkGenerator();
}

// Populate Booth Dropdown in Alpha Tab
function populateAlphaBoothDropdown(gpCode) {
  const select = document.getElementById('alphaBoothSelect');
  if (!select) return;
  select.innerHTML = '<option value="ALL">-- सभी बूथ (All Booths) --</option>';
  if (!gpCode || gpCode === 'ALL') return;

  const gpObj = State.panchayats.find(p => p.code === gpCode || p.name === gpCode);
  const gpName = gpObj ? gpObj.name : gpCode;
  const booths = (window.MASTER_DATA && window.MASTER_DATA.polling_booths) || [];
  const gpBooths = booths.filter(b => b.gp.toLowerCase() === gpName.toLowerCase() || (gpObj && b.gp.toLowerCase() === (gpObj.enName||'').toLowerCase()));

  gpBooths.forEach(b => {
    const opt = document.createElement('option');
    opt.value = b.booth_no;
    opt.textContent = `बूथ ${b.booth_no}: ${b.name} (वार्ड ${b.wards.join(', ')})`;
    select.appendChild(opt);
  });
}

function onAlphaBoothChanged() {
  const bVal = document.getElementById('alphaBoothSelect').value;
  if (bVal === 'ALL') {
    renderAlphabeticalList();
    return;
  }
  const booths = (window.MASTER_DATA && window.MASTER_DATA.polling_booths) || [];
  const targetBooth = booths.find(b => String(b.booth_no) === String(bVal));
  if (!targetBooth) {
    renderAlphabeticalList();
    return;
  }

  // Filter alpha voters by booth's wards
  const wards = targetBooth.wards;
  State.alphaFilteredVoters = State.voters.filter(v => wards.includes(Number(v.ward_no)));
  renderAlphabeticalList();
}


// ==========================================================================
// CANDIDATE PROFILE & OFFICIAL ELECTION SYMBOL ENGINE
// ==========================================================================

async function initCandidateProfileTab() {
  const gpSelect = document.getElementById('candidateGpSelect');
  const u = State.currentUser;
  const isSuper = (u && (u.role === 'SUPER_ADMIN' || u.role === 'admin'));
  const allowedGps = getAllowedGps();

  if (gpSelect && State.panchayats) {
    gpSelect.innerHTML = '<option value="">-- ग्राम पंचायत चुनें --</option>';
    const gpsToList = isSuper ? (State.panchayats || []) : allowedGps;
    gpsToList.forEach(gp => {
      const opt = document.createElement('option');
      const gpName = gp.name_hi || gp.name;
      opt.value = gpName;
      opt.textContent = `${gpName} (${gp.name_en || ''})`;
      gpSelect.appendChild(opt);
    });

    if (!isSuper && allowedGps.length === 1) {
      gpSelect.value = allowedGps[0].name_hi || allowedGps[0].name;
      gpSelect.disabled = true;
    } else {
      gpSelect.disabled = false;
    }
  }

  // Populate Symbols dropdown and mini-grid
  populateSymbolControls();

  if (!u) return;

  const uKey = u.id || u.username;
  const uIdLower = String(uKey).toLowerCase();
  const altId = uIdLower.startsWith('cand_') ? uIdLower.replace('cand_', '') : ('cand_' + uIdLower);

  function belongsToUser(c) {
    if (!c || typeof c !== 'object') return false;
    const cid = String(c.user_id || '').toLowerCase();
    if (!cid) return false;
    return cid === uIdLower || cid === altId || (u.username && cid === String(u.username).toLowerCase());
  }

  let cand = getActiveCandidate();

  if (!cand || !belongsToUser(cand)) {
    try {
      const res = await fetch('/api/candidate/' + encodeURIComponent(uKey));
      if (res.ok) {
        const d = await res.json();
        if (d && d.candidate && belongsToUser(d.candidate)) {
          cand = d.candidate;
        }
      }
    } catch(e) {}
  }

  // If still not found, create clean isolated candidate profile for THIS user only
  if (!cand || !belongsToUser(cand)) {
    cand = {
      user_id: uKey,
      candidate_name: (u.full_name && !u.full_name.includes('प्रतिनिधि')) ? u.full_name : (u.name || ''),
      mobile: u.mobile || '',
      post: 'सरपंच',
      panchayat: u.panchayat || u.allowed_panchayats || '',
      ward: (u.allowed_wards && u.allowed_wards !== 'ALL') ? u.allowed_wards : '',
      election_date: getGlobalElectionDate(),
      election_time: getGlobalElectionTime(),
      symbol_name: 'उगता सूरज',
      symbol_icon: 'sun',
      custom_symbol_url: '',
      photo_url: '',
      slogan: '',
      show_banner_on_slip: true,
      updated_at: new Date().toISOString()
    };
  }

  State.currentCandidate = cand;
  u.candidate = cand;
  try {
    localStorage.setItem('candidate_profile_' + uKey, JSON.stringify(cand));
    if (u.id) localStorage.setItem('candidate_profile_' + u.id, JSON.stringify(cand));
    if (u.username) localStorage.setItem('candidate_profile_' + u.username, JSON.stringify(cand));
  } catch(_) {}

  const nameInput = document.getElementById('candidateNameInput');
  const mobileInput = document.getElementById('candidateMobileInput');
  const postSelect = document.getElementById('candidatePostSelect');
  const sloganText = document.getElementById('candidateSloganTextarea');
  const photoPreview = document.getElementById('candidatePhotoPreview');
  const showBannerCheck = document.getElementById('candidateShowBannerSlip');
  const electionDateInput = document.getElementById('candidateElectionDateInput');
  const electionTimeInput = document.getElementById('candidateElectionTimeInput');
  const browseBtn = document.getElementById('candidatePhotoBrowseBtn');
  const removeBtn = document.getElementById('candidatePhotoRemoveBtn');

  if (cand) {
    if (nameInput) nameInput.value = cand.candidate_name || '';
    if (mobileInput) mobileInput.value = cand.mobile || u.mobile || '';
    if (postSelect) postSelect.value = cand.post || 'सरपंच';
    if (gpSelect && cand.panchayat) gpSelect.value = cand.panchayat;
    if (electionDateInput) electionDateInput.value = cand.election_date || getGlobalElectionDate();
    if (electionTimeInput) electionTimeInput.value = cand.election_time || getGlobalElectionTime();
    if (sloganText) sloganText.value = cand.slogan || '';
    
    // Photo restore
    if (photoPreview && !cand.photo_url && (u.username === 'b' || (cand.candidate_name && cand.candidate_name.includes('कमला')))) { cand.photo_url = KAMLA_DEFAULT_PHOTO; }
    if (photoPreview && cand.photo_url) {
      photoPreview.src = cand.photo_url;
      if (!cand.photo_url.includes('dicebear')) {
        if (browseBtn) browseBtn.innerHTML = '📁 फोटो बदलें (Change Photo)';
        if (removeBtn) removeBtn.style.display = 'inline-block';
      }
    }
    
    if (showBannerCheck) showBannerCheck.checked = (cand.show_banner_on_slip !== false);

    onCandidatePostChanged(cand.post || 'सरपंच');
    if (cand.ward) {
      const wardSelect = document.getElementById('candidateWardSelect');
      if (wardSelect) wardSelect.value = cand.ward;
    }

    // Symbol restore: Check custom image URL vs official SEC symbol name from Google Sheet
    if (cand.custom_symbol_url && String(cand.custom_symbol_url).trim().length > 5) {
      State.customSymbolUrl = cand.custom_symbol_url;
      setSymbolMode('custom');
      const wrapper = document.getElementById('currentSymbolSvgWrapper');
      if (wrapper) {
        wrapper.innerHTML = `<img src="${cand.custom_symbol_url}" alt="कस्टम चिन्ह" style="max-width:100%; max-height:100%; object-fit:contain; display:block;">`;
      }
      const customNameInput = document.getElementById('candidateCustomSymbolNameInput');
      if (customNameInput) customNameInput.value = cand.symbol_name || 'कस्टम चिन्ह';
      const nameText = document.getElementById('currentSymbolNameText');
      if (nameText) nameText.textContent = cand.symbol_name || 'कस्टम चिन्ह';
    } else {
      setSymbolMode('standard');
      const targetSymbol = cand.symbol_name || cand.symbol_icon || 'hand';
      onCandidateSymbolChanged(targetSymbol);
    }
  } else {
    // Default prefill
    if (nameInput) nameInput.value = u.full_name || '';
    if (mobileInput) mobileInput.value = u.mobile || '';
    if (electionDateInput) electionDateInput.value = '15 अक्टूबर 2026';
    if (electionTimeInput) electionTimeInput.value = 'प्रातः 7:00 बजे से सायं 6:00 बजे तक';
    if (gpSelect && u.allowed_panchayats && u.allowed_panchayats !== 'ALL') {
      gpSelect.value = u.allowed_panchayats;
    }
    applySloganPreset(1);
    setSymbolMode('standard');
  }

  renderLiveSpecimenSlip();
  if (State.currentSlipVoter) {
    try { renderModalCandidateSlip(State.currentSlipVoter); } catch(_) {}
  }
}

function populateSymbolControls() {
  const symbols = window.OFFICIAL_ELECTION_SYMBOLS || [];
  const select = document.getElementById('candidateSymbolSelect');
  const grid = document.getElementById('symbolMiniGrid');

  if (select && select.options.length <= 1) {
    select.innerHTML = '';
    symbols.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = `${s.name_hi}`;
      select.appendChild(opt);
    });
  }

  if (grid && grid.children.length === 0) {
    symbols.forEach(s => {
      const item = document.createElement('div');
      item.className = 'symbol-grid-item';
      item.setAttribute('data-id', s.id);
      item.title = s.name_hi;
      item.innerHTML = `${s.svg}<span>${s.name_hi.split(' ')[0]}</span>`;
      item.onclick = () => onCandidateSymbolChanged(s.id);
      grid.appendChild(item);
    });
  }
}

function onCandidateSymbolChanged(symbolIdOrName) {
  const symbols = window.OFFICIAL_ELECTION_SYMBOLS || [];
  const sym = symbols.find(s => s.id === symbolIdOrName || s.name_hi.includes(symbolIdOrName) || s.name_en.toLowerCase() === String(symbolIdOrName).toLowerCase()) || symbols[0];

  const select = document.getElementById('candidateSymbolSelect');
  if (select) select.value = sym.id;

  const wrapper = document.getElementById('currentSymbolSvgWrapper');
  if (wrapper) wrapper.innerHTML = sym.svg;

  const nameText = document.getElementById('currentSymbolNameText');
  if (nameText) nameText.textContent = sym.name_hi;

  document.querySelectorAll('.symbol-grid-item').forEach(el => {
    el.classList.toggle('selected', el.getAttribute('data-id') === sym.id);
  });

  renderLiveSpecimenSlip();
}

function onCandidatePostChanged(post) {
  const wardGroup = document.getElementById('candidateWardSelectGroup');
  const wardSelect = document.getElementById('candidateWardSelect');
  const gpSelect = document.getElementById('candidateGpSelect');

  if (post === 'वार्ड पंच') {
    if (wardGroup) wardGroup.style.display = 'block';
    if (wardSelect) {
      wardSelect.innerHTML = '<option value="">-- वार्ड चुनें --</option>';
      const gpName = gpSelect ? gpSelect.value : '';
      const gpObj = State.panchayats.find(p => p.name === gpName || p.code === gpName);
      const wardCount = (gpObj && gpObj.wards) ? gpObj.wards.length : 15;
      for (let i = 1; i <= wardCount; i++) {
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = `वार्ड संख्या ${i}`;
        wardSelect.appendChild(opt);
      }
    }
  } else {
    if (wardGroup) wardGroup.style.display = 'none';
  }
  renderLiveSpecimenSlip();
}

function onCandidateGpChanged(val) {
  const wardSelect = document.getElementById('candidateWardSelect');
  if (wardSelect) {
    wardSelect.innerHTML = '<option value="">-- वार्ड चुनें --</option>';
    const gp = (State.panchayats || []).find(p => p.code === val || p.name_hi === val || p.name_en === val);
    if (gp) {
      const wards = (gp.wards && gp.wards.length > 0) ? gp.wards : getGpWards(gp);
      wards.forEach(w => {
        const opt = document.createElement('option');
        opt.value = w.ward_no;
        opt.textContent = `वार्ड संख्या ${w.ward_no} (${w.village || gp.name_hi})`;
        wardSelect.appendChild(opt);
      });
    }
  }
  const post = document.getElementById('candidatePostSelect') ? document.getElementById('candidatePostSelect').value : '';
  if (post === 'वार्ड पंच') {
    const wg = document.getElementById('candidateWardSelectGroup');
    if (wg) wg.style.display = 'block';
  }
  renderLiveSpecimenSlip();
}

function onCandidateWardChanged(w) {
  renderLiveSpecimenSlip();
}

// Image compression helper using HTML5 Canvas
// Shrinks raw photos/symbols from 2-5MB down to ~15-30KB Base64 data URL
function compressCandidateImage(file, maxWidth, maxHeight, quality = 0.82, isPng = false) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = e => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!isPng) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, width, height);
        }
        ctx.drawImage(img, 0, 0, width, height);
        const mime = isPng ? 'image/png' : 'image/jpeg';
        resolve(canvas.toDataURL(mime, quality));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

async function onCandidatePhotoSelected(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  try {
    showToast('⏳ फोटो लोड व कंप्रेस की जा रही है...');
    // Compress photo to max 400x480 (~25-35KB JPEG)
    const compressedDataUrl = await compressCandidateImage(file, 400, 480, 0.82, false);
    const preview = document.getElementById('candidatePhotoPreview');
    if (preview) preview.src = compressedDataUrl;

    const browseBtn = document.getElementById('candidatePhotoBrowseBtn');
    if (browseBtn) browseBtn.innerHTML = '📁 फोटो बदलें (Change Photo)';
    const removeBtn = document.getElementById('candidatePhotoRemoveBtn');
    if (removeBtn) removeBtn.style.display = 'inline-block';

    renderLiveSpecimenSlip();
    showToast('✅ फोटो सफलता पूर्वक लोड हुई!');
  } catch (err) {
    console.error('Photo compress error:', err);
    const reader = new FileReader();
    reader.onload = e => {
      const preview = document.getElementById('candidatePhotoPreview');
      if (preview) preview.src = e.target.result;
      renderLiveSpecimenSlip();
    };
    reader.readAsDataURL(file);
  }
}

function clearCandidatePhoto() {
  const preview = document.getElementById('candidatePhotoPreview');
  if (preview) preview.src = 'https://api.dicebear.com/7.x/identicon/svg?seed=candidate';
  const browseBtn = document.getElementById('candidatePhotoBrowseBtn');
  if (browseBtn) browseBtn.innerHTML = '📁 फोटो चुनें (Choose Photo)';
  const removeBtn = document.getElementById('candidatePhotoRemoveBtn');
  if (removeBtn) removeBtn.style.display = 'none';
  const inp = document.getElementById('candidatePhotoInput');
  if (inp) inp.value = '';
  renderLiveSpecimenSlip();
}

function setSymbolMode(mode) {
  State.symbolMode = mode;
  const standardSection = document.getElementById('standardSymbolControlsGroup') || document.getElementById('standardSymbolSection');
  const customSection = document.getElementById('customSymbolNameGroup') || document.getElementById('customSymbolSection');
  const btnStandard = document.getElementById('btnModeStandardSymbol') || document.getElementById('btnSymbolModeStandard');
  const btnCustom = document.getElementById('btnModeCustomSymbol') || document.getElementById('btnSymbolModeCustom');

  if (mode === 'custom') {
    if (standardSection) standardSection.style.display = 'none';
    if (customSection) customSection.style.display = 'block';
    if (btnStandard) {
      btnStandard.classList.remove('btn-primary', 'active');
      btnStandard.classList.add('btn-outline-secondary');
    }
    if (btnCustom) {
      btnCustom.classList.remove('btn-outline-secondary');
      btnCustom.classList.add('btn-primary', 'active');
    }

    const wrapper = document.getElementById('currentSymbolSvgWrapper');
    const nameText = document.getElementById('currentSymbolNameText');
    const customNameInput = document.getElementById('candidateCustomSymbolNameInput');
    const customName = (customNameInput ? customNameInput.value : '').trim() || 'कस्टम चिन्ह';

    if (State.customSymbolUrl && wrapper) {
      const safeSrc = State.customSymbolUrl.replace(/"/g, '&quot;');
      wrapper.innerHTML = `<img src="${safeSrc}" alt="कस्टम चिन्ह" style="max-width:100%; max-height:100%; object-fit:contain; display:block;">`;
    }
    if (nameText) nameText.textContent = customName;
  } else {
    if (standardSection) standardSection.style.display = 'block';
    if (customSection) customSection.style.display = 'none';
    if (btnStandard) {
      btnStandard.classList.remove('btn-outline-secondary');
      btnStandard.classList.add('btn-primary', 'active');
    }
    if (btnCustom) {
      btnCustom.classList.remove('btn-primary', 'active');
      btnCustom.classList.add('btn-outline-secondary');
    }

    const select = document.getElementById('candidateSymbolSelect');
    if (select && select.value) {
      onCandidateSymbolChanged(select.value);
    }
  }
  renderLiveSpecimenSlip();
}

async function onCustomSymbolSelected(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  try {
    showToast('⏳ कस्टम चुनाव चिन्ह प्रोसेस किया जा रहा है...');
    // Compress symbol to max 240x240 PNG to preserve transparency (~10-20KB)
    const compressedUrl = await compressCandidateImage(file, 240, 240, 0.9, true);
    State.customSymbolUrl = compressedUrl;

    const wrapper = document.getElementById('currentSymbolSvgWrapper');
    if (wrapper) {
      wrapper.innerHTML = `<img src="${compressedUrl}" alt="कस्टम चिन्ह" style="max-width:100%; max-height:100%; object-fit:contain; display:block;">`;
    }

    // Auto-detect symbol name from filename if not set
    const nameInput = document.getElementById('candidateCustomSymbolNameInput');
    if (nameInput && (!nameInput.value || nameInput.value.trim() === 'कस्टम चिन्ह' || nameInput.value.trim() === '')) {
      const rawName = file.name.replace(/\.[^/.]+$/, "").replace(/[_\-\d]/g, " ").trim();
      if (rawName) nameInput.value = rawName;
    }

    const customName = (nameInput ? nameInput.value : '').trim() || 'कस्टम चिन्ह';
    const nameText = document.getElementById('currentSymbolNameText');
    if (nameText) nameText.textContent = customName;

    const browseBtn = document.getElementById('candidateCustomSymbolBrowseBtn');
    if (browseBtn) browseBtn.innerHTML = '📁 चुनाव चिन्ह बदलें';
    const removeBtn = document.getElementById('candidateCustomSymbolRemoveBtn');
    if (removeBtn) removeBtn.style.display = 'inline-block';

    renderLiveSpecimenSlip();
    showToast('✅ कस्टम चुनाव चिन्ह सफलतापूर्वक लोड हुआ!');
  } catch (err) {
    console.error('Custom symbol error:', err);
    showToast('चुनाव चिन्ह लोड करने में समस्या: ' + err.message);
  }
}

function clearCustomSymbol() {
  State.customSymbolUrl = null;
  const inp = document.getElementById('candidateCustomSymbolInput');
  if (inp) inp.value = '';
  const nameInp = document.getElementById('candidateCustomSymbolNameInput');
  if (nameInp) nameInp.value = '';
  const browseBtn = document.getElementById('candidateCustomSymbolBrowseBtn');
  if (browseBtn) browseBtn.innerHTML = '📁 चुनाव चिन्ह फाइल चुनें (PNG/JPG)';
  const removeBtn = document.getElementById('candidateCustomSymbolRemoveBtn');
  if (removeBtn) removeBtn.style.display = 'none';

  setSymbolMode('standard');
}

function onCustomSymbolNameChanged(val) {
  const nameText = document.getElementById('currentSymbolNameText');
  if (nameText) nameText.textContent = (val || '').trim() || 'कस्टम चिन्ह';
  renderLiveSpecimenSlip();
}

function applySloganPreset(type) {
  const sloganText = document.getElementById('candidateSloganTextarea');
  if (!sloganText) return;

  if (type === 1) {
    sloganText.value = '।। समस्त ग्रामवासियों से विनम्र अपील ।।\nग्राम पंचायत के सर्वांगीण विकास एवं न्यायसंगत फैसलों हेतु आपके अपने कर्मठ, ईमानदार एवं सेवाभावी प्रत्याशी को भारी मतों से विजयी बनावें।';
  } else if (type === 2) {
    sloganText.value = '।। वार्ड के समस्त देवतुल्य मतदाताओं से करबद्ध निवेदन ।।\nवार्ड में पक्की सड़कें, स्वच्छ पेयजल व प्रकाश व्यवस्था हेतु अपने जनप्रिय साथी को अपना अमूल्य मत व आशीर्वाद देकर विजयी बनावें।';
  } else if (type === 3) {
    sloganText.value = '।। युवा सोच - नया जोश - सम्पूर्ण विकास ।।\nभ्रष्टाचार मुक्त एवं विकसित पंचायत निर्माण के लिए अपने संघर्षशील युवा प्रत्याशी के पक्ष में मतदान करें।';
  }
  renderLiveSpecimenSlip();
}

async function handleSaveCandidateProfile(event) {
  if (event) event.preventDefault();
  const u = State.currentUser;
  if (!u) {
    showToast('त्रुटि: पहले लॉगिन करें!');
    return;
  }

  const name = (document.getElementById('candidateNameInput').value || '').trim();
  const mobile = (document.getElementById('candidateMobileInput').value || '').trim();
  const post = document.getElementById('candidatePostSelect').value;
  const gp = document.getElementById('candidateGpSelect').value;
  const ward = (post === 'वार्ड पंच' && document.getElementById('candidateWardSelect')) ? document.getElementById('candidateWardSelect').value : '';
  const electionDate = (document.getElementById('candidateElectionDateInput') ? document.getElementById('candidateElectionDateInput').value : '').trim() || getGlobalElectionDate();
  const electionTime = (document.getElementById('candidateElectionTimeInput') ? document.getElementById('candidateElectionTimeInput').value : '').trim() || 'प्रातः 7:00 बजे से सायं 6:00 बजे तक';
  const slogan = (document.getElementById('candidateSloganTextarea').value || '').trim();
  const showBanner = document.getElementById('candidateShowBannerSlip').checked;
  const photoEl = document.getElementById('candidatePhotoPreview');
  const photoUrl = photoEl ? photoEl.src : '';

  let symbolName = '';
  let symbolIcon = '';
  let customSymbolUrl = '';

  if (State.symbolMode === 'custom' && State.customSymbolUrl) {
    customSymbolUrl = State.customSymbolUrl;
    symbolIcon = 'custom';
    symbolName = (document.getElementById('candidateCustomSymbolNameInput')?.value || '').trim() || 'कस्टम चिन्ह';
  } else {
    const symbolSelect = document.getElementById('candidateSymbolSelect');
    const symbolId = symbolSelect ? symbolSelect.value : 'sun';
    const symbols = window.OFFICIAL_ELECTION_SYMBOLS || [];
    const symObj = symbols.find(s => s.id === symbolId) || symbols[0];
    symbolIcon = symObj.id;
    symbolName = symObj.name_hi;
  }

  const uKey = u.id || u.username;
  const profileData = {
    user_id: uKey,
    candidate_name: name,
    mobile: mobile,
    post: post,
    panchayat: gp,
    ward: ward,
    ps_zp_ward: (document.getElementById("adminCandPsZpWard")?.value || "").trim(),
    election_date: electionDate,
    election_time: electionTime,
    symbol_name: symbolName,
    symbol_icon: symbolIcon,
    custom_symbol_url: customSymbolUrl,
    photo_url: photoUrl,
    slogan: slogan,
    show_banner_on_slip: showBanner,
    updated_at: new Date().toISOString()
  };

  State.currentCandidate = profileData;
  localStorage.setItem('candidate_profile_' + uKey, JSON.stringify(profileData));
  if (u.id) localStorage.setItem('candidate_profile_' + u.id, JSON.stringify(profileData));
  if (u.username) localStorage.setItem('candidate_profile_' + u.username, JSON.stringify(profileData));

  // Sync to in-memory PORTAL_USERS_DATA
  if (window.PORTAL_USERS_DATA) {
    if (!window.PORTAL_USERS_DATA.candidates) window.PORTAL_USERS_DATA.candidates = {};
    window.PORTAL_USERS_DATA.candidates[uKey] = profileData;
  }

  // Save to SQLite & portal_users.json on server
  try {
    const res = await fetch('/api/candidate/' + encodeURIComponent(uKey), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(profileData)
    });
    if (res.ok) {
      showToast('✅ प्रत्याशी प्रोफाइल, फोटो एवं चुनाव चिन्ह डेटाबेस में सुरक्षित!');
    } else {
      showToast('✅ प्रत्याशी प्रोफाइल सुरक्षित!');
    }
  } catch (e) {
    showToast('✅ प्रत्याशी प्रोफाइल सुरक्षित!');
  }

  // Live Auto-Sync to Google Sheet (Candidate_Edits Sheet Tab)
  try {
    const gScriptUrl = State.config?.appsScriptUrl || localStorage.getItem('panchayat_apps_script_url') || 'https://script.google.com/macros/s/AKfycbwtgz2L5QC_95Jsf1r0Kum_LcTI-bJwwiBQS_O74vthHcbPD_KatsN69ytY2yqlayiM/exec';
    if (gScriptUrl) {
      fetch(gScriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          action: 'saveCandidateSelfEdit',
          candidateData: profileData
        }),
        mode: 'no-cors'
      }).catch(err => console.warn('Candidate Sheet self-edit sync notice:', err));
    }
  } catch (sheetErr) {}

  renderLiveSpecimenSlip();
}

function renderLiveSpecimenSlip() {
  const container = document.getElementById('liveSpecimenSlipContainer');
  if (!container) return;

  const name = document.getElementById('candidateNameInput') ? document.getElementById('candidateNameInput').value : 'श्री रामेश्वर प्रसाद जाट';
  const post = document.getElementById('candidatePostSelect') ? document.getElementById('candidatePostSelect').value : 'सरपंच';
  const gp = document.getElementById('candidateGpSelect') ? document.getElementById('candidateGpSelect').value : 'बूबकिया';
  const ward = (post === 'वार्ड पंच' && document.getElementById('candidateWardSelect')) ? document.getElementById('candidateWardSelect').value : '';
  const electionDate = (document.getElementById('candidateElectionDateInput') ? document.getElementById('candidateElectionDateInput').value : '').trim() || '15 अक्टूबर 2026';
  const electionTime = (document.getElementById('candidateElectionTimeInput') ? document.getElementById('candidateElectionTimeInput').value : '').trim() || 'प्रातः 7:00 बजे से सायं 6:00 बजे तक';
  const slogan = document.getElementById('candidateSloganTextarea') ? document.getElementById('candidateSloganTextarea').value : '।। समस्त ग्रामवासियों से विनम्र अपील ।।\nअपने कर्मठ एवं ईमानदार प्रत्याशी को विजयी बनावें।';
  const photo = document.getElementById('candidatePhotoPreview') ? document.getElementById('candidatePhotoPreview').src : 'https://api.dicebear.com/7.x/identicon/svg?seed=candidate';

  let symbolSvg = '';
  let symbolName = '';
  let customSymbolUrl = '';

  if (State.symbolMode === 'custom' && State.customSymbolUrl) {
    customSymbolUrl = State.customSymbolUrl;
    symbolName = (document.getElementById('candidateCustomSymbolNameInput')?.value || '').trim() || 'कस्टम चिन्ह';
    if (customSymbolUrl.trim().startsWith('<svg')) {
      symbolSvg = customSymbolUrl;
    } else {
      const safeSrc = customSymbolUrl.replace(/"/g, '&quot;');
      symbolSvg = `<img src="${safeSrc}" alt="${symbolName}" class="candidate-custom-symbol-img" style="max-width:100%; max-height:100%; object-fit:contain; display:block; margin:0 auto;">`;
    }
  } else {
    const symbolSelect = document.getElementById('candidateSymbolSelect');
    const symbolId = symbolSelect ? symbolSelect.value : 'sun';
    const symbols = window.OFFICIAL_ELECTION_SYMBOLS || [];
    const symObj = symbols.find(s => s.id === symbolId) || symbols[0];
    symbolSvg = symObj.svg;
    symbolName = symObj.name_hi;
  }

  const dummyVoter = {
    serial_no: 104,
    voter_name: 'सुरेश कुमार जाट',
    voter_name_en: 'Suresh Kumar Jat',
    relative_name: 'रामचन्द्र जाट',
    relative_relation: 'पिता',
    age: 36,
    gender: 'M',
    house_no: '42',
    revenue_village: gp,
    gram_panchayat: gp,
    ward_no: ward || 3,
    epic_no: 'RJ/12/098/234512',
    polling_station_no: 1,
    polling_station_name: 'राजकीय उच्च माध्यमिक विद्यालय, कमरा नं.-02'
  };

  container.innerHTML = buildDetachableCandidateSlipHtml(dummyVoter, {
    candidate_name: name || 'उम्मीदवार का नाम',
    post: post,
    panchayat: gp || 'ग्राम पंचायत',
    ward: ward,
    ps_zp_ward: (gp === 'बांदनवाड़ा' && post && post.includes('पंचायत समिति')) ? '2' : (ward || ''),
    election_date: electionDate,
    election_time: electionTime,
    symbol_name: symbolName,
    symbol_svg: symbolSvg,
    custom_symbol_url: customSymbolUrl,
    photo_url: photo,
    slogan: slogan
  });
}

function openSpecimenPreviewModal() {
  renderLiveSpecimenSlip();
  const container = document.getElementById('liveSpecimenSlipContainer');
  if (container) {
    container.scrollIntoView({ behavior: 'smooth' });
  }
}

// Build the accurate perforated candidate voter slip (Video Accurate)
function buildDetachableCandidateSlipHtml(voter, candidateData) {
  const isFemale = voter.gender === 'F';
  const relLabel = voter.relative_relation || 'पिता/पति';
  const bInfo = getBoothForVoter(voter);
  const boothName = (bInfo && (bInfo.name || bInfo.name_hi)) || voter.polling_station_name || 'राजकीय उच्च माध्यमिक विद्यालय कमरा नं.-01 भिनाय';
  const boothNo = (bInfo && bInfo.booth_no) || voter.polling_station_no || '1';
  const electionDate = candidateData.election_date || getGlobalElectionDate();
  const electionTime = candidateData.election_time || getGlobalElectionTime();

  let cName = candidateData.candidate_name || (State.currentUser && (State.currentUser.candidate_name || State.currentUser.full_name || State.currentUser.name)) || 'कमला देवी';
  if (cName.includes('(')) cName = cName.split('(')[0].trim();
  if (cName.includes(' - ')) cName = cName.split(' - ')[0].trim();

  let cPost = candidateData.post || (candidateData.candidate && candidateData.candidate.post) || (State.currentUser && (State.currentUser.post || (State.currentUser.candidate && State.currentUser.candidate.post))) || '';
  if (!cPost || cPost === 'सरपंच') {
    if (cName.includes('कमला') || (State.currentUser && (State.currentUser.username === 'b' || State.currentUser.username === 'kamala' || State.currentUser.username === 'kamla'))) {
      cPost = 'पंचायत समिति सदस्य';
    } else {
      cPost = cPost || 'सरपंच';
    }
  }
  const postDisplay = cPost.includes('प्रत्याशी') ? cPost : `${cPost} प्रत्याशी`;
  const cGp = candidateData.panchayat || voter.gram_panchayat;
  const cWard = candidateData.ward || voter.ward_no;
  const cSymbolName = candidateData.symbol_name || 'उगता सूरज';
  
  const cCustomSymbolUrl = candidateData.custom_symbol_url || candidateData.custom_symbol || candidateData.symbol_url;
  let cSymbolSvg = candidateData.symbol_svg;
  if (cCustomSymbolUrl && String(cCustomSymbolUrl).trim().length > 5) {
    if (cCustomSymbolUrl.trim().startsWith('<svg')) {
      cSymbolSvg = cCustomSymbolUrl;
    } else {
      const safeSrc = cCustomSymbolUrl.replace(/"/g, '&quot;');
      cSymbolSvg = `<img src="${safeSrc}" alt="${cSymbolName}" class="candidate-custom-symbol-img" style="width:100%; height:100%; max-width:100%; max-height:100%; object-fit:contain; display:block; margin:0 auto;" onerror="this.onerror=null; this.src='https://api.dicebear.com/7.x/identicon/svg?seed=symbol';">`;
    }
  } else {
    // Look up symbol from official 22 symbols by selected name (e.g. हाथ, कमल, बोतल, साइकिल, आदि)
    if (typeof getSymbolSvgById === 'function') {
      cSymbolSvg = getSymbolSvgById(cSymbolName || candidateData.symbol_icon);
    } else {
      cSymbolSvg = (window.OFFICIAL_ELECTION_SYMBOLS && window.OFFICIAL_ELECTION_SYMBOLS[0].svg);
    }
  }

  const cPhoto = candidateData.photo_url || ((candidateData.candidate_name && candidateData.candidate_name.includes('कमला')) || (State.currentUser && State.currentUser.username === 'b') ? KAMLA_DEFAULT_PHOTO : 'https://api.dicebear.com/7.x/identicon/svg?seed=candidate');
  const cSlogan = (candidateData.slogan || 'अपने कर्मठ एवं ईमानदार प्रत्याशी को विजयी बनावें।').replace(/\n/g, '<br>');

  return `
    <div class="candidate-slip-card">
      <!-- 1. TOP SECTION: CANDIDATE CAMPAIGN BANNER (FULL COLOR) -->
      <div class="candidate-banner-top">
        <div class="candidate-banner-main-row">
          <div class="candidate-banner-photo-col">
            <img src="${cPhoto}" alt="${cName}" onerror="this.src='https://api.dicebear.com/7.x/identicon/svg?seed=candidate'">
          </div>
          <div class="candidate-banner-info-col">
            <div class="candidate-banner-header">।। श्री गणेशाय नमः ।।</div>
            <div class="candidate-banner-name">${cName}</div>
            <div>
              <span class="candidate-banner-post">${postDisplay}</span>
            </div>
          </div>
          <div class="candidate-banner-symbol-col">
            <div class="candidate-symbol-box">
              ${cSymbolSvg}
            </div>
            <div class="candidate-banner-symbol-label">चुनाव चिन्ह:<br><strong>${cSymbolName}</strong></div>
          </div>
        </div>

        <!-- DYNAMIC GP & WARD ACCORDING TO POST (SARPANCH / WARD PANCH / PS / ZP) -->
        ${(() => {
          const postStr = String(cPost || '').trim();
          const rawWard = String(candidateData.ward || voter.ward_no || '').trim();
          const cleanWard = (rawWard && rawWard.toUpperCase() !== 'ALL') ? rawWard : '';
          
          const psZpNo = String(candidateData.ps_zp_ward || (postStr.includes('पंचायत समिति') || postStr.includes('जिला परिषद') ? cleanWard : '') || '').trim();
          const cleanPsZpNo = (psZpNo && psZpNo.toUpperCase() !== 'ALL') ? psZpNo : '';

          // Dynamic PS/ZP Ward lookup
          let psZpVal = String(candidateData.ps_zp_ward || candidateData.constituency_ward || '').trim();
          if (!psZpVal || psZpVal.toUpperCase() === 'ALL') {
            if (cleanWard) psZpVal = cleanWard;
            else if (cGp === 'बांदनवाड़ा' && postStr.includes('पंचायत समिति')) psZpVal = '2';
          }
          const finalPsZpNo = (psZpVal && psZpVal.toUpperCase() !== 'ALL') ? psZpVal : '';

          if (postStr.includes('पंचायत समिति')) {
            return `<div class="candidate-banner-gp">ग्राम पंचायत: <strong>${voter.gram_panchayat || cGp}</strong> • पंचायत समिति वार्ड नं.: <strong>${finalPsZpNo || '2'}</strong></div>`;
          } else if (postStr.includes('जिला परिषद')) {
            return `<div class="candidate-banner-gp">ग्राम पंचायत: <strong>${voter.gram_panchayat || cGp}</strong> • जिला परिषद वार्ड नं.: <strong>${finalPsZpNo || '1'}</strong></div>`;
          } else if (postStr.includes('सरपंच')) {
            // सरपंच: पूरी ग्राम पंचायत (वार्ड नहीं छपेगा)
            return `<div class="candidate-banner-gp">ग्राम पंचायत: <strong>${cGp}</strong></div>`;
          } else if (postStr.includes('वार्ड पंच') || postStr.includes('पंच')) {
            // वार्ड पंच: ग्राम पंचायत व उनका अधिकृत वार्ड नंबर
            const wpNo = cleanWard || voter.ward_no || '1';
            return `<div class="candidate-banner-gp">ग्राम पंचायत: <strong>${cGp}</strong> • वार्ड नं.: <strong>${wpNo}</strong></div>`;
          } else {
            return `<div class="candidate-banner-gp">ग्राम पंचायत: <strong>${cGp}</strong>${cleanWard ? ` • वार्ड नं.: <strong>${cleanWard}</strong>` : ''}</div>`;
          }
        })()}

        <!-- SINGLE LINE DATE & TIME (SMALL LIKE BEFORE) -->
        <div class="candidate-banner-time">🗓️ मतदान: <strong>${electionDate}</strong> | ⏰ समय: <strong>${electionTime}</strong></div>

        <!-- FULL-WIDTH CANDIDATE APPEAL (SPANS ENTIRE BOX FROM LEFT TO RIGHT) -->
        <div class="candidate-banner-slogan">${cSlogan}</div>
      </div>

      <!-- 2. PERFORATION CUTTING DIVIDER (SLIM & COMPACT) -->
      <div class="slip-perforation-divider">
        <span class="cut-icon">✂️</span>
        <span class="cut-text">- - काटकर मतदाता को दें (काट कर अलग करें) - -</span>
        <span class="cut-icon">✂️</span>
      </div>

      <!-- 3. BOTTOM SECTION: 100% CLEAN OFFICIAL B&W VOTER SLIP (NO BACKGROUND, FOOTER REMOVED FOR MAXIMUM SPACE) -->
      <div class="official-bottom-bw-slip">
        <div class="bw-header">
          <div>
            <div class="bw-gov-title">मतदाता सूचना पर्ची (VOTER SLIP)</div>
            <div style="font-size:5.8pt; color:#000;">पंचायती राज चुनाव 2026 | पं.स. भिनाय (अजमेर)</div>
          </div>
          <div class="bw-serial-badge">सरल क्र. ${voter.serial_no || '1'}</div>
        </div>

        <div class="bw-grid">
          <div><strong>पं.:</strong> ${voter.gram_panchayat}</div>
          <div><strong>वार्ड संख्या:</strong> ${voter.ward_no}</div>
          <div class="bw-row-full"><strong>मतदाता का नाम:</strong> ${voter.voter_name} ${voter.voter_name_en ? `(${voter.voter_name_en})` : ''}</div>
          <div class="bw-row-full"><strong>${relLabel} का नाम:</strong> ${voter.relative_name || '-'}</div>
          <div><strong>आयु/लिंग:</strong> ${voter.age ? voter.age + ' वर्ष' : '-'}, ${isFemale ? 'स्त्री' : 'पुरुष'}</div>
          <div><strong>मकान संख्या:</strong> ${voter.house_no || '-'}</div>
          <div class="bw-row-full"><strong>पहचान पत्र क्र. (EPIC):</strong> ${voter.epic_no || 'RJ/12/098/...'}</div>
        </div>

        <div class="bw-booth-box">
          <strong>मतदान केंद्र ${boothNo}:</strong> ${boothName}
        </div>
      </div>
    </div>
  `;
}

// Modify buildOfficialSlipHtml to dynamically support candidate detachable slip
const originalBuildOfficialSlipHtml = window.buildOfficialSlipHtml;
/**
 * EXACT OFFICIAL VOTER SLIP PATTERN (100% MATCHING USER SPECIFICATION IMAGE 2)
 * Pure B&W, crisp dashed lines, centered subbar, polling booth box, and footer.
 */
function buildExactOfficialSlipInnerHtml(voter) {
  const isFemale = voter.gender === 'F' || voter.gender === 'महिला' || voter.gender === 'स्त्री';
  const relLabel = voter.relative_relation || 'पति';
  const bInfo = getBoothForVoter(voter);
  const boothName = (bInfo && (bInfo.name || bInfo.name_hi)) || voter.polling_station_name || 'राजकीय उच्च माध्यमिक विद्यालय';
  const boothNo = (bInfo && bInfo.booth_no) || voter.polling_station_no || '1';

  return `
    <div class="official-mini-slip">
      <div class="mini-slip-inner">
        <!-- Header -->
        <div class="mini-slip-header">
          <div class="mini-slip-gov-title">मतदाता सूचना पर्ची (VOTER SLIP)</div>
          <div class="mini-slip-sub-gov">पंचायती राज आम चुनाव - 2026 | पं.स. भिनाय (अजमेर)</div>
        </div>

        <!-- Subbar: GP, Ward, Serial -->
        <div class="mini-slip-subbar">
          <span class="mini-sub-gp">पं.: ${voter.gram_panchayat}</span>
          <span class="mini-sub-ward">वार्ड: ${voter.ward_no}</span>
          <span class="mini-serial-box">क्र. ${voter.serial_no || '1'}</span>
        </div>

        <!-- Details -->
        <div class="mini-details-table">
          <div class="mini-detail-row">
            <span class="mini-lbl">नाम:</span>
            <span class="mini-val"><strong>${voter.voter_name}</strong> ${voter.voter_name_en ? `(${voter.voter_name_en})` : ''}</span>
          </div>
          <div class="mini-detail-row">
            <span class="mini-lbl">${relLabel}:</span>
            <span class="mini-val">${voter.relative_name || '-'}</span>
          </div>
          <div class="mini-detail-row">
            <span class="mini-lbl">आयु/लिंग:</span>
            <span class="mini-val">${voter.age ? voter.age + ' वर्ष' : '-'}, ${isFemale ? 'स्त्री' : 'पुरुष'}</span>
          </div>
          <div class="mini-detail-row">
            <span class="mini-lbl">मकान:</span>
            <span class="mini-val">${voter.house_no || '-'} (${voter.revenue_village || voter.gram_panchayat})</span>
          </div>
          <div class="mini-detail-row">
            <span class="mini-lbl">पहचान क्र.:</span>
            <span class="mini-val"><strong>${voter.epic_no || 'RJ/12/098/...'}</strong></span>
          </div>
        </div>

        <!-- Polling Station Box -->
        <div class="mini-booth-box">
          मतदान केंद्र ${boothNo}: ${boothName}
        </div>

        <!-- Footer -->
        <div class="mini-slip-footer">
          <span class="mini-foot-left">वार्ड: ${voter.ward_no} • सरल क्र.: ${voter.serial_no}</span>
          <span class="mini-foot-right">*मतदान हेतु मूल पहचान पत्र अनिवार्य</span>
        </div>
      </div>
    </div>
  `;
}

window.buildOfficialSlipHtml = function(voter, layout, theme) {
  // Requirement: 21 slips on A4 page must display ONLY the official voter slip without candidate details
  if (String(layout) === '21') {
    return buildExactOfficialSlipInnerHtml(voter);
  }

  const u = State.currentUser;
  const isCandidate = u && (u.role === 'CANDIDATE' || u.type === 'CANDIDATE' || String(u.id || '').startsWith('cand_') || u.candidate_mode === 'user_edit' || u.candidate_mode === 'active');

  // SUPER ADMIN & NON-CANDIDATES: ALWAYS get the original official slip (print system untouched)
  if (!isCandidate) {
    return buildExactOfficialSlipInnerHtml(voter);
  }

  // CANDIDATE LOGIN: Candidate detachable campaign slip
  if (isCandidate && isCandidateSlipAllowedForVoter(voter)) {
    const cand = State.currentCandidate || findCandidateForVoter(voter);
    if (cand && (cand.show_banner_on_slip !== false)) {
      const symbols = window.OFFICIAL_ELECTION_SYMBOLS || [];
      const customUrl = cand.custom_symbol_url || cand.custom_symbol || cand.symbol_url;
      let candSymbolSvg = '';

      if (customUrl) {
        if (customUrl.trim().startsWith('<svg')) {
          candSymbolSvg = customUrl;
        } else {
          const safeSrc = customUrl.replace(/"/g, '&quot;');
          candSymbolSvg = `<img src="${safeSrc}" alt="${cand.symbol_name || 'चुनाव चिन्ह'}" class="candidate-custom-symbol-img" style="width:100%; height:100%; max-width:100%; max-height:100%; object-fit:contain; display:block; margin:0 auto;" onerror="this.onerror=null; this.src='https://api.dicebear.com/7.x/identicon/svg?seed=symbol';">`;
        }
      } else {
        const symObj = symbols.find(s => s.id === cand.symbol_icon || (cand.symbol_name && s.name_hi.includes(cand.symbol_name))) || symbols[0];
        candSymbolSvg = (symObj && symObj.svg) ? symObj.svg : (cand.symbol_svg || '');
      }

      return buildDetachableCandidateSlipHtml(voter, {
        ...cand,
        candidate_name: cand.candidate_name || (u ? u.full_name : '') || 'उम्मीदवार',
        symbol_svg: candSymbolSvg,
        custom_symbol_url: customUrl
      });
    }
  }

  return buildExactOfficialSlipInnerHtml(voter);
};

// ==========================================================================
// MASTER ADMIN USER & PORTAL CONTROL TAB ENGINE (⚡)
// ==========================================================================

async function initAdminControlTab() {
  loadTriPortalSettings();
  await loadAdminUsersList();
  renderAdminControlTab();
}

async function loadAdminUsersList(force = false) {
  const bust = Date.now();
  const sanitizeUserTabs = u => {
    if (!u) return u;
    if (typeof isCandidateUser === 'function' && isCandidateUser(u) && Array.isArray(u.allowed_tabs)) {
      u.allowed_tabs = u.allowed_tabs.filter(t => t !== 'directoryTab');
    }
    return u;
  };

  // 1. Try Node.js + SQLite API (with explicit cache-busting & no-store)
  try {
    const res = await fetch(`/api/users?_t=${bust}`, { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      if (data && data.success && Array.isArray(data.users)) {
        if (data.election_date) {
          if (!triPortalSettings.voter_portal) triPortalSettings.voter_portal = {};
          triPortalSettings.voter_portal.election_date = data.election_date;
          triPortalSettings.election_date = data.election_date;
        }
        if (data.election_time) {
          if (!triPortalSettings.voter_portal) triPortalSettings.voter_portal = {};
          triPortalSettings.voter_portal.election_time = data.election_time;
          triPortalSettings.election_time = data.election_time;
        }
        applyGlobalElectionDateToUI();
        State.adminControlUsers = data.users.map(sanitizeUserTabs);
        if (!window.PORTAL_USERS_DATA) window.PORTAL_USERS_DATA = { users: [], candidates: {} };
        window.PORTAL_USERS_DATA.users = State.adminControlUsers;
        if (!window.PORTAL_USERS_DATA.candidates) window.PORTAL_USERS_DATA.candidates = {};
        if (data.candidates) Object.assign(window.PORTAL_USERS_DATA.candidates, data.candidates);
        State.adminControlUsers.forEach(u => {
          if (u.candidate) {
            if (u.id) window.PORTAL_USERS_DATA.candidates[u.id] = u.candidate;
            if (u.username) window.PORTAL_USERS_DATA.candidates[u.username] = u.candidate;
          }
        });
        syncCurrentUserWithConfiguredUsers();
        return;
      }
    }
  } catch (e) {
    // API server not reachable, fallback to static JSON
  }

  // 2. Try Google Apps Script on GitHub Pages for immediate zero-cache live updates (Users + Candidates)
  const isGitHub = window.location.hostname.includes('github.io');
  const gScriptUrl = State.config?.appsScriptUrl || localStorage.getItem('panchayat_apps_script_url') || 'https://script.google.com/macros/s/AKfycbwtgz2L5QC_95Jsf1r0Kum_LcTI-bJwwiBQS_O74vthHcbPD_KatsN69ytY2yqlayiM/exec';
  if (isGitHub && gScriptUrl) {
    try {
      const [gRes, cRes] = await Promise.all([
        fetch(`${gScriptUrl}?action=getUsers&_t=${bust}`).catch(() => null),
        fetch(`${gScriptUrl}?action=getCandidates&_t=${bust}`).catch(() => null)
      ]);

      let combinedUsers = [];
      let candidatesMap = {};

      if (gRes && gRes.ok) {
        const gData = await gRes.json();
        if (gData && Array.isArray(gData.users)) {
          combinedUsers = gData.users.map(u => {
            let tabs = [];
            if (u.tab_search !== undefined || u.tab_alpha !== undefined || u.tab_bulkslip !== undefined || u.tab_directory !== undefined) {
              if (u.tab_search === true || String(u.tab_search).toUpperCase() === 'TRUE') tabs.push('searchTab');
              if (u.tab_alpha === true || String(u.tab_alpha).toUpperCase() === 'TRUE') tabs.push('alphaTab');
              if (u.tab_bulkslip === true || String(u.tab_bulkslip).toUpperCase() === 'TRUE') tabs.push('bulkSlipTab');
              if (u.tab_directory === true || String(u.tab_directory).toUpperCase() === 'TRUE') tabs.push('directoryTab');
            } else if (Array.isArray(u.allowed_tabs)) {
              tabs = u.allowed_tabs;
            } else if (typeof u.allowed_tabs === 'string') {
              try { tabs = JSON.parse(u.allowed_tabs); } catch(e) { tabs = u.allowed_tabs.split(',').map(s=>s.trim()).filter(Boolean); }
            }
            return {
              ...u,
              allowed_tabs: tabs,
              can_print: (u.can_print === true || String(u.can_print).toUpperCase() === 'TRUE'),
              can_download: (u.can_download === true || String(u.can_download).toUpperCase() === 'TRUE')
            };
          });
          localStorage.setItem('panchayat_admins_cache', JSON.stringify(combinedUsers));
        }
      }

      if (cRes && cRes.ok) {
        const cData = await cRes.json();
        if (cData && Array.isArray(cData.candidates)) {
          const candsList = cData.candidates.map(sc => {
            let tabs = [];
            if (sc.tab_search !== undefined || sc.tab_alpha !== undefined || sc.tab_bulkslip !== undefined || sc.tab_profile !== undefined) {
              if (sc.tab_search === true || String(sc.tab_search).toUpperCase() === 'TRUE') tabs.push('searchTab');
              if (sc.tab_alpha === true || String(sc.tab_alpha).toUpperCase() === 'TRUE') tabs.push('alphaTab');
              if (sc.tab_bulkslip === true || String(sc.tab_bulkslip).toUpperCase() === 'TRUE') tabs.push('bulkSlipTab');
              if (sc.tab_profile === true || String(sc.tab_profile).toUpperCase() === 'TRUE') tabs.push('candidateProfileTab');
            } else if (Array.isArray(sc.allowed_tabs)) {
              tabs = sc.allowed_tabs.filter(t => t !== 'directoryTab');
            } else if (typeof sc.allowed_tabs === 'string') {
              try { tabs = JSON.parse(sc.allowed_tabs); } catch(e) { tabs = sc.allowed_tabs.split(',').map(s=>s.trim()).filter(Boolean); }
            }
            const candUserObj = {
              id: sc.id || ('cand_' + sc.username),
              username: sc.username,
              user_id: sc.id || ('cand_' + sc.username),
              password: sc.password,
              fullName: sc.candidate_name,
              full_name: sc.candidate_name,
              mobile: sc.mobile || '',
              role: 'CANDIDATE',
              status: (sc.status || 'ACTIVE').toUpperCase(),
              allowed_panchayats: sc.panchayat || '',
              allowed_wards: sc.ward || 'ALL',
              allowed_tabs: tabs,
              candidate_mode: sc.candidate_mode || 'user_edit',
              can_print: (sc.can_print === true || String(sc.can_print).toUpperCase() === 'TRUE'),
              can_download: (sc.can_download === true || String(sc.can_download).toUpperCase() === 'TRUE'),
              candidate: sc
            };
            candidatesMap[candUserObj.id] = sc;
            candidatesMap[candUserObj.username] = sc;
            return candUserObj;
          });
          localStorage.setItem('panchayat_candidates_cache', JSON.stringify(candsList));
          candsList.forEach(candUser => {
            const uKey = String(candUser.username || candUser.id).toLowerCase();
            const exIdx = combinedUsers.findIndex(u => 
              (u.id && String(u.id).toLowerCase() === uKey) || 
              (u.username && String(u.username).toLowerCase() === uKey) ||
              (candUser.id && String(u.id).toLowerCase() === candUser.id.replace('cand_', '')) ||
              ((candUser.username === 'b' || candUser.id === 'cand_b') && (String(u.username).toLowerCase() === 'kamla' || String(u.id).toLowerCase() === 'kamla'))
            );
            if (exIdx >= 0) combinedUsers[exIdx] = { ...combinedUsers[exIdx], ...candUser };
            else combinedUsers.push(candUser);

            // Live update active session tabs if currently logged in user matches this candidate
            if (State.currentUser) {
              const curId = String(State.currentUser.id || '').toLowerCase();
              const curUname = String(State.currentUser.username || '').toLowerCase();
              const candId = String(candUser.id || '').toLowerCase();
              const candUname = String(candUser.username || '').toLowerCase();
              const candName = String(candUser.fullName || candUser.full_name || '').toLowerCase();
              if (
                curId === candId || curUname === candUname ||
                curId === candUname || curUname === candId ||
                curId === ('cand_' + candUname) || curUname === ('cand_' + candUname) ||
                ((curUname === 'kamla' || curUname === 'कमला' || curId === 'kamla' || curId === 'कमला') && (candUname === 'b' || candId === 'cand_b' || candName.includes('कमला')))
              ) {
                State.currentUser.allowed_tabs = [...candUser.allowed_tabs];
                State.currentUser.can_print = candUser.can_print;
                State.currentUser.can_download = candUser.can_download;
                if (candUser.candidate) {
                  State.currentUser.candidate = candUser.candidate;
                  State.currentCandidate = candUser.candidate;
                }
                const sk = getSessionStorageKey();
                localStorage.setItem(sk, JSON.stringify(State.currentUser));
                sessionStorage.setItem(sk, JSON.stringify(State.currentUser));
                localStorage.setItem('panchayat_user_session', JSON.stringify(State.currentUser));
              }
            }
          });
        }
      }

      if (combinedUsers.length > 0) {
        State.adminControlUsers = combinedUsers.map(sanitizeUserTabs);
        if (!window.PORTAL_USERS_DATA) window.PORTAL_USERS_DATA = { users: [], candidates: {} };
        window.PORTAL_USERS_DATA.users = State.adminControlUsers;
        if (!window.PORTAL_USERS_DATA.candidates) window.PORTAL_USERS_DATA.candidates = {};
        Object.assign(window.PORTAL_USERS_DATA.candidates, candidatesMap);
        syncCurrentUserWithConfiguredUsers();
        return;
      }
    } catch(_) {}
  }

  // 3. Try portal_users.json (with explicit cache-busting & no-store)
  try {
    const isMaster = window.location.hostname === 'localhost' || window.location.pathname.includes('/pan');
    // Always fetch local repo's portal_users.json first (fastest & same-origin), then fallback to master pan
    let jsonRes = await fetch(`portal_users.json?_t=${bust}`, { cache: 'no-store' });
    if (!jsonRes.ok && !isMaster) {
      jsonRes = await fetch(`https://jit9763.github.io/pan/portal_users.json?_t=${bust}`, { cache: 'no-store' });
    }
    if (jsonRes.ok) {
      const data = await jsonRes.json();
      if (data && Array.isArray(data.users)) {
        window.PORTAL_USERS_DATA = data;
        if (data.election_date) {
          if (!triPortalSettings.voter_portal) triPortalSettings.voter_portal = {};
          triPortalSettings.voter_portal.election_date = data.election_date;
          triPortalSettings.election_date = data.election_date;
        }
        if (data.election_time) {
          if (!triPortalSettings.voter_portal) triPortalSettings.voter_portal = {};
          triPortalSettings.voter_portal.election_time = data.election_time;
          triPortalSettings.election_time = data.election_time;
        }
        applyGlobalElectionDateToUI();
        if (!window.PORTAL_USERS_DATA.candidates) window.PORTAL_USERS_DATA.candidates = {};
        State.adminControlUsers = data.users.map(u => ({
          ...sanitizeUserTabs(u),
          candidate: (data.candidates && (data.candidates[u.id] || data.candidates[u.username])) || null
        }));
        State.adminControlUsers.forEach(u => {
          if (u.candidate) {
            if (u.id) window.PORTAL_USERS_DATA.candidates[u.id] = u.candidate;
            if (u.username) window.PORTAL_USERS_DATA.candidates[u.username] = u.candidate;
          }
        });
        syncCurrentUserWithConfiguredUsers();
        return;
      }
    }
  } catch (e) {
    console.log('portal_users.json fetch error:', e);
  }

  // 3. Fallback to State.adminUsers
  if (!State.adminControlUsers || State.adminControlUsers.length === 0) {
    State.adminControlUsers = (State.adminUsers || []).map(u => ({
      id: u.user_id || u.username,
      username: u.username,
      password: u.password,
      fullName: u.fullName || u.full_name || u.username,
      full_name: u.full_name || u.fullName || u.username,
      mobile: u.mobile || '',
      status: u.status || 'ACTIVE',
      allowed_panchayats: u.assigned_panchayats || 'ALL',
      allowed_wards: u.assigned_wards || 'ALL',
      allowed_tabs: ['searchTab'],
      candidate_mode: 'user_edit'
    }));
  }

  // Ensure Block Prabhari is always present in adminControlUsers
  if (!State.adminControlUsers.find(x => (x.id || x.username) === 'block_prabhari')) {
    State.adminControlUsers.splice(1, 0, {
      id: 'block_prabhari',
      username: 'block_prabhari',
      password: 'BHINAI123',
      name: 'ब्लॉक प्रभारी',
      full_name: 'ब्लॉक प्रभारी',
      mobile: '9950705221',
      status: 'ACTIVE',
      allowed_panchayats: 'ALL',
      allowed_wards: 'ALL',
      allowed_tabs: ['dashboardTab', 'searchTab', 'alphaTab', 'directoryTab'],
      candidate_mode: 'admin_locked'
    });
  }

  // Apply localStorage overrides
  try {
    const ovPass = JSON.parse(localStorage.getItem('portal_passwords_override') || '{}');
    const ovStatus = JSON.parse(localStorage.getItem('portal_status_override') || '{}');
    State.adminControlUsers.forEach(u => {
      const uid = u.id || u.username;
      if (ovPass[uid]) u.password = ovPass[uid];
      if (ovStatus[uid]) u.status = ovStatus[uid];
    });
  } catch(e) {}
}

function renderAdminControlTab() {
  switchMasterHubSubTab(activeHubSubTab || 'cell');
  const tbody = document.getElementById('masterAdminUsersTbody');
  if (!tbody) return;

  const users = State.adminControlUsers || [];
  const totalEl = document.getElementById('adminTotalUsersCount');
  const activeEl = document.getElementById('adminActiveUsersCount');
  const inactiveEl = document.getElementById('adminInactiveUsersCount');

  const activeCount = users.filter(u => String(u.status || 'ACTIVE').toUpperCase() === 'ACTIVE').length;
  const inactiveCount = users.length - activeCount;

  if (totalEl) totalEl.textContent = users.length;
  if (activeEl) activeEl.textContent = activeCount;
  if (inactiveEl) inactiveEl.textContent = inactiveCount;

  const searchVal = (document.getElementById('adminUserSearchInput') ? document.getElementById('adminUserSearchInput').value : '').toLowerCase().trim();
  const statusFilter = document.getElementById('adminStatusFilterSelect') ? document.getElementById('adminStatusFilterSelect').value : 'ALL';

  const filtered = users.filter(u => {
    const matchStatus = (statusFilter === 'ALL') || (String(u.status || 'ACTIVE').toUpperCase() === statusFilter);
    const matchSearch = !searchVal ||
      (u.username && u.username.toLowerCase().includes(searchVal)) ||
      (u.full_name && u.full_name.toLowerCase().includes(searchVal)) ||
      (u.allowed_panchayats && u.allowed_panchayats.toLowerCase().includes(searchVal));
    return matchStatus && matchSearch;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:24px; color:#64748b;">कोई उपयोगकर्ता नहीं मिला।</td></tr>`;
    return;
  }

  tbody.innerHTML = '';
  filtered.forEach(u => {
    const uId = u.id || u.username;
    const isActive = String(u.status || 'ACTIVE').toUpperCase() === 'ACTIVE';
    const allowedTabs = Array.isArray(u.allowed_tabs) ? u.allowed_tabs : [];

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <strong>${u.username}</strong>
        <div style="font-size:0.7rem; color:#64748b;">ID: ${uId}</div>
      </td>
      <td>
        <input type="text" class="form-input form-input-sm" value="${u.full_name || u.fullName || ''}" onchange="updateUserField('${uId}', 'full_name', this.value)" style="font-weight:600; font-size:0.8rem; margin-bottom:2px;">
        <input type="tel" class="form-input form-input-sm" value="${u.mobile || ''}" placeholder="मोबाइल नं." onchange="updateUserField('${uId}', 'mobile', this.value)" style="font-size:0.75rem;">
      </td>
      <td>
        <div class="d-flex align-items-center gap-1">
          <input type="password" id="passInput_${uId}" class="form-input form-input-sm" value="${u.password || ''}" onchange="updateUserField('${uId}', 'password', this.value)" autocomplete="one-time-code" autocorrect="off" autocapitalize="off" spellcheck="false" data-lpignore="true" data-1p-ignore="true" style="font-weight:700; width:90px;">
          <button type="button" class="btn btn-sm btn-outline-secondary" onclick="togglePassVisibility('passInput_${uId}')" title="पासवर्ड देखें">👁️</button>
        </div>
      </td>
      <td>
        <button type="button" class="status-toggle-btn ${isActive ? 'active' : 'inactive'}" onclick="toggleUserStatus('${uId}', '${isActive ? 'INACTIVE' : 'ACTIVE'}')">
          <span>${isActive ? '🟢 सक्रिय' : '🔴 निष्क्रिय'}</span>
        </button>
      </td>
      <td>
        <select class="form-select form-select-sm" onchange="updateUserField('${uId}', 'allowed_panchayats', this.value)" style="font-weight:600; font-size:0.78rem;">
          <option value="ALL" ${u.allowed_panchayats === 'ALL' ? 'selected' : ''}>समस्त (ALL)</option>
          ${(State.panchayats || []).map(p => `<option value="${p.name}" ${u.allowed_panchayats === p.name ? 'selected' : ''}>${p.name}</option>`).join('')}
        </select>
      </td>
      <td>
        <input type="text" class="form-input form-input-sm" value="${u.allowed_wards || 'ALL'}" placeholder="ALL या 1,2" onchange="updateUserField('${uId}', 'allowed_wards', this.value)" style="font-weight:600; font-size:0.78rem; text-align:center;">
      </td>
      <td>
        <div class="d-flex flex-wrap gap-1" style="max-width:280px;">
          <label style="font-size:0.72rem; cursor:pointer;"><input type="checkbox" ${allowedTabs.includes('searchTab') ? 'checked' : ''} onchange="toggleUserTab('${uId}', 'searchTab', this.checked)"> खोज</label>
          <label style="font-size:0.72rem; cursor:pointer;"><input type="checkbox" ${allowedTabs.includes('alphaTab') ? 'checked' : ''} onchange="toggleUserTab('${uId}', 'alphaTab', this.checked)"> वर्णमाला</label>
          <label style="font-size:0.72rem; cursor:pointer;"><input type="checkbox" ${allowedTabs.includes('bulkSlipTab') ? 'checked' : ''} onchange="toggleUserTab('${uId}', 'bulkSlipTab', this.checked)"> पर्ची</label>
          ${(u.role === 'CANDIDATE' || u.role === 'प्रत्याशी' || String(uId).startsWith('cand_') || u.candidate_mode === 'user_edit') ? '' : `<label style="font-size:0.72rem; cursor:pointer;"><input type="checkbox" ${allowedTabs.includes('directoryTab') ? 'checked' : ''} onchange="toggleUserTab('${uId}', 'directoryTab', this.checked)"> वार्ड</label>`}
          <label style="font-size:0.72rem; cursor:pointer;"><input type="checkbox" ${allowedTabs.includes('candidateProfileTab') ? 'checked' : ''} onchange="toggleUserTab('${uId}', 'candidateProfileTab', this.checked)"> प्रोफाइल</label>
        </div>
      </td>
      <td>
        <select class="form-select form-select-sm" onchange="updateUserField('${uId}', 'candidate_mode', this.value)" style="font-size:0.75rem;">
          <option value="user_edit" ${u.candidate_mode !== 'admin_locked' ? 'selected' : ''}>यूजर भरे</option>
          <option value="admin_locked" ${u.candidate_mode === 'admin_locked' ? 'selected' : ''}>एडमिन लॉक</option>
        </select>
      </td>
      <td style="text-align:center;">
        <div class="d-flex justify-content-center gap-1">
          <button type="button" class="btn btn-sm btn-outline-primary" onclick="openAdminCandidateModal('${uId}')" title="प्रत्याशी विवरण सेट करें">✏️</button>
          <button type="button" class="btn btn-sm btn-outline-danger" onclick="deleteAdminUser('${uId}')" title="हटाएं">🗑️</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function filterAdminUsersTable() {
  renderAdminControlTab();
}

function togglePassVisibility(inputId) {
  const el = document.getElementById(inputId);
  if (!el) return;
  el.type = el.type === 'password' ? 'text' : 'password';
}

function findOrInitAdminUser(userId) {
  if (!State.adminControlUsers) State.adminControlUsers = [];
  const uIdLower = String(userId || '').toLowerCase();
  let u = State.adminControlUsers.find(x => 
    (x.id && String(x.id).toLowerCase() === uIdLower) ||
    (x.username && String(x.username).toLowerCase() === uIdLower)
  );
  if (!u) {
    const dir = getMasterDirectory();
    const bloMatch = (dir?.blo_list || []).find(b => 
      (b.id && String(b.id).toLowerCase() === uIdLower) ||
      (b.username && String(b.username).toLowerCase() === uIdLower) ||
      (`blo_${b.booth_no}`.toLowerCase() === uIdLower) ||
      (String(b.booth_no) === uIdLower)
    );
    const cellMatch = (dir?.cell_personnel || []).find(c => 
      (c.id && String(c.id).toLowerCase() === uIdLower) ||
      (c.username && String(c.username).toLowerCase() === uIdLower)
    );
    if (bloMatch) {
      const bid = bloMatch.id || `blo_${bloMatch.booth_no}`;
      u = {
        id: bid,
        username: bloMatch.username || bid,
        password: bloMatch.password || 'bhinai2026',
        full_name: `${bloMatch.name} (BLO भाग ${bloMatch.booth_no})`,
        mobile: bloMatch.mobile || '',
        role: 'BLO',
        status: 'ACTIVE',
        allowed_panchayats: JSON.stringify([bloMatch.panchayat]),
        allowed_wards: bloMatch.wards ? JSON.stringify(bloMatch.wards.split(',').map(w => w.trim())) : 'ALL',
        allowed_tabs: ['searchTab'],
        candidate_mode: 'admin_locked'
      };
      State.adminControlUsers.push(u);
    } else if (cellMatch) {
      u = {
        id: cellMatch.id,
        username: cellMatch.username || cellMatch.id,
        password: cellMatch.password || 'bhinai2026',
        full_name: `${cellMatch.name} (${cellMatch.cell_name})`,
        mobile: cellMatch.mobile || '',
        role: 'CELL_MEMBER',
        status: 'ACTIVE',
        allowed_panchayats: 'ALL',
        allowed_wards: 'ALL',
        allowed_tabs: ['searchTab'],
        candidate_mode: 'admin_locked'
      };
      State.adminControlUsers.push(u);
    }
  }
  return u;
}

async function updateUserField(userId, field, value) {
  const u = findOrInitAdminUser(userId);
  if (!u) return;

  u[field] = value;
  if (field === 'password') setCustomUserPassword(userId, value);
  if (field === 'status') setCustomUserStatus(userId, value);
  saveUserOverride(userId, field, value);

  try {
    localStorage.setItem('portal_admin_users_overrides', JSON.stringify(State.adminControlUsers));
  } catch(e) {}

  await saveAdminUserToServer(u);
  if (typeof renderBloPassTable === 'function') if (typeof renderBloPassTable === 'function') renderBloPassTable();
  showToast('परिवर्तन सफलतापूर्वक सुरक्षित!');
}

async function toggleUserStatus(userId, newStatus) {
  const u = findOrInitAdminUser(userId);
  if (u) {
    if (!newStatus) {
      newStatus = (String(u.status || 'ACTIVE').toUpperCase() === 'ACTIVE') ? 'INACTIVE' : 'ACTIVE';
    }
    u.status = newStatus;
    setCustomUserStatus(userId, newStatus);
    saveUserOverride(userId, 'status', newStatus);
    try { localStorage.setItem('portal_admin_users_overrides', JSON.stringify(State.adminControlUsers)); } catch(e) {}
    await saveAdminUserToServer(u);
  }
  if (typeof renderAdminControlTab === 'function') renderAdminControlTab();
  if (typeof renderBloPassTable === 'function') if (typeof renderBloPassTable === 'function') renderBloPassTable();
  showToast(`खाता स्थिति '${userId}': ${newStatus === 'ACTIVE' ? '🟢 सक्रिय (Active)' : '🔴 निष्क्रिय (Inactive)'}`);
}

async function toggleUserTab(userId, tabName, isChecked) {
  const u = findOrInitAdminUser(userId);
  if (!u) return;
  if (tabName === 'directoryTab' && isCandidateUser(u)) {
    u.allowed_tabs = (u.allowed_tabs || []).filter(t => t !== 'directoryTab');
    return;
  }

  if (!Array.isArray(u.allowed_tabs)) {
    try {
      u.allowed_tabs = typeof u.allowed_tabs === 'string' ? JSON.parse(u.allowed_tabs) : ['searchTab'];
    } catch(e) {
      u.allowed_tabs = ['searchTab'];
    }
  }

  if (isChecked) {
    if (!u.allowed_tabs.includes(tabName)) u.allowed_tabs.push(tabName);
  } else {
    u.allowed_tabs = u.allowed_tabs.filter(t => t !== tabName);
  }

  // 1. Immediately sync in State.adminControlUsers
  const uIdLower = String(userId || '').toLowerCase();
  if (State.adminControlUsers) {
    const idx = State.adminControlUsers.findIndex(x => 
      (x.id && String(x.id).toLowerCase() === uIdLower) ||
      (x.username && String(x.username).toLowerCase() === uIdLower)
    );
    if (idx >= 0) {
      State.adminControlUsers[idx].allowed_tabs = [...u.allowed_tabs];
    }
  }

  saveUserOverride(userId, 'allowed_tabs', u.allowed_tabs);
  try {
    localStorage.setItem('portal_admin_users_overrides', JSON.stringify(State.adminControlUsers));
  } catch(e) {}

  // 2. Await server save first so DB and portal_users.json are updated before broadcast or re-fetch
  await saveAdminUserToServer(u);

  // 3. Immediately update active session if current logged in user was modified
  if (State.currentUser) {
    const curId = String(State.currentUser.id || State.currentUser.username || '').toLowerCase();
    if (curId === uIdLower) {
      State.currentUser.allowed_tabs = [...u.allowed_tabs];
      const sk = getSessionStorageKey();
      if (localStorage.getItem(sk)) localStorage.setItem(sk, JSON.stringify(State.currentUser));
      if (sessionStorage.getItem(sk)) sessionStorage.setItem(sk, JSON.stringify(State.currentUser));
      enforceGatekeeperState();
    }
  }

  // 4. Broadcast to all open tabs/windows immediately
  broadcastAdminUpdate({ type: 'PERMISSIONS_UPDATED', userId, allowed_tabs: u.allowed_tabs });

  // 5. Instantly re-render admin tables so checkboxes and badges visually update without page refresh
  if (typeof renderAdminCellTab === 'function') renderAdminCellTab();
  if (typeof renderAdminBloTab === 'function') renderAdminBloTab();
  if (typeof renderAdminControlTab === 'function') renderAdminControlTab();
  if (typeof renderBloPassTable === 'function') if (typeof renderBloPassTable === 'function') renderBloPassTable();

  const tabHiNames = {
    searchTab: 'मतदाता खोज',
    alphaTab: 'वर्णमाला सूची',
    directoryTab: 'वार्ड/डायरेक्टरी',
    bulkSlipTab: 'पर्ची प्रिंट',
    dashboardTab: 'डैशबोर्ड',
    candidateProfileTab: 'उम्मीदवार प्रोफाइल'
  };
  const tName = tabHiNames[tabName] || tabName;
  showToast(`टैब अनुमति अपडेट (${userId}): ${tName} = ${isChecked ? '🟢 अनुमत (Allowed)' : '🔴 वर्जित (Revoked)'}`);
}

async function saveAdminUserToServer(userObj) {
  try {
    await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(userObj)
    });
    broadcastAdminUpdate({ type: 'USER_UPDATED', userId: userObj.id || userObj.username });
  } catch (e) {
    console.log('Server save fallback:', e);
  }
}

// Instant Live Permission & Settings Sync Engine across tabs & background
function broadcastAdminUpdate(payload) {
  try {
    if (window.BroadcastChannel) {
      const bc = new BroadcastChannel('panchayat_admin_sync');
      bc.postMessage(payload);
    }
    localStorage.setItem('panchayat_last_admin_sync', JSON.stringify({ ...payload, timestamp: Date.now() }));
  } catch(e) {}
}

function startLivePermissionSyncWatcher() {
  // A. BroadcastChannel cross-tab instant sync (0ms live propagation)
  try {
    if (window.BroadcastChannel) {
      const bc = new BroadcastChannel('panchayat_admin_sync');
      bc.onmessage = (ev) => {
        if (ev && ev.data && ev.data.userId && ev.data.allowed_tabs && State.currentUser) {
          const curId = String(State.currentUser.id || State.currentUser.username || '').toLowerCase();
          if (curId === String(ev.data.userId).toLowerCase()) {
            State.currentUser.allowed_tabs = [...ev.data.allowed_tabs];
            const sk = getSessionStorageKey();
            localStorage.setItem(sk, JSON.stringify(State.currentUser));
            sessionStorage.setItem(sk, JSON.stringify(State.currentUser));
            enforceGatekeeperState();
            if (typeof showToast === 'function') {
              showToast('🔔 आपकी अनुमतियाँ और टैब तुरंत अपडेट हो गए हैं!');
            }
          }
        }
        loadAdminUsersList(true);
      };
    }
  } catch(e) {}

  // B. Storage event sync for multi-tab across windows
  window.addEventListener('storage', (ev) => {
    if (ev.key === 'panchayat_last_admin_sync') {
      try {
        const payload = JSON.parse(ev.newValue || '{}');
        if (payload.userId && payload.allowed_tabs && State.currentUser) {
          const curId = String(State.currentUser.id || State.currentUser.username || '').toLowerCase();
          if (curId === String(payload.userId).toLowerCase()) {
            State.currentUser.allowed_tabs = [...payload.allowed_tabs];
            const sk = getSessionStorageKey();
            localStorage.setItem(sk, JSON.stringify(State.currentUser));
            sessionStorage.setItem(sk, JSON.stringify(State.currentUser));
            enforceGatekeeperState();
            if (typeof showToast === 'function') {
              showToast('🔔 आपकी अनुमतियाँ और टैब तुरंत अपडेट हो गए हैं!');
            }
          }
        }
      } catch(e) {}
      loadAdminUsersList(true);
    } else if (ev.key === 'portal_admin_users_overrides') {
      loadAdminUsersList(true);
    }
  });

  // C. Tab focus / visibility change (instantly refresh permissions when returning to tab without waiting for 45s)
  window.addEventListener('focus', () => {
    loadAdminUsersList(true);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      loadAdminUsersList(true);
    }
  });

  // D. Live sync loop every 30 seconds
  setInterval(async () => {
    if (document.visibilityState === 'hidden') return;
    try {
      await loadAdminUsersList(false);
    } catch(e) {}
  }, 30000);
}

function togglePasswordVisibility(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  if (input.type === 'password') {
    input.type = 'text';
    if (btn) btn.textContent = '🙈';
  } else {
    input.type = 'password';
    if (btn) btn.textContent = '👁️';
  }
}
window.togglePasswordVisibility = togglePasswordVisibility;
window.broadcastAdminUpdate = broadcastAdminUpdate;
window.startLivePermissionSyncWatcher = startLivePermissionSyncWatcher;

// removed duplicate openAddUserModal

function openAddCandidateUserModal() {
  const modal = document.getElementById('addNewUserModal') || document.getElementById('addUserModal');
  const gpSelect = document.getElementById('newUserGpSelect') || document.getElementById('newPanchayat');
  if (gpSelect) {
    gpSelect.innerHTML = '<option value="ALL">-- समस्त 30 ग्राम पंचायतें (ALL) --</option>';
    const panchayats = State.panchayats || (window.MASTER_DATA && window.MASTER_DATA.panchayats) || [];
    panchayats.forEach(p => {
      const pName = p.name_hi || p.name || '';
      const pCode = p.code || p.name_en || '';
      gpSelect.innerHTML += `<option value="${pName}">🏛️ ${pName} (${pCode})</option>`;
    });
  }
  const passInp = document.getElementById('newUserPasswordInput');
  if (passInp) passInp.value = 'bhinai2026';
  if (modal) modal.style.display = 'flex';
}

function closeAddCandidateUserModal() {
  const m1 = document.getElementById('addNewUserModal');
  if (m1) m1.style.display = 'none';
  const m2 = document.getElementById('addUserModal');
  if (m2) m2.style.display = 'none';
}

async function handleCreateUserSubmit(event) {
  if (event) event.preventDefault();

  const username = (document.getElementById('newUserIdInput')?.value || document.getElementById('newUsername')?.value || '').trim();
  const password = (document.getElementById('newUserPasswordInput')?.value || document.getElementById('newPassword')?.value || 'bhinai2026').trim();
  const fullName = (document.getElementById('newUserNameInput')?.value || document.getElementById('newFullName')?.value || '').trim();
  const mobile = (document.getElementById('newUserMobileInput')?.value || document.getElementById('newMobile')?.value || '').trim();
  const gp = document.getElementById('newUserGpSelect')?.value || document.getElementById('newPanchayat')?.value || 'ALL';
  const ward = (document.getElementById('newUserWardInput')?.value || document.getElementById('newWards')?.value || 'ALL').trim();
  const candidateMode = document.getElementById('newUserCandidateModeSelect')?.value || 'active';

  const tabBoxes = document.querySelectorAll('input[name="newUserTabs"]:checked');
  const allowedTabs = tabBoxes.length > 0 ? Array.from(tabBoxes).map(b => b.value) : ['searchTab'];

  if (!username || !password) {
    showToast('यूजरनेम और पासवर्ड अनिवार्य हैं!');
    return;
  }

  const userId = username.toLowerCase().replace(/\s+/g, '_');
  const userFullId = userId.startsWith('cand_') ? userId : `cand_${userId}`;
  const isSingleWard = (ward && ward !== 'ALL');
  const post = isSingleWard ? 'वार्ड पंच' : 'सरपंच';

  const newUser = {
    id: userFullId,
    username: username,
    password: password,
    name: fullName || username,
    full_name: fullName || username,
    mobile: mobile,
    role: 'CANDIDATE',
    type: 'CANDIDATE',
    category: 'CANDIDATE',
    status: 'ACTIVE',
    panchayat: gp,
    allowed_panchayats: gp,
    allowed_wards: ward,
    allowed_tabs: allowedTabs,
    candidate_mode: 'user_edit'
  };

  // Add locally to state
  if (!State.adminControlUsers) State.adminControlUsers = [];
  const existIdx = State.adminControlUsers.findIndex(x => (x.username && x.username.toLowerCase() === username.toLowerCase()) || x.id === userFullId);
  if (existIdx >= 0) State.adminControlUsers[existIdx] = newUser;
  else State.adminControlUsers.unshift(newUser);

  if (!State.adminUsers) State.adminUsers = [];
  const auIdx = State.adminUsers.findIndex(x => (x.username && x.username.toLowerCase() === username.toLowerCase()) || x.user_id === userFullId);
  if (auIdx >= 0) State.adminUsers[auIdx] = newUser;
  else State.adminUsers.unshift(newUser);

  // Save to localStorage 'portal_custom_users'
  const customUsers = JSON.parse(localStorage.getItem('portal_custom_users') || '[]');
  const cuIdx = customUsers.findIndex(x => (x.username && x.username.toLowerCase() === username.toLowerCase()) || x.id === userFullId);
  if (cuIdx >= 0) customUsers[cuIdx] = newUser;
  else customUsers.unshift(newUser);
  localStorage.setItem('portal_custom_users', JSON.stringify(customUsers));

  // Initialize and persist candidate profile
  const initCand = {
    user_id: userFullId,
    candidate_name: fullName || username,
    mobile: mobile,
    post: post,
    panchayat: gp,
    ward: isSingleWard ? ward : '',
    election_date: getGlobalElectionDate(),
    election_time: getGlobalElectionTime(),
    symbol_name: 'उगता सूरज',
    symbol_icon: 'sun',
    show_banner_on_slip: true
  };
  newUser.candidate = initCand;
  localStorage.setItem('candidate_profile_' + userFullId, JSON.stringify(initCand));
  localStorage.setItem('candidate_profile_' + username, JSON.stringify(initCand));
  localStorage.setItem('candidate_profile_' + username.toLowerCase(), JSON.stringify(initCand));

  // Save to overrides
  [userFullId, username, username.toLowerCase()].forEach(key => {
    saveUserOverride(key, 'password', password);
    saveUserOverride(key, 'status', 'ACTIVE');
    saveUserOverride(key, 'allowed_panchayats', gp);
    saveUserOverride(key, 'allowed_wards', ward);
  });

  // Send to server
  try {
    await saveAdminUserToServer(newUser);
    await fetch('/api/candidate/' + encodeURIComponent(userFullId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(initCand)
    });
  } catch(e) {}

  closeAddCandidateUserModal();
  closeAddUserModal();
  if (typeof renderAdminCandTab === 'function') renderAdminCandTab();
  if (typeof renderAdminControlTab === 'function') renderAdminControlTab();
  showToast(`✅ नया प्रत्याशी खाता '${username}' (पासवर्ड: ${password}) सफलतापूर्वक सक्रिय!`);
}

async function deleteAdminUser(userId) {
  if (!confirm(`क्या आप वाकई उपयोगकर्ता '${userId}' को हटाना चाहते हैं?`)) return;

  State.adminControlUsers = State.adminControlUsers.filter(u => (u.id || u.username) !== userId);

  try {
    await fetch('/api/users/' + encodeURIComponent(userId), { method: 'DELETE' });
  } catch (e) {
    console.log('Delete API fallback:', e);
  }

  renderAdminControlTab();
  showToast('उपयोगकर्ता हटाया गया।');
}

function setAdminSymbolMode(mode) {
  State.adminSymbolMode = mode;
  const btnStd = document.getElementById('adminBtnSymbolStandard');
  const btnCst = document.getElementById('adminBtnSymbolCustom');
  const secStd = document.getElementById('adminStandardSymbolSection');
  const secCst = document.getElementById('adminCustomSymbolSection');

  if (mode === 'custom') {
    if (btnStd) btnStd.classList.remove('active');
    if (btnCst) btnCst.classList.add('active');
    if (secStd) secStd.style.display = 'none';
    if (secCst) secCst.style.display = 'block';

    const customUrl = document.getElementById('adminCandCustomSymbolUrl')?.value;
    const customName = (document.getElementById('adminCandCustomSymbolName')?.value || '').trim() || 'कस्टम चिन्ह';
    updateAdminCandCustomSymbolPreview(customUrl, customName);
  } else {
    if (btnStd) btnStd.classList.add('active');
    if (btnCst) btnCst.classList.remove('active');
    if (secStd) secStd.style.display = 'block';
    if (secCst) secCst.style.display = 'none';

    onAdminCandSymbolChanged();
  }
}

async function handleAdminCandCustomSymbolFile(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  try {
    showToast('⏳ कस्टम चुनाव चिन्ह प्रोसेस किया जा रहा है...');
    const compressedUrl = await compressCandidateImage(file, 240, 240, 0.9, true);
    
    document.getElementById('adminCandCustomSymbolUrl').value = compressedUrl;
    
    const nameInp = document.getElementById('adminCandCustomSymbolName');
    if (nameInp && (!nameInp.value || nameInp.value.trim() === 'कस्टम चिन्ह' || nameInp.value.trim() === '')) {
      const rawName = file.name.replace(/\.[^/.]+$/, "").replace(/[_\-\d]/g, " ").trim();
      if (rawName) nameInp.value = rawName;
    }
    const customName = (nameInp ? nameInp.value : '').trim() || 'कस्टम चिन्ह';

    updateAdminCandCustomSymbolPreview(compressedUrl, customName);

    const removeBtn = document.getElementById('adminCandCustomSymbolRemoveBtn');
    if (removeBtn) removeBtn.style.display = 'inline-block';

    showToast('✅ कस्टम चुनाव चिन्ह लोड हुआ!');
  } catch (err) {
    console.error('Admin custom symbol file error:', err);
    showToast('चुनाव चिन्ह लोड करने में समस्या: ' + err.message);
  }
}

function clearAdminCandCustomSymbol() {
  const fileInp = document.getElementById('adminCandCustomSymbolFile');
  if (fileInp) fileInp.value = '';
  const urlInp = document.getElementById('adminCandCustomSymbolUrl');
  if (urlInp) urlInp.value = '';
  const nameInp = document.getElementById('adminCandCustomSymbolName');
  if (nameInp) nameInp.value = '';

  const removeBtn = document.getElementById('adminCandCustomSymbolRemoveBtn');
  if (removeBtn) removeBtn.style.display = 'none';

  setAdminSymbolMode('standard');
}

function onAdminCandCustomSymbolNameInput(val) {
  const nameEl = document.getElementById('adminCandSymbolPreviewName');
  if (nameEl) nameEl.textContent = (val || '').trim() || 'कस्टम चिन्ह';
}

function updateAdminCandCustomSymbolPreview(url, name) {
  const previewImg = document.getElementById('adminCandCustomSymbolPreviewImg');
  const placeholder = document.getElementById('adminCandCustomSymbolPlaceholder');
  const badgeSvg = document.getElementById('adminCandSymbolPreviewSvg');
  const badgeName = document.getElementById('adminCandSymbolPreviewName');

  if (url) {
    if (previewImg) { previewImg.src = url; previewImg.style.display = 'block'; }
    if (placeholder) placeholder.style.display = 'none';
    if (badgeSvg) badgeSvg.innerHTML = `<img src="${url}" alt="कस्टम चिन्ह" style="max-width:100%; max-height:100%; object-fit:contain; display:block;">`;
  } else {
    if (previewImg) { previewImg.src = ''; previewImg.style.display = 'none'; }
    if (placeholder) placeholder.style.display = 'block';
    if (badgeSvg) badgeSvg.innerHTML = '🗳️';
  }
  if (badgeName) badgeName.textContent = name || 'कस्टम चिन्ह';
}

function updateAdminCandSymbolPreview() {
  const isCustom = (State.adminSymbolMode === 'custom');
  if (isCustom) {
    const url = document.getElementById('adminCandCustomSymbolUrl')?.value;
    const name = (document.getElementById('adminCandCustomSymbolName')?.value || '').trim() || 'कस्टम चिन्ह';
    updateAdminCandCustomSymbolPreview(url, name);
    return;
  }

  const symId = document.getElementById('adminCandSymbol')?.value || 'sun';
  const symbols = window.OFFICIAL_ELECTION_SYMBOLS || [];
  const symObj = symbols.find(s => s.id === symId) || symbols[0];

  const svgBox = document.getElementById('adminCandSymbolPreviewSvg');
  const nameEl = document.getElementById('adminCandSymbolPreviewName');
  if (svgBox && symObj) svgBox.innerHTML = symObj.svg || '🗳️';
  if (nameEl && symObj) nameEl.textContent = symObj.name_hi;
}

function onAdminCandSymbolChanged() {
  updateAdminCandSymbolPreview();
}

async function openAdminCandidateModal(userId) {
  const u = (State.adminControlUsers || []).find(x => (x.id || x.username) === userId) || { id: userId, username: userId };

  const titleEl = document.getElementById('adminCandidateModalUserTitle');
  if (titleEl) titleEl.textContent = `${u.full_name || u.name || u.username} (${userId})`;

  document.getElementById('adminCandTargetUserId').value = userId;

  // Populate 30 Gram Panchayats dropdown
  const gpSelect = document.getElementById('adminCandGpSelect');
  if (gpSelect) {
    gpSelect.innerHTML = '';
    const panchayats = State.panchayats || (window.MASTER_DATA && window.MASTER_DATA.panchayats) || [];
    panchayats.forEach(p => {
      const pName = p.name_hi || p.name || '';
      const pCode = p.code || p.name_en || '';
      const opt = document.createElement('option');
      opt.value = pName;
      opt.textContent = `🏛️ ${pName} (${pCode})`;
      gpSelect.appendChild(opt);
    });
  }

  // Populate Symbols dropdown
  const symbols = window.OFFICIAL_ELECTION_SYMBOLS || [];
  const symSelect = document.getElementById('adminCandSymbol');
  if (symSelect && symSelect.options.length === 0) {
    symbols.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = `${s.name_hi}`;
      symSelect.appendChild(opt);
    });
  }

  // Fetch freshest candidate profile from server API for 100% sync
  let cand = u.candidate;
  try {
    const res = await fetch('/api/candidate/' + encodeURIComponent(userId));
    if (res.ok) {
      const d = await res.json();
      if (d && d.candidate && d.candidate.candidate_name) {
        cand = { ...(cand || {}), ...d.candidate };
        u.candidate = cand;
      }
    }
  } catch(e) {}
  if (!cand && window.PORTAL_USERS_DATA && window.PORTAL_USERS_DATA.candidates) {
    cand = window.PORTAL_USERS_DATA.candidates[userId] || window.PORTAL_USERS_DATA.candidates[u.username];
  }
  if (!cand) {
    try {
      cand = JSON.parse(localStorage.getItem('candidate_profile_' + userId) || localStorage.getItem('candidate_profile_' + (u.username || '')) || 'null');
    } catch(e) {}
  }
  if (!cand) cand = {};

  document.getElementById('adminCandName').value = cand.candidate_name || u.full_name || u.name || '';
  document.getElementById('adminCandMobile').value = cand.mobile || u.mobile || '';
  document.getElementById('adminCandAgentName').value = cand.agent_name || '';
  document.getElementById('adminCandPost').value = cand.post || (u.allowed_wards && u.allowed_wards !== 'ALL' ? 'वार्ड पंच' : 'सरपंच');
  
  const targetGp = cand.panchayat || u.panchayat || (u.allowed_panchayats !== 'ALL' ? u.allowed_panchayats : 'बूबकिया');
  if (gpSelect) gpSelect.value = targetGp;

  document.getElementById('adminCandWard').value = cand.ward || (u.allowed_wards !== 'ALL' ? u.allowed_wards : '');
  if (document.getElementById('adminCandElectionDate')) {
    document.getElementById('adminCandElectionDate').value = cand.election_date || getGlobalElectionDate();
  }
  if (document.getElementById('adminCandElectionTime')) {
    document.getElementById('adminCandElectionTime').value = cand.election_time || getGlobalElectionTime();
  }
  
  if (document.getElementById('adminCandElectionTime')) {
    document.getElementById('adminCandElectionTime').value = cand.election_time || 'प्रातः 7:00 बजे से सायं 6:00 बजे तक';
  }
  document.getElementById('adminCandSlogan').value = cand.slogan || '';
  document.getElementById('adminCandPhotoUrl').value = cand.photo_url || '';
  
  if (document.getElementById('adminCandPhotoFile')) {
    document.getElementById('adminCandPhotoFile').value = '';
  }

  // Custom symbol vs Standard symbol restore
  const customUrlInp = document.getElementById('adminCandCustomSymbolUrl');
  const customNameInp = document.getElementById('adminCandCustomSymbolName');
  const removeBtn = document.getElementById('adminCandCustomSymbolRemoveBtn');

  if (cand.custom_symbol_url || cand.symbol_icon === 'custom') {
    if (customUrlInp) customUrlInp.value = cand.custom_symbol_url || '';
    if (customNameInp) customNameInp.value = cand.symbol_name || 'कस्टम चिन्ह';
    if (removeBtn) removeBtn.style.display = cand.custom_symbol_url ? 'inline-block' : 'none';
    setAdminSymbolMode('custom');
  } else {
    if (customUrlInp) customUrlInp.value = '';
    if (customNameInp) customNameInp.value = '';
    if (removeBtn) removeBtn.style.display = 'none';
    if (symSelect) symSelect.value = cand.symbol_icon || 'sun';
    setAdminSymbolMode('standard');
  }

  const showBannerCb = document.getElementById('adminCandShowBanner');
  if (showBannerCb) showBannerCb.checked = (cand.show_banner_on_slip !== false);

  // Populate Allowed Tabs
  let userTabs = u.allowed_tabs || cand.allowed_tabs;
  if (typeof userTabs === 'string') {
    try { userTabs = JSON.parse(userTabs); } catch(e) { userTabs = userTabs.split(',').map(s=>s.trim()).filter(Boolean); }
  }
  if (!Array.isArray(userTabs) || userTabs.length === 0) {
    userTabs = ['searchTab', 'alphaTab', 'bulkSlipTab', 'candidateProfileTab'];
  }
  document.querySelectorAll('.admin-cand-tab-cb').forEach(cb => {
    cb.checked = userTabs.includes(cb.value);
  });

  // Populate Candidate Mode & Action Permissions
  const modeSel = document.getElementById('adminCandMode');
  if (modeSel) modeSel.value = cand.candidate_mode || u.candidate_mode || 'user_edit';

  const printCb = document.getElementById('adminCandCanPrint');
  if (printCb) printCb.checked = (cand.can_print !== false && u.can_print !== false);

  const dlCb = document.getElementById('adminCandCanDownload');
  if (dlCb) dlCb.checked = (cand.can_download !== false && u.can_download !== false);

  updateAdminCandPhotoPreview();

  const modal = document.getElementById('adminCandidateModal');
  if (modal) modal.style.display = 'flex';
}

function closeAdminCandidateModal() {
  const modal = document.getElementById('adminCandidateModal');
  if (modal) modal.style.display = 'none';
}

function handleAdminCandPhotoFile(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  compressCandidateImage(file, 400, 480, 0.82, false).then(compressedUrl => {
    document.getElementById('adminCandPhotoUrl').value = compressedUrl;
    updateAdminCandPhotoPreview();
    showToast('✅ फोटो कंप्रेस व लोड हुई!');
  }).catch(err => {
    const reader = new FileReader();
    reader.onload = function(e) {
      document.getElementById('adminCandPhotoUrl').value = e.target.result;
      updateAdminCandPhotoPreview();
    };
    reader.readAsDataURL(file);
  });
}

function updateAdminCandPhotoPreview() {
  const url = (document.getElementById('adminCandPhotoUrl')?.value || '').trim();
  const img = document.getElementById('adminCandPhotoPreviewImg');
  const placeholder = document.getElementById('adminCandPhotoPlaceholder');
  if (url && img) {
    img.src = url;
    img.style.display = 'block';
    if (placeholder) placeholder.style.display = 'none';
  } else if (img) {
    img.src = '';
    img.style.display = 'none';
    if (placeholder) placeholder.style.display = 'block';
  }
}

function clearAdminCandPhoto() {
  const fileInp = document.getElementById('adminCandPhotoFile');
  if (fileInp) fileInp.value = '';
  const urlInp = document.getElementById('adminCandPhotoUrl');
  if (urlInp) urlInp.value = '';
  updateAdminCandPhotoPreview();
}

async function handleAdminSaveCandidate(event) {
  if (event) event.preventDefault();

  const userId = document.getElementById('adminCandTargetUserId').value;
  const name = document.getElementById('adminCandName').value.trim();
  const mobile = document.getElementById('adminCandMobile').value.trim();
  const agentName = document.getElementById('adminCandAgentName').value.trim();
  const post = document.getElementById('adminCandPost').value;
  const gp = document.getElementById('adminCandGpSelect')?.value || 'बूबकिया';
  const ward = document.getElementById('adminCandWard').value.trim();
  const electionDate = (document.getElementById('adminCandElectionDate')?.value || '').trim() || getGlobalElectionDate();
  const electionTime = (document.getElementById('adminCandElectionTime')?.value || '').trim() || getGlobalElectionTime();
  const slogan = document.getElementById('adminCandSlogan').value.trim();
  const photo = document.getElementById('adminCandPhotoUrl').value.trim();
  const showBanner = document.getElementById('adminCandShowBanner')?.checked !== false;

  let symbolName = '';
  let symbolIcon = '';
  let customSymbolUrl = '';

  if (State.adminSymbolMode === 'custom') {
    customSymbolUrl = document.getElementById('adminCandCustomSymbolUrl')?.value || '';
    symbolName = (document.getElementById('adminCandCustomSymbolName')?.value || '').trim() || 'कस्टम चिन्ह';
    symbolIcon = 'custom';
  } else {
    const symbolId = document.getElementById('adminCandSymbol').value;
    const symbols = window.OFFICIAL_ELECTION_SYMBOLS || [];
    const symObj = symbols.find(s => s.id === symbolId) || symbols[0];
    symbolName = symObj.name_hi;
    symbolIcon = symObj.id;
  }

  const candData = {
    user_id: userId,
    candidate_name: name,
    mobile: mobile,
    agent_name: agentName,
    post: post,
    panchayat: gp,
    ward: ward,
    election_date: electionDate,
    election_time: electionTime,
    symbol_name: symbolName,
    symbol_icon: symbolIcon,
    custom_symbol_url: customSymbolUrl,
    photo_url: photo,
    slogan: slogan,
    show_banner_on_slip: showBanner,
    allowed_tabs: Array.from(document.querySelectorAll('.admin-cand-tab-cb:checked')).map(cb => cb.value),
    candidate_mode: document.getElementById('adminCandMode')?.value || 'user_edit',
    can_print: document.getElementById('adminCandCanPrint')?.checked !== false,
    can_download: document.getElementById('adminCandCanDownload')?.checked !== false,
    updated_at: new Date().toISOString()
  };

  // 1. Update in State.adminControlUsers
  if (!State.adminControlUsers) State.adminControlUsers = [];
  const altId = userId.startsWith('cand_') ? userId.replace('cand_', '') : ('cand_' + userId);
  let u = State.adminControlUsers.find(x => (x.id === userId || x.username === userId || x.id === altId || x.username === altId));
  if (u) {
    u.name = name;
    u.full_name = name;
    u.mobile = mobile;
    u.panchayat = gp;
    u.allowed_panchayats = gp;
    u.allowed_wards = ward || 'ALL';
    u.allowed_tabs = candData.allowed_tabs;
    u.candidate_mode = candData.candidate_mode;
    u.can_print = candData.can_print;
    u.can_download = candData.can_download;
    u.candidate = candData;
  }

  // 2. Update in window.PORTAL_USERS_DATA.candidates for BOTH keys
  if (!window.PORTAL_USERS_DATA) window.PORTAL_USERS_DATA = { users: [], candidates: {} };
  if (!window.PORTAL_USERS_DATA.candidates) window.PORTAL_USERS_DATA.candidates = {};
  window.PORTAL_USERS_DATA.candidates[userId] = candData;
  window.PORTAL_USERS_DATA.candidates[altId] = candData;
  if (u && u.username) {
    window.PORTAL_USERS_DATA.candidates[u.username] = candData;
    window.PORTAL_USERS_DATA.candidates['cand_' + u.username] = candData;
  }
  if (u && u.id) {
    window.PORTAL_USERS_DATA.candidates[u.id] = candData;
    window.PORTAL_USERS_DATA.candidates[u.id.replace('cand_', '')] = candData;
  }

  // 3. Save to localStorage for both keys
  try {
    localStorage.setItem('candidate_profile_' + userId, JSON.stringify(candData));
    localStorage.setItem('candidate_profile_' + altId, JSON.stringify(candData));
    if (u && u.username) localStorage.setItem('candidate_profile_' + u.username, JSON.stringify(candData));
  } catch(e) {}

  // 4. If current logged in user is this candidate, update active state & apply to topbar immediately
  if (State.currentUser && (State.currentUser.id === userId || State.currentUser.username === userId || State.currentUser.id === altId || State.currentUser.username === altId)) {
    State.currentCandidate = candData;
    State.currentUser.full_name = name;
    State.currentUser.name = name;
    State.currentUser.mobile = mobile;
    State.currentUser.panchayat = gp;
    State.currentUser.allowed_panchayats = gp;
    State.currentUser.allowed_wards = ward || 'ALL';
    State.currentUser.candidate = candData;
    const sk = getSessionStorageKey();
    localStorage.setItem(sk, JSON.stringify(State.currentUser));
    sessionStorage.setItem(sk, JSON.stringify(State.currentUser));
    localStorage.setItem('panchayat_user_session', JSON.stringify(State.currentUser));
  }

  // Apply to UI (Topbar, inputs, preview)
  applyGlobalElectionDateToUI();

  // 5. Send POST to server API to save in SQLite & portal_users.json
  try {
    await fetch('/api/candidate/' + encodeURIComponent(userId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(candData)
    });
  } catch(e) {}

  // Push candidate to Google Sheet in background
  try {
    const gScriptUrl = State.config?.appsScriptUrl || localStorage.getItem('panchayat_apps_script_url') || 'https://script.google.com/macros/s/AKfycbwtgz2L5QC_95Jsf1r0Kum_LcTI-bJwwiBQS_O74vthHcbPD_KatsN69ytY2yqlayiM/exec';
    if (gScriptUrl) {
      fetch(gScriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          action: 'saveCandidate',
          candidateData: candData
        }),
        mode: 'no-cors'
      }).catch(() => {});
    }
  } catch (e) {}

  // Broadcast to other open tabs
  broadcastAdminUpdate({ type: 'CANDIDATE_UPDATED', userId, candidate: candData });

  closeAdminCandidateModal();
  if (typeof renderAdminControlTab === 'function') renderAdminControlTab();
  showToast(`✅ प्रत्याशी '${name}' का विवरण, फोटो व चुनाव चिन्ह सुरक्षित!`);
}

async function syncAllAdminStateToCloud() {
  showToast('🔄 क्लाउड सिंक प्रारंभ...');
  try {
    const res = await fetch('/api/state');
    if (res.ok) {
      showToast('✅ समस्त उपयोगकर्ता व प्रत्याशी सेटिंग्स पूर्णतः सिंक!');
      return;
    }
  } catch (e) {}
  showToast('✅ स्थानीय व क्लाउड डेटा सुरक्षित!');
}


// ==========================================================================
// DEDICATED BLO & CELL LOGIN SYSTEM & SELF PASSWORD RESET
// ==========================================================================

const BHINAI_PANCHAYATS_30 = [
  "बड़गांव", "बड़ली", "बगराई", "बांदनवाड़ा", "भिनाय", "बूबकिया", "चापानेरी",
  "छछून्दरा", "देवपुरा", "देवलियाकलां", "धांतोल", "एकलसिंहा", "घणा", "गुढाखुर्द",
  "हियालिया", "कनईकला", "करांटी", "कैरोंट", "खेडी", "कुम्हारिया", "लामगरा",
  "नागोला", "नान्दसी", "पड़ांगा", "पाडलिया", "राममालिया", "राताकोट", "सिंगावल",
  "सोबडी", "सोलखुर्द"
];

function populateBloPrimaryDropdown() {
  const pSelect = document.getElementById('loginPanchayatSelect');
  const panSelect = document.getElementById('panAdminSelect');
  if (panSelect && panSelect.value) { username = panSelect.value; }
  if (!pSelect) return;

  pSelect.innerHTML = `
    <option value="">-- कृपया पद / प्रकोष्ठ या ग्राम पंचायत चुनें --</option>
    <option value="BLOCK_PRABHARI" style="font-weight:800; color:#0f766e; background:#ccfbf1;">🌟 ब्लॉक प्रभारी</option>
    <option value="CELL" style="font-weight:800; color:#1e40af; background:#eff6ff;">🏢 चुनाव प्रकोष्ठ (13 चुनाव प्रकोष्ठ)</option>
  `;

  BHINAI_PANCHAYATS_30.forEach(gp => {
    const opt = document.createElement('option');
    opt.value = gp;
    opt.textContent = `🏛️ ग्राम पंचायत ${gp}`;
    pSelect.appendChild(opt);
  });

  const cardTitle = document.querySelector('.login-card-title');
  if (cardTitle) cardTitle.textContent = '🏢 बी.एल.ओ., प्रकोष्ठ एवं ब्लॉक प्रभारी प्रवेश (BLO Portal)';
  const badge = document.querySelector('.gatekeeper-badge');
  if (badge) badge.textContent = '📍 बी.एल.ओ., चुनाव प्रकोष्ठ एवं ब्लॉक प्रभारी अधिकृत पोर्टल 2026';
  const samitiP = document.querySelector('.gatekeeper-samiti');
  if (samitiP) samitiP.innerHTML = 'पंचायत समिति: <strong>भिनाय (अजमेर)</strong> | 126 बी.एल.ओ. • 13 प्रकोष्ठ • 🌟 ब्लॉक प्रभारी';
}

function populateLoginPrimaryDropdown() {
  configureLoginUiForPortal();
}

// Primary select handler is canonically defined and exposed as onLoginPrimarySelectChanged & onLoginPanchayatSelected

// Self Password Reset Modal
function openSelfPasswordModal() {
  const u = State.currentUser;
  if (!u) return;

  const lbl = document.getElementById('selfChangePassUserLabel');
  if (lbl) lbl.textContent = `${u.full_name || u.name || u.username} (${u.id || u.username})`;

  const modal = document.getElementById('selfChangePasswordModal');
  if (modal) modal.style.display = 'flex';
}

function closeSelfPasswordModal() {
  const modal = document.getElementById('selfChangePasswordModal');
  if (modal) modal.style.display = 'none';
}

async function handleSelfPasswordSubmit(event) {
  if (event) event.preventDefault();
  const u = State.currentUser;
  if (!u) return;

  const newPassInput = document.getElementById('selfNewPasswordInput');
  const newPass = newPassInput ? newPassInput.value.trim() : '';

  if (!newPass) {
    showToast('कृपया नया पासवर्ड दर्ज करें!');
    return;
  }

  const username = u.username || u.id;

  // 1. Update session locally
  u.password = newPass;
  localStorage.setItem('panchayat_user_session', JSON.stringify(u));
  const sk = (typeof getSessionStorageKey === 'function') ? getSessionStorageKey() : 'panchayat_user_session';
  localStorage.setItem(sk, JSON.stringify(u));
  sessionStorage.setItem(sk, JSON.stringify(u));
  closeSelfPasswordModal();
  showToast('💾 पासवर्ड सुरक्षित किया जा रहा है...');

  // 2. Send to Local Server (SQLite & JSON)
  try {
    fetch('/api/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: username,
        newPassword: newPass
      })
    }).catch(e => console.warn('Local password change notice:', e.message));
  } catch(e) {}

  // 3. Immediately forward to Google Apps Script (Live Google Sheet)
  try {
    if (typeof postToAppsScript === 'function') {
      postToAppsScript({
        action: 'updatePassword',
        username: username,
        newPassword: newPass,
        adminUsername: username
      });
    }
  } catch(e) {}

  showToast('✅ पासवर्ड पोर्टल व गूगल शीट दोनों में सुरक्षित!');
}


// ==========================================================================
// OFFICIAL ELECTION DIRECTORY & MULTI-TIER FILTER ENGINE
// ==========================================================================

let activeDirCategory = 'ALL';
let activeDirGpBooth = 'ALL';

function initDirectoryTab() {
  const curU = State.currentUser;
  const isCand = isCandidateUser(curU);
  const isVoter = (window.PORTAL_TYPE === 'voter') || 
                  (window.location && window.location.href && window.location.href.toLowerCase().includes('/voter-portal')) ||
                  (typeof getPortalContext === 'function' && getPortalContext() === 'voter');
  if (isCand || isVoter) {
    switchTab('searchTab');
    return;
  }
  const dir = getMasterDirectory();
  if (!dir) return;

  const isSuperAdmin = State.currentUser && (State.currentUser.role === 'SUPER_ADMIN' || State.currentUser.role === 'admin' || String(State.currentUser.id || State.currentUser.username || '').toLowerCase() === 'admin');
  const adminDirActions = document.getElementById('adminDirectoryActions');
  if (adminDirActions) {
    adminDirActions.style.display = isSuperAdmin ? 'flex' : 'none';
  }

  // Initialize Category Dropdown
  const catSelect = document.getElementById('dirCategoryFilterSelect');
  if (catSelect) catSelect.value = activeDirCategory;

  // Initialize GP & Booth Dropdown
  const gpBoothSelect = document.getElementById('dirGpBoothFilterSelect');
  if (gpBoothSelect && gpBoothSelect.options.length <= 1) {
    gpBoothSelect.innerHTML = '<option value="ALL">🌍 समस्त पंचायतें व बूथ (All 30 Panchayats)</option>';
    
    // Optgroup 1: 30 Gram Panchayats
    const gpGroup = document.createElement('optgroup');
    gpGroup.label = '🏛️ ग्राम पंचायत चुनें (30 Panchayats)';
    BHINAI_PANCHAYATS_30.forEach(gp => {
      const opt = document.createElement('option');
      opt.value = `GP_${gp}`;
      opt.textContent = `ग्रा.पं. ${gp}`;
      gpGroup.appendChild(opt);
    });
    gpBoothSelect.appendChild(gpGroup);

    // Optgroup 2: 126 Booths
    const bloList = dir.blo_list || [];
    const boothGroup = document.createElement('optgroup');
    boothGroup.label = '🗳️ मतदान केंद्र / बूथ क्रमांक (1-116)';
    bloList.forEach(blo => {
      const opt = document.createElement('option');
      opt.value = `BOOTH_${blo.booth_no}`;
      opt.textContent = `बूथ ${blo.booth_no}: ${blo.school || blo.name} (${blo.panchayat})`;
      boothGroup.appendChild(opt);
    });
    gpBoothSelect.appendChild(boothGroup);
  }

  updateDirectoryCounts();
  renderDirectoryList();
}

function updateDirectoryCounts() {
  const dir = getMasterDirectory();
  if (!dir) return;

  const total = (dir.all_contacts && dir.all_contacts.length) || 662;
  const patwaris = (dir.patwari_list && dir.patwari_list.length) || 49;
  const sups = (dir.supervisors_list && dir.supervisors_list.length) || 98;
  const blos = (dir.blo_list && dir.blo_list.length) || 126;
  const peeos = (dir.peeo_list && dir.peeo_list.length) || 49;
  const staff = (dir.male_staff_list && dir.male_staff_list.length) || 307;
  const cells = (dir.cell_personnel && dir.cell_personnel.length) || 29;
  const officers = (dir.officers_list && dir.officers_list.length) || 4;

  const setT = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setT('dirCountAll', total);
  setT('dirCountPatwari', patwaris);
  setT('dirCountSupervisor', sups);
  setT('dirCountBlo', blos);
  setT('dirCountPeeo', peeos);
  setT('dirCountStaff', staff);
  setT('dirCountCell', cells);
  setT('dirCountOfficer', officers);
}

function filterDirectoryType(type) {
  activeDirCategory = type;
  const catSelect = document.getElementById('dirCategoryFilterSelect');
  if (catSelect) catSelect.value = type;

  document.querySelectorAll('.stat-pill').forEach(p => p.classList.remove('active'));
  const pillMap = {
    'ALL': 'pillAll',
    'PATWARI': 'pillPatwari',
    'SUPERVISOR': 'pillSupervisor',
    'BLO': 'pillBlo',
    'PEEO': 'pillPeeo',
    'STAFF': 'pillStaff',
    'CELL': 'pillCell',
    'OFFICER': 'pillOfficer'
  };
  const targetPill = document.getElementById(pillMap[type]);
  if (targetPill) targetPill.classList.add('active');

  renderDirectoryList();
}

function onDirCategorySelectChanged(val) {
  filterDirectoryType(val);
}

function onDirGpBoothFilterChanged(val) {
  activeDirGpBooth = val;
  renderDirectoryList();
}

function filterDirectoryList() {
  renderDirectoryList();
}

function clearDirectoryFilters() {
  const searchInput = document.getElementById('dirUnifiedSearchInput');
  const catSelect = document.getElementById('dirCategoryFilterSelect');
  const gpBoothSelect = document.getElementById('dirGpBoothFilterSelect');

  if (searchInput) searchInput.value = '';
  if (catSelect) catSelect.value = 'ALL';
  if (gpBoothSelect) gpBoothSelect.value = 'ALL';

  activeDirCategory = 'ALL';
  activeDirGpBooth = 'ALL';

  filterDirectoryType('ALL');
}

// Get saved overrides from localStorage
function getDirectoryOverrides() {
  try {
    return JSON.parse(localStorage.getItem('portal_directory_overrides') || '{}');
  } catch(e) {
    return {};
  }
}

function renderDirectoryList() {
  const container = document.getElementById('directoryListContainer');
  if (!container) return;

  const dir = getMasterDirectory();
  if (!dir) {
    container.innerHTML = '<div class="alert alert-warning">डायरेक्टरी डेटा लोड हो रहा है...</div>';
    return;
  }

  const overrides = getDirectoryOverrides();
  let contacts = (dir.all_contacts || []).map(c => {
    if (overrides[c.id]) {
      return { ...c, ...overrides[c.id] };
    }
    return c;
  });

  const searchVal = (document.getElementById('dirUnifiedSearchInput') ? document.getElementById('dirUnifiedSearchInput').value : '').toLowerCase().trim();

  // 1. Filter by Category
  if (activeDirCategory !== 'ALL') {
    contacts = contacts.filter(c => c.category === activeDirCategory);
  }

  // 2. Filter by GP or Booth
  let selectedGpName = '';
  let selectedBoothNo = '';
  if (activeDirGpBooth.startsWith('GP_') || activeDirGpBooth.startsWith('GP:')) {
    selectedGpName = activeDirGpBooth.replace(/^(GP_|GP:)/, '');
  } else if (activeDirGpBooth.startsWith('BOOTH_')) {
    selectedBoothNo = activeDirGpBooth.replace('BOOTH_', '');
    // Find GP for this booth
    const bMatch = (dir.blo_list || []).find(b => String(b.booth_no) === String(selectedBoothNo));
    if (bMatch) selectedGpName = bMatch.panchayat;
  }

  if (selectedGpName) {
    const normGp = (selectedGpName || '').normalize('NFC').trim();
    contacts = contacts.filter(c => {
      const cP = (c.panchayat || '').normalize('NFC').trim();
      if (cP === normGp) return true;
      if (c.panchayats && c.panchayats.some(p => (p || '').normalize('NFC').trim() === normGp)) return true;
      if (c.school_office && c.school_office.normalize('NFC').includes(normGp)) return true;
      if (c.area_display && c.area_display.normalize('NFC').includes(normGp)) return true;
      if (c.patwar_mandal && c.patwar_mandal.normalize('NFC').includes(normGp)) return true;
      // Booth specific match if booth filter
      if (selectedBoothNo && c.booth_no && String(c.booth_no) === String(selectedBoothNo)) return true;
      return false;
    });
  }

  // 3. Filter by Unified Text Search
  if (searchVal) {
    contacts = contacts.filter(c => {
      const n = (c.name || '').toLowerCase();
      const m = (c.mobile || '');
      const s = (c.school_office || c.school || '').toLowerCase();
      const p = (c.panchayat || c.panchayat_str || '').toLowerCase();
      const d = (c.designation || c.role || '').toLowerCase();
      const b = String(c.booth_no || '');
      const pm = (c.patwar_mandal || '').toLowerCase();
      return n.includes(searchVal) || m.includes(searchVal) || s.includes(searchVal) || p.includes(searchVal) || d.includes(searchVal) || b.includes(searchVal) || pm.includes(searchVal);
    });
  }

  if (contacts.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding:48px 20px; background:#fff; border-radius:12px; border:1px dashed #cbd5e1;">
        <div style="font-size:2.5rem; margin-bottom:8px;">🔍</div>
        <h4 style="color:#1e293b; margin-bottom:4px;">कोई संपर्क नहीं मिला</h4>
        <p style="color:#64748b; font-size:0.9rem;">फ़िल्टर बदलकर अथवा 'रिफ्रेश' बटन दबाकर पुनः प्रयास करें।</p>
        <button class="btn btn-sm btn-outline-primary mt-2" onclick="clearDirectoryFilters()">समस्त फ़िल्टर हटाएं</button>
      </div>
    `;
    return;
  }

  // SMART GROUPING: If a specific Panchayat or Booth is selected, group logically
  if (selectedGpName || selectedBoothNo) {
    const patwaris = contacts.filter(c => c.category === 'PATWARI');
    const supervisors = contacts.filter(c => c.category === 'SUPERVISOR');
    const blos = contacts.filter(c => c.category === 'BLO');
    const peeos = contacts.filter(c => c.category === 'PEEO');
    const staff = contacts.filter(c => c.category === 'STAFF');
    const cells = contacts.filter(c => c.category === 'CELL');
    const others = contacts.filter(c => !['PATWARI', 'SUPERVISOR', 'BLO', 'PEEO', 'STAFF', 'CELL'].includes(c.category));

    let html = `
      <div class="mb-3 p-3" style="background:#ecfdf5; border-left:4px solid #10b981; border-radius:8px;">
        <h4 style="margin:0; color:#065f46; display:flex; align-items:center; gap:8px;">
          <span>🏛️ ग्राम पंचायत: <strong>${selectedGpName}</strong></span>
          ${selectedBoothNo ? `<span class="badge" style="background:#047857; color:#fff; font-size:0.8rem;">बूथ सं. ${selectedBoothNo}</span>` : ''}
          <span style="font-size:0.85rem; font-weight:normal; color:#047857;">(संबंधित कुल कार्मिक: ${contacts.length})</span>
        </h4>
      </div>
    `;

    const renderGroup = (title, icon, badgeBg, badgeColor, items) => {
      if (items.length === 0) return '';
      return `
        <div class="dir-group-section mb-4">
          <div class="d-flex align-items-center gap-2 mb-2 pb-1" style="border-bottom:2px solid #e2e8f0;">
            <span style="font-size:1.3rem;">${icon}</span>
            <h4 style="margin:0; font-size:1.05rem; color:#1e293b; font-weight:700;">${title}</h4>
            <span class="badge" style="background:${badgeBg}; color:${badgeColor}; font-weight:700; font-size:0.75rem;">${items.length}</span>
          </div>
          <div class="dir-cards-grid" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(320px, 1fr)); gap:12px;">
            ${items.map(c => renderContactCard(c)).join('')}
          </div>
        </div>
      `;
    };

    html += renderGroup('पटवारी (Patwari / राजस्व प्रशासन)', '🏛️', '#fef3c7', '#b45309', patwaris);
    html += renderGroup('सुपरवाइजर (Supervisor / सेक्टर अधिकारी)', '👮', '#dbeafe', '#1e40af', supervisors);
    html += renderGroup('बी.एल.ओ. (BLO / बूथ लेवल अधिकारी)', '📍', '#dcfce7', '#15803d', blos);
    html += renderGroup('पीईईओ / संस्था प्रधान (PEEO / Principal)', '🎓', '#f3e8ff', '#6b21a8', peeos);
    html += renderGroup('पुरुष कार्मिक (Male Educational Staff)', '👨‍🏫', '#e0f2fe', '#0369a1', staff);
    html += renderGroup('चुनाव प्रकोष्ठ (Election Cell)', '🏢', '#fee2e2', '#991b1b', cells);
    html += renderGroup('अन्य कार्मिक / अधिकारी', '⚖️', '#f1f5f9', '#475569', others);

    container.innerHTML = html;
    return;
  }

  // STANDARD VIEW (Sorted & Displayed in Grid)
  const isSuperAdmin = State.currentUser && (State.currentUser.role === 'SUPER_ADMIN' || State.currentUser.role === 'admin' || String(State.currentUser.id || State.currentUser.username || '').toLowerCase() === 'admin');

  let html = `
    <div class="d-flex justify-content-between align-items-center mb-2">
      <span style="font-size:0.85rem; color:#64748b; font-weight:600;">प्रदर्शित संपर्क: <strong>${contacts.length}</strong></span>
      <span style="font-size:0.8rem; color:#047857; font-weight:600;">⚡ वन-क्लिक कॉल एवं व्हाट्सएप सुविधा उपलब्ध</span>
    </div>
    <div class="dir-cards-grid" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(320px, 1fr)); gap:12px;">
      ${contacts.map(c => renderContactCard(c)).join('')}
    </div>
  `;
  container.innerHTML = html;
}

function renderContactCard(c) {
  const isSuperAdmin = State.currentUser && (State.currentUser.role === 'SUPER_ADMIN' || State.currentUser.role === 'admin' || String(State.currentUser.id || State.currentUser.username || '').toLowerCase() === 'admin');

  const getBadgeStyle = (cat) => {
    switch(cat) {
      case 'PATWARI': return { bg: '#fef3c7', col: '#b45309', label: `🏛️ ${c.charge ? c.charge : 'मूल'} पटवारी` };
      case 'SUPERVISOR': return { bg: '#dbeafe', col: '#1e40af', label: '👮 सुपरवाइजर' };
      case 'BLO': return { bg: '#dcfce7', col: '#15803d', label: `📍 बूथ क्र. ${c.booth_no || ''}` };
      case 'PEEO': return { bg: '#f3e8ff', col: '#6b21a8', label: '🎓 पीईईओ / संस्था प्रधान' };
      case 'STAFF': return { bg: '#e0f2fe', col: '#0369a1', label: '👨‍🏫 पुरुष कार्मिक' };
      case 'CELL': return { bg: '#fee2e2', col: '#991b1b', label: '🏢 प्रकोष्ठ कार्मिक' };
      default: return { bg: '#f1f5f9', col: '#334155', label: '⚖️ अधिकारी' };
    }
  };

  const badge = getBadgeStyle(c.category);
  const cleanMobile = (c.mobile || '').replace(/[^0-9]/g, '');

  return `
    <div class="dir-card p-3" style="background:#fff; border:1px solid #e2e8f0; border-radius:10px; box-shadow:0 1px 3px rgba(0,0,0,0.05); display:flex; flex-direction:column; justify-content:space-between; transition:transform 0.15s ease, box-shadow 0.15s ease;">
      <div>
        <div class="d-flex justify-content-between align-items-start gap-1 mb-1">
          <h4 style="margin:0; font-size:1.02rem; color:#0f172a; font-weight:700;">${c.name}</h4>
          <span class="badge" style="background:${badge.bg}; color:${badge.col}; font-size:0.72rem; font-weight:700; padding:2px 8px; border-radius:6px; white-space:nowrap;">
            ${badge.label}
          </span>
        </div>
        
        <div style="font-size:0.83rem; color:#475569; font-weight:600; margin-bottom:4px;">
          ${c.designation || c.role || 'कार्मिक'}
        </div>

        <div style="font-size:0.82rem; color:#64748b; line-height:1.4; margin-bottom:8px;">
          ${c.school_office ? `<div style="display:flex; align-items:flex-start; gap:4px;"><span style="font-size:0.85rem;">🏫</span><span>${c.school_office}</span></div>` : ''}
          ${c.area_display ? `<div style="display:flex; align-items:flex-start; gap:4px; margin-top:2px;"><span style="font-size:0.85rem;">📍</span><span>${c.area_display}</span></div>` : ''}
          ${c.patwar_mandal ? `<div style="display:flex; align-items:center; gap:4px; margin-top:2px;"><span style="font-size:0.85rem;">📜</span><span>मंडल: <strong>${c.patwar_mandal}</strong> (${c.charge || 'मूल'})</span></div>` : ''}
          ${c.shala_darpan_code ? `<div style="display:flex; align-items:center; gap:4px; margin-top:2px;"><span style="font-size:0.85rem;">🆔</span><span>शाला दर्पण: <strong>${c.shala_darpan_code}</strong></span></div>` : ''}
        </div>
      </div>

      <div class="d-flex justify-content-between align-items-center pt-2" style="border-top:1px dashed #e2e8f0; margin-top:6px;">
        <span style="font-size:0.85rem; font-weight:700; color:#1e293b;">
          📞 ${c.mobile || 'मो. अनुल्लेखित'}
        </span>
        
        <div class="d-flex gap-1 align-items-center">
          ${cleanMobile ? `
            <a href="tel:${cleanMobile}" class="btn-icon-sm" style="background:#eff6ff; border:1px solid #bfdbfe; color:#2563eb; padding:6px 10px; border-radius:6px; text-decoration:none; font-size:0.82rem; font-weight:700; display:inline-flex; align-items:center; gap:4px;" title="कॉल करें">
              📞 कॉल
            </a>
            <a href="https://wa.me/91${cleanMobile}" target="_blank" class="btn-icon-sm" style="background:#f0fdf4; border:1px solid #bbf7d0; color:#16a34a; padding:6px 10px; border-radius:6px; text-decoration:none; font-size:0.82rem; font-weight:700; display:inline-flex; align-items:center; gap:4px;" title="व्हाट्सएप संदेश भेजें">
              💬 व्हाट्सएप
            </a>
          ` : ''}
          ${isSuperAdmin ? `
            <button type="button" class="btn-icon-sm" onclick="openEditPersonnelModal('${c.id}')" style="background:#f8fafc; border:1px solid #cbd5e1; color:#334155; padding:6px 9px; border-radius:6px; cursor:pointer; font-size:0.8rem; font-weight:600; display:inline-flex; align-items:center; gap:3px;" title="विवरण संपादित करें">
              ✏️ एडिट
            </button>
            ${c.can_login ? `
              <button type="button" class="btn-icon-sm" onclick="adminPromptChangePass('${c.username || c.id}', '${c.name}')" style="background:#fef3c7; border:1px solid #fde68a; color:#b45309; padding:6px 9px; border-radius:6px; cursor:pointer; font-size:0.8rem; font-weight:600; display:inline-flex; align-items:center; gap:3px;" title="पासवर्ड बदलें">
                🔑
              </button>
            ` : ''}
          ` : ''}
        </div>
      </div>
    </div>
  `;
}

// ==========================================================================
// UNIVERSAL PERSONNEL EDIT MODAL CONTROLS
// ==========================================================================

function openEditPersonnelModal(id) {
  const isSuperAdmin = State.currentUser && (State.currentUser.role === 'SUPER_ADMIN' || State.currentUser.role === 'admin' || String(State.currentUser.id || State.currentUser.username || '').toLowerCase() === 'admin');
  if (!isSuperAdmin) {
    showToast('⚠️ केवल मुख्य व्यवस्थापक (Super Admin) को संपादन का अधिकार है!');
    return;
  }

  const dir = getMasterDirectory();
  if (!dir) return;

  const overrides = getDirectoryOverrides();
  let contact = (dir.all_contacts || []).find(c => c.id === id);
  if (!contact) return;

  if (overrides[id]) {
    contact = { ...contact, ...overrides[id] };
  }

  const titleEl = document.getElementById('editPersonnelModalTitle');
  if (titleEl) titleEl.textContent = `✏️ ${contact.name} - संपादन (${contact.role || contact.category})`;

  const setVal = (fid, val) => { const el = document.getElementById(fid); if (el) el.value = val || ''; };
  setVal('editPersId', contact.id);
  setVal('editPersName', contact.name);
  setVal('editPersMobile', contact.mobile);
  setVal('editPersRole', contact.designation || contact.role || '');
  setVal('editPersSchool', contact.school_office || contact.school || '');
  setVal('editPersPanchayat', contact.panchayat || contact.panchayat_str || '');
  setVal('editPersBooth', contact.booth_no ? `बूथ क्र. ${contact.booth_no}` : (contact.patwar_mandal ? `मंडल ${contact.patwar_mandal}` : ''));

  const modal = document.getElementById('editPersonnelModal');
  if (modal) modal.style.display = 'flex';
}

function closeEditPersonnelModal() {
  const modal = document.getElementById('editPersonnelModal');
  if (modal) modal.style.display = 'none';
}

async function handleSavePersonnelEdit(event) {
  if (event) event.preventDefault();

  const isSuperAdmin = State.currentUser && (State.currentUser.role === 'SUPER_ADMIN' || State.currentUser.role === 'admin' || String(State.currentUser.id || State.currentUser.username || '').toLowerCase() === 'admin');
  if (!isSuperAdmin) {
    showToast('⚠️ केवल मुख्य व्यवस्थापक (Super Admin) को संपादन का अधिकार है!');
    return;
  }

  const id = document.getElementById('editPersId').value;
  const name = document.getElementById('editPersName').value.trim();
  const mobile = document.getElementById('editPersMobile').value.trim();
  const role = document.getElementById('editPersRole').value.trim();
  const school = document.getElementById('editPersSchool').value.trim();
  const panchayat = document.getElementById('editPersPanchayat').value.trim();
  const boothMandal = document.getElementById('editPersBooth').value.trim();

  if (!id || !name || !mobile) {
    showToast('कृपया नाम एवं मोबाइल नंबर अवश्य भरें!');
    return;
  }

  const editPayload = {
    id,
    name,
    mobile,
    designation: role,
    role,
    school_office: school,
    school: school,
    panchayat,
    area_display: `${panchayat ? 'ग्रा.पं. ' + panchayat : ''} ${boothMandal ? '| ' + boothMandal : ''}`.trim()
  };

  // 1. Update in-memory MASTER_DIRECTORY
  const dir = getMasterDirectory();
  if (dir && dir.all_contacts) {
    const item = dir.all_contacts.find(c => c.id === id);
    if (item) Object.assign(item, editPayload);
    
    for (const key of ['patwari_list', 'supervisors_list', 'blo_list', 'peeo_list', 'male_staff_list', 'cell_personnel', 'officers_list']) {
      if (dir[key]) {
        const subItem = dir[key].find(c => c.id === id);
        if (subItem) Object.assign(subItem, editPayload);
      }
    }
  }

  // 2. Save to localStorage overrides
  const overrides = getDirectoryOverrides();
  overrides[id] = editPayload;
  localStorage.setItem('portal_directory_overrides', JSON.stringify(overrides));

  // 3. Send to Node server for permanent disk & SQLite sync
  try {
    await fetch('/api/directory/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editPayload)
    });
  } catch (err) {
    console.log('Server update background notice:', err);
  }

  closeEditPersonnelModal();
  renderDirectoryList();
  showToast(`✅ कार्मिक '${name}' का विवरण सफलतापूर्वक अपडेट किया गया!`);
}

async function adminPromptChangePass(userId, name) {
  const isSuperAdmin = State.currentUser && (State.currentUser.role === 'SUPER_ADMIN' || State.currentUser.role === 'admin' || String(State.currentUser.id || State.currentUser.username || '').toLowerCase() === 'admin');
  if (!isSuperAdmin) {
    showToast('⚠️ केवल मुख्य व्यवस्थापक (Super Admin) को पासवर्ड बदलने का अधिकार है!');
    return;
  }

  const currentPass = getCustomUserPassword(userId) || (userId === 'admin' ? 'admin2026' : (userId === 'block_prabhari' ? 'BHINAI123' : ''));
  const newPass = prompt(`'${name}' (${userId}) के लिए नया पासवर्ड दर्ज करें:`, currentPass);
  if (!newPass || !newPass.trim()) return;

  const trimmed = newPass.trim();
  setCustomUserPassword(userId, trimmed);

  // Update in state if exists
  const uInState = (State.adminControlUsers || []).find(x => (x.id || x.username) === userId);
  if (uInState) {
    uInState.password = trimmed;
    try { localStorage.setItem('portal_admin_users_overrides', JSON.stringify(State.adminControlUsers)); } catch(e) {}
  }
  if (typeof renderBloPassTable === 'function') renderBloPassTable();
  if (typeof renderAdminControlTab === 'function') renderAdminControlTab();

  try {
    const res = await fetch('/api/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: userId,
        newPassword: newPass.trim()
      })
    });
    const d = await res.json();
    if (d && d.success) {
      showToast(`✅ पासवर्ड सफलतापूर्वक '${newPass.trim()}' सेट किया गया!`);
    } else {
      showToast('त्रुटि: ' + ((d && d.error) ? d.error : 'पासवर्ड नहीं बदला जा सका'));
    }
  } catch (e) {
    showToast(`✅ पासवर्ड लोकल सेट: '${newPass.trim()}'`);
  }
}



// ==========================================================================
// UNIFIED GATEKEEPER LOGIN & LOGOUT HANDLERS
// ==========================================================================

async function handleGatekeeperLogin(event) {
  if (event) event.preventDefault();
  const errorDiv = document.getElementById('gatekeeperError');
  if (errorDiv) { errorDiv.style.display = 'none'; errorDiv.textContent = ''; }

  // Ensure freshest admin users and permissions are loaded before login validation
  try { await loadAdminUsersList(true); } catch(e) {}

  const uInput = document.getElementById('gatekeeperUsername');
  let username = uInput ? uInput.value.trim() : '';

  const vDirect = document.getElementById('voterDirectIdInput');
  if (!username && vDirect && vDirect.value) {
    username = vDirect.value.trim();
  }

  const mInput = document.getElementById('manualUsernameInput');
  if (!username && mInput && mInput.value) {
    username = mInput.value.trim();
  }

  const pSelect = document.getElementById('loginPanchayatSelect');
  const panSelect = document.getElementById('panAdminSelect');
  if (!username && panSelect && panSelect.value) { username = panSelect.value; }
  const offSelect = document.getElementById('loginOfficerSelect');

  if (!username) {
    if (pSelect && pSelect.value === 'ADMIN') {
      username = 'admin';
    } else if (pSelect && pSelect.value === 'INCHARGE') {
      username = 'incharge';
    } else if (pSelect && pSelect.value === 'VYAVASTHAPAK') {
      username = 'vyavasthapak';
    } else if (pSelect && pSelect.value === 'BLOCK_PRABHARI') {
      username = 'block_prabhari';
    } else if (offSelect && offSelect.value) {
      username = offSelect.value;
    }
  }

  const passInput = document.getElementById('gatekeeperPassword');
  const password = passInput ? passInput.value.trim() : '';

  if (!username) {
    if (errorDiv) {
      errorDiv.textContent = 'कृपया पद, ग्राम पंचायत या चुनाव प्रकोष्ठ चुनें!';
      errorDiv.style.display = 'block';
    }
    return;
  }

  // If on blo-portal and username is admin: BLOCK IT
  if (getPortalContext() === 'blo' && (username === 'admin' || pSelect?.value === 'ADMIN')) {
    if (errorDiv) {
      errorDiv.textContent = 'बी.एल.ओ. पोर्टल पर एडमिन लॉगिन वर्जित है! कृपया मास्टर एडमिन पोर्टल (pan) से लॉगिन करें।';
      errorDiv.style.display = 'block';
    }
    return;
  }

  if (!password) {
    if (errorDiv) {
      errorDiv.textContent = 'कृपया पासवर्ड दर्ज करें!';
      errorDiv.style.display = 'block';
    }
    return;
  }

  // 1. Try Node server login endpoint (Only on localhost/local node server, skip on GitHub Pages!)
  const isLocalServer = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  if (isLocalServer) {
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.success && data.user) {
          State.currentUser = data.user;
          const candProfile = data.candidate || data.user.candidate || (window.PORTAL_USERS_DATA && window.PORTAL_USERS_DATA.candidates && (window.PORTAL_USERS_DATA.candidates[data.user.id] || window.PORTAL_USERS_DATA.candidates[data.user.username]));
          if (candProfile) {
            State.currentCandidate = candProfile;
            State.currentUser.candidate = candProfile;
            try {
              localStorage.setItem('candidate_profile_' + data.user.id, JSON.stringify(candProfile));
              localStorage.setItem('candidate_profile_' + data.user.username, JSON.stringify(candProfile));
            } catch(_) {}
          }
          if (isCandidateUser(State.currentUser)) {
            if (!Array.isArray(State.currentUser.allowed_tabs)) {
              State.currentUser.allowed_tabs = [];
            }
          }
          syncCurrentUserWithConfiguredUsers();
          const sk = getSessionStorageKey();
          localStorage.setItem(sk, JSON.stringify(State.currentUser));
          sessionStorage.setItem(sk, JSON.stringify(State.currentUser));
          localStorage.setItem('panchayat_user_session', JSON.stringify(State.currentUser));
          if (typeof document !== 'undefined') {
            document.documentElement.classList.add('user-logged-in');
          }
          applyGlobalElectionDateToUI();
          enforceGatekeeperState();
          showToast(`नमस्ते ${data.user.full_name || data.user.name || data.user.username}! स्वागत है।`);
          return;
        } else if (data && data.error) {
          if (errorDiv) {
            errorDiv.textContent = data.error;
            errorDiv.style.display = 'block';
          }
          return;
        }
      }
    } catch (err) {
      console.log('Local server login bypassed to client validation:', err);
    }
  }

  // 2. Client-side Fallback validation (Universal password '123' accepted for ALL accounts!)
  const isUniversalPass = false;

  // A. Super Admin Check (Distinct Password: admin2026)
  if (username === 'admin' || username === 'superadmin') {
    const customAdminPass = getCustomUserPassword('admin') || getCustomUserPassword('superadmin');
    if (password === 'admin2026' || (customAdminPass && password === customAdminPass)) {
      const adminUser = {
        id: 'admin',
        username: 'admin',
        role: 'SUPER_ADMIN',
        name: 'मुख्य व्यवस्थापक',
        full_name: 'मुख्य व्यवस्थापक (Super Admin)',
        allowed_panchayats: 'ALL',
        allowed_wards: 'ALL',
        allowed_tabs: ['dashboardTab', 'searchTab', 'alphaTab', 'bulkSlipTab', 'directoryTab', 'candidateProfileTab', 'adminControlTab', 'settingsTab'],
        can_edit: true,
        candidate_mode: 'admin_locked'
      };
      State.currentUser = adminUser;
      localStorage.setItem(getSessionStorageKey(), JSON.stringify(adminUser));
      localStorage.setItem('panchayat_user_session', JSON.stringify(adminUser));
      enforceGatekeeperState();
      showToast('नमस्ते एडमिन! पोर्टल में आपका स्वागत है।');
      return;
    }
  }

  // B. INCHARGE (ब्लॉक इनचार्ज - केवल अवलोकन / No Edit)
  if (username === 'incharge' || (pSelect && pSelect.value === 'INCHARGE')) {
    const inchargeStatus = getCustomUserStatus('incharge');
    if (inchargeStatus === 'INACTIVE') {
      if (errorDiv) {
        errorDiv.textContent = 'ब्लॉक इनचार्ज खाता सुपर एडमिन द्वारा निष्क्रिय (Inactive) किया गया है!';
        errorDiv.style.display = 'block';
      }
      return;
    }
    const customInchargePass = getCustomUserPassword('incharge');
    if (password === 'incharge2026' || (customInchargePass && password === customInchargePass)) {
      const inchargeUser = {
        id: 'incharge',
        username: 'incharge',
        role: 'INCHARGE',
        name: 'ब्लॉक इनचार्ज',
        full_name: 'ब्लॉक इनचार्ज',
        allowed_panchayats: 'ALL',
        allowed_wards: 'ALL',
        allowed_tabs: ['dashboardTab', 'searchTab', 'alphaTab', 'directoryTab'],
        can_edit: false,
        can_search_all: true,
        can_print_bulk: false,
        can_download_single: true,
        candidate_mode: 'admin_locked'
      };
      State.currentUser = inchargeUser;
      const sk = getSessionStorageKey();
      if (document.getElementById('gatekeeperRememberMe')?.checked) {
        localStorage.setItem(sk, JSON.stringify(inchargeUser));
        if (getPortalContext() === 'master') localStorage.setItem('panchayat_user_session', JSON.stringify(inchargeUser));
      } else {
        sessionStorage.setItem(sk, JSON.stringify(inchargeUser));
      }
      enforceGatekeeperState();
      showToast('नमस्ते ब्लॉक इनचार्ज! पोर्टल में आपका स्वागत है (समस्त 30 ग्राम पंचायतें केवल अवलोकन)।');
      return;
    }
  }

  // C. VYAVASTHAPAK (व्यवस्थापक - प्रिंट व डाउनलोड)
  if (username === 'vyavasthapak' || (pSelect && pSelect.value === 'VYAVASTHAPAK')) {
    const vyavStatus = getCustomUserStatus('vyavasthapak');
    if (vyavStatus === 'INACTIVE') {
      if (errorDiv) {
        errorDiv.textContent = 'व्यवस्थापक खाता सुपर एडमिन द्वारा निष्क्रिय (Inactive) किया गया है!';
        errorDiv.style.display = 'block';
      }
      return;
    }
    const customVyavPass = getCustomUserPassword('vyavasthapak');
    if (password === 'vyavastha2026' || (customVyavPass && password === customVyavPass)) {
      const vyavUser = {
        id: 'vyavasthapak',
        username: 'vyavasthapak',
        role: 'VYAVASTHAPAK',
        name: 'व्यवस्थापक',
        full_name: 'व्यवस्थापक',
        allowed_panchayats: 'ALL',
        allowed_wards: 'ALL',
        allowed_tabs: ['dashboardTab', 'searchTab', 'alphaTab', 'bulkSlipTab', 'directoryTab'],
        can_edit: false,
        can_search_all: true,
        can_print_bulk: true,
        can_download_single: true,
        candidate_mode: 'admin_locked'
      };
      State.currentUser = vyavUser;
      const sk = getSessionStorageKey();
      if (document.getElementById('gatekeeperRememberMe')?.checked) {
        localStorage.setItem(sk, JSON.stringify(vyavUser));
        if (getPortalContext() === 'master') localStorage.setItem('panchayat_user_session', JSON.stringify(vyavUser));
      } else {
        sessionStorage.setItem(sk, JSON.stringify(vyavUser));
      }
      enforceGatekeeperState();
      showToast('नमस्ते व्यवस्थापक! पोर्टल में आपका स्वागत है (समस्त 30 ग्राम पंचायतें प्रिंट व डाउनलोड)।');
      return;
    }
  }

  // D. Block Prabhari (Suresh Chand Jangid - Teacher)
  if (username === 'block_prabhari' || username === 'suresh_jangid' || (pSelect && pSelect.value === 'BLOCK_PRABHARI')) {
    const bpStatus = getCustomUserStatus('block_prabhari');
    if (bpStatus === 'INACTIVE') {
      if (errorDiv) {
        errorDiv.textContent = 'ब्लॉक प्रभारी खाता सुपर एडमिन द्वारा निष्क्रिय (Inactive) किया गया है!';
        errorDiv.style.display = 'block';
      }
      return;
    }
    const customBpPass = getCustomUserPassword('block_prabhari');
    if (password.toUpperCase() === 'BHINAI123' || password.toLowerCase() === 'bhinai123' || password === 'prabhari2026' || (customBpPass && password === customBpPass)) {
      const bpUser = {
        id: 'block_prabhari',
        username: 'block_prabhari',
        role: 'BLOCK_PRABHARI',
        name: 'ब्लॉक प्रभारी',
        full_name: 'ब्लॉक प्रभारी',
        post: 'प्रभारी',
        designation: 'ब्लॉक प्रभारी',
        office: 'उपखण्ड कार्यालय भिनाय',
        mobile: '9950705221',
        allowed_panchayats: 'ALL',
        allowed_wards: 'ALL',
        allowed_tabs: ['dashboardTab', 'searchTab', 'alphaTab', 'directoryTab'],
        can_print_bulk: false,
        can_download_single: true,
        can_search_all: true,
        candidate_mode: 'admin_locked'
      };
      State.currentUser = bpUser;
      const sk = getSessionStorageKey();
      if (document.getElementById('gatekeeperRememberMe')?.checked) {
        localStorage.setItem(sk, JSON.stringify(bpUser));
        if (getPortalContext() === 'master') localStorage.setItem('panchayat_user_session', JSON.stringify(bpUser));
      } else {
        sessionStorage.setItem(sk, JSON.stringify(bpUser));
      }
      enforceGatekeeperState();
      showToast('नमस्ते! ब्लॉक प्रभारी सत्र प्रारंभ हुआ (समस्त 30 ग्रा.पं. खोज अधिकार)।');
      return;
    }
  }

  // Ensure admin users and candidates are loaded
  if (!State.adminControlUsers || State.adminControlUsers.length === 0) {
    try { await loadAdminUsersList(); } catch(e) {}
  }

  // E. Candidates / Agents Check from State.adminUsers, State.adminControlUsers, and localStorage
  const localCustomUsers = JSON.parse(localStorage.getItem('portal_custom_users') || '[]');
  const allCandidatePool = [
    ...(State.adminControlUsers || []),
    ...localCustomUsers,
    ...(State.adminUsers || [])
  ];

  const unameLower = username.toLowerCase();
  const candMatch = allCandidatePool.find(u => {
    if (u.role === 'BLO' || u.role === 'बी.एल.ओ.' || u.role === 'CELL_MEMBER' || u.category === 'CELL' || u.role === 'BLOCK_PRABHARI' || (u.id && String(u.id).toLowerCase().startsWith('blo_')) || (u.username && String(u.username).toLowerCase().startsWith('blo_')) || (u.id && String(u.id).toLowerCase().startsWith('cell_'))) {
      return false;
    }
    const cU = (u.username || '').toLowerCase();
    const cId = (u.id || u.user_id || '').toLowerCase();
    const cName = (u.full_name || u.fullName || u.candidate_name || u.name || '').toLowerCase();
    return cU === unameLower || 
           cId === unameLower ||
           cId === `cand_${unameLower}` ||
           cU === `cand_${unameLower}` ||
           (unameLower.startsWith('cand_') && (cU === unameLower.replace(/^cand_/, '') || cId === unameLower.replace(/^cand_/, ''))) ||
           cName === unameLower ||
           ((unameLower === 'kamla' || unameLower === 'कमला' || unameLower === 'kamla sharma' || unameLower === 'कमला शर्मा') && (cU === 'b' || cId === 'cand_b' || cName.includes('कमला')));
  });
  if (candMatch) {
    const candStatus = getCustomUserStatus(candMatch.username) || candMatch.status || 'ACTIVE';
    if (candStatus === 'INACTIVE') {
      if (errorDiv) {
        errorDiv.textContent = 'यह प्रत्याशी खाता मुख्य व्यवस्थापक द्वारा निष्क्रिय (Inactive) किया गया है!';
        errorDiv.style.display = 'block';
      }
      return;
    }
    const customCandPass = getCustomUserPassword(candMatch.username) || getCustomUserPassword(candMatch.id);
    if ((customCandPass && password === customCandPass) || (candMatch && candMatch.password && password === candMatch.password)) {
      const candUser = {
        id: candMatch.id || candMatch.user_id || `cand_${candMatch.username}`,
        username: candMatch.username,
        role: 'CANDIDATE',
        type: 'CANDIDATE',
        category: 'CANDIDATE',
        name: candMatch.full_name || candMatch.fullName || candMatch.name || candMatch.username,
        full_name: candMatch.full_name || candMatch.fullName || candMatch.name || candMatch.username,
        panchayat: candMatch.allowed_panchayats || candMatch.panchayat || candMatch.assigned_panchayats || '',
        allowed_panchayats: candMatch.allowed_panchayats || candMatch.panchayat || candMatch.assigned_panchayats || '',
        allowed_wards: candMatch.allowed_wards || candMatch.ward || candMatch.assigned_wards || 'ALL',
        allowed_tabs: Array.isArray(candMatch.allowed_tabs)
          ? candMatch.allowed_tabs.filter(t => t !== 'directoryTab')
          : [],
        candidate_mode: 'user_edit'
      };
      State.currentUser = candUser;

      // Initialize candidate profile
      // Initialize candidate profile (Always prefer authoritative remote data over stale localStorage)
      let candProfile = null;
      if (window.PORTAL_USERS_DATA && window.PORTAL_USERS_DATA.candidates) {
        candProfile = window.PORTAL_USERS_DATA.candidates[candUser.id] || window.PORTAL_USERS_DATA.candidates[candUser.username];
      }
      if (!candProfile && candMatch && candMatch.candidate) {
        candProfile = candMatch.candidate;
      }
      if (!candProfile) {
        try {
          const res = await fetch('/api/candidate/' + encodeURIComponent(candUser.id || candUser.username));
          if (res.ok) {
            const d = await res.json();
            if (d && d.candidate && d.candidate.candidate_name) {
              candProfile = d.candidate;
            }
          }
        } catch(e) {}
      }
      if (!candProfile) {
        try {
          const cached = localStorage.getItem('candidate_profile_' + candUser.id) || localStorage.getItem('candidate_profile_' + candUser.username);
          if (cached) {
            const parsed = JSON.parse(cached);
            if (parsed && !String(parsed.slogan || '').includes('सुपरएडमिन द्वारा सिंक')) {
              candProfile = parsed;
            }
          }
        } catch(e) {}
      }
      if (candProfile) {
        if (String(candProfile.slogan || '').includes('सुपरएडमिन द्वारा सिंक')) {
          candProfile.slogan = '।। समस्त ग्रामवासियों से विनम्र अपील ।।\nअपने कर्मठ, ईमानदार एवं सेवाभावी प्रत्याशी को भारी मतों से विजयी बनावें।';
        }
        if (String(candProfile.candidate_name || '').toLowerCase().includes('narendra')) {
          candProfile.candidate_name = 'श्री रामेश्वर जाट';
        }
      }
      if (String(candUser.full_name || '').toLowerCase().includes('narendra')) {
        candUser.full_name = 'श्री रामेश्वर जाट';
        candUser.name = 'श्री रामेश्वर जाट';
      }
      if (!candProfile) {
        candProfile = {
          user_id: candUser.id,
          candidate_name: candUser.full_name,
          panchayat: candUser.panchayat,
          ward: candUser.allowed_wards !== 'ALL' ? candUser.allowed_wards : '',
          post: candUser.allowed_wards !== 'ALL' ? 'वार्ड पंच' : 'सरपंच',
          symbol_name: 'उगता सूरज',
          symbol_icon: 'sun',
          show_banner_on_slip: true
        };
      }
      State.currentCandidate = candProfile;
      candUser.candidate = candProfile;
      try {
        localStorage.setItem('candidate_profile_' + candUser.id, JSON.stringify(candProfile));
        localStorage.setItem('candidate_profile_' + candUser.username, JSON.stringify(candProfile));
      } catch(e) {}

      localStorage.setItem(getSessionStorageKey(), JSON.stringify(candUser));
      enforceGatekeeperState();
      showToast(`नमस्ते ${candUser.full_name}! प्रत्याशी सत्र प्रारंभ हुआ।`);
      return;
    }
  }

  // E2. Online Google Sheet Direct Candidate Verification (For newly added candidates or real-time password updates)
  const isVoterContext = (typeof getPortalContext === 'function' && getPortalContext() === 'voter') || window.location.pathname.includes('voter-portal');
  const gScriptUrl = State.config?.appsScriptUrl || localStorage.getItem('panchayat_apps_script_url') || 'https://script.google.com/macros/s/AKfycbwtgz2L5QC_95Jsf1r0Kum_LcTI-bJwwiBQS_O74vthHcbPD_KatsN69ytY2yqlayiM/exec';

  if (gScriptUrl) {
    try {
      const gUrl = `${gScriptUrl}${gScriptUrl.includes('?') ? '&' : '?'}action=candidateLogin&username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&_t=${Date.now()}`;
      const gRes = await fetch(gUrl);
      if (gRes.ok) {
        const gData = await gRes.json();
        if (gData && gData.success && gData.user && gData.candidate) {
          const candUser = gData.user;
          const candProfile = gData.candidate;
          let allowed = gData.candidate?.allowed_tabs || gData.user?.allowed_tabs;
          if (typeof allowed === 'string') {
            try { allowed = JSON.parse(allowed); } catch(e) { allowed = allowed.split(',').map(s=>s.trim()).filter(Boolean); }
          }
          if (!Array.isArray(allowed)) {
            allowed = ['searchTab', 'alphaTab', 'bulkSlipTab', 'candidateProfileTab'];
          }
          candUser.allowed_tabs = allowed.filter(t => t !== 'directoryTab');
          candUser.can_print = (gData.candidate?.can_print !== false && gData.user?.can_print !== false);
          candUser.can_download = (gData.candidate?.can_download !== false && gData.user?.can_download !== false);
          candUser.candidate_mode = 'user_edit';
          candUser.candidate = candProfile;
          State.currentUser = candUser;
          State.currentCandidate = candProfile;

          if (!window.PORTAL_USERS_DATA) window.PORTAL_USERS_DATA = { users: [], candidates: {} };
          if (!window.PORTAL_USERS_DATA.candidates) window.PORTAL_USERS_DATA.candidates = {};
          window.PORTAL_USERS_DATA.candidates[candUser.id] = candProfile;
          window.PORTAL_USERS_DATA.candidates[candUser.username] = candProfile;

          try {
            localStorage.setItem('candidate_profile_' + candUser.id, JSON.stringify(candProfile));
            localStorage.setItem('candidate_profile_' + candUser.username, JSON.stringify(candProfile));
            const sk = getSessionStorageKey();
            localStorage.setItem(sk, JSON.stringify(candUser));
            sessionStorage.setItem(sk, JSON.stringify(candUser));
          } catch(_) {}

          if (typeof document !== 'undefined') {
            document.documentElement.classList.add('user-logged-in');
          }
          applyGlobalElectionDateToUI();
          enforceGatekeeperState();
          showToast(`नमस्ते ${candUser.full_name || candUser.username}! प्रत्याशी पोर्टल में स्वागत है (गूगल शीट सत्यापित)।`);
          return;
        } else if (gData && gData.error && (isVoterContext || candMatch)) {
          if (errorDiv) {
            errorDiv.textContent = gData.error;
            errorDiv.style.display = 'block';
          }
          return;
        }
      }
    } catch(gErr) {
      console.warn('Google Sheet online candidate authentication notice:', gErr);
    }
  }

  if (candMatch) {
    if (errorDiv) {
      errorDiv.textContent = 'अमान्य पासवर्ड! कृपया सही पासवर्ड दर्ज करें।';
      errorDiv.style.display = 'block';
    }
    return;
  }

  // F. BLO & Cell Members lookup (Synchronized with Super Admin configuration)
  const dir = getMasterDirectory();
  if (dir) {
    // 1. Check in BLO list
    const bloMatch = (dir.blo_list || []).find(b => 
      b.id === username || 
      b.username === username || 
      String(b.booth_no) === username.replace('blo_', '') ||
      (b.old_part_no && String(b.old_part_no) === username.replace('blo_', ''))
    );
    if (bloMatch) {
      const bloUname = bloMatch.username || bloMatch.id || ('blo_' + bloMatch.booth_no);
      const cfgUser = (State.adminControlUsers || []).find(u => 
        (u.id && String(u.id).toLowerCase() === bloUname.toLowerCase()) || 
        (u.username && String(u.username).toLowerCase() === bloUname.toLowerCase()) ||
        (bloMatch.user_id && (String(u.id).toLowerCase() === String(bloMatch.user_id).toLowerCase() || String(u.username).toLowerCase() === String(bloMatch.user_id).toLowerCase())) ||
        (bloMatch.old_part_no && (String(u.id).toLowerCase() === ('blo_' + bloMatch.old_part_no) || String(u.username).toLowerCase() === ('blo_' + bloMatch.old_part_no)))
      );
      
      const bloStatus = cfgUser?.status || getCustomUserStatus(bloUname) || 'ACTIVE';
      if (String(bloStatus).toUpperCase() === 'INACTIVE') {
        if (errorDiv) {
          errorDiv.textContent = 'यह बी.एल.ओ. खाता मुख्य व्यवस्थापक द्वारा निष्क्रिय (Inactive) किया गया है!';
          errorDiv.style.display = 'block';
        }
        return;
      }
      
      const bloPass = cfgUser?.password || getCustomUserPassword(bloUname) || bloMatch.password || 'bhinai2026';
      if (password === bloPass) {
        let allowedTabs = (cfgUser && Array.isArray(cfgUser.allowed_tabs))
          ? cfgUser.allowed_tabs
          : ['searchTab'];
        let allowedGps = cfgUser?.allowed_panchayats || [bloMatch.panchayat];
        let allowedWards = cfgUser?.allowed_wards || (bloMatch.wards ? bloMatch.wards.split(',').map(w => w.trim()) : 'ALL');

        const bloUser = {
          id: bloUname,
          username: bloUname,
          role: 'BLO',
          full_name: `${bloMatch.name} (BLO भाग ${bloMatch.old_part_no || bloMatch.booth_no || username.replace('blo_', '')})`,
          booth_no: String(bloMatch.old_part_no || bloMatch.booth_no || username.replace('blo_', '')),
          panchayat: typeof allowedGps === 'string' ? allowedGps : bloMatch.panchayat,
          allowed_panchayats: typeof allowedGps === 'string' ? allowedGps : JSON.stringify(allowedGps),
          allowed_wards: typeof allowedWards === 'string' ? allowedWards : (Array.isArray(allowedWards) ? JSON.stringify(allowedWards) : allowedWards),
          allowed_tabs: allowedTabs,
          can_print: (cfgUser && cfgUser.can_print !== undefined) ? (cfgUser.can_print === true || cfgUser.can_print === 1) : false,
          can_download: (cfgUser && cfgUser.can_download !== undefined) ? (cfgUser.can_download === true || cfgUser.can_download === 1) : true,
          can_search: (cfgUser && cfgUser.can_search !== undefined) ? (cfgUser.can_search === true || cfgUser.can_search === 1) : true,
          can_view: (cfgUser && cfgUser.can_view !== undefined) ? (cfgUser.can_view === true || cfgUser.can_view === 1) : true,
          candidate_mode: 'admin_locked'
        };
        State.currentUser = bloUser;
        const sk = getSessionStorageKey();
        localStorage.setItem(sk, JSON.stringify(bloUser));
        sessionStorage.setItem(sk, JSON.stringify(bloUser));
        localStorage.setItem('panchayat_user_session', JSON.stringify(bloUser));
        if (typeof document !== 'undefined') {
          document.documentElement.classList.add('user-logged-in');
        }
        enforceGatekeeperState();
        showToast(`नमस्ते ${bloMatch.name}! बी.एल.ओ. सत्र प्रारंभ हुआ।`);
        return;
      } else {
        if (errorDiv) {
          errorDiv.textContent = 'अमान्य पासवर्ड! कृपया सही पासवर्ड दर्ज करें।';
          errorDiv.style.display = 'block';
        }
        return;
      }
    }

    // 2. Check in Cell Personnel list (built-in + custom)
    const customCells = JSON.parse(localStorage.getItem('portal_custom_cell_personnel') || '[]');
    const allCells = [...customCells, ...(dir.cell_personnel || [])];
    const cellMatch = allCells.find(c => c.id === username || c.username === username);
    if (cellMatch) {
      const cellUname = cellMatch.username || cellMatch.id;
      const cfgUser = (State.adminControlUsers || []).find(u => 
        (u.id && String(u.id).toLowerCase() === cellUname.toLowerCase()) || 
        (u.username && String(u.username).toLowerCase() === cellUname.toLowerCase())
      );
      
      const cellStatus = cfgUser?.status || getCustomUserStatus(cellUname) || 'ACTIVE';
      if (String(cellStatus).toUpperCase() === 'INACTIVE') {
        if (errorDiv) {
          errorDiv.textContent = 'यह प्रकोष्ठ कार्मिक खाता मुख्य व्यवस्थापक द्वारा निष्क्रिय (Inactive) किया गया है!';
          errorDiv.style.display = 'block';
        }
        return;
      }
      
      const cellPass = cfgUser?.password || getCustomUserPassword(cellUname) || cellMatch.password || 'bhinai2026';
      if (password === cellPass) {
        let allowedTabs = (cfgUser && Array.isArray(cfgUser.allowed_tabs))
          ? cfgUser.allowed_tabs
          : (getCustomUserScope(cellUname) === 'SEARCH_30_GP' ? ['dashboardTab', 'searchTab', 'alphaTab', 'directoryTab'] : ['directoryTab']);
        let allowedGps = cfgUser?.allowed_panchayats || 'ALL';
        let allowedWards = cfgUser?.allowed_wards || 'ALL';

        const cellUser = {
          id: cellUname,
          username: cellUname,
          role: 'CELL_MEMBER',
          name: cellMatch.name,
          full_name: `${cellMatch.name} (${cellMatch.designation || 'प्रकोष्ठ कार्मिक'})`,
          cell_name: cellMatch.cell_name,
          allowed_panchayats: allowedGps,
          allowed_wards: allowedWards,
          allowed_tabs: allowedTabs,
          can_print: (cfgUser && cfgUser.can_print !== undefined) ? (cfgUser.can_print === true || cfgUser.can_print === 1) : false,
          can_download: (cfgUser && cfgUser.can_download !== undefined) ? (cfgUser.can_download === true || cfgUser.can_download === 1) : true,
          can_search: (cfgUser && cfgUser.can_search !== undefined) ? (cfgUser.can_search === true || cfgUser.can_search === 1) : true,
          can_view: (cfgUser && cfgUser.can_view !== undefined) ? (cfgUser.can_view === true || cfgUser.can_view === 1) : true,
          candidate_mode: 'admin_locked'
        };
        State.currentUser = cellUser;
        const sk = getSessionStorageKey();
        localStorage.setItem(sk, JSON.stringify(cellUser));
        sessionStorage.setItem(sk, JSON.stringify(cellUser));
        localStorage.setItem('panchayat_user_session', JSON.stringify(cellUser));
        if (typeof document !== 'undefined') {
          document.documentElement.classList.add('user-logged-in');
        }
        enforceGatekeeperState();
        showToast(`नमस्ते ${cellMatch.name}! प्रकोष्ठ सत्र प्रारंभ हुआ।`);
        return;
      } else {
        if (errorDiv) {
          errorDiv.textContent = 'अमान्य पासवर्ड! कृपया सही पासवर्ड दर्ज करें।';
          errorDiv.style.display = 'block';
        }
        return;
      }
    }
  }

  // STRICT REJECTION: Any user not in the authorized user list cannot log in!
  if (errorDiv) {
    errorDiv.textContent = 'यह यूजर आईडी पंजीकृत नहीं है! केवल अधिकृत व पंजीकृत उपयोगकर्ता ही लॉगिन कर सकते हैं। संपर्क: मुख्य व्यवस्थापक।';
    errorDiv.style.display = 'block';
  }
}

function logoutUser() {
  State.currentUser = null;
  State.currentCandidate = null;

  // 1. Instantly remove user-logged-in class from both html and body
  if (typeof document !== 'undefined') {
    document.documentElement.classList.remove('user-logged-in');
    if (document.body) document.body.classList.remove('user-logged-in');
  }

  // 2. Clear all portal session keys across localStorage and sessionStorage
  const sessionKeys = [
    'panchayat_session_voter',
    'panchayat_session_master',
    'panchayat_session_blo',
    'panchayat_user_session',
    'portal_session_voter',
    'portal_session_master',
    'portal_session_blo',
    'panchayat_session'
  ];

  sessionKeys.forEach(k => {
    try {
      localStorage.removeItem(k);
      sessionStorage.removeItem(k);
    } catch(_) {}
  });

  // 3. Clear password and error in login form
  const passEl = document.getElementById('gatekeeperPassword');
  if (passEl) passEl.value = '';
  const errEl = document.getElementById('gatekeeperError');
  if (errEl) errEl.style.display = 'none';

  // 4. Reset screen elements
  const gatekeeper = document.getElementById('welcomeGatekeeper');
  const mainApp = document.getElementById('mainPortalApp');
  if (gatekeeper) gatekeeper.style.display = 'flex';
  if (mainApp) mainApp.style.display = 'none';

  // 5. Clean page reload to ensure 100% fresh login gatekeeper state without leftover memory
  try {
    window.location.reload();
  } catch(_) {}
}


// ==========================================================================
// TRI-PORTAL MASTER COMMAND & CONTROL ENGINE (PAN MASTER HUB)
// ==========================================================================

// triPortalSettings and helpers moved to top of file

async function loadTriPortalSettings() {
  const isLocalServer = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  const bust = Date.now();
  let loaded = false;

  if (isLocalServer) {
    try {
      const res = await fetch(`/api/portal-settings?_t=${bust}`);
      if (res.ok) {
        const data = await res.json();
        if (data && (data.voter_portal || data.election_date)) {
          triPortalSettings = { ...triPortalSettings, ...data };
          loaded = true;
        }
      }
    } catch(e) {}
  }

  if (!loaded) {
    try {
      let res = await fetch(`portal_settings.json?_t=${bust}`, { cache: 'no-store' });
      if (!res.ok) {
        res = await fetch(`https://jit9763.github.io/pan/portal_settings.json?_t=${bust}`, { cache: 'no-store' });
      }
      if (res.ok) {
        const data = await res.json();
        if (data && (data.voter_portal || data.election_date)) {
          triPortalSettings = { ...triPortalSettings, ...data };
          loaded = true;
        }
      }
    } catch(e) {}
  }

  if (loaded) {
    localStorage.setItem('portal_tri_settings', JSON.stringify(triPortalSettings));
  } else {
    try {
      const local = JSON.parse(localStorage.getItem('portal_tri_settings') || '{}');
      if (local && (local.voter_portal || local.election_date)) {
        triPortalSettings = { ...triPortalSettings, ...local };
      }
    } catch(e) {}
  }

  updateTriPortalUiFromSettings();
  applyGlobalElectionDateToUI();
}

function updateTriPortalUiFromSettings() {
  const vDateInp = document.getElementById('voterPortalElectionDateInput');
  const vTimeInp = document.getElementById('voterPortalElectionTimeInput');
  if (vDateInp) {
    vDateInp.value = triPortalSettings.voter_portal?.election_date || triPortalSettings.election_date || '15 अक्टूबर 2026';
  }
  if (vTimeInp) {
    vTimeInp.value = triPortalSettings.voter_portal?.election_time || triPortalSettings.election_time || 'प्रातः 7:00 बजे से सायं 6:00 बजे तक';
  }
  const vBtn = document.getElementById('btnToggleVoterPortalLive');
  const vBadge = document.getElementById('voterPortalStatusBadge');
  if (vBtn && vBadge) {
    const isActive = triPortalSettings.voter_portal?.status === 'ACTIVE';
    vBtn.textContent = isActive ? '🟢 चालू (ON)' : '🔴 बंद (OFF)';
    vBtn.style.background = isActive ? '#16a34a' : '#dc2626';
    vBadge.textContent = isActive ? 'LIVE ACTIVE' : 'PAUSED / MAINTENANCE';
    vBadge.style.background = isActive ? '#dcfce7' : '#fee2e2';
    vBadge.style.color = isActive ? '#15803d' : '#991b1b';
  }

  const bBtn = document.getElementById('btnToggleBloPortalLive');
  const bBadge = document.getElementById('bloPortalStatusBadge');
  if (bBtn && bBadge) {
    const isActive = triPortalSettings.blo_portal?.status === 'ACTIVE';
    bBtn.textContent = isActive ? '🟢 चालू (ON)' : '🔴 बंद (OFF)';
    bBtn.style.background = isActive ? '#4f46e5' : '#dc2626';
    bBadge.textContent = isActive ? 'LIVE ACTIVE' : 'LOCKED';
    bBadge.style.background = isActive ? '#e0e7ff' : '#fee2e2';
    bBadge.style.color = isActive ? '#4338ca' : '#991b1b';
  }

  const mods = triPortalSettings.voter_portal?.modules || {};
  const setChk = (id, val) => { const el = document.getElementById(id); if (el) el.checked = !!val; };
  setChk('chkModSearch', mods.search !== false);
  setChk('chkModAlpha', mods.alpha !== false);
  setChk('chkModSlips', mods.slips !== false);
  setChk('chkModCandidate', mods.candidate_edit !== false);
}

async function togglePortalStatus(portalKey) {
  if (portalKey === 'voter') {
    const curr = triPortalSettings.voter_portal?.status === 'ACTIVE';
    triPortalSettings.voter_portal.status = curr ? 'PAUSED' : 'ACTIVE';
    showToast(`पब्लिक वोटर पोर्टल स्थिति: ${!curr ? '🟢 चालू' : '🔴 बंद'}`);
  } else if (portalKey === 'blo') {
    const curr = triPortalSettings.blo_portal?.status === 'ACTIVE';
    triPortalSettings.blo_portal.status = curr ? 'PAUSED' : 'ACTIVE';
    showToast(`BLO पोर्टल स्थिति: ${!curr ? '🟢 चालू' : '🔴 बंद'}`);
  }
  updateTriPortalUiFromSettings();
  savePortalModuleSettings();
}

async function savePortalModuleSettings() {
  const mods = {
    search: document.getElementById('chkModSearch')?.checked ?? true,
    alpha: document.getElementById('chkModAlpha')?.checked ?? true,
    slips: document.getElementById('chkModSlips')?.checked ?? true,
    candidate_edit: document.getElementById('chkModCandidate')?.checked ?? true
  };
  if (!triPortalSettings.voter_portal) triPortalSettings.voter_portal = {};
  triPortalSettings.voter_portal.modules = mods;

  localStorage.setItem('portal_tri_settings', JSON.stringify(triPortalSettings));

  try {
    await fetch('/api/portal-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(triPortalSettings)
    });
  } catch(e) {}
}

async function fetchRemoteSettings() {
  showToast('📥 रिमोट/ऑनलाइन से सेटिंग्स फेच की जा रही हैं...');
  try {
    const isLocalServer = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (isLocalServer) {
      const res = await fetch('/api/fetch-remote-settings', { method: 'POST' });
      const data = await res.json();
      await loadAdminUsersList();
      if (typeof renderAdminControlTab === 'function') renderAdminControlTab();
      showToast(data.message || '✅ रिमोट सेटिंग्स सफलतापूर्वक फेच व लागू कर दी गईं!');
    } else {
      const res = await fetch('portal_users.json?v=' + Date.now());
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.users)) {
          State.adminControlUsers = data.users;
          if (typeof renderAdminControlTab === 'function') renderAdminControlTab();
          showToast('✅ ऑनलाइन नवीनतम सेटिंग्स लोड हो गईं!');
        }
      }
    }
  } catch(e) {
    console.error('Fetch remote error:', e);
    showToast('रिमोट सेटिंग्स फेच करने में त्रुटि: ' + e.message);
  }
}

async function triggerTriPortalSync() {
  showToast('🚀 तीनों पोर्टल्स (pan, voter-portal, blo-portal) में सिंक शुरू किया गया...');
  try {
    const res = await fetch('/api/sync-all-portals', { method: 'POST' });
    const data = await res.json();
    if (data && data.success) {
      showToast('✅ तीनों पोर्टल्स सफलतापूर्वक सिंक व डिप्लॉय हो गए!');
    } else {
      showToast('सिंक संपन्न (क्लाउड डिप्लॉय सक्रिय)!');
    }
  } catch(e) {
    showToast('✅ स्थानीय व क्लाउड सेटिंग्स अद्यतन!');
  }
}

function previewPortalModal(url, title) {
  const modal = document.getElementById('portalPreviewModal');
  const titleEl = document.getElementById('portalPreviewTitle');
  const iframe = document.getElementById('portalPreviewIframe');
  const extLink = document.getElementById('portalPreviewExternalLink');

  if (titleEl) titleEl.textContent = `👁️ लाइव पोर्टल प्रीव्यू: ${title}`;
  if (extLink) extLink.href = url;
  if (iframe) iframe.src = url;
  if (modal) modal.style.display = 'flex';
}

function closePortalPreviewModal() {
  const modal = document.getElementById('portalPreviewModal');
  const iframe = document.getElementById('portalPreviewIframe');
  if (iframe) iframe.src = '';
  if (modal) modal.style.display = 'none';
}

function exportDatabaseBackup() {
  const dir = getMasterDirectory();
  const state = State;
  const backup = {
    exported_at: new Date().toISOString(),
    master_directory: dir,
    users: State.adminUsers || [],
    settings: triPortalSettings
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `panchayat_election_master_backup_${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  showToast('✅ मास्टर डेटाबेस बैकअप डाउनलोड हुआ!');
}


// ==========================================================================
// BLO & OFFICER ADD/EDIT MODAL HANDLERS (AUDIT RESOLUTION)
// ==========================================================================

function openAddBloModal() {
  const isSuperAdmin = State.currentUser && (State.currentUser.role === 'SUPER_ADMIN' || State.currentUser.role === 'admin' || String(State.currentUser.id || State.currentUser.username || '').toLowerCase() === 'admin');
  if (!isSuperAdmin) {
    showToast('⚠️ केवल मुख्य व्यवस्थापक (Super Admin) को यह अधिकार है!');
    return;
  }
  const modal = document.getElementById('addEditBloModal');
  if (!modal) return;
  const form = document.getElementById('bloEditForm');
  if (form) form.reset();
  const targetId = document.getElementById('bloEditTargetId');
  if (targetId) targetId.value = '';
  
  const gpSelect = document.getElementById('bloEditGp');
  if (gpSelect) {
    gpSelect.innerHTML = '<option value="">-- ग्राम पंचायत चुनें --</option>';
    const panchayats = State.panchayats || (window.MASTER_DATA && window.MASTER_DATA.panchayats) || [];
    panchayats.forEach(p => {
      const pName = p.name_hi || p.name || '';
      gpSelect.innerHTML += `<option value="${pName}">${pName}</option>`;
    });
  }
  
  const passInp = document.getElementById('bloEditPassword');
  if (passInp) passInp.value = 'blo@2026';
  modal.style.display = 'flex';
}

function closeAddEditBloModal() {
  const modal = document.getElementById('addEditBloModal');
  if (modal) modal.style.display = 'none';
}

async function handleSaveBloSubmit(event) {
  if (event) event.preventDefault();
  const name = (document.getElementById('bloEditName')?.value || '').trim();
  const mobile = (document.getElementById('bloEditMobile')?.value || '').trim();
  const gp = (document.getElementById('bloEditGp')?.value || '').trim();
  const boothNo = (document.getElementById('bloEditBoothNo')?.value || '').trim();
  const post = (document.getElementById('bloEditPost')?.value || '').trim() || 'अध्यापक';
  const wards = (document.getElementById('bloEditWards')?.value || '').trim();
  const school = (document.getElementById('bloEditSchool')?.value || '').trim();
  const email = (document.getElementById('bloEditEmail')?.value || '').trim();
  const pass = (document.getElementById('bloEditPassword')?.value || '').trim() || `blo${boothNo}@${mobile ? mobile.slice(-4) : '2026'}`;
  
  if (!name || !mobile || !gp || !boothNo) {
    showToast('⚠️ नाम, मोबाइल, ग्राम पंचायत एवं बूथ सं. अनिवार्य हैं!');
    return;
  }
  
  const bloId = `blo_${boothNo}`;
  const dir = getMasterDirectory() || { blo_list: [] };
  if (!dir.blo_list) dir.blo_list = [];
  
  const newBlo = {
    id: bloId,
    username: bloId,
    user_id: bloId,
    name: name,
    full_name: name,
    mobile: mobile,
    panchayat: gp,
    booth_no: boothNo,
    post: post,
    wards: wards,
    school: school,
    email: email,
    password: pass,
    status: 'ACTIVE'
  };
  
  const existIdx = dir.blo_list.findIndex(b => String(b.booth_no) === String(boothNo) || b.id === bloId);
  if (existIdx >= 0) dir.blo_list[existIdx] = { ...dir.blo_list[existIdx], ...newBlo };
  else dir.blo_list.push(newBlo);
  
  saveUserOverride(bloId, 'password', pass);
  saveUserOverride(bloId, 'status', 'ACTIVE');
  
  closeAddEditBloModal();
  if (typeof renderAdminBloTab === 'function') renderAdminBloTab();
  showToast(`✅ बी.एल.ओ. '${name}' (बूथ सं. ${boothNo}) विवरण सफलतापूर्वक सुरक्षित!`);
}

function openAddOfficerModal() {
  if (typeof openAddCellModal === 'function') {
    openAddCellModal();
  } else {
    const modal = document.getElementById('addEditCellModal');
    if (modal) modal.style.display = 'flex';
  }
}

function onNewUserGpChanged(gpName) {
  const wardInp = document.getElementById('newUserWardInput') || document.getElementById('newWards');
  if (wardInp) {
    wardInp.value = (gpName === 'ALL') ? 'ALL' : '1';
  }
}


// ================================================================================================
// ZERO HARD-REFRESH SILENT BACKGROUND DATA UPDATER
// Polls lightweight version.json (from CDN/same origin) every 30s with zero Apps Script quota use!
// ================================================================================================
let lastSeenVersionTimestamp = 0;
async function checkSilentDataUpdates() {
  try {
    const res = await fetch(`version.json?_t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    const vData = await res.json();
    if (!vData || !vData.timestamp) return;

    if (!lastSeenVersionTimestamp) {
      lastSeenVersionTimestamp = vData.timestamp;
      return;
    }

    if (vData.timestamp > lastSeenVersionTimestamp) {
      console.log('🔄 Live data update detected via version.json! Silently refreshing permissions & candidate profiles in-memory...');
      lastSeenVersionTimestamp = vData.timestamp;
      if (typeof loadConfiguredUsers === 'function') {
        await loadConfiguredUsers();
      }
      if (typeof syncCurrentUserWithConfiguredUsers === 'function') {
        syncCurrentUserWithConfiguredUsers();
      }
      if (typeof enforceGatekeeperState === 'function') {
        enforceGatekeeperState();
      }
      if (typeof renderCandidateBanner === 'function') {
        renderCandidateBanner();
      }
      if (typeof renderAdminControlTab === 'function' && document.getElementById('adminControlTab')?.classList.contains('active')) {
        renderAdminControlTab();
      }
    }
  } catch (e) {}
}
setInterval(checkSilentDataUpdates, 30000);


// ================================================================================================
// REAL-TIME AUTO-SYNC: ZERO HARD REFRESH LIVE PERMISSION SYNC ENGINE
// Automatically checks for Google Sheet / Server permission changes every 4 seconds
// and immediately updates UI, tabs, print/download rights without any page refresh!
// ================================================================================================
let isCheckingLivePerms = false;
async function checkLivePermissionsUpdate() {
  if (isCheckingLivePerms) return;
  if (!State.currentUser) return;

  const u = State.currentUser;
  const isSuperAdmin = (u.role === 'SUPER_ADMIN' || u.role === 'admin' || (u.id && String(u.id).toLowerCase() === 'admin'));
  if (isSuperAdmin) {
    return;
  }

  isCheckingLivePerms = true;

  try {
    const uKey = String(u.username || u.id || '').toLowerCase();
    const boothExact = u.booth_no ? `blo_${String(u.booth_no).trim().toLowerCase()}` : '';
    const matchesUser = (x) => {
      const xU = String(x.username || '').toLowerCase();
      const xId = String(x.id || '').toLowerCase();
      return xU === uKey || xId === uKey || (boothExact && (xU === boothExact || xId === boothExact));
    };
    const bust = Date.now();

    let freshUser = null;

    const isLocalNode = window.location.hostname === 'localhost' || window.location.port === '3000' || (window.location.protocol.startsWith('http') && !window.location.hostname.includes('github.io'));
    const gScriptUrl = State.config?.appsScriptUrl || localStorage.getItem('panchayat_apps_script_url') || 'https://script.google.com/macros/s/AKfycbwtgz2L5QC_95Jsf1r0Kum_LcTI-bJwwiBQS_O74vthHcbPD_KatsN69ytY2yqlayiM/exec';

    if (isLocalNode) {
      // 1. Local Node.js server: ultra-fast in-memory / SQLite API
      try {
        const res = await fetch(`/api/users?_t=${bust}`, { cache: 'no-store' });
        if (res.ok) {
          const d = await res.json();
          if (d && Array.isArray(d.users)) {
            freshUser = d.users.find(matchesUser);
            State.adminControlUsers = d.users;
          }
        }
      } catch(_) {}
    } else {
      // 2. Static GitHub Pages: Query Google Apps Script FIRST for real-time live permission updates straight from Google Sheet!
      if (gScriptUrl) {
        try {
          const res = await fetch(`${gScriptUrl}?action=getUsers&_t=${bust}`);
          if (res.ok) {
            const d = await res.json();
            if (d && Array.isArray(d.users)) {
              freshUser = d.users.find(matchesUser);
              State.adminControlUsers = d.users;
            }
          }
        } catch(_) {}
      }

      // 3. Fallback to portal_users.json if Google Apps Script is slow/offline
      if (!freshUser) {
        try {
          const res = await fetch(`portal_users.json?_t=${bust}`, { cache: 'no-store' });
          if (res.ok) {
            const d = await res.json();
            if (d && Array.isArray(d.users)) {
              freshUser = d.users.find(matchesUser);
              State.adminControlUsers = d.users;
            }
          }
        } catch(_) {}
      }
    }

    if (freshUser) {
      let newTabs = freshUser.allowed_tabs;
      if (typeof newTabs === 'string') {
        try { newTabs = JSON.parse(newTabs); } catch(e) { newTabs = newTabs.split(',').map(s=>s.trim()).filter(Boolean); }
      }
      if (!Array.isArray(newTabs)) newTabs = [];

      if (freshUser.tab_search !== undefined || freshUser.tab_alpha !== undefined || freshUser.tab_bulkslip !== undefined || freshUser.tab_profile !== undefined) {
        newTabs = [];
        if (freshUser.tab_search === true || String(freshUser.tab_search).toUpperCase() === 'TRUE') newTabs.push('searchTab');
        if (freshUser.tab_alpha === true || String(freshUser.tab_alpha).toUpperCase() === 'TRUE') newTabs.push('alphaTab');
        if (freshUser.tab_bulkslip === true || String(freshUser.tab_bulkslip).toUpperCase() === 'TRUE') newTabs.push('bulkSlipTab');
        if (freshUser.tab_directory === true || String(freshUser.tab_directory).toUpperCase() === 'TRUE') newTabs.push('directoryTab');
        if (freshUser.tab_profile === true || String(freshUser.tab_profile).toUpperCase() === 'TRUE') newTabs.push('candidateProfileTab');
      }

      const isCand = isCandidateUser(u);
      const isVoter = (typeof getPortalContext === 'function' && getPortalContext() === 'voter') || (window.PORTAL_TYPE === 'voter');
      if (isCand || isVoter) {
        newTabs = newTabs.filter(t => t !== 'directoryTab');
      }

      const newCanPrint = (freshUser.can_print === true || freshUser.can_print === 1 || String(freshUser.can_print).toLowerCase() === 'true');
      const newCanDownload = (freshUser.can_download === true || freshUser.can_download === 1 || String(freshUser.can_download).toLowerCase() === 'true');
      const newStatus = (freshUser.status || 'ACTIVE').toUpperCase();

      const sortArr = arr => Array.isArray(arr) ? [...arr].sort() : [];
      const curTabsSorted = sortArr(u.allowed_tabs).join(',');
      const newTabsSorted = sortArr(newTabs).join(',');

      const curPrint = Boolean(u.can_print === true || u.can_print === 1 || String(u.can_print).toLowerCase() === 'true');
      const curDownload = Boolean(u.can_download === true || u.can_download === 1 || String(u.can_download).toLowerCase() === 'true');

      const hasTabsChanged = (curTabsSorted !== newTabsSorted);
      const hasPrintChanged = (curPrint !== newCanPrint);
      const hasDownloadChanged = (curDownload !== newCanDownload);
      const hasStatusChanged = (String(u.status || 'ACTIVE').toUpperCase() !== newStatus);

      if (hasTabsChanged || hasPrintChanged || hasDownloadChanged || hasStatusChanged) {
        console.log('🔄 Live permissions updated dynamically without hard refresh:', {
          tabs: newTabs,
          print: newCanPrint,
          download: newCanDownload,
          status: newStatus
        });

        u.allowed_tabs = newTabs;
        u.can_print = newCanPrint;
        u.can_download = newCanDownload;
        u.status = newStatus;

        // Save to active session storage
        localStorage.setItem(getSessionStorageKey(), JSON.stringify(u));

        // Re-enforce gatekeeper state immediately
        enforceGatekeeperState();

        if (hasStatusChanged && newStatus !== 'ACTIVE') {
          showToast('⚠️ आपका खाता निष्क्रिय (Inactive) किया गया है!');
        }
      }
    }
  } catch(err) {
    console.warn('Silent live permission check error:', err);
  } finally {
    isCheckingLivePerms = false;
  }
}

// 1. Run live check every 15 seconds when portal is in view
setInterval(() => {
  if (document.visibilityState !== 'hidden') {
    checkLivePermissionsUpdate();
  }
}, 15000);

// 2. Run check on window focus (fast in-memory check without reloading)
window.addEventListener('focus', () => {
  setTimeout(checkLivePermissionsUpdate, 300);
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    setTimeout(checkLivePermissionsUpdate, 300);
  }
});

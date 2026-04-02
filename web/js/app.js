/**
 * DigiAsset Core UI — App Core
 * Router, RPC helper, auth state, sync polling.
 * Exposes a global `App` object for use by page modules.
 *
 * Security notes:
 * - All user-supplied or RPC-derived strings rendered into HTML
 *   MUST pass through esc() before insertion.
 * - Static SVG / hardcoded HTML strings (no user data) are safe
 *   to set via innerHTML and are clearly marked below.
 * - Credentials are kept in memory only, never in localStorage/cookies.
 */

(function () {
  'use strict';

  /* --------------------------------------------------------
     XSS Sanitizer — exported as window.esc for module reuse
  -------------------------------------------------------- */
  function esc(s) {
    const d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
  }
  window.esc = esc;

  /* --------------------------------------------------------
     Private State
  -------------------------------------------------------- */
  var _credentials = null;   // { username, password } — memory only, never persisted
  var _authed = false;
  var _syncState = null;
  var _version = null;
  var _modules = {};
  var _currentRoute = null;
  var _currentModule = null;
  var _authResolve = null;
  var _authReject = null;
  var _syncTimer = null;

  /* --------------------------------------------------------
     DOM References (populated on DOMContentLoaded)
  -------------------------------------------------------- */
  var elContent, elSyncDot, elSyncText, elAuthBtn, elAuthLabel,
      elAuthIcon, elVersionText, elAuthModal, elAuthUsername,
      elAuthPassword, elAuthError, elAuthSubmit, elAuthCancel,
      elSidebar, elSidebarToggle, elSidebarOverlay;

  /* --------------------------------------------------------
     RPC Helper
  -------------------------------------------------------- */

  /**
   * Send a JSON-RPC request to the DigiAsset Core endpoint.
   * Uses Basic Auth if credentials are set.
   * @param {string} method
   * @param {Array|Object} [params=[]]
   * @returns {Promise<any>} Resolves with the RPC result value.
   */
  function rpc(method, params) {
    var body = JSON.stringify({
      jsonrpc: '1.0',
      id: method,
      method: method,
      params: params !== undefined ? params : []
    });

    var headers = { 'Content-Type': 'application/json' };
    if (_credentials) {
      headers['Authorization'] =
        'Basic ' + btoa(_credentials.username + ':' + _credentials.password);
    }

    return fetch('/', {
      method: 'POST',
      headers: headers,
      body: body
    }).then(function (resp) {
      if (resp.status === 401) {
        var err = new Error('Unauthorized');
        err.code = 401;
        throw err;
      }
      return resp.json();
    }).then(function (data) {
      if (data.error) {
        var err = new Error(data.error.message || 'RPC error');
        err.code = data.error.code;
        throw err;
      }
      return data.result;
    });
  }

  /**
   * Like rpc(), but shows the auth modal first if not authenticated.
   * @param {string} method
   * @param {Array|Object} [params=[]]
   * @returns {Promise<any>}
   */
  function rpcAuth(method, params) {
    var p = _authed ? Promise.resolve() : showAuthModal();
    return p.then(function () { return rpc(method, params); });
  }

  /* --------------------------------------------------------
     Auth Modal
  -------------------------------------------------------- */

  /**
   * Show the auth modal. Returns a Promise that resolves when
   * the user successfully authenticates, or rejects on cancel.
   * @returns {Promise<void>}
   */
  function showAuthModal() {
    return new Promise(function (resolve, reject) {
      _authResolve = resolve;
      _authReject = reject;

      elAuthUsername.value = (_credentials && _credentials.username) || '';
      elAuthPassword.value = '';
      elAuthError.textContent = '';
      elAuthError.classList.add('hidden');
      elAuthModal.classList.remove('hidden');
      elAuthSubmit.disabled = false;
      elAuthSubmit.textContent = 'Sign In';

      if (!elAuthUsername.value) {
        elAuthUsername.focus();
      } else {
        elAuthPassword.focus();
      }
    });
  }

  function _hideAuthModal() {
    elAuthModal.classList.add('hidden');
    _authResolve = null;
    _authReject = null;
  }

  function _submitAuth() {
    var username = elAuthUsername.value.trim();
    var password = elAuthPassword.value;

    if (!username) {
      elAuthError.textContent = 'Username is required.';
      elAuthError.classList.remove('hidden');
      elAuthUsername.focus();
      return;
    }

    elAuthSubmit.disabled = true;
    elAuthSubmit.textContent = 'Verifying\u2026';
    elAuthError.classList.add('hidden');

    var prev = _credentials;
    _credentials = { username: username, password: password };

    rpc('syncstate').then(function () {
      _authed = true;
      _updateAuthButton();
      _hideAuthModal();
      if (_authResolve) _authResolve();
    }).catch(function (err) {
      _credentials = prev;
      // err.message comes from our own Error constructor — safe to display
      var msg = err.code === 401
        ? 'Invalid username or password.'
        : 'Authentication failed: ' + esc(err.message);
      elAuthError.textContent = msg;
      elAuthError.classList.remove('hidden');
      elAuthSubmit.disabled = false;
      elAuthSubmit.textContent = 'Sign In';
      elAuthPassword.focus();
    });
  }

  function _cancelAuth() {
    _hideAuthModal();
    if (_authReject) _authReject(new Error('Auth cancelled'));
  }

  function _updateAuthButton() {
    if (_authed) {
      elAuthBtn.classList.add('authenticated');
      elAuthLabel.textContent = 'Authenticated';
      // Static SVG — no user data, safe innerHTML
      elAuthIcon.innerHTML =
        '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>' +
        '<path d="M7 11V7a5 5 0 0 1 9.9-1"/>';
    } else {
      elAuthBtn.classList.remove('authenticated');
      elAuthLabel.textContent = 'Authenticate';
      // Static SVG — no user data, safe innerHTML
      elAuthIcon.innerHTML =
        '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>' +
        '<path d="M7 11V7a5 5 0 0 1 10 0v4"/>';
    }
  }

  /* --------------------------------------------------------
     Hash-Based Router
  -------------------------------------------------------- */

  /**
   * Parse location.hash into { route, params }.
   * Format: #/route?key=val
   * @returns {{ route: string, params: URLSearchParams }}
   */
  function parseHash() {
    var hash = location.hash || '#/dashboard';
    var withoutHash = hash.charAt(0) === '#' ? hash.slice(1) : hash;
    var parts = withoutHash.split('?');
    var path = parts[0];
    var query = parts[1] || '';
    var route = (path.charAt(0) === '/' ? path.slice(1) : path) || 'dashboard';
    var params = new URLSearchParams(query);
    return { route: route, params: params };
  }

  /**
   * Navigate to a route programmatically.
   * @param {string} route
   * @param {Object} [params]
   */
  function navigate(route, params) {
    var hash = '#/' + route;
    if (params && Object.keys(params).length > 0) {
      hash += '?' + new URLSearchParams(params).toString();
    }
    location.hash = hash;
  }

  function _handleRoute() {
    var parsed = parseHash();
    var route = parsed.route;
    var params = parsed.params;

    if (route === _currentRoute) return;
    _currentRoute = route;

    // Destroy previous module
    if (_currentModule && typeof _currentModule.destroy === 'function') {
      try { _currentModule.destroy(); } catch (e) { /* ignore */ }
    }
    _currentModule = null;

    // Update active nav link
    document.querySelectorAll('.nav-link').forEach(function (el) {
      if (el.dataset.route === route) {
        el.classList.add('active');
      } else {
        el.classList.remove('active');
      }
    });

    // Render module
    var mod = _modules[route];
    if (mod && typeof mod.render === 'function') {
      _currentModule = mod;
      try {
        mod.render(elContent, params);
      } catch (err) {
        // err.message sanitized via esc()
        elContent.textContent = '';
        var errDiv = document.createElement('div');
        errDiv.className = 'empty-state';
        var title = document.createElement('div');
        title.className = 'empty-state-title';
        title.textContent = 'Error';
        var text = document.createElement('div');
        text.className = 'empty-state-text';
        text.textContent = err.message;
        errDiv.appendChild(title);
        errDiv.appendChild(text);
        elContent.appendChild(errDiv);
      }
    } else {
      // Static message with only the route name escaped
      elContent.textContent = '';
      var wrap = document.createElement('div');
      wrap.className = 'empty-state';
      var icon = document.createElement('div');
      icon.className = 'empty-state-icon';
      icon.textContent = '\u25C6';
      var modTitle = document.createElement('div');
      modTitle.className = 'empty-state-title';
      modTitle.textContent = 'Module not loaded';
      var modText = document.createElement('div');
      modText.className = 'empty-state-text';
      modText.textContent = 'The \u201C' + route + '\u201D module has not been implemented yet.';
      wrap.appendChild(icon);
      wrap.appendChild(modTitle);
      wrap.appendChild(modText);
      elContent.appendChild(wrap);
    }

    // Close mobile sidebar after navigation
    _closeSidebar();
  }

  /* --------------------------------------------------------
     Sync Polling
  -------------------------------------------------------- */

  function _pollSync() {
    rpc('syncstate').then(function (result) {
      _syncState = result;
      var status = _deriveSyncStatus(result);
      elSyncDot.className = 'sync-dot ' + status.cls;
      elSyncText.textContent = status.text;
    }).catch(function () {
      elSyncDot.className = 'sync-dot error';
      elSyncText.textContent = _authed ? 'Offline' : 'Auth required';
    });
  }

  // syncstate returns { count: <block_height>, sync: <int> }
  // sync: 0 = synced, negative = blocks behind, 1 = stopped, 2 = initializing, 3 = rewinding, 4 = optimizing
  function _deriveSyncStatus(result) {
    if (!result) return { cls: 'error', text: 'No data' };

    var sync = result.sync;
    var count = result.count;

    if (sync === 0) {
      return { cls: 'synced', text: 'Synced \u2022 ' + Number(count).toLocaleString() };
    }
    if (sync < 0) {
      var behind = Math.abs(sync);
      return { cls: 'syncing', text: behind.toLocaleString() + ' blocks behind' };
    }
    if (sync === 1) return { cls: 'error', text: 'Stopped' };
    if (sync === 2) return { cls: 'syncing', text: 'Initializing\u2026' };
    if (sync === 3) return { cls: 'rewinding', text: 'Rewinding\u2026' };
    if (sync === 4) return { cls: 'syncing', text: 'Optimizing\u2026' };

    return { cls: 'syncing', text: 'State: ' + sync };
  }

  function _startSyncPolling() {
    _pollSync();
    _syncTimer = setInterval(_pollSync, 5000);
  }

  /* --------------------------------------------------------
     Version Fetch
  -------------------------------------------------------- */

  // version RPC returns a string directly, e.g. "0.3.3.0"
  function _fetchVersion() {
    rpc('version').then(function (result) {
      _version = String(result);
      elVersionText.textContent = 'v' + _version;
    }).catch(function () {
      // Not critical
    });
  }

  /* --------------------------------------------------------
     Module Registry
  -------------------------------------------------------- */

  /**
   * Register a page module.
   * Modules call this from their own file after app.js loads.
   * @param {string} name — route name matching data-route on nav links
   * @param {{ render: function(HTMLElement, URLSearchParams): void, destroy?: function(): void }} mod
   */
  function registerModule(name, mod) {
    _modules[name] = mod;
  }

  /* --------------------------------------------------------
     State Getters
  -------------------------------------------------------- */

  function getSyncState() { return _syncState; }
  function isAuthed() { return _authed; }
  function getCredentials() { return _credentials; }

  /* --------------------------------------------------------
     Mobile Sidebar
  -------------------------------------------------------- */

  function _openSidebar() {
    elSidebar.classList.add('open');
    elSidebarOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function _closeSidebar() {
    elSidebar.classList.remove('open');
    elSidebarOverlay.classList.remove('active');
    document.body.style.overflow = '';
  }

  function _toggleSidebar() {
    if (elSidebar.classList.contains('open')) {
      _closeSidebar();
    } else {
      _openSidebar();
    }
  }

  /* --------------------------------------------------------
     Init
  -------------------------------------------------------- */

  document.addEventListener('DOMContentLoaded', function () {
    elContent        = document.getElementById('content');
    elSyncDot        = document.getElementById('sync-dot');
    elSyncText       = document.getElementById('sync-text');
    elAuthBtn        = document.getElementById('auth-btn');
    elAuthLabel      = document.getElementById('auth-label');
    elAuthIcon       = document.getElementById('auth-icon');
    elVersionText    = document.getElementById('version-text');
    elAuthModal      = document.getElementById('auth-modal');
    elAuthUsername   = document.getElementById('auth-username');
    elAuthPassword   = document.getElementById('auth-password');
    elAuthError      = document.getElementById('auth-error');
    elAuthSubmit     = document.getElementById('auth-submit');
    elAuthCancel     = document.getElementById('auth-cancel');
    elSidebar        = document.getElementById('sidebar');
    elSidebarToggle  = document.getElementById('sidebar-toggle');
    elSidebarOverlay = document.getElementById('sidebar-overlay');

    // Auth button: show modal if not authed, clear auth if authed
    elAuthBtn.addEventListener('click', function () {
      if (_authed) {
        _credentials = null;
        _authed = false;
        _updateAuthButton();
      } else {
        showAuthModal().catch(function () { /* cancelled */ });
      }
    });

    elAuthSubmit.addEventListener('click', _submitAuth);
    elAuthCancel.addEventListener('click', _cancelAuth);

    elAuthPassword.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') _submitAuth();
    });
    elAuthUsername.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') elAuthPassword.focus();
    });

    // Close modal on backdrop click
    elAuthModal.addEventListener('click', function (e) {
      if (e.target === elAuthModal || e.target.classList.contains('modal-backdrop')) {
        _cancelAuth();
      }
    });

    // Mobile sidebar
    elSidebarToggle.addEventListener('click', _toggleSidebar);
    elSidebarOverlay.addEventListener('click', _closeSidebar);

    // Escape closes modal or sidebar
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (!elAuthModal.classList.contains('hidden')) {
          _cancelAuth();
        } else {
          _closeSidebar();
        }
      }
    });

    // Hash router
    window.addEventListener('hashchange', _handleRoute);

    if (!location.hash || location.hash === '#') {
      location.hash = '#/dashboard';
    }

    // Defer initial route so modules have time to register
    setTimeout(_handleRoute, 0);

    // All DigiAsset Core RPC calls require auth — prompt immediately
    showAuthModal().then(function () {
      _startSyncPolling();
      _fetchVersion();
    }).catch(function () {
      // User cancelled — start polling anyway (will show "Auth required")
      _startSyncPolling();
    });
  });

  /* --------------------------------------------------------
     Public API
  -------------------------------------------------------- */
  window.App = {
    rpc: rpc,
    rpcAuth: rpcAuth,
    showAuthModal: showAuthModal,
    navigate: navigate,
    parseHash: parseHash,
    registerModule: registerModule,
    getSyncState: getSyncState,
    isAuthed: isAuthed,
    getCredentials: getCredentials,
    esc: esc
  };

})();

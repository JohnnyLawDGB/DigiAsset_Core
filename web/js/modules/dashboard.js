/**
 * DigiAsset Core UI — Dashboard Module
 * Displays sync state, asset count, IPFS status, node version,
 * quick actions, and a recent assets table.
 * Refreshes every 15 seconds.
 */
(function () {
  'use strict';

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
  }

  var _interval = null;

  function render(container, params) {
    container.textContent = '';

    // Page skeleton — no user data here, safe static HTML
    var page = document.createElement('div');
    page.className = 'page';

    var header = document.createElement('div');
    header.className = 'page-header';
    var title = document.createElement('h1');
    title.className = 'page-title';
    title.textContent = 'Dashboard';
    header.appendChild(title);
    page.appendChild(header);

    // Cards grid
    var grid = document.createElement('div');
    grid.className = 'cards-grid';
    grid.id = 'dash-cards';
    page.appendChild(grid);

    // Quick Actions
    var actSection = document.createElement('div');
    actSection.className = 'section';
    var actTitle = document.createElement('h2');
    actTitle.className = 'section-title';
    actTitle.textContent = 'Quick Actions';
    actSection.appendChild(actTitle);

    var btnGroup = document.createElement('div');
    btnGroup.className = 'btn-group';

    var actions = [
      { label: 'Create Asset', href: '#/create' },
      { label: 'Browse Assets', href: '#/explorer' },
      { label: 'View Wallets', href: '#/wallets' }
    ];
    actions.forEach(function (a) {
      var btn = document.createElement('a');
      btn.className = 'btn btn-primary';
      btn.href = a.href;
      btn.textContent = a.label;
      btnGroup.appendChild(btn);
    });
    actSection.appendChild(btnGroup);
    page.appendChild(actSection);

    // Recent Assets section
    var recentSection = document.createElement('div');
    recentSection.className = 'section';
    var recentTitle = document.createElement('h2');
    recentTitle.className = 'section-title';
    recentTitle.textContent = 'Recent Assets';
    recentSection.appendChild(recentTitle);

    var recentWrap = document.createElement('div');
    recentWrap.id = 'dash-recent';
    recentWrap.textContent = 'Loading\u2026';
    recentSection.appendChild(recentWrap);
    page.appendChild(recentSection);

    container.appendChild(page);

    // Initial load + schedule refresh
    _loadDashboard(grid, recentWrap);

    if (_interval) clearInterval(_interval);
    _interval = setInterval(function () {
      _loadDashboard(grid, recentWrap);
    }, 15000);
  }

  function _loadDashboard(grid, recentWrap) {
    var sync = App.getSyncState();
    var syncHeight = sync ? (sync.height || sync.current || '—') : '—';
    var syncPct = sync && sync.percent !== undefined ? Math.round(sync.percent) + '%' : null;
    var syncState = sync ? String(sync.state || sync.status || 'Unknown') : 'Unknown';

    _renderSyncCard(grid, syncHeight, syncPct, syncState);

    Promise.all([
      App.rpc('listassets').catch(function () { return null; }),
      App.rpc('getipfscount').catch(function () { return null; }),
      App.rpc('version').catch(function () { return null; }),
      App.rpc('listlastassets', [5]).catch(function () { return null; })
    ]).then(function (results) {
      var assets   = results[0];
      var ipfs     = results[1];
      var version  = results[2];
      var recent   = results[3];

      _renderCards(grid, assets, ipfs, version, syncHeight, syncPct, syncState);
      _renderRecent(recentWrap, recent);
    });
  }

  function _renderSyncCard(grid, height, pct, state) {
    // Only set sync card content if it already exists; full render in _renderCards
  }

  function _renderCards(grid, assets, ipfs, version, syncHeight, syncPct, syncState) {
    grid.textContent = '';

    // Sync card
    var syncCard = _makeCard('Sync', '\u25A3');
    var syncBody = document.createElement('div');
    syncBody.className = 'card-body';

    var syncHeightEl = document.createElement('div');
    syncHeightEl.className = 'card-value';
    syncHeightEl.textContent = esc(syncHeight);
    syncBody.appendChild(syncHeightEl);

    var syncStateEl = document.createElement('div');
    syncStateEl.className = 'card-label';
    syncStateEl.textContent = esc(syncState);
    syncBody.appendChild(syncStateEl);

    if (syncPct !== null) {
      var bar = document.createElement('div');
      bar.className = 'progress-bar-wrap';
      var fill = document.createElement('div');
      fill.className = 'progress-bar-fill';
      fill.style.width = esc(syncPct);
      bar.appendChild(fill);
      syncBody.appendChild(bar);

      var pctLabel = document.createElement('div');
      pctLabel.className = 'card-sublabel';
      pctLabel.textContent = esc(syncPct);
      syncBody.appendChild(pctLabel);
    }

    syncCard.appendChild(syncBody);
    grid.appendChild(syncCard);

    // Assets card
    var assetCard = _makeCard('Assets', '\u25C6');
    var assetBody = document.createElement('div');
    assetBody.className = 'card-body';
    var assetCount = document.createElement('div');
    assetCount.className = 'card-value';
    assetCount.textContent = assets !== null ? esc(assets.length) : '—';
    assetBody.appendChild(assetCount);
    var assetLabel = document.createElement('div');
    assetLabel.className = 'card-label';
    assetLabel.textContent = 'Total assets indexed';
    assetBody.appendChild(assetLabel);
    assetCard.appendChild(assetBody);
    grid.appendChild(assetCard);

    // IPFS card
    var ipfsCard = _makeCard('IPFS', '\u25CB');
    var ipfsBody = document.createElement('div');
    ipfsBody.className = 'card-body';
    var ipfsStatus = document.createElement('div');
    ipfsStatus.className = 'card-value';
    if (ipfs !== null && ipfs !== undefined) {
      ipfsStatus.textContent = 'Connected';
      ipfsStatus.classList.add('status-ok');
    } else {
      ipfsStatus.textContent = 'Offline';
      ipfsStatus.classList.add('status-error');
    }
    ipfsBody.appendChild(ipfsStatus);
    var ipfsCount = document.createElement('div');
    ipfsCount.className = 'card-label';
    ipfsCount.textContent = ipfs !== null && ipfs !== undefined ? esc(ipfs) + ' items cached' : 'Not reachable';
    ipfsBody.appendChild(ipfsCount);
    ipfsCard.appendChild(ipfsBody);
    grid.appendChild(ipfsCard);

    // Node card
    var nodeCard = _makeCard('Node', '\u25B6');
    var nodeBody = document.createElement('div');
    nodeBody.className = 'card-body';
    var nodeVersion = document.createElement('div');
    nodeVersion.className = 'card-value';
    nodeVersion.textContent = version !== null && version !== undefined ? esc(version) : '—';
    nodeBody.appendChild(nodeVersion);
    var nodeLabel = document.createElement('div');
    nodeLabel.className = 'card-label';
    nodeLabel.textContent = 'DigiAsset Core version';
    nodeBody.appendChild(nodeLabel);
    nodeCard.appendChild(nodeBody);
    grid.appendChild(nodeCard);
  }

  function _makeCard(title, icon) {
    var card = document.createElement('div');
    card.className = 'card';
    var cardHeader = document.createElement('div');
    cardHeader.className = 'card-header';
    var cardIcon = document.createElement('span');
    cardIcon.className = 'card-icon';
    cardIcon.textContent = icon;
    var cardTitle = document.createElement('span');
    cardTitle.className = 'card-title';
    cardTitle.textContent = title;
    cardHeader.appendChild(cardIcon);
    cardHeader.appendChild(cardTitle);
    card.appendChild(cardHeader);
    return card;
  }

  function _renderRecent(wrap, assets) {
    wrap.textContent = '';

    if (!assets || assets.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'empty-state';
      var emptyIcon = document.createElement('div');
      emptyIcon.className = 'empty-state-icon';
      emptyIcon.textContent = '\u25C6';
      var emptyTitle = document.createElement('div');
      emptyTitle.className = 'empty-state-title';
      emptyTitle.textContent = 'No assets yet';
      var emptyText = document.createElement('div');
      emptyText.className = 'empty-state-text';
      emptyText.textContent = 'Assets will appear here as they are indexed.';
      empty.appendChild(emptyIcon);
      empty.appendChild(emptyTitle);
      empty.appendChild(emptyText);
      wrap.appendChild(empty);
      return;
    }

    var tableWrap = document.createElement('div');
    tableWrap.className = 'table-wrap';
    var table = document.createElement('table');
    table.className = 'data-table';

    var thead = document.createElement('thead');
    var headerRow = document.createElement('tr');
    ['Asset ID', 'Height', 'CID'].forEach(function (col) {
      var th = document.createElement('th');
      th.textContent = col;
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    assets.forEach(function (asset) {
      var tr = document.createElement('tr');

      // Asset ID cell — linked to explorer
      var tdId = document.createElement('td');
      var link = document.createElement('a');
      var assetId = String(asset.assetId || asset.assetindex || asset.index || '');
      var assetIndex = asset.assetIndex !== undefined ? asset.assetIndex : asset.index;
      link.href = '#/explorer/' + encodeURIComponent(assetIndex !== undefined ? assetIndex : assetId);
      link.textContent = assetId.length > 16 ? assetId.slice(0, 8) + '\u2026' + assetId.slice(-6) : assetId;
      link.title = assetId;
      tdId.appendChild(link);
      tr.appendChild(tdId);

      // Height
      var tdHeight = document.createElement('td');
      tdHeight.textContent = esc(asset.height !== undefined ? asset.height : '—');
      tr.appendChild(tdHeight);

      // CID
      var tdCid = document.createElement('td');
      var cid = String(asset.cid || asset.metaCid || '—');
      tdCid.textContent = cid.length > 20 ? cid.slice(0, 12) + '\u2026' : cid;
      tdCid.title = cid;
      tr.appendChild(tdCid);

      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    tableWrap.appendChild(table);
    wrap.appendChild(tableWrap);
  }

  function destroy() {
    if (_interval) {
      clearInterval(_interval);
      _interval = null;
    }
  }

  App.registerModule('dashboard', { render: render, destroy: destroy });

})();

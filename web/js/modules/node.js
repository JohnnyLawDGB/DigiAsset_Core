/**
 * DigiAsset Core UI — Node Status Module
 * Displays sync state, chain tip, IPFS status, version,
 * exchange rates table, and PSP info.
 * Refreshes every 10 seconds.
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

    var page = document.createElement('div');
    page.className = 'page';

    var header = document.createElement('div');
    header.className = 'page-header';
    var title = document.createElement('h1');
    title.className = 'page-title';
    title.textContent = 'Node Status';
    header.appendChild(title);
    page.appendChild(header);

    // Cards grid placeholder
    var grid = document.createElement('div');
    grid.className = 'cards-grid';
    grid.id = 'node-cards';
    page.appendChild(grid);

    // Exchange Rates section
    var ratesSection = document.createElement('div');
    ratesSection.className = 'section';
    var ratesTitle = document.createElement('h2');
    ratesTitle.className = 'section-title';
    ratesTitle.textContent = 'Exchange Rates';
    ratesSection.appendChild(ratesTitle);
    var ratesWrap = document.createElement('div');
    ratesWrap.id = 'node-rates';
    ratesWrap.textContent = 'Loading\u2026';
    ratesSection.appendChild(ratesWrap);
    page.appendChild(ratesSection);

    // PSP section
    var pspSection = document.createElement('div');
    pspSection.className = 'section';
    var pspTitle = document.createElement('h2');
    pspTitle.className = 'section-title';
    pspTitle.textContent = 'PSP';
    pspSection.appendChild(pspTitle);
    var pspWrap = document.createElement('div');
    pspWrap.id = 'node-psp';
    pspWrap.textContent = 'Loading\u2026';
    pspSection.appendChild(pspWrap);
    page.appendChild(pspSection);

    container.appendChild(page);

    _loadNode(grid, ratesWrap, pspWrap);

    if (_interval) clearInterval(_interval);
    _interval = setInterval(function () {
      _loadNode(grid, ratesWrap, pspWrap);
    }, 10000);
  }

  function _loadNode(grid, ratesWrap, pspWrap) {
    var sync = App.getSyncState();

    Promise.all([
      App.rpc('getblockcount').catch(function () { return null; }),
      App.rpc('getipfscount').catch(function () { return null; }),
      App.rpc('version').catch(function () { return null; }),
      App.rpc('getexchangerates').catch(function () { return null; }),
      App.rpc('getpsp').catch(function () { return null; })
    ]).then(function (results) {
      var blockcount   = results[0];
      var ipfscount    = results[1];
      var version      = results[2];
      var rates        = results[3];
      var psp          = results[4];

      _renderCards(grid, sync, blockcount, ipfscount, version);
      _renderRates(ratesWrap, rates);
      _renderPsp(pspWrap, psp);
    });
  }

  function _renderCards(grid, sync, blockcount, ipfscount, version) {
    grid.textContent = '';

    var syncHeight = sync ? (sync.height || sync.current || '—') : '—';
    var syncState  = sync ? String(sync.state || sync.status || 'Unknown') : 'Unknown';
    var syncPct    = sync && sync.percent !== undefined ? Math.round(sync.percent) + '%' : null;

    // Sync card
    var syncCard = _makeCard('Sync', '\u25A3');
    var syncBody = document.createElement('div');
    syncBody.className = 'card-body';
    var syncVal = document.createElement('div');
    syncVal.className = 'card-value';
    syncVal.textContent = esc(syncHeight);
    syncBody.appendChild(syncVal);
    var syncDetail = document.createElement('div');
    syncDetail.className = 'card-label';
    var detailStr = esc(syncState);
    if (syncPct) detailStr += ' \u00B7 ' + esc(syncPct);
    syncDetail.textContent = syncState + (syncPct ? ' \u00B7 ' + syncPct : '');
    syncBody.appendChild(syncDetail);
    syncCard.appendChild(syncBody);
    grid.appendChild(syncCard);

    // Chain Tip card
    var tipCard = _makeCard('Chain Tip', '\u25B6');
    var tipBody = document.createElement('div');
    tipBody.className = 'card-body';
    var tipVal = document.createElement('div');
    tipVal.className = 'card-value';
    tipVal.textContent = blockcount !== null && blockcount !== undefined ? esc(blockcount) : '—';
    tipBody.appendChild(tipVal);
    var tipLabel = document.createElement('div');
    tipLabel.className = 'card-label';
    tipLabel.textContent = 'Current block height';
    tipBody.appendChild(tipLabel);
    tipCard.appendChild(tipBody);
    grid.appendChild(tipCard);

    // IPFS card
    var ipfsCard = _makeCard('IPFS', '\u25CB');
    var ipfsBody = document.createElement('div');
    ipfsBody.className = 'card-body';
    var ipfsStatus = document.createElement('div');
    ipfsStatus.className = 'card-value';
    if (ipfscount !== null && ipfscount !== undefined) {
      ipfsStatus.textContent = 'Connected';
      ipfsStatus.classList.add('status-ok');
    } else {
      ipfsStatus.textContent = 'Offline';
      ipfsStatus.classList.add('status-error');
    }
    ipfsBody.appendChild(ipfsStatus);
    var ipfsLabel = document.createElement('div');
    ipfsLabel.className = 'card-label';
    ipfsLabel.textContent = ipfscount !== null && ipfscount !== undefined
      ? esc(ipfscount) + ' items'
      : 'Not reachable';
    ipfsBody.appendChild(ipfsLabel);
    ipfsCard.appendChild(ipfsBody);
    grid.appendChild(ipfsCard);

    // Version card
    var vCard = _makeCard('Version', '\u2139');
    var vBody = document.createElement('div');
    vBody.className = 'card-body';
    var vVal = document.createElement('div');
    vVal.className = 'card-value';
    vVal.textContent = version !== null && version !== undefined ? esc(version) : '—';
    vBody.appendChild(vVal);
    var vLabel = document.createElement('div');
    vLabel.className = 'card-label';
    vLabel.textContent = 'DigiAsset Core';
    vBody.appendChild(vLabel);
    vCard.appendChild(vBody);
    grid.appendChild(vCard);
  }

  function _renderRates(wrap, rates) {
    wrap.textContent = '';

    if (!rates || typeof rates !== 'object') {
      wrap.textContent = 'Exchange rate data unavailable.';
      return;
    }

    var entries = Object.entries(rates);
    if (entries.length === 0) {
      wrap.textContent = 'No exchange rate data.';
      return;
    }

    var tableWrap = document.createElement('div');
    tableWrap.className = 'table-wrap';
    var table = document.createElement('table');
    table.className = 'data-table';

    var thead = document.createElement('thead');
    var hr = document.createElement('tr');
    ['Currency', 'Rate'].forEach(function (col) {
      var th = document.createElement('th');
      th.textContent = col;
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    entries.forEach(function (entry) {
      var tr = document.createElement('tr');
      var tdCur = document.createElement('td');
      tdCur.textContent = String(entry[0]).toUpperCase();
      tr.appendChild(tdCur);
      var tdRate = document.createElement('td');
      tdRate.className = 'mono';
      tdRate.textContent = esc(entry[1]);
      tr.appendChild(tdRate);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    tableWrap.appendChild(table);
    wrap.appendChild(tableWrap);
  }

  function _renderPsp(wrap, psp) {
    wrap.textContent = '';

    if (psp === null || psp === undefined) {
      wrap.textContent = 'PSP data unavailable.';
      return;
    }

    var card = document.createElement('div');
    card.className = 'card';
    var body = document.createElement('div');
    body.className = 'card-body';
    var pre = document.createElement('pre');
    pre.className = 'json-block';
    pre.textContent = JSON.stringify(psp, null, 2);
    body.appendChild(pre);
    card.appendChild(body);
    wrap.appendChild(card);
  }

  function _makeCard(title, icon) {
    var card = document.createElement('div');
    card.className = 'card';
    var cardHeader = document.createElement('div');
    cardHeader.className = 'card-header';
    if (icon) {
      var cardIcon = document.createElement('span');
      cardIcon.className = 'card-icon';
      cardIcon.textContent = icon;
      cardHeader.appendChild(cardIcon);
    }
    var cardTitle = document.createElement('span');
    cardTitle.className = 'card-title';
    cardTitle.textContent = title;
    cardHeader.appendChild(cardTitle);
    card.appendChild(cardHeader);
    return card;
  }

  function destroy() {
    if (_interval) {
      clearInterval(_interval);
      _interval = null;
    }
  }

  App.registerModule('node', { render: render, destroy: destroy });

})();

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

    // syncstate returns { count: <block_height>, sync: <int> }
    // sync: 0=synced, negative=blocks behind, 1=stopped, 2=initializing, 3=rewinding, 4=optimizing
    var syncHeight = sync ? Number(sync.count).toLocaleString() : '—';
    var syncVal    = sync ? sync.sync : null;
    var syncPct    = null; // not provided by API
    var syncState  = 'Unknown';
    if (sync !== null && sync !== undefined) {
      if (syncVal === 0) syncState = 'Synced';
      else if (syncVal < 0) syncState = Math.abs(syncVal).toLocaleString() + ' blocks behind';
      else if (syncVal === 1) syncState = 'Stopped';
      else if (syncVal === 2) syncState = 'Initializing';
      else if (syncVal === 3) syncState = 'Rewinding';
      else if (syncVal === 4) syncState = 'Optimizing';
      else syncState = 'State: ' + syncVal;
    }

    // Sync card
    var syncCard = _makeCard('Sync', '\u25A3');
    var syncBody = document.createElement('div');
    syncBody.className = 'card-body';
    var syncHeightEl = document.createElement('div');
    syncHeightEl.className = 'card-value';
    syncHeightEl.textContent = syncHeight;
    syncBody.appendChild(syncHeightEl);
    var syncDetail = document.createElement('div');
    syncDetail.className = 'card-label';
    syncDetail.textContent = syncState;
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

    // getexchangerates returns an array of on-chain exchange rate records:
    // [{ address, height, index, value }, ...]
    if (!rates || !Array.isArray(rates)) {
      wrap.textContent = 'Exchange rate data unavailable.';
      return;
    }

    if (rates.length === 0) {
      wrap.textContent = 'No exchange rate data.';
      return;
    }

    var tableWrap = document.createElement('div');
    tableWrap.className = 'table-wrap';
    var table = document.createElement('table');
    table.className = 'data-table';

    var thead = document.createElement('thead');
    var hr = document.createElement('tr');
    ['Address', 'Height', 'Index', 'Value'].forEach(function (col) {
      var th = document.createElement('th');
      th.textContent = col;
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    rates.forEach(function (record) {
      var tr = document.createElement('tr');

      // Address — truncated for display
      var addr = String(record.address || '—');
      var tdAddr = document.createElement('td');
      tdAddr.className = 'mono';
      tdAddr.textContent = addr.length > 20 ? addr.slice(0, 10) + '\u2026' + addr.slice(-6) : addr;
      tdAddr.title = addr;
      tr.appendChild(tdAddr);

      var tdHeight = document.createElement('td');
      tdHeight.textContent = esc(record.height !== undefined ? record.height : '—');
      tr.appendChild(tdHeight);

      var tdIndex = document.createElement('td');
      tdIndex.textContent = esc(record.index !== undefined ? record.index : '—');
      tr.appendChild(tdIndex);

      var tdValue = document.createElement('td');
      tdValue.className = 'mono';
      tdValue.textContent = esc(record.value !== undefined ? record.value : '—');
      tr.appendChild(tdValue);

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

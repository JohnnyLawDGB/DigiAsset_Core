/**
 * DigiAsset Core UI — Explorer Module
 * Three views: list, asset detail, address holdings.
 * Sub-routing is parsed from location.hash path segments.
 */
(function () {
  'use strict';

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
  }

  // Resolve an asset-metadata media reference (typically "ipfs://<cid>") to a
  // fetchable URL. The node does not expose an IPFS gateway through the proxy, so
  // we resolve via a public IPFS gateway. The CID is validated to a safe charset
  // before being placed in the URL (defense against injection from RPC-derived data).
  function _ipfsToGateway(url) {
    if (typeof url !== 'string' || !url) return '';
    if (url.indexOf('http://') === 0 || url.indexOf('https://') === 0) return url;
    var rest = url;
    if (rest.indexOf('ipfs://') === 0) rest = rest.slice(7);
    if (rest.indexOf('ipfs/') === 0) rest = rest.slice(5);
    var slash = rest.indexOf('/');
    var path = '';
    if (slash >= 0) { path = rest.slice(slash); rest = rest.slice(0, slash); }
    if (!/^[A-Za-z0-9]+$/.test(rest)) return '';        // validate CID charset
    if (!/^[A-Za-z0-9/._-]*$/.test(path)) path = '';    // keep only safe path chars
    return 'https://' + rest + '.ipfs.dweb.link' + path;
  }

  // Parse sub-path segments after #/explorer
  // Returns an array of path segments
  function _getParams() {
    var hash = location.hash || '';
    // Remove leading #/
    var path = hash.replace(/^#\//, '');
    // Split by /
    var parts = path.split('/');
    // parts[0] is 'explorer', rest are params
    var params = parts.slice(1);
    return params;
  }

  function render(container, urlParams) {
    var params = _getParams();
    container.textContent = '';

    if (params.length === 0) {
      _renderList(container);
    } else if (params[0] === 'address') {
      var addr = params[1] ? decodeURIComponent(params[1]) : '';
      _renderAddress(container, addr);
    } else {
      var assetIndex = decodeURIComponent(params[0]);
      _renderDetail(container, assetIndex);
    }
  }

  /* ---- List View ---- */
  function _renderList(container) {
    var page = document.createElement('div');
    page.className = 'page';

    var header = document.createElement('div');
    header.className = 'page-header';
    var title = document.createElement('h1');
    title.className = 'page-title';
    title.textContent = 'Asset Explorer';
    header.appendChild(title);
    page.appendChild(header);

    // Search bar
    var searchSection = document.createElement('div');
    searchSection.className = 'section';
    var searchRow = document.createElement('div');
    searchRow.className = 'search-row';
    var searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'input search-input';
    searchInput.placeholder = 'Search by asset index or address (D…, S…, dgb1…)';
    var searchBtn = document.createElement('button');
    searchBtn.className = 'btn btn-primary';
    searchBtn.textContent = 'Search';
    searchRow.appendChild(searchInput);
    searchRow.appendChild(searchBtn);
    searchSection.appendChild(searchRow);
    page.appendChild(searchSection);

    function doSearch() {
      var val = searchInput.value.trim();
      if (!val) return;
      // Address detection: starts with D, S, dgb1 (case-insensitive)
      if (/^(D|S|dgb1)/i.test(val)) {
        location.hash = '#/explorer/address/' + encodeURIComponent(val);
      } else {
        location.hash = '#/explorer/' + encodeURIComponent(val);
      }
    }

    searchBtn.addEventListener('click', doSearch);
    searchInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') doSearch();
    });

    // Asset table
    var tableSection = document.createElement('div');
    tableSection.className = 'section';
    var tableTitle = document.createElement('h2');
    tableTitle.className = 'section-title';
    tableTitle.textContent = 'Recent Assets';
    tableSection.appendChild(tableTitle);

    var tableWrap = document.createElement('div');
    tableWrap.className = 'table-wrap';
    tableWrap.textContent = 'Loading\u2026';
    tableSection.appendChild(tableWrap);
    page.appendChild(tableSection);

    container.appendChild(page);

    App.rpc('listlastassets', [50]).then(function (assets) {
      tableWrap.textContent = '';
      if (!assets || assets.length === 0) {
        tableWrap.textContent = 'No assets found.';
        return;
      }
      var table = document.createElement('table');
      table.className = 'data-table';

      var thead = document.createElement('thead');
      var hr = document.createElement('tr');
      ['Asset ID', 'Index', 'Height', 'CID'].forEach(function (col) {
        var th = document.createElement('th');
        th.textContent = col;
        hr.appendChild(th);
      });
      thead.appendChild(hr);
      table.appendChild(thead);

      var tbody = document.createElement('tbody');
      assets.forEach(function (asset) {
        var tr = document.createElement('tr');

        var assetId = String(asset.assetId || asset.assetid || '');
        var assetIndex = asset.assetIndex !== undefined ? asset.assetIndex : (asset.index !== undefined ? asset.index : '');
        var height = asset.height !== undefined ? asset.height : '—';
        var cid = String(asset.cid || asset.metaCid || '—');

        // Asset ID (linked, truncated)
        var tdId = document.createElement('td');
        var link = document.createElement('a');
        link.href = '#/explorer/' + encodeURIComponent(String(assetIndex));
        link.textContent = assetId.length > 16 ? assetId.slice(0, 8) + '\u2026' + assetId.slice(-6) : (assetId || String(assetIndex));
        link.title = assetId;
        tdId.appendChild(link);
        tr.appendChild(tdId);

        // Index
        var tdIndex = document.createElement('td');
        tdIndex.textContent = esc(assetIndex);
        tr.appendChild(tdIndex);

        // Height
        var tdHeight = document.createElement('td');
        tdHeight.textContent = esc(height);
        tr.appendChild(tdHeight);

        // CID (truncated)
        var tdCid = document.createElement('td');
        tdCid.className = 'mono';
        tdCid.textContent = cid.length > 20 ? cid.slice(0, 12) + '\u2026' : cid;
        tdCid.title = cid;
        tr.appendChild(tdCid);

        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      tableWrap.appendChild(table);
    }).catch(function (err) {
      tableWrap.textContent = 'Error loading assets: ' + String(err.message || err);
    });
  }

  /* ---- Detail View ---- */
  function _renderDetail(container, assetIndex) {
    var page = document.createElement('div');
    page.className = 'page';

    var backLink = document.createElement('a');
    backLink.href = '#/explorer';
    backLink.className = 'back-link';
    backLink.textContent = '\u2190 Back to Explorer';
    page.appendChild(backLink);

    var header = document.createElement('div');
    header.className = 'page-header';
    var title = document.createElement('h1');
    title.className = 'page-title';
    title.textContent = 'Asset #' + esc(assetIndex);
    header.appendChild(title);
    page.appendChild(header);

    var contentWrap = document.createElement('div');
    contentWrap.textContent = 'Loading\u2026';
    page.appendChild(contentWrap);

    container.appendChild(page);

    var idx = parseInt(assetIndex, 10);

    // getassetdata and getassetholders both take INTEGER assetIndex
    // listassetissuances takes STRING assetId — fetch sequentially after asset data
    App.rpc('getassetdata', [idx]).then(function (asset) {
      var assetId = asset ? (asset.assetId || asset.assetid || '') : '';
      return Promise.all([
        Promise.resolve(asset),
        App.rpc('getassetholders', [idx]).catch(function () { return null; }),
        assetId ? App.rpc('listassetissuances', [assetId]).catch(function () { return null; }) : Promise.resolve(null)
      ]);
    }).then(function (results) {
      var asset = results[0];
      var holders = results[1];
      var issuances = results[2];

      contentWrap.textContent = '';

      if (!asset) {
        contentWrap.textContent = 'Asset not found.';
        return;
      }

      // Cards grid
      var grid = document.createElement('div');
      grid.className = 'cards-grid';

      // Asset info card
      var infoCard = _makeCard('Asset Info');
      var infoBody = document.createElement('div');
      infoBody.className = 'card-body detail-list';

      // Asset name and description live under asset.ipfs.data
      var ipfsData = (asset.ipfs && asset.ipfs.data) ? asset.ipfs.data : {};
      var assetName = ipfsData.assetName || '—';
      var assetDesc = ipfsData.description || '—';
      // Issuer address lives under asset.issuer.address
      var issuerAddr = (asset.issuer && asset.issuer.address) ? asset.issuer.address : '—';

      var fields = [
        ['Name', assetName],
        ['Asset ID', asset.assetId || asset.assetid || '—'],
        ['Index', asset.assetIndex !== undefined ? asset.assetIndex : (asset.index !== undefined ? asset.index : idx)],
        ['Issuer', issuerAddr],
        ['CID', asset.cid || asset.metaCid || '—'],
        ['Height', asset.height !== undefined ? asset.height : '—'],
        ['Description', assetDesc]
      ];
      fields.forEach(function (f) {
        var row = document.createElement('div');
        row.className = 'detail-row';
        var label = document.createElement('span');
        label.className = 'detail-label';
        label.textContent = f[0] + ': ';
        var value = document.createElement('span');
        value.className = 'detail-value mono';
        value.textContent = String(f[1]);
        row.appendChild(label);
        row.appendChild(value);
        infoBody.appendChild(row);
      });
      infoCard.appendChild(infoBody);
      grid.appendChild(infoCard);

      // Supply card
      var supplyCard = _makeCard('Supply');
      var supplyBody = document.createElement('div');
      supplyBody.className = 'card-body detail-list';
      var supplyFields = [
        ['Count', asset.count !== undefined ? asset.count : (asset.supply !== undefined ? asset.supply : '—')],
        ['Decimals', asset.decimals !== undefined ? asset.decimals : '—']
      ];
      supplyFields.forEach(function (f) {
        var row = document.createElement('div');
        row.className = 'detail-row';
        var label = document.createElement('span');
        label.className = 'detail-label';
        label.textContent = f[0] + ': ';
        var value = document.createElement('span');
        value.className = 'detail-value';
        value.textContent = String(f[1]);
        row.appendChild(label);
        row.appendChild(value);
        supplyBody.appendChild(row);
      });
      supplyCard.appendChild(supplyBody);
      grid.appendChild(supplyCard);

      // Media card — render the asset icon/image from ipfs.data.urls[] (if any)
      var mediaUrls = Array.isArray(ipfsData.urls) ? ipfsData.urls : [];
      var imgEntry = null;
      for (var mi = 0; mi < mediaUrls.length; mi++) {
        var u = mediaUrls[mi];
        if (u && typeof u.mimeType === 'string' && u.mimeType.indexOf('image/') === 0) { imgEntry = u; break; }
      }
      if (!imgEntry && mediaUrls.length) imgEntry = mediaUrls[0];
      var mediaSrc = imgEntry ? _ipfsToGateway(imgEntry.url) : '';
      if (mediaSrc) {
        var mediaCard = _makeCard('Media');
        var mediaBody = document.createElement('div');
        mediaBody.className = 'card-body';
        var img = document.createElement('img');
        img.alt = assetName + ' image';   // .alt is a property assignment — not HTML-parsed
        img.loading = 'lazy';
        img.style.maxWidth = '100%';
        img.style.maxHeight = '320px';
        img.style.borderRadius = '8px';
        img.style.display = 'block';
        img.addEventListener('error', function () { mediaCard.style.display = 'none'; });
        img.src = mediaSrc;
        mediaBody.appendChild(img);
        mediaCard.appendChild(mediaBody);
        grid.insertBefore(mediaCard, grid.firstChild);   // show the image first
      }

      contentWrap.appendChild(grid);

      // Rules card (if present)
      if (asset.rules && Object.keys(asset.rules).length > 0) {
        var rulesSection = document.createElement('div');
        rulesSection.className = 'section';
        var rulesTitle = document.createElement('h2');
        rulesTitle.className = 'section-title';
        rulesTitle.textContent = 'Rules';
        rulesSection.appendChild(rulesTitle);
        var rulesCard = _makeCard('');
        var rulesBody = document.createElement('div');
        rulesBody.className = 'card-body';
        var pre = document.createElement('pre');
        pre.className = 'json-block';
        pre.textContent = JSON.stringify(asset.rules, null, 2);
        rulesBody.appendChild(pre);
        rulesCard.appendChild(rulesBody);
        rulesSection.appendChild(rulesCard);
        contentWrap.appendChild(rulesSection);
      }

      // Holders section
      var holdersSection = document.createElement('div');
      holdersSection.className = 'section';
      var holdersTitle = document.createElement('h2');
      holdersTitle.className = 'section-title';
      holdersTitle.textContent = 'Holders';
      holdersSection.appendChild(holdersTitle);

      if (!holders || (Array.isArray(holders) && holders.length === 0)) {
        var noHolders = document.createElement('div');
        noHolders.className = 'empty-state-text';
        noHolders.textContent = 'No holder data available.';
        holdersSection.appendChild(noHolders);
      } else {
        var hTableWrap = document.createElement('div');
        hTableWrap.className = 'table-wrap';
        var hTable = document.createElement('table');
        hTable.className = 'data-table';
        var hThead = document.createElement('thead');
        var hHr = document.createElement('tr');
        ['Address', 'Quantity'].forEach(function (col) {
          var th = document.createElement('th');
          th.textContent = col;
          hHr.appendChild(th);
        });
        hThead.appendChild(hHr);
        hTable.appendChild(hThead);
        var hTbody = document.createElement('tbody');

        // holders may be object {address: qty} or array
        var holderEntries = [];
        if (Array.isArray(holders)) {
          holders.forEach(function (h) {
            holderEntries.push([h.address || h[0] || '', h.quantity || h[1] || 0]);
          });
        } else {
          Object.keys(holders).forEach(function (addr) {
            holderEntries.push([addr, holders[addr]]);
          });
        }

        holderEntries.forEach(function (entry) {
          var tr = document.createElement('tr');
          var tdAddr = document.createElement('td');
          var addrLink = document.createElement('a');
          addrLink.href = '#/explorer/address/' + encodeURIComponent(String(entry[0]));
          addrLink.className = 'mono';
          addrLink.textContent = String(entry[0]);
          tdAddr.appendChild(addrLink);
          tr.appendChild(tdAddr);

          var tdQty = document.createElement('td');
          tdQty.textContent = esc(entry[1]);
          tr.appendChild(tdQty);

          hTbody.appendChild(tr);
        });
        hTable.appendChild(hTbody);
        hTableWrap.appendChild(hTable);
        holdersSection.appendChild(hTableWrap);
      }
      contentWrap.appendChild(holdersSection);

      // Issuances section
      var issSection = document.createElement('div');
      issSection.className = 'section';
      var issTitle = document.createElement('h2');
      issTitle.className = 'section-title';
      issTitle.textContent = 'Issuances';
      issSection.appendChild(issTitle);

      if (!issuances || issuances.length === 0) {
        var noIss = document.createElement('div');
        noIss.className = 'empty-state-text';
        noIss.textContent = 'No issuance data available.';
        issSection.appendChild(noIss);
      } else {
        var iTableWrap = document.createElement('div');
        iTableWrap.className = 'table-wrap';
        var iTable = document.createElement('table');
        iTable.className = 'data-table';
        var iThead = document.createElement('thead');
        var iHr = document.createElement('tr');
        ['TX', 'Height', 'CID'].forEach(function (col) {
          var th = document.createElement('th');
          th.textContent = col;
          iHr.appendChild(th);
        });
        iThead.appendChild(iHr);
        iTable.appendChild(iThead);
        var iTbody = document.createElement('tbody');
        issuances.forEach(function (iss) {
          var tr = document.createElement('tr');
          var tx = String(iss.txid || iss.tx || '—');
          var tdTx = document.createElement('td');
          tdTx.className = 'mono';
          tdTx.textContent = tx.length > 20 ? tx.slice(0, 12) + '\u2026' + tx.slice(-6) : tx;
          tdTx.title = tx;
          tr.appendChild(tdTx);
          var tdH = document.createElement('td');
          tdH.textContent = esc(iss.height !== undefined ? iss.height : '—');
          tr.appendChild(tdH);
          var issCid = String(iss.cid || iss.metaCid || '—');
          var tdC = document.createElement('td');
          tdC.className = 'mono';
          tdC.textContent = issCid.length > 20 ? issCid.slice(0, 12) + '\u2026' : issCid;
          tdC.title = issCid;
          tr.appendChild(tdC);
          iTbody.appendChild(tr);
        });
        iTable.appendChild(iTbody);
        iTableWrap.appendChild(iTable);
        issSection.appendChild(iTableWrap);
      }
      contentWrap.appendChild(issSection);

    }).catch(function (err) {
      contentWrap.textContent = 'Error loading asset: ' + String(err.message || err);
    });
  }

  /* ---- Address View ---- */
  function _renderAddress(container, address) {
    var page = document.createElement('div');
    page.className = 'page';

    var backLink = document.createElement('a');
    backLink.href = '#/explorer';
    backLink.className = 'back-link';
    backLink.textContent = '\u2190 Back to Explorer';
    page.appendChild(backLink);

    var header = document.createElement('div');
    header.className = 'page-header';
    var title = document.createElement('h1');
    title.className = 'page-title';
    title.textContent = 'Address Holdings';
    header.appendChild(title);
    page.appendChild(header);

    var addrDisplay = document.createElement('div');
    addrDisplay.className = 'address-display mono';
    addrDisplay.style.wordBreak = 'break-all';
    addrDisplay.textContent = address;
    page.appendChild(addrDisplay);

    var tableWrap = document.createElement('div');
    tableWrap.className = 'table-wrap';
    tableWrap.textContent = 'Loading\u2026';
    page.appendChild(tableWrap);

    container.appendChild(page);

    App.rpc('getaddressholdings', [address]).then(function (holdings) {
      tableWrap.textContent = '';

      if (!holdings || (Array.isArray(holdings) && holdings.length === 0) ||
          (!Array.isArray(holdings) && Object.keys(holdings).length === 0)) {
        tableWrap.textContent = 'No assets held at this address.';
        return;
      }

      var table = document.createElement('table');
      table.className = 'data-table';
      var thead = document.createElement('thead');
      var hr = document.createElement('tr');
      // getaddressholdings returns object: { assetIndex: count, ... }
      // keys are assetIndex values (as strings), values are quantities
      ['Index', 'Quantity'].forEach(function (col) {
        var th = document.createElement('th');
        th.textContent = col;
        hr.appendChild(th);
      });
      thead.appendChild(hr);
      table.appendChild(thead);

      var tbody = document.createElement('tbody');

      // Build entries from the object: key = assetIndex, value = quantity
      var entries = [];
      Object.entries(holdings).forEach(function (pair) {
        entries.push({ assetIndex: pair[0], quantity: pair[1] });
      });

      entries.forEach(function (entry) {
        var tr = document.createElement('tr');

        // Index cell — linked to asset detail
        var tdIdx = document.createElement('td');
        var link = document.createElement('a');
        link.href = '#/explorer/' + encodeURIComponent(String(entry.assetIndex));
        link.textContent = String(entry.assetIndex);
        link.className = 'mono';
        tdIdx.appendChild(link);
        tr.appendChild(tdIdx);

        var tdQty = document.createElement('td');
        tdQty.textContent = esc(entry.quantity);
        tr.appendChild(tdQty);

        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      tableWrap.appendChild(table);
    }).catch(function (err) {
      tableWrap.textContent = 'Error loading holdings: ' + String(err.message || err);
    });
  }

  /* ---- Helpers ---- */
  function _makeCard(title) {
    var card = document.createElement('div');
    card.className = 'card';
    if (title) {
      var cardHeader = document.createElement('div');
      cardHeader.className = 'card-header';
      var cardTitle = document.createElement('span');
      cardTitle.className = 'card-title';
      cardTitle.textContent = title;
      cardHeader.appendChild(cardTitle);
      card.appendChild(cardHeader);
    }
    return card;
  }

  function destroy() {}

  App.registerModule('explorer', { render: render, destroy: destroy });

})();

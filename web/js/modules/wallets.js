/**
 * DigiAsset Core UI — Wallets Module
 * Two views: wallet list and wallet detail.
 * Sub-routing parsed from location.hash path segments.
 * Requires authentication for all wallet RPC calls.
 */
(function () {
  'use strict';

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
  }

  function _getParams() {
    var hash = location.hash || '';
    var path = hash.replace(/^#\//, '');
    var parts = path.split('/');
    // parts[0] = 'wallets', rest are params
    return parts.slice(1);
  }

  function render(container, urlParams) {
    var params = _getParams();
    container.textContent = '';

    if (params.length === 0 || params[0] === '') {
      _renderList(container);
    } else {
      var name = decodeURIComponent(params[0]);
      _renderDetail(container, name);
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
    title.textContent = 'Wallets';
    header.appendChild(title);
    page.appendChild(header);

    var contentWrap = document.createElement('div');
    contentWrap.id = 'wallets-content';
    page.appendChild(contentWrap);

    container.appendChild(page);

    if (!App.isAuthed()) {
      _renderAuthPrompt(contentWrap, function () {
        _renderList(container);
      });
      return;
    }

    contentWrap.textContent = 'Loading\u2026';

    App.rpcAuth('listwallets').then(function (wallets) {
      contentWrap.textContent = '';

      if (!wallets || wallets.length === 0) {
        contentWrap.textContent = 'No wallets found.';
        return;
      }

      var grid = document.createElement('div');
      grid.className = 'cards-grid';

      wallets.forEach(function (walletName) {
        var card = document.createElement('div');
        card.className = 'card card-link';

        var cardHeader = document.createElement('div');
        cardHeader.className = 'card-header';
        var icon = document.createElement('span');
        icon.className = 'card-icon';
        icon.textContent = '\u25C6';
        var titleEl = document.createElement('span');
        titleEl.className = 'card-title';
        titleEl.textContent = String(walletName) || '(default)';
        cardHeader.appendChild(icon);
        cardHeader.appendChild(titleEl);
        card.appendChild(cardHeader);

        var cardBody = document.createElement('div');
        cardBody.className = 'card-body';
        var cardLabel = document.createElement('div');
        cardLabel.className = 'card-label';
        cardLabel.textContent = 'Click to view details';
        cardBody.appendChild(cardLabel);
        card.appendChild(cardBody);

        card.style.cursor = 'pointer';
        card.addEventListener('click', function () {
          location.hash = '#/wallets/' + encodeURIComponent(String(walletName));
        });

        grid.appendChild(card);
      });

      contentWrap.appendChild(grid);
    }).catch(function (err) {
      contentWrap.textContent = 'Error loading wallets: ' + String(err.message || err);
    });
  }

  /* ---- Detail View ---- */
  function _renderDetail(container, walletName) {
    var page = document.createElement('div');
    page.className = 'page';

    var backLink = document.createElement('a');
    backLink.href = '#/wallets';
    backLink.className = 'back-link';
    backLink.textContent = '\u2190 Back to Wallets';
    page.appendChild(backLink);

    var header = document.createElement('div');
    header.className = 'page-header';
    var title = document.createElement('h1');
    title.className = 'page-title';
    title.textContent = esc(walletName || '(default)');
    header.appendChild(title);
    page.appendChild(header);

    var contentWrap = document.createElement('div');
    contentWrap.id = 'wallet-detail-content';
    page.appendChild(contentWrap);

    container.appendChild(page);

    if (!App.isAuthed()) {
      _renderAuthPrompt(contentWrap, function () {
        _renderDetail(container, walletName);
      });
      return;
    }

    contentWrap.textContent = 'Loading\u2026';

    App.rpcAuth('getbalance').then(function (balance) {
      contentWrap.textContent = '';

      // Cards grid
      var grid = document.createElement('div');
      grid.className = 'cards-grid';

      // Balance card
      var balCard = _makeCard('DGB Balance', '\u25C6');
      var balBody = document.createElement('div');
      balBody.className = 'card-body';
      var balVal = document.createElement('div');
      balVal.className = 'card-value';
      balVal.textContent = balance !== null && balance !== undefined ? esc(balance) + ' DGB' : '—';
      balBody.appendChild(balVal);
      balCard.appendChild(balBody);
      grid.appendChild(balCard);

      // Actions card
      var actCard = _makeCard('Actions', '\u25B6');
      var actBody = document.createElement('div');
      actBody.className = 'card-body';

      var btnGroup = document.createElement('div');
      btnGroup.className = 'btn-group';

      var sendBtn = document.createElement('button');
      sendBtn.className = 'btn btn-primary';
      sendBtn.textContent = 'Send DGB';
      btnGroup.appendChild(sendBtn);

      var newAddrBtn = document.createElement('button');
      newAddrBtn.className = 'btn btn-secondary';
      newAddrBtn.textContent = 'New Address';
      btnGroup.appendChild(newAddrBtn);

      actBody.appendChild(btnGroup);

      // Send form (hidden by default)
      var sendForm = document.createElement('div');
      sendForm.className = 'send-form';
      sendForm.style.display = 'none';
      sendForm.style.marginTop = '1rem';

      var toInput = document.createElement('input');
      toInput.type = 'text';
      toInput.className = 'input';
      toInput.placeholder = 'Recipient address';
      toInput.style.display = 'block';
      toInput.style.width = '100%';
      toInput.style.marginBottom = '0.5rem';
      sendForm.appendChild(toInput);

      var amtInput = document.createElement('input');
      amtInput.type = 'number';
      amtInput.className = 'input';
      amtInput.placeholder = 'Amount (DGB)';
      amtInput.min = '0';
      amtInput.step = '0.00000001';
      amtInput.style.display = 'block';
      amtInput.style.width = '100%';
      amtInput.style.marginBottom = '0.5rem';
      sendForm.appendChild(amtInput);

      var sendFormBtns = document.createElement('div');
      sendFormBtns.className = 'btn-group';
      var confirmSendBtn = document.createElement('button');
      confirmSendBtn.className = 'btn btn-primary';
      confirmSendBtn.textContent = 'Send';
      var cancelSendBtn = document.createElement('button');
      cancelSendBtn.className = 'btn btn-secondary';
      cancelSendBtn.textContent = 'Cancel';
      sendFormBtns.appendChild(confirmSendBtn);
      sendFormBtns.appendChild(cancelSendBtn);
      sendForm.appendChild(sendFormBtns);

      var sendResult = document.createElement('div');
      sendResult.className = 'send-result';
      sendResult.style.marginTop = '0.5rem';
      sendForm.appendChild(sendResult);

      actBody.appendChild(sendForm);
      actCard.appendChild(actBody);
      grid.appendChild(actCard);

      contentWrap.appendChild(grid);

      // Toggle send form
      sendBtn.addEventListener('click', function () {
        var visible = sendForm.style.display !== 'none';
        sendForm.style.display = visible ? 'none' : 'block';
        sendResult.textContent = '';
        if (!visible) {
          toInput.value = '';
          amtInput.value = '';
          toInput.focus();
        }
      });

      cancelSendBtn.addEventListener('click', function () {
        sendForm.style.display = 'none';
        sendResult.textContent = '';
      });

      confirmSendBtn.addEventListener('click', function () {
        var addr = toInput.value.trim();
        var amt = parseFloat(amtInput.value);
        if (!addr) {
          sendResult.textContent = 'Please enter a recipient address.';
          sendResult.className = 'send-result error';
          return;
        }
        if (isNaN(amt) || amt <= 0) {
          sendResult.textContent = 'Please enter a valid amount greater than 0.';
          sendResult.className = 'send-result error';
          return;
        }
        if (!window.confirm('Send ' + amt + ' DGB to ' + addr + '?')) return;

        confirmSendBtn.disabled = true;
        confirmSendBtn.textContent = 'Sending\u2026';
        sendResult.textContent = '';
        sendResult.className = 'send-result';

        App.rpcAuth('sendtoaddress', [addr, amt]).then(function (txid) {
          confirmSendBtn.disabled = false;
          confirmSendBtn.textContent = 'Send';
          sendResult.className = 'send-result ok';
          var txidEl = document.createElement('span');
          txidEl.textContent = 'Sent! TXID: ' + String(txid);
          sendResult.textContent = '';
          sendResult.appendChild(txidEl);
        }).catch(function (err) {
          confirmSendBtn.disabled = false;
          confirmSendBtn.textContent = 'Send';
          sendResult.className = 'send-result error';
          sendResult.textContent = 'Error: ' + String(err.message || err);
        });
      });

      // New address button
      newAddrBtn.addEventListener('click', function () {
        newAddrBtn.disabled = true;
        newAddrBtn.textContent = 'Generating\u2026';
        App.rpcAuth('getnewaddress').then(function (addr) {
          newAddrBtn.disabled = false;
          newAddrBtn.textContent = 'New Address';
          window.alert('New address: ' + String(addr));
          // Re-render to show new address in table
          container.textContent = '';
          render(container, null);
        }).catch(function (err) {
          newAddrBtn.disabled = false;
          newAddrBtn.textContent = 'New Address';
          window.alert('Error generating address: ' + String(err.message || err));
        });
      });

      // Addresses section
      var addrSection = document.createElement('div');
      addrSection.className = 'section';
      var addrTitle = document.createElement('h2');
      addrTitle.className = 'section-title';
      addrTitle.textContent = 'Addresses';
      addrSection.appendChild(addrTitle);

      var addrWrap = document.createElement('div');
      addrWrap.textContent = 'Loading addresses\u2026';
      addrSection.appendChild(addrWrap);
      contentWrap.appendChild(addrSection);

      App.rpcAuth('listaddressgroupings').then(function (groupings) {
        addrWrap.textContent = '';

        // listaddressgroupings returns array of arrays of arrays
        // [[['address', balance, 'account'], ...], ...]
        var rows = [];
        if (Array.isArray(groupings)) {
          groupings.forEach(function (group) {
            if (Array.isArray(group)) {
              group.forEach(function (item) {
                if (Array.isArray(item)) {
                  rows.push({ address: item[0], balance: item[1] });
                } else if (item && typeof item === 'object') {
                  rows.push({ address: item.address || item[0], balance: item.amount || item.balance || item[1] });
                }
              });
            }
          });
        }

        if (rows.length === 0) {
          addrWrap.textContent = 'No addresses found.';
          return;
        }

        var tableWrap = document.createElement('div');
        tableWrap.className = 'table-wrap';
        var table = document.createElement('table');
        table.className = 'data-table';

        var thead = document.createElement('thead');
        var hr = document.createElement('tr');
        ['Address', 'Balance'].forEach(function (col) {
          var th = document.createElement('th');
          th.textContent = col;
          hr.appendChild(th);
        });
        thead.appendChild(hr);
        table.appendChild(thead);

        var tbody = document.createElement('tbody');
        rows.forEach(function (row) {
          var tr = document.createElement('tr');

          var tdAddr = document.createElement('td');
          var addrStr = String(row.address || '');

          // Explorer link
          var addrLink = document.createElement('a');
          addrLink.href = '#/explorer/address/' + encodeURIComponent(addrStr);
          addrLink.className = 'mono';
          addrLink.textContent = addrStr;
          addrLink.title = 'View assets at this address';
          tdAddr.appendChild(addrLink);

          // Click-to-copy
          var copyBtn = document.createElement('button');
          copyBtn.className = 'btn-copy';
          copyBtn.title = 'Copy address';
          copyBtn.textContent = '\u29C9';
          copyBtn.style.marginLeft = '0.4em';
          copyBtn.style.fontSize = '0.8em';
          copyBtn.style.cursor = 'pointer';
          copyBtn.style.background = 'none';
          copyBtn.style.border = 'none';
          copyBtn.style.color = 'inherit';
          copyBtn.addEventListener('click', function (e) {
            e.preventDefault();
            if (navigator.clipboard) {
              navigator.clipboard.writeText(addrStr).then(function () {
                copyBtn.textContent = '\u2713';
                setTimeout(function () { copyBtn.textContent = '\u29C9'; }, 1500);
              });
            } else {
              window.prompt('Copy this address:', addrStr);
            }
          });
          tdAddr.appendChild(copyBtn);
          tr.appendChild(tdAddr);

          var tdBal = document.createElement('td');
          tdBal.textContent = esc(row.balance !== undefined ? row.balance : '—');
          tr.appendChild(tdBal);

          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        tableWrap.appendChild(table);
        addrWrap.appendChild(tableWrap);
      }).catch(function (err) {
        addrWrap.textContent = 'Error loading addresses: ' + String(err.message || err);
      });

    }).catch(function (err) {
      contentWrap.textContent = 'Error: ' + String(err.message || err);
    });
  }

  /* ---- Auth Prompt ---- */
  function _renderAuthPrompt(wrap, onAuth) {
    wrap.textContent = '';

    var msg = document.createElement('div');
    msg.className = 'empty-state';

    var icon = document.createElement('div');
    icon.className = 'empty-state-icon';
    icon.textContent = '\u25C6';
    msg.appendChild(icon);

    var msgTitle = document.createElement('div');
    msgTitle.className = 'empty-state-title';
    msgTitle.textContent = 'Authentication Required';
    msg.appendChild(msgTitle);

    var msgText = document.createElement('div');
    msgText.className = 'empty-state-text';
    msgText.textContent = 'Wallet operations require authentication.';
    msg.appendChild(msgText);

    var unlockBtn = document.createElement('button');
    unlockBtn.className = 'btn btn-primary';
    unlockBtn.textContent = 'Unlock';
    unlockBtn.style.marginTop = '1rem';
    unlockBtn.addEventListener('click', function () {
      App.showAuthModal().then(function () {
        onAuth();
      }).catch(function () {
        // User cancelled
      });
    });
    msg.appendChild(unlockBtn);

    wrap.appendChild(msg);
  }

  /* ---- Helpers ---- */
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

  function destroy() {}

  App.registerModule('wallets', { render: render, destroy: destroy });

})();

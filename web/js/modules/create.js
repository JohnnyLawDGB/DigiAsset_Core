/**
 * DigiAsset Core UI — Create Asset Module
 * 6-step wizard for issuing a new DigiAsset.
 * Step data persists across wizard navigation.
 */
(function () {
  'use strict';

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
  }

  // Wizard state — reset on destroy/new render
  var _state = null;
  var _step = 1;
  var TOTAL_STEPS = 6;

  function _resetState() {
    _state = {
      name: '',
      description: '',
      issuer: '',
      url: '',
      cid: '',
      quantity: 1,
      decimals: 0,
      locked: false,
      royalty: 0,
      expiry: '',
      deflationary: false,
      kyc: false
    };
    _step = 1;
  }

  function render(container, params) {
    container.textContent = '';
    _resetState();
    _renderWizard(container);
  }

  function _renderWizard(container) {
    container.textContent = '';

    var page = document.createElement('div');
    page.className = 'page';

    var header = document.createElement('div');
    header.className = 'page-header';
    var title = document.createElement('h1');
    title.className = 'page-title';
    title.textContent = 'Create Asset';
    header.appendChild(title);
    page.appendChild(header);

    // Warning banners
    var sync = App.getSyncState();
    // syncstate returns { count, sync } — sync === 0 means fully synced
    var isSynced = sync ? (sync.sync === 0) : false;

    if (sync && !isSynced) {
      var syncWarn = _makeBanner('warning',
        '\u26A0 Node is not fully synced. Asset creation may not work correctly until sync is complete.');
      page.appendChild(syncWarn);
    }

    if (!App.isAuthed()) {
      var authWarn = _makeBanner('warning',
        '\u26A0 Authentication required to create assets.');
      var unlockBtn = document.createElement('button');
      unlockBtn.className = 'btn btn-primary btn-sm';
      unlockBtn.textContent = 'Unlock';
      unlockBtn.style.marginLeft = '1em';
      unlockBtn.addEventListener('click', function () {
        App.showAuthModal().then(function () {
          _renderWizard(container);
        }).catch(function () {});
      });
      authWarn.appendChild(unlockBtn);
      page.appendChild(authWarn);
    }

    // Step indicators
    var stepsEl = document.createElement('div');
    stepsEl.className = 'wizard-steps';
    var stepLabels = ['Basics', 'Media', 'Supply', 'Rules', 'Review', 'Result'];
    for (var i = 1; i <= TOTAL_STEPS; i++) {
      var stepDot = document.createElement('div');
      stepDot.className = 'wizard-step' + (i === _step ? ' active' : '') + (i < _step ? ' done' : '');
      var dotNum = document.createElement('span');
      dotNum.className = 'wizard-step-num';
      dotNum.textContent = i < _step ? '\u2713' : String(i);
      var dotLabel = document.createElement('span');
      dotLabel.className = 'wizard-step-label';
      dotLabel.textContent = stepLabels[i - 1];
      stepDot.appendChild(dotNum);
      stepDot.appendChild(dotLabel);
      stepsEl.appendChild(stepDot);
      if (i < TOTAL_STEPS) {
        var connector = document.createElement('div');
        connector.className = 'wizard-connector' + (i < _step ? ' done' : '');
        stepsEl.appendChild(connector);
      }
    }
    page.appendChild(stepsEl);

    // Step content
    var stepContent = document.createElement('div');
    stepContent.className = 'wizard-content';
    page.appendChild(stepContent);

    // Navigation
    var navRow = document.createElement('div');
    navRow.className = 'wizard-nav';
    var backBtn = document.createElement('button');
    backBtn.className = 'btn btn-secondary';
    backBtn.textContent = '\u2190 Back';
    backBtn.style.visibility = _step === 1 || _step === TOTAL_STEPS ? 'hidden' : 'visible';
    var nextBtn = document.createElement('button');
    nextBtn.className = 'btn btn-primary';
    nextBtn.textContent = _step === TOTAL_STEPS - 1 ? 'Create Asset' : (_step === TOTAL_STEPS ? '' : 'Next \u2192');
    if (_step === TOTAL_STEPS) nextBtn.style.display = 'none';
    navRow.appendChild(backBtn);
    navRow.appendChild(nextBtn);
    page.appendChild(navRow);

    container.appendChild(page);

    // Render step
    _renderStep(_step, stepContent, container, backBtn, nextBtn, navRow);
  }

  function _renderStep(step, content, container, backBtn, nextBtn, navRow) {
    content.textContent = '';

    switch (step) {
      case 1: _renderStep1(content); break;
      case 2: _renderStep2(content); break;
      case 3: _renderStep3(content); break;
      case 4: _renderStep4(content); break;
      case 5: _renderStep5(content); break;
      case 6: _renderStep6(content, container, navRow); break;
    }

    backBtn.onclick = function () {
      if (step > 1 && step < TOTAL_STEPS) {
        _saveStep(step, content);
        _step = step - 1;
        _renderWizard(container);
      }
    };

    nextBtn.onclick = function () {
      if (step < TOTAL_STEPS - 1) {
        // Validate
        var err = _validateStep(step, content);
        if (err) {
          _showStepError(content, err);
          return;
        }
        _saveStep(step, content);
        _step = step + 1;
        _renderWizard(container);
      } else if (step === TOTAL_STEPS - 1) {
        // Review — fire create
        _step = TOTAL_STEPS;
        _renderWizard(container);
      }
    };
  }

  /* ---- Step 1: Basics ---- */
  function _renderStep1(content) {
    var card = _makeStepCard('Step 1: Basics');

    card.appendChild(_makeField('Name', 'text', 'asset-name', 'Asset name (required)', _state.name));
    var descRow = _makeFieldLabel('Description');
    var descInput = document.createElement('textarea');
    descInput.className = 'input textarea';
    descInput.id = 'asset-description';
    descInput.rows = 3;
    descInput.placeholder = 'Describe this asset';
    descInput.value = _state.description;
    descRow.appendChild(descInput);
    card.appendChild(descRow);
    card.appendChild(_makeField('Issuer', 'text', 'asset-issuer', 'Issuer name or address', _state.issuer));
    card.appendChild(_makeField('Website URL', 'url', 'asset-url', 'https://example.com', _state.url));

    content.appendChild(card);
  }

  /* ---- Step 2: Media ---- */
  function _renderStep2(content) {
    var card = _makeStepCard('Step 2: Media');

    var desc = document.createElement('p');
    desc.className = 'step-desc';
    desc.textContent = 'Upload an image to IPFS. The resulting CID will be attached to this asset.';
    card.appendChild(desc);

    var fileRow = _makeFieldLabel('Image File');
    var fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.id = 'asset-file';
    fileInput.className = 'input-file';
    fileRow.appendChild(fileInput);
    card.appendChild(fileRow);

    var statusEl = document.createElement('div');
    statusEl.className = 'upload-status';
    if (_state.cid) {
      statusEl.textContent = 'Uploaded. CID: ' + _state.cid;
      statusEl.classList.add('ok');
    }
    card.appendChild(statusEl);

    var cidRow = _makeFieldLabel('CID (optional — paste existing)');
    var cidInput = document.createElement('input');
    cidInput.type = 'text';
    cidInput.id = 'asset-cid';
    cidInput.className = 'input';
    cidInput.placeholder = 'Qm... or bafy...';
    cidInput.value = _state.cid;
    cidRow.appendChild(cidInput);
    card.appendChild(cidRow);

    fileInput.addEventListener('change', function () {
      var file = fileInput.files[0];
      if (!file) return;
      statusEl.textContent = 'Uploading\u2026';
      statusEl.className = 'upload-status';
      var formData = new FormData();
      formData.append('file', file);
      fetch('http://localhost:5001/api/v0/add', {
        method: 'POST',
        body: formData
      }).then(function (resp) {
        if (!resp.ok) throw new Error('IPFS returned ' + resp.status);
        return resp.json();
      }).then(function (data) {
        var hash = data.Hash || data.hash || '';
        _state.cid = hash;
        cidInput.value = hash;
        statusEl.textContent = 'Uploaded successfully. CID: ' + hash;
        statusEl.className = 'upload-status ok';
      }).catch(function (err) {
        statusEl.textContent = 'Upload failed: ' + String(err.message || err);
        statusEl.className = 'upload-status error';
      });
    });

    content.appendChild(card);
  }

  /* ---- Step 3: Supply ---- */
  function _renderStep3(content) {
    var card = _makeStepCard('Step 3: Supply');

    card.appendChild(_makeField('Quantity', 'number', 'asset-quantity', 'Number of units to issue', _state.quantity, { min: '1', step: '1' }));

    var decRow = _makeFieldLabel('Decimals');
    var decSelect = document.createElement('select');
    decSelect.id = 'asset-decimals';
    decSelect.className = 'input select';
    for (var i = 0; i <= 8; i++) {
      var opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = String(i);
      if (i === _state.decimals) opt.selected = true;
      decSelect.appendChild(opt);
    }
    decRow.appendChild(decSelect);
    card.appendChild(decRow);

    var lockRow = _makeFieldLabel('');
    var lockLabel = document.createElement('label');
    lockLabel.className = 'checkbox-label';
    var lockCheck = document.createElement('input');
    lockCheck.type = 'checkbox';
    lockCheck.id = 'asset-locked';
    lockCheck.checked = _state.locked;
    lockLabel.appendChild(lockCheck);
    var lockText = document.createTextNode(' Locked supply (no future issuances)');
    lockLabel.appendChild(lockText);
    lockRow.appendChild(lockLabel);
    card.appendChild(lockRow);

    content.appendChild(card);
  }

  /* ---- Step 4: Rules ---- */
  function _renderStep4(content) {
    var card = _makeStepCard('Step 4: Rules');

    card.appendChild(_makeField('Royalty %', 'number', 'asset-royalty', '0 to 100', _state.royalty, { min: '0', max: '100', step: '0.01' }));
    card.appendChild(_makeField('Expiry Block', 'number', 'asset-expiry', 'Block height (leave blank for no expiry)', _state.expiry, { min: '1' }));

    var deflRow = _makeFieldLabel('');
    var deflLabel = document.createElement('label');
    deflLabel.className = 'checkbox-label';
    var deflCheck = document.createElement('input');
    deflCheck.type = 'checkbox';
    deflCheck.id = 'asset-deflationary';
    deflCheck.checked = _state.deflationary;
    deflLabel.appendChild(deflCheck);
    deflLabel.appendChild(document.createTextNode(' Deflationary (burned on transfer)'));
    deflRow.appendChild(deflLabel);
    card.appendChild(deflRow);

    var kycRow = _makeFieldLabel('');
    var kycLabel = document.createElement('label');
    kycLabel.className = 'checkbox-label';
    var kycCheck = document.createElement('input');
    kycCheck.type = 'checkbox';
    kycCheck.id = 'asset-kyc';
    kycCheck.checked = _state.kyc;
    kycLabel.appendChild(kycCheck);
    kycLabel.appendChild(document.createTextNode(' KYC required'));
    kycRow.appendChild(kycLabel);
    card.appendChild(kycRow);

    content.appendChild(card);
  }

  /* ---- Step 5: Review ---- */
  function _renderStep5(content) {
    var card = _makeStepCard('Step 5: Review');

    var desc = document.createElement('p');
    desc.className = 'step-desc';
    desc.textContent = 'Review your asset details before creating.';
    card.appendChild(desc);

    var table = document.createElement('table');
    table.className = 'data-table review-table';
    var tbody = document.createElement('tbody');

    var reviewFields = [
      ['Name', _state.name],
      ['Description', _state.description || '—'],
      ['Issuer', _state.issuer || '—'],
      ['Website URL', _state.url || '—'],
      ['CID', _state.cid || '—'],
      ['Quantity', _state.quantity],
      ['Decimals', _state.decimals],
      ['Locked', _state.locked ? 'Yes' : 'No'],
      ['Royalty %', _state.royalty],
      ['Expiry Block', _state.expiry || 'None'],
      ['Deflationary', _state.deflationary ? 'Yes' : 'No'],
      ['KYC', _state.kyc ? 'Yes' : 'No']
    ];

    reviewFields.forEach(function (f) {
      var tr = document.createElement('tr');
      var tdLabel = document.createElement('td');
      tdLabel.className = 'review-label';
      tdLabel.textContent = f[0];
      tr.appendChild(tdLabel);
      var tdVal = document.createElement('td');
      tdVal.textContent = String(f[1]);
      tr.appendChild(tdVal);
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    card.appendChild(table);

    content.appendChild(card);
  }

  /* ---- Step 6: Result ---- */
  function _renderStep6(content, container, navRow) {
    var card = _makeStepCard('Creating Asset\u2026');

    var statusEl = document.createElement('div');
    statusEl.className = 'create-status';
    statusEl.textContent = 'Submitting to DigiAsset Core\u2026';
    card.appendChild(statusEl);

    content.appendChild(card);

    // Build the RPC payload
    var payload = {
      name: _state.name,
      quantity: Number(_state.quantity),
      decimals: Number(_state.decimals)
    };
    if (_state.description) payload.description = _state.description;
    if (_state.issuer) payload.issuer = _state.issuer;
    if (_state.url) payload.url = _state.url;
    if (_state.cid) payload.cid = _state.cid;
    if (_state.locked) payload.locked = true;
    if (_state.royalty) payload.royalty = Number(_state.royalty);
    if (_state.expiry) payload.expiry = Number(_state.expiry);
    if (_state.deflationary) payload.deflationary = true;
    if (_state.kyc) payload.kyc = true;

    App.rpcAuth('createasset', [payload]).then(function (result) {
      card.textContent = '';
      var successEl = document.createElement('div');
      successEl.className = 'create-success';

      var icon = document.createElement('div');
      icon.className = 'empty-state-icon';
      icon.textContent = '\u2713';
      successEl.appendChild(icon);

      var successTitle = document.createElement('div');
      successTitle.className = 'empty-state-title';
      successTitle.textContent = 'Asset Created!';
      successEl.appendChild(successTitle);

      var resultData = typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result);
      var resultPre = document.createElement('pre');
      resultPre.className = 'json-block';
      resultPre.textContent = resultData;
      successEl.appendChild(resultPre);

      card.appendChild(successEl);

      // "Create Another" button
      var anotherBtn = document.createElement('button');
      anotherBtn.className = 'btn btn-primary';
      anotherBtn.textContent = 'Create Another Asset';
      anotherBtn.style.marginTop = '1.5rem';
      anotherBtn.addEventListener('click', function () {
        _resetState();
        _renderWizard(container);
      });
      card.appendChild(anotherBtn);

    }).catch(function (err) {
      card.textContent = '';

      var errEl = document.createElement('div');
      errEl.className = 'create-error';

      var errIcon = document.createElement('div');
      errIcon.className = 'empty-state-icon';
      errIcon.textContent = '\u26A0';
      errEl.appendChild(errIcon);

      var errTitle = document.createElement('div');
      errTitle.className = 'empty-state-title';
      errTitle.textContent = 'Creation Failed';
      errEl.appendChild(errTitle);

      var errMsg = document.createElement('div');
      errMsg.className = 'empty-state-text';
      var rawMsg = String(err.message || err);
      errMsg.textContent = rawMsg;
      errEl.appendChild(errMsg);

      var note = document.createElement('div');
      note.className = 'empty-state-text';
      note.style.marginTop = '0.5rem';
      note.style.fontSize = '0.85em';
      note.textContent = 'Note: The createasset RPC may not be available in all DigiAsset Core builds.';
      errEl.appendChild(note);

      card.appendChild(errEl);

      // Try again button
      var retryBtn = document.createElement('button');
      retryBtn.className = 'btn btn-secondary';
      retryBtn.textContent = '\u2190 Back to Review';
      retryBtn.style.marginTop = '1.5rem';
      retryBtn.addEventListener('click', function () {
        _step = 5;
        _renderWizard(container);
      });
      card.appendChild(retryBtn);

      var anotherBtn = document.createElement('button');
      anotherBtn.className = 'btn btn-primary';
      anotherBtn.textContent = 'Start Over';
      anotherBtn.style.marginTop = '1.5rem';
      anotherBtn.style.marginLeft = '0.5rem';
      anotherBtn.addEventListener('click', function () {
        _resetState();
        _renderWizard(container);
      });
      card.appendChild(anotherBtn);
    });
  }

  /* ---- Save / Validate ---- */
  function _saveStep(step, content) {
    switch (step) {
      case 1:
        _state.name        = (document.getElementById('asset-name') || {}).value || '';
        _state.description = (document.getElementById('asset-description') || {}).value || '';
        _state.issuer      = (document.getElementById('asset-issuer') || {}).value || '';
        _state.url         = (document.getElementById('asset-url') || {}).value || '';
        break;
      case 2:
        _state.cid = (document.getElementById('asset-cid') || {}).value || '';
        break;
      case 3:
        _state.quantity = parseInt((document.getElementById('asset-quantity') || {}).value || '1', 10) || 1;
        _state.decimals = parseInt((document.getElementById('asset-decimals') || {}).value || '0', 10) || 0;
        _state.locked   = !!(document.getElementById('asset-locked') || {}).checked;
        break;
      case 4:
        _state.royalty     = parseFloat((document.getElementById('asset-royalty') || {}).value || '0') || 0;
        _state.expiry      = (document.getElementById('asset-expiry') || {}).value || '';
        _state.deflationary = !!(document.getElementById('asset-deflationary') || {}).checked;
        _state.kyc          = !!(document.getElementById('asset-kyc') || {}).checked;
        break;
    }
  }

  function _validateStep(step, content) {
    if (step === 1) {
      var name = ((document.getElementById('asset-name') || {}).value || '').trim();
      if (!name) return 'Asset name is required.';
    }
    if (step === 3) {
      var qty = parseInt((document.getElementById('asset-quantity') || {}).value || '0', 10);
      if (isNaN(qty) || qty < 1) return 'Quantity must be at least 1.';
    }
    return null;
  }

  function _showStepError(content, msg) {
    var existing = content.querySelector('.step-error');
    if (existing) existing.remove();
    var err = document.createElement('div');
    err.className = 'step-error error-banner';
    err.textContent = msg;
    content.appendChild(err);
  }

  /* ---- Helpers ---- */
  function _makeStepCard(title) {
    var card = document.createElement('div');
    card.className = 'card wizard-card';
    if (title) {
      var h = document.createElement('h2');
      h.className = 'section-title';
      h.textContent = title;
      card.appendChild(h);
    }
    return card;
  }

  function _makeField(label, type, id, placeholder, value, attrs) {
    var row = _makeFieldLabel(label);
    var input = document.createElement('input');
    input.type = type;
    input.id = id;
    input.className = 'input';
    input.placeholder = placeholder;
    if (value !== undefined && value !== null) input.value = String(value);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        input.setAttribute(k, attrs[k]);
      });
    }
    row.appendChild(input);
    return row;
  }

  function _makeFieldLabel(label) {
    var row = document.createElement('div');
    row.className = 'field-row';
    if (label) {
      var lbl = document.createElement('label');
      lbl.className = 'field-label';
      lbl.textContent = label;
      row.appendChild(lbl);
    }
    return row;
  }

  function _makeBanner(type, text) {
    var banner = document.createElement('div');
    banner.className = 'banner banner-' + type;
    banner.textContent = text;
    return banner;
  }

  function destroy() {
    _state = null;
    _step = 1;
  }

  App.registerModule('create', { render: render, destroy: destroy });

})();

(function () {
  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function truncateAddr(addr) {
    if (!addr || addr.length < 10) return addr || '';
    return addr.slice(0, 6) + '…' + addr.slice(-4);
  }

  function profileUrl(addr) {
    return 'profile.html?addr=' + encodeURIComponent(addr);
  }

  var web3 = window.BuilderFinderWeb3;
  var connectedAddr = null;

  var CATEGORY_ICON = { Dev: '💻', Design: '🎨', Content: '✍️', Community: '📣' };
  var BOUNTY_BUCKET = {
    Open: 'open', Claimed: 'claimed', Submitted: 'claimed',
    Approved: 'completed', Expired: 'completed', Cancelled: 'completed'
  };

  function renderBountyRow(b, otherRoleLabel, otherAddr) {
    var bucket = BOUNTY_BUCKET[b.status] || 'open';
    var stampLabel = b.status === 'Approved' ? 'Completed' : b.status;
    var icon = CATEGORY_ICON[b.category] || '🛠️';
    return (
      '<div class="bounty-row">' +
        '<div class="bounty-icon">' + icon + '</div>' +
        '<div class="bounty-main">' +
          '<h3>' + escapeHtml(b.title) + '</h3>' +
          '<span class="bounty-cat">' + escapeHtml(b.category) + '</span>' +
          (otherAddr ? '<div class="mini-addr">' + otherRoleLabel + ': <a href="' + profileUrl(otherAddr) + '">' + truncateAddr(otherAddr) + '</a></div>' : '') +
        '</div>' +
        '<div class="bounty-stats-row">' +
          '<div><span class="bounty-stat-label">Reward</span><span class="bounty-stat-val reward">' + escapeHtml(b.rewardLabel) + '</span></div>' +
          '<div><span class="bounty-stat-label">Deadline</span><span class="bounty-stat-val">' + escapeHtml(b.deadline) + '</span></div>' +
          '<div><span class="bounty-stat-label">Status</span><span class="status-stamp ' + bucket + '">' + stampLabel + '</span></div>' +
        '</div>' +
        '<div class="bounty-links">' +
          (b.briefLink ? '<a href="' + b.briefLink + '" target="_blank" rel="noopener">View brief →</a>' : '') +
        '</div>' +
      '</div>'
    );
  }

  // ---------- Connect Wallet ----------
  var connectBtn = document.getElementById('connect-wallet-btn');
  var walletStatusEl = document.getElementById('wallet-status');
  function refreshWalletUi() {
    if (!connectBtn) return;
    if (connectedAddr) {
      connectBtn.textContent = 'Connected';
      connectBtn.disabled = true;
      if (walletStatusEl) {
        walletStatusEl.style.display = '';
        walletStatusEl.innerHTML = '<a href="' + profileUrl(connectedAddr) + '">' + truncateAddr(connectedAddr) + '</a>';
      }
    } else {
      connectBtn.textContent = web3.isLive() ? 'Connect Wallet' : 'Not Live Yet';
      connectBtn.disabled = !web3.isLive();
    }
    updateEditFormUi();
  }
  function doConnect() {
    return web3.connectWallet().then(function (a) { connectedAddr = a; refreshWalletUi(); return a; });
  }
  if (connectBtn) {
    connectBtn.addEventListener('click', function () { doConnect().catch(function (err) { alert(err.message || String(err)); }); });
    refreshWalletUi();
  }

  // ---------- Lookup bar ----------
  var lookupInput = document.getElementById('lookup-input');
  var lookupBtn = document.getElementById('lookup-btn');
  function getAddrFromQuery() {
    var params = new URLSearchParams(window.location.search);
    return (params.get('addr') || '').trim();
  }
  function goToAddr(addr) {
    if (addr) window.location.search = '?addr=' + encodeURIComponent(addr);
  }
  if (lookupBtn) lookupBtn.addEventListener('click', function () { goToAddr(lookupInput.value.trim()); });
  if (lookupInput) lookupInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') goToAddr(lookupInput.value.trim()); });

  var addr = getAddrFromQuery();
  var emptyEl = document.getElementById('profile-empty');
  var contentEl = document.getElementById('profile-content');
  var editForm = document.getElementById('edit-profile-form');
  var editToggle = document.getElementById('edit-profile-toggle');
  var editSubmitBtn = editForm ? editForm.querySelector('.form-submit') : null;

  function updateEditFormUi() {
    if (!editSubmitBtn) return;
    editSubmitBtn.textContent = (web3.isLive() && connectedAddr) ? 'Save Profile' : 'Connect Wallet to Save';
  }
  updateEditFormUi();

  if (!addr) {
    emptyEl.hidden = false;
    contentEl.hidden = true;
    return;
  }

  if (lookupInput) lookupInput.value = addr;
  emptyEl.hidden = true;
  contentEl.hidden = false;

  document.getElementById('profile-avatar').textContent = addr.slice(2, 4).toUpperCase();
  document.getElementById('profile-addr').textContent = truncateAddr(addr);

  document.getElementById('copy-addr-btn').addEventListener('click', function (e) {
    var btn = e.currentTarget;
    var done = function () { btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = 'Copy'; }, 1500); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(addr).then(done).catch(done);
    } else {
      done();
    }
  });

  editToggle.addEventListener('click', function (e) {
    e.preventDefault();
    editForm.hidden = !editForm.hidden;
  });

  editForm.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!web3.isLive()) return;
    if (!connectedAddr) {
      doConnect().catch(function (err) { alert(err.message || String(err)); });
      return;
    }
    var available = document.getElementById('avail-yes').checked;
    var rate = document.getElementById('rate-input').value.trim();
    var skills = document.getElementById('skills-input').value.trim();
    editSubmitBtn.disabled = true;
    editSubmitBtn.textContent = 'Confirming…';
    web3.setBuilderProfile(available, rate, skills)
      .then(function () {
        editSubmitBtn.disabled = false;
        updateEditFormUi();
        return loadProfileData();
      })
      .catch(function (err) {
        alert(err.reason || err.message || String(err));
        editSubmitBtn.disabled = false;
        updateEditFormUi();
      });
  });

  function loadProfileData() {
    return Promise.all([web3.fetchAllBounties(), web3.fetchProfile(addr)]).then(function (results) {
      var bounties = results[0];
      var profile = results[1];
      var addrLower = addr.toLowerCase();

      var asBuilder = bounties.filter(function (b) { return (b.builder || '').toLowerCase() === addrLower; });
      var asPoster = bounties.filter(function (b) { return (b.poster || '').toLowerCase() === addrLower; });

      var completed = asBuilder.filter(function (b) { return b.status === 'Approved'; }).length;
      var points = completed * 100;
      var strikes = asBuilder.filter(function (b) { return b.status === 'Expired'; }).length;
      var posted = asPoster.length;

      document.getElementById('stat-points').textContent = points;
      document.getElementById('stat-completed').textContent = completed;
      document.getElementById('stat-posted').textContent = posted;
      document.getElementById('stat-strikes').textContent = strikes;
      document.getElementById('stat-strikes').classList.toggle('bad', strikes > 0);

      var badgesEl = document.getElementById('profile-badges');
      var metaEl = document.getElementById('profile-meta');
      var badges = '';
      if (profile && profile.openForWork) badges += '<span class="badge open">Open for work</span>';
      if (strikes >= 3) badges += '<span class="badge blacklist">Blacklisted (builder)</span>';
      badgesEl.innerHTML = badges;

      if (profile && (profile.rateLabel || profile.skillsLabel)) {
        metaEl.innerHTML =
          (profile.rateLabel ? '<strong>Rate:</strong> ' + escapeHtml(profile.rateLabel) + '. ' : '') +
          (profile.skillsLabel ? '<strong>Skills:</strong> ' + escapeHtml(profile.skillsLabel) + '.' : '');
      } else {
        metaEl.textContent = 'No profile set yet — availability and rate are self-reported.';
      }

      document.getElementById('builder-count').textContent = '(' + asBuilder.length + ')';
      document.getElementById('poster-count').textContent = '(' + asPoster.length + ')';

      var builderListEl = document.getElementById('as-builder-list');
      builderListEl.innerHTML = asBuilder.length
        ? asBuilder.map(function (b) { return renderBountyRow(b, 'Posted by', b.poster); }).join('')
        : '<div class="empty-state"><p class="empty-title">No bounties claimed yet.</p><p class="empty-sub">Nothing on record for this address as a builder.</p></div>';

      var posterListEl = document.getElementById('as-poster-list');
      posterListEl.innerHTML = asPoster.length
        ? asPoster.map(function (b) { return renderBountyRow(b, 'Claimed by', b.builder); }).join('')
        : '<div class="empty-state"><p class="empty-title">No bounties posted yet.</p><p class="empty-sub">Nothing on record for this address as a poster.</p></div>';
    });
  }

  loadProfileData().catch(function (err) { console.error('profile data failed to load', err); });
})();

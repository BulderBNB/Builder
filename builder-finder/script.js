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
  var allBounties = [];

  var BOUNTY_BUCKET = {
    Open: 'open', Claimed: 'claimed', Submitted: 'claimed',
    Approved: 'completed', Expired: 'completed', Cancelled: 'completed'
  };
  var CATEGORY_ICON = { Dev: '💻', Design: '🎨', Content: '✍️', Community: '📣' };

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
  }

  function doConnect() {
    return web3.connectWallet().then(function (addr) {
      connectedAddr = addr;
      refreshWalletUi();
      renderBountyList();
      updatePostFormUi();
      return addr;
    });
  }

  if (connectBtn) {
    connectBtn.addEventListener('click', function () {
      doConnect().catch(function (err) { alert(err.message || String(err)); });
    });
    refreshWalletUi();
  }

  // ---------- Bounties (browse list, filters, search, live stats, actions) ----------
  var bountyContainer = document.getElementById('bounty-list');
  var bountyFilterBtns = document.querySelectorAll('.browse-filters .chip[data-filter]');
  var bountySearchInput = document.getElementById('bounty-search');
  var statOpenEl = document.getElementById('stat-open');
  var statBuildersEl = document.getElementById('stat-builders');
  var statCompletedEl = document.getElementById('stat-completed');
  var activeFilter = 'all';

  function loadBounties() {
    return web3.fetchAllBounties()
      .then(function (bounties) {
        allBounties = bounties;

        var openCount = bounties.filter(function (b) { return b.status === 'Open'; }).length;
        var completedCount = bounties.filter(function (b) { return b.status === 'Approved'; }).length;
        var builderSet = {};
        bounties.forEach(function (b) { if (b.builder) builderSet[b.builder] = true; });
        if (statOpenEl) statOpenEl.textContent = openCount;
        if (statBuildersEl) statBuildersEl.textContent = Object.keys(builderSet).length;
        if (statCompletedEl) statCompletedEl.textContent = completedCount;

        renderBountyList();
        renderLeaderboard();
      })
      .catch(function (err) {
        console.error('bounties failed to load', err);
        if (statOpenEl) statOpenEl.textContent = '—';
        if (statBuildersEl) statBuildersEl.textContent = '—';
        if (statCompletedEl) statCompletedEl.textContent = '—';
        if (bountyContainer) {
          bountyContainer.innerHTML =
            '<div class="empty-state">' +
              '<p class="empty-title">Couldn’t load bounties.</p>' +
              '<p class="empty-sub">Try refreshing in a bit.</p>' +
            '</div>';
        }
      });
  }

  function renderBountyList() {
    if (!bountyContainer) return;
    var query = (bountySearchInput && bountySearchInput.value || '').trim().toLowerCase();
    var filtered = allBounties.filter(function (b) {
      var bucket = BOUNTY_BUCKET[b.status] || 'open';
      if (activeFilter !== 'all' && bucket !== activeFilter) return false;
      if (query && b.title.toLowerCase().indexOf(query) === -1 && b.category.toLowerCase().indexOf(query) === -1) return false;
      return true;
    });

    if (!filtered.length) {
      bountyContainer.innerHTML =
        '<div class="empty-state">' +
          '<p class="empty-title">No bounties yet.</p>' +
          '<p class="empty-sub">Be the first to post one.</p>' +
        '</div>';
      return;
    }
    bountyContainer.innerHTML = filtered.map(renderBountyRow).join('');
  }

  function actionButtonsFor(b) {
    if (!web3.isLive() || !connectedAddr) return '';
    var mine = connectedAddr.toLowerCase();
    var btns = [];
    if (b.status === 'Open' && b.poster.toLowerCase() !== mine) {
      btns.push('<button class="btn btn-crimson btn-sm" data-action="claim" data-id="' + b.id + '">Claim</button>');
    }
    if (b.status === 'Claimed' && b.builder.toLowerCase() === mine) {
      btns.push('<button class="btn btn-crimson btn-sm" data-action="submit-proof" data-id="' + b.id + '">Submit Proof</button>');
    }
    if (b.status === 'Submitted' && b.poster.toLowerCase() === mine) {
      btns.push('<button class="btn btn-crimson btn-sm" data-action="approve" data-id="' + b.id + '">Approve</button>');
    }
    if (b.status === 'Approved' && b.builder.toLowerCase() === mine) {
      btns.push('<button class="btn btn-outline btn-sm" data-action="report" data-id="' + b.id + '">Report Non-Payment</button>');
    }
    return btns.join('');
  }

  function renderBountyRow(b) {
    var bucket = BOUNTY_BUCKET[b.status] || 'open';
    var stampLabel = b.status === 'Approved' ? 'Completed' : b.status;
    var icon = CATEGORY_ICON[b.category] || '🛠️';
    var partyLine = '<div class="mini-addr">Posted by: <a href="' + profileUrl(b.poster) + '">' + truncateAddr(b.poster) + '</a>' +
      (b.builder ? ' · Claimed by: <a href="' + profileUrl(b.builder) + '">' + truncateAddr(b.builder) + '</a>' : '') +
      '</div>';
    return (
      '<div class="bounty-row">' +
        '<div class="bounty-icon">' + icon + '</div>' +
        '<div class="bounty-main">' +
          '<h3>' + escapeHtml(b.title) + '</h3>' +
          '<span class="bounty-cat">' + escapeHtml(b.category) + '</span>' +
          (b.poster ? partyLine : '') +
        '</div>' +
        '<div class="bounty-stats-row">' +
          '<div><span class="bounty-stat-label">Reward</span><span class="bounty-stat-val reward">' + escapeHtml(b.rewardLabel) + '</span></div>' +
          '<div><span class="bounty-stat-label">Deadline</span><span class="bounty-stat-val">' + escapeHtml(b.deadline) + '</span></div>' +
          '<div><span class="bounty-stat-label">Status</span><span class="status-stamp ' + bucket + '">' + stampLabel + '</span></div>' +
        '</div>' +
        '<div class="bounty-links">' +
          (b.briefLink ? '<a href="' + b.briefLink + '" target="_blank" rel="noopener">View brief →</a>' : '') +
          actionButtonsFor(b) +
        '</div>' +
      '</div>'
    );
  }

  if (bountyContainer) {
    bountyContainer.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-action]');
      if (!btn) return;
      var id = Number(btn.getAttribute('data-id'));
      var action = btn.getAttribute('data-action');
      var p;
      if (action === 'claim') {
        p = web3.claimBounty(id);
      } else if (action === 'submit-proof') {
        var link = prompt('Link to the finished work:');
        if (!link) return;
        p = web3.submitProof(id, link);
      } else if (action === 'approve') {
        p = web3.approveBounty(id);
      } else if (action === 'report') {
        if (!confirm('Report that this bounty was never paid off-platform? This is logged permanently and publicly.')) return;
        p = web3.reportNonPayment(id);
      }
      if (!p) return;
      btn.disabled = true;
      btn.textContent = 'Confirming…';
      p.then(function () { return loadBounties(); })
        .catch(function (err) { alert(err.reason || err.message || String(err)); renderBountyList(); });
    });

    bountyFilterBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        bountyFilterBtns.forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        activeFilter = btn.getAttribute('data-filter');
        renderBountyList();
      });
    });
    if (bountySearchInput) bountySearchInput.addEventListener('input', renderBountyList);
  }

  // ---------- Builder leaderboard (computed from bounty history) ----------
  var builderLeaderboardList = document.getElementById('builder-leaderboard-list');
  function renderLeaderboard() {
    if (!builderLeaderboardList) return;
    var counts = {};
    allBounties.forEach(function (b) {
      if (b.status === 'Approved' && b.builder) counts[b.builder] = (counts[b.builder] || 0) + 1;
    });
    var ranked = Object.keys(counts)
      .map(function (addr) { return { addr: addr, completed: counts[addr] }; })
      .sort(function (a, b) { return b.completed - a.completed; })
      .slice(0, 10);

    if (!ranked.length) {
      builderLeaderboardList.innerHTML =
        '<div class="empty-state">' +
          '<p class="empty-title">No builders ranked yet.</p>' +
          '<p class="empty-sub">Complete a bounty to top the board.</p>' +
        '</div>';
      return;
    }
    builderLeaderboardList.innerHTML = ranked.map(function (row, i) {
      var rankCls = i === 0 ? 'leaderboard-rank gold' : 'leaderboard-rank';
      return (
        '<div class="leaderboard-row">' +
          '<span class="' + rankCls + ' mono">' + (i + 1) + '</span>' +
          '<span><a href="' + profileUrl(row.addr) + '" class="mono">' + truncateAddr(row.addr) + '</a></span>' +
          '<span class="mono">' + row.completed + '</span>' +
        '</div>'
      );
    }).join('');
  }

  if (bountyContainer || builderLeaderboardList) {
    loadBounties();
  }

  // ---------- Profile lookup widget ----------
  var lookupInput = document.getElementById('profile-lookup-input');
  var lookupBtn = document.getElementById('profile-lookup-btn');
  if (lookupBtn && lookupInput) {
    var goToProfile = function () {
      var addr = lookupInput.value.trim();
      if (addr) window.location.href = profileUrl(addr);
    };
    lookupBtn.addEventListener('click', goToProfile);
    lookupInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') goToProfile(); });
  }

  // ---------- Post form ----------
  var bountyForm = document.getElementById('bounty-form');
  var bountySubmitBtn = bountyForm ? bountyForm.querySelector('.form-submit') : null;

  function updatePostFormUi() {
    if (!bountySubmitBtn) return;
    bountySubmitBtn.textContent = (web3.isLive() && connectedAddr) ? 'Post Bounty' : 'Connect Wallet to Post';
  }
  updatePostFormUi();

  if (bountyForm) {
    bountyForm.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!web3.isLive()) return; // not deployed yet — stays a no-op, same as before
      if (!connectedAddr) {
        doConnect().catch(function (err) { alert(err.message || String(err)); });
        return;
      }
      var title = document.getElementById('bounty-title').value.trim();
      var brief = document.getElementById('bounty-brief').value.trim();
      var reward = document.getElementById('bounty-reward').value.trim();
      var categoryEl = bountyForm.querySelector('input[name="category"]:checked');
      var category = categoryEl ? categoryEl.value : '';
      var deadline = document.getElementById('bounty-deadline').value;
      if (!title || !reward || !category || !deadline) { alert('Fill in title, reward, category, and deadline.'); return; }

      bountySubmitBtn.disabled = true;
      bountySubmitBtn.textContent = 'Confirming…';
      web3.postBounty(title, brief, reward, category, deadline)
        .then(function () {
          bountyForm.reset();
          bountySubmitBtn.disabled = false;
          updatePostFormUi();
          return loadBounties();
        })
        .catch(function (err) {
          alert(err.reason || err.message || String(err));
          bountySubmitBtn.disabled = false;
          updatePostFormUi();
        });
    });
  }
})();

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

  var allBountiesGlobal = [];

  // ---------- Bounties (browse list, filters, search, live stats) ----------
  var bountyContainer = document.getElementById('bounty-list');
  if (bountyContainer) {
    var bountyFilterBtns = document.querySelectorAll('.browse-filters .chip[data-filter]');
    var bountySearchInput = document.getElementById('bounty-search');
    var statOpenEl = document.getElementById('stat-open');
    var statBuildersEl = document.getElementById('stat-builders');
    var statCompletedEl = document.getElementById('stat-completed');
    var allBounties = [];
    var activeFilter = 'all';

    var BOUNTY_BUCKET = {
      Open: 'open',
      Claimed: 'claimed',
      Submitted: 'claimed',
      Approved: 'completed',
      Expired: 'completed',
      Cancelled: 'completed'
    };
    var CATEGORY_ICON = { Dev: '💻', Design: '🎨', Content: '✍️', Community: '📣' };

    fetch('data/bounties.json')
      .then(function (r) { return r.json(); })
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
      })
      .catch(function (err) {
        console.error('bounties failed to load', err);
        if (statOpenEl) statOpenEl.textContent = '—';
        if (statBuildersEl) statBuildersEl.textContent = '—';
        if (statCompletedEl) statCompletedEl.textContent = '—';
        bountyContainer.innerHTML =
          '<div class="empty-state">' +
            '<p class="empty-title">Couldn’t load bounties.</p>' +
            '<p class="empty-sub">Try refreshing in a bit.</p>' +
          '</div>';
      });

    function renderBountyList() {
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

    function renderBountyRow(b) {
      var bucket = BOUNTY_BUCKET[b.status] || 'open';
      var stampLabel = bucket === 'open' ? 'Open' : bucket === 'claimed' ? 'Claimed' : 'Completed';
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
            '<div>' +
              '<span class="bounty-stat-label">Reward</span>' +
              '<span class="bounty-stat-val reward">' + escapeHtml(b.rewardLabel) + '</span>' +
            '</div>' +
            '<div>' +
              '<span class="bounty-stat-label">Deadline</span>' +
              '<span class="bounty-stat-val">' + escapeHtml(b.deadline) + '</span>' +
            '</div>' +
            '<div>' +
              '<span class="bounty-stat-label">Status</span>' +
              '<span class="status-stamp ' + bucket + '">' + stampLabel + '</span>' +
            '</div>' +
          '</div>' +
          '<div class="bounty-links">' +
            (b.briefLink ? '<a href="' + b.briefLink + '" target="_blank" rel="noopener">View brief →</a>' : '') +
          '</div>' +
        '</div>'
      );
    }

    bountyFilterBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        bountyFilterBtns.forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        activeFilter = btn.getAttribute('data-filter');
        renderBountyList();
      });
    });
    if (bountySearchInput) {
      bountySearchInput.addEventListener('input', renderBountyList);
    }
  }

  // ---------- Builder leaderboard (computed from bounty history) ----------
  var builderLeaderboardList = document.getElementById('builder-leaderboard-list');
  if (builderLeaderboardList) {
    fetch('data/bounties.json')
      .then(function (r) { return r.json(); })
      .then(function (bounties) {
        var counts = {};
        bounties.forEach(function (b) {
          if (b.status === 'Approved' && b.builder) {
            counts[b.builder] = (counts[b.builder] || 0) + 1;
          }
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
      })
      .catch(function (err) {
        console.error('leaderboard failed to load', err);
        builderLeaderboardList.innerHTML =
          '<div class="empty-state">' +
            '<p class="empty-title">Couldn’t load the leaderboard.</p>' +
            '<p class="empty-sub">Try refreshing in a bit.</p>' +
          '</div>';
      });
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

  // ---------- Post form (on-chain not live yet) ----------
  var bountyForm = document.getElementById('bounty-form');
  if (bountyForm) {
    bountyForm.addEventListener('submit', function (e) {
      e.preventDefault();
    });
  }
})();

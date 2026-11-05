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

  function avatarColor(addr) {
    var hash = 0;
    for (var i = 0; i < addr.length; i++) hash = (hash * 31 + addr.charCodeAt(i)) >>> 0;
    var hue = hash % 360;
    return 'hsl(' + hue + ', 65%, 55%)';
  }

  var CATEGORY_ICON = { Dev: '💻', Design: '🎨', Content: '✍️', Community: '📣' };
  var BOUNTY_BUCKET = {
    Open: 'open', Claimed: 'claimed', Submitted: 'claimed',
    Approved: 'completed', Expired: 'completed', Cancelled: 'completed'
  };

  function renderBountyRow(b, otherRoleLabel, otherAddr) {
    var bucket = BOUNTY_BUCKET[b.status] || 'open';
    var stampLabel = bucket === 'open' ? 'Open' : bucket === 'claimed' ? 'Claimed' : 'Completed';
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

  var lookupInput = document.getElementById('lookup-input');
  var lookupBtn = document.getElementById('lookup-btn');

  function getAddrFromQuery() {
    var params = new URLSearchParams(window.location.search);
    return (params.get('addr') || '').trim();
  }

  function goToAddr(addr) {
    if (!addr) return;
    window.location.search = '?addr=' + encodeURIComponent(addr);
  }

  if (lookupBtn) {
    lookupBtn.addEventListener('click', function () { goToAddr(lookupInput.value.trim()); });
  }
  if (lookupInput) {
    lookupInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') goToAddr(lookupInput.value.trim());
    });
  }

  var addr = getAddrFromQuery();
  var emptyEl = document.getElementById('profile-empty');
  var contentEl = document.getElementById('profile-content');

  if (!addr) {
    emptyEl.hidden = false;
    contentEl.hidden = true;
    return;
  }

  if (lookupInput) lookupInput.value = addr;
  emptyEl.hidden = true;
  contentEl.hidden = false;

  document.getElementById('profile-avatar').textContent = addr.slice(2, 4).toUpperCase();
  document.getElementById('profile-avatar').style.background = avatarColor(addr.toLowerCase());
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

  var editToggle = document.getElementById('edit-profile-toggle');
  var editForm = document.getElementById('edit-profile-form');
  editToggle.addEventListener('click', function (e) {
    e.preventDefault();
    editForm.hidden = !editForm.hidden;
  });
  editForm.addEventListener('submit', function (e) { e.preventDefault(); });

  Promise.all([
    fetch('data/bounties.json').then(function (r) { return r.json(); }),
    fetch('data/profiles.json').then(function (r) { return r.json(); })
  ]).then(function (results) {
    var bounties = results[0];
    var profiles = results[1];
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
    if (strikes > 0) document.getElementById('stat-strikes').classList.add('bad');

    var profile = profiles[addrLower] || profiles[addr] || null;
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
  }).catch(function (err) {
    console.error('profile data failed to load', err);
  });
})();

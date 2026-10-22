(function () {
  // ---------- Mobile nav ----------
  var navToggle = document.getElementById('nav-toggle');
  var mainNav = document.getElementById('main-nav');
  if (navToggle && mainNav) {
    navToggle.addEventListener('click', function () {
      var isOpen = mainNav.classList.toggle('open');
      navToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });
    mainNav.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () {
        mainNav.classList.remove('open');
        navToggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  // ---------- Copy contract address ----------
  function copyText(text, btn) {
    var done = function () {
      if (!btn) return;
      var label = btn.querySelector('span');
      var original = label ? label.textContent : null;
      btn.classList.add('copied');
      if (label) label.textContent = 'Copied!';
      setTimeout(function () {
        btn.classList.remove('copied');
        if (label && original) label.textContent = original;
      }, 1800);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(function () {
        fallbackCopy(text); done();
      });
    } else {
      fallbackCopy(text); done();
    }
  }
  function fallbackCopy(text) {
    var el = document.createElement('textarea');
    el.value = text; el.style.position = 'fixed'; el.style.opacity = '0';
    document.body.appendChild(el); el.select();
    try { document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(el);
  }
  document.querySelectorAll('.ca-copy').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var value = btn.getAttribute('data-copy') ||
        (document.getElementById('ca-value') && document.getElementById('ca-value').textContent.trim());
      if (value) copyText(value.trim(), btn);
    });
  });

  // ---------- World map ----------
  var mapPins = document.getElementById('map-pins-layer');
  if (mapPins) {
    fetch('data/map-pins.json')
      .then(function (r) { return r.json(); })
      .then(function (pins) {
        var builderCount = pins.filter(function (p) { return p.type === 'builder'; }).length;
        var eventCount = pins.filter(function (p) { return p.type === 'event'; }).length;
        var cityCount = pins.length;

        pins.forEach(function (p) {
          var group = document.createElement('div');
          group.className = 'pin-group-html';
          group.style.position = 'absolute';
          group.style.left = p.xpct + '%';
          group.style.top = p.ypct + '%';
          group.innerHTML =
            '<span class="pin-dot-html ' + p.type + '"></span>' +
            '<span class="pin-ring-html"></span>' +
            '<span class="pin-label-html">' + p.name + '</span>';
          mapPins.appendChild(group);
        });

        var statBuilders = document.getElementById('stat-builders');
        var statEvents = document.getElementById('stat-events');
        var statCities = document.getElementById('stat-cities');
        if (statBuilders) statBuilders.textContent = builderCount;
        if (statEvents) statEvents.textContent = eventCount;
        if (statCities) statCities.textContent = cityCount;
      })
      .catch(function (err) { console.error('map pins failed to load', err); });
  }

  // ---------- Events ----------
  var eventsContainer = document.getElementById('events-list');
  if (eventsContainer) {
    var limit = parseInt(eventsContainer.getAttribute('data-limit') || '0', 10);
    fetch('data/events.json')
      .then(function (r) { return r.json(); })
      .then(function (events) {
        var list = limit ? events.slice(0, limit) : events;
        eventsContainer.innerHTML = list.map(renderEventCard).join('');
      })
      .catch(function (err) { console.error('events failed to load', err); });
  }

  function renderEventCard(ev) {
    var liveTag = ev.status === 'live' ? '<span class="event-tag-live">LIVE NOW</span>' : '';
    return (
      '<div class="card event-card">' +
        '<div class="event-banner"><span class="event-date">' + ev.date + '</span>' + liveTag + '</div>' +
        '<div class="event-body">' +
          '<h3>' + ev.title + '</h3>' +
          '<p class="event-loc">' + ev.location + '</p>' +
          '<div class="post-preview"><span class="avatar"></span><span><strong>' + ev.post.author + '</strong> — "' + ev.post.text + '"</span></div>' +
          '<a class="event-cta" href="' + ev.ticketUrl + '" target="_blank" rel="noopener">' + ev.ctaLabel + ' →</a>' +
        '</div>' +
      '</div>'
    );
  }

  // ---------- People directory ----------
  var peopleContainer = document.getElementById('people-list');
  if (peopleContainer) {
    fetch('data/people.json')
      .then(function (r) { return r.json(); })
      .then(function (people) {
        if (!people.length) {
          peopleContainer.innerHTML =
            '<div class="empty-state">' +
              '<p class="empty-title">No one’s pinned yet.</p>' +
              '<p class="empty-sub">Be the first builder on the map.</p>' +
              '<a class="btn btn-gold btn-lg" href="join.html">Join the Map</a>' +
            '</div>';
          return;
        }
        peopleContainer.innerHTML = people.map(renderPersonCard).join('');
      })
      .catch(function (err) { console.error('people failed to load', err); });
  }

  function renderPersonCard(p) {
    var initial = (p.handle || '?').replace('@', '').charAt(0).toUpperCase();
    return (
      '<div class="card person-card">' +
        '<div class="person-avatar">' + initial + '</div>' +
        '<h4>' + p.handle + '</h4>' +
        '<p class="person-loc">' + p.location + '</p>' +
        '<span class="role-tag">' + p.role + '</span>' +
      '</div>'
    );
  }

  // ---------- Filter chips (directory) ----------
  var chips = document.querySelectorAll('.chip[data-filter]');
  if (chips.length) {
    chips.forEach(function (chip) {
      chip.addEventListener('click', function () {
        chips.forEach(function (c) { c.classList.remove('active'); });
        chip.classList.add('active');
        var filter = chip.getAttribute('data-filter');
        document.querySelectorAll('.person-card').forEach(function (card) {
          var role = card.querySelector('.role-tag');
          var match = filter === 'All' || (role && role.textContent === filter);
          card.style.display = match ? '' : 'none';
        });
      });
    });
  }

  // ---------- Join form (role multi-select display only, no backend yet) ----------
  var joinForm = document.getElementById('join-form');
  if (joinForm) {
    joinForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var submitBtn = joinForm.querySelector('.form-submit');
      var original = submitBtn.textContent;
      submitBtn.textContent = 'Coming soon — check back shortly';
      submitBtn.disabled = true;
      setTimeout(function () {
        submitBtn.textContent = original;
        submitBtn.disabled = false;
      }, 3000);
    });
  }
})();

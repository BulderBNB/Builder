(function () {
  // ---------- Supabase ----------
  var SUPABASE_URL = 'https://gnxebzuzcjglldoevxik.supabase.co';
  var SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdueGVienV6Y2pnbGxkb2V2eGlrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI2OTI3NTEsImV4cCI6MjEwODI2ODc1MX0.v4bQECO0HkJhnOAKgxDbgE8zwqXsSkZ9RVDAPMOp5Fg';
  var supabaseClient = (window.supabase && window.supabase.createClient)
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY)
    : null;

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
    var loadPeople = supabaseClient
      ? supabaseClient.from('people').select('*').eq('status', 'approved').order('created_at', { ascending: false })
          .then(function (res) {
            if (res.error) throw res.error;
            return res.data;
          })
      : fetch('data/people.json').then(function (r) { return r.json(); });

    loadPeople
      .then(function (people) {
        if (!people || !people.length) {
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
      .catch(function (err) {
        console.error('people failed to load', err);
        peopleContainer.innerHTML =
          '<div class="empty-state">' +
            '<p class="empty-title">Couldn’t load the directory.</p>' +
            '<p class="empty-sub">Try refreshing in a bit.</p>' +
          '</div>';
      });
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function renderPersonCard(p) {
    var initial = (p.handle || '?').replace('@', '').charAt(0).toUpperCase();
    var roles = Array.isArray(p.roles) ? p.roles : (p.role ? [p.role] : []);
    var roleTags = roles.map(function (r) { return '<span class="role-tag">' + escapeHtml(r) + '</span>'; }).join(' ');
    return (
      '<div class="card person-card">' +
        '<div class="person-avatar">' + escapeHtml(initial) + '</div>' +
        '<h4>' + escapeHtml(p.handle) + '</h4>' +
        '<p class="person-loc">' + escapeHtml(p.city || p.location) + '</p>' +
        roleTags +
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
          var roleTags = card.querySelectorAll('.role-tag');
          var match = filter === 'All' || Array.prototype.some.call(roleTags, function (tag) {
            return tag.textContent === filter;
          });
          card.style.display = match ? '' : 'none';
        });
      });
    });
  }

  // ---------- Join form ----------
  var joinForm = document.getElementById('join-form');
  if (joinForm) {
    joinForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var submitBtn = joinForm.querySelector('.form-submit');
      var original = submitBtn.textContent;

      var handle = document.getElementById('handle').value.trim();
      var city = document.getElementById('city').value.trim();
      var bio = document.getElementById('bio').value.trim();
      var roles = Array.prototype.map.call(
        joinForm.querySelectorAll('input[name="role"]:checked'),
        function (el) { return el.value; }
      );

      if (!supabaseClient) {
        submitBtn.textContent = 'Not connected — try again later';
        submitBtn.disabled = true;
        setTimeout(function () { submitBtn.textContent = original; submitBtn.disabled = false; }, 3000);
        return;
      }

      submitBtn.textContent = 'Submitting…';
      submitBtn.disabled = true;

      supabaseClient.from('people').insert({
        handle: handle,
        city: city,
        roles: roles,
        bio: bio || null,
        status: 'pending'
      }).then(function (res) {
        if (res.error) {
          console.error('submit failed', res.error);
          submitBtn.textContent = 'Something went wrong — try again';
          setTimeout(function () { submitBtn.textContent = original; submitBtn.disabled = false; }, 3000);
          return;
        }
        joinForm.reset();
        submitBtn.textContent = 'Submitted — pending review ✓';
        setTimeout(function () { submitBtn.textContent = original; submitBtn.disabled = false; }, 4000);
      });
    });
  }
})();

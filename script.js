(function () {
  // ---------- Supabase ----------
  var SUPABASE_URL = 'https://gnxebzuzcjglldoevxik.supabase.co';
  var SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdueGVienV6Y2pnbGxkb2V2eGlrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI2OTI3NTEsImV4cCI6MjEwODI2ODc1MX0.v4bQECO0HkJhnOAKgxDbgE8zwqXsSkZ9RVDAPMOp5Fg';
  var supabaseClient = (window.supabase && window.supabase.createClient)
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY)
    : null;

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

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

  // ---------- World map (events only) ----------
  var mapPins = document.getElementById('map-pins-layer');
  if (mapPins) {
    fetch('data/map-pins.json')
      .then(function (r) { return r.json(); })
      .then(function (pins) {
        pins.forEach(function (p) {
          var group = document.createElement('div');
          group.className = 'pin-group-html';
          group.style.position = 'absolute';
          group.style.left = p.xpct + '%';
          group.style.top = p.ypct + '%';
          group.innerHTML =
            '<span class="pin-dot-html ' + p.type + '"></span>' +
            '<span class="pin-ring-html"></span>' +
            '<span class="pin-label-html">' + escapeHtml(p.name) + '</span>';
          mapPins.appendChild(group);
        });

        var statEvents = document.getElementById('stat-events');
        var statCities = document.getElementById('stat-cities');
        if (statEvents) statEvents.textContent = pins.length;
        if (statCities) statCities.textContent = pins.length;
      })
      .catch(function (err) { console.error('map pins failed to load', err); });
  }

  // ---------- Events (full grid) ----------
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
        '<div class="event-banner"><span class="event-date">' + escapeHtml(ev.date) + '</span>' + liveTag + '</div>' +
        '<div class="event-body">' +
          '<h3>' + escapeHtml(ev.title) + '</h3>' +
          '<p class="event-loc">' + escapeHtml(ev.location) + '</p>' +
          '<div class="post-preview"><span class="avatar"></span><span><strong>' + escapeHtml(ev.post.author) + '</strong> — "' + escapeHtml(ev.post.text) + '"</span></div>' +
          '<a class="event-cta" href="' + ev.ticketUrl + '" target="_blank" rel="noopener">' + escapeHtml(ev.ctaLabel) + ' →</a>' +
        '</div>' +
      '</div>'
    );
  }

  // ---------- Events panel (map sidebar, Upcoming/Previous tabs) ----------
  var eventsPanelList = document.getElementById('events-panel-list');
  var eventsTabs = document.querySelectorAll('.events-tab[data-tab]');
  if (eventsPanelList) {
    fetch('data/events.json')
      .then(function (r) { return r.json(); })
      .then(function (events) {
        function render(tab) {
          var filtered = events.filter(function (ev) {
            return tab === 'past' ? ev.status === 'past' : ev.status !== 'past';
          });
          if (!filtered.length) {
            eventsPanelList.innerHTML = '<p style="color:var(--text-muted); font-size:0.85rem; padding:14px 0;">Nothing here yet.</p>';
            return;
          }
          eventsPanelList.innerHTML = filtered.map(function (ev) {
            var liveTag = ev.status === 'live' ? '<span class="event-row-live">LIVE</span>' : '';
            var rowClass = ev.status === 'past' ? 'event-row past' : 'event-row';
            return (
              '<div class="' + rowClass + '">' +
                '<div class="event-row-date mono">' + escapeHtml(ev.date.split(' ')[0]) + '</div>' +
                '<div class="event-row-body">' +
                  '<h4>' + escapeHtml(ev.title) + liveTag + '</h4>' +
                  '<p class="event-row-loc">' + escapeHtml(ev.location) + '</p>' +
                  '<a class="event-row-link" href="' + ev.ticketUrl + '" target="_blank" rel="noopener">' + escapeHtml(ev.ctaLabel) + ' →</a>' +
                '</div>' +
              '</div>'
            );
          }).join('');
        }
        render('upcoming');
        eventsTabs.forEach(function (tab) {
          tab.addEventListener('click', function () {
            eventsTabs.forEach(function (t) { t.classList.remove('active'); });
            tab.classList.add('active');
            render(tab.getAttribute('data-tab'));
          });
        });
      })
      .catch(function (err) { console.error('events panel failed to load', err); });
  }

  // ---------- Quiz game: "Are You a Real Builder?" ----------
  var quizRoot = document.getElementById('quiz-root');
  if (quizRoot) {
    var LADDER = [100, 200, 300, 500, 1000, 2000, 4000, 8000, 16000, 32000, 64000, 125000, 250000, 500000, 1000000];
    var CHECKPOINTS = [5, 10];
    var TIME_PER_Q = 20;

    var screens = {
      start: document.getElementById('quiz-start'),
      play: document.getElementById('quiz-play'),
      end: document.getElementById('quiz-end')
    };
    var startBtn = document.getElementById('quiz-start-btn');
    var againBtn = document.getElementById('quiz-again-btn');
    var walkBtn = document.getElementById('quiz-walk-btn');
    var qNumEl = document.getElementById('quiz-q-num');
    var qCatEl = document.getElementById('quiz-q-cat');
    var qTextEl = document.getElementById('quiz-question-text');
    var qOptionsEl = document.getElementById('quiz-options');
    var timerFillEl = document.getElementById('quiz-timer-fill');
    var ladderEl = document.getElementById('quiz-ladder');
    var endStampEl = document.getElementById('quiz-end-stamp');
    var endTitleEl = document.getElementById('quiz-end-title');
    var endSubEl = document.getElementById('quiz-end-sub');
    var endScoreEl = document.getElementById('quiz-end-score');
    var nameForm = document.getElementById('quiz-name-form');
    var nameInput = document.getElementById('quiz-name-input');
    var submitStatusEl = document.getElementById('quiz-submit-status');

    var questions = [];
    var order = [];
    var current = 0;
    var locked = false;
    var timerInterval = null;
    var timeLeft = TIME_PER_Q;

    fetch('data/quiz-questions.json')
      .then(function (r) { return r.json(); })
      .then(function (qs) { questions = qs; })
      .catch(function (err) { console.error('quiz questions failed to load', err); });

    function show(name) {
      Object.keys(screens).forEach(function (key) {
        if (screens[key]) screens[key].style.display = key === name ? '' : 'none';
      });
    }

    function bankedScore() {
      var banked = 0;
      CHECKPOINTS.forEach(function (c) {
        if (current >= c) banked = LADDER[c - 1];
      });
      return banked;
    }

    function renderLadder() {
      var rows = [];
      for (var i = LADDER.length - 1; i >= 0; i--) {
        var qn = i + 1;
        var cls = 'quiz-ladder-row';
        if (qn === current + 1) cls += ' current';
        if (qn <= current) cls += ' done';
        if (CHECKPOINTS.indexOf(qn) !== -1) cls += ' checkpoint';
        rows.push(
          '<li class="' + cls + '">' +
            '<span class="quiz-ladder-num mono">' + qn + '</span>' +
            '<span class="quiz-ladder-val mono">' + LADDER[i].toLocaleString() + '</span>' +
          '</li>'
        );
      }
      if (ladderEl) ladderEl.innerHTML = rows.join('');
    }

    function startGame() {
      order = questions.map(function (_, i) { return i; });
      current = 0;
      locked = false;
      show('play');
      nextQuestion();
    }

    function nextQuestion() {
      if (current >= questions.length) {
        endGame(LADDER[LADDER.length - 1], 'won');
        return;
      }
      locked = false;
      var q = questions[order[current]];
      if (qNumEl) qNumEl.textContent = 'Question ' + (current + 1) + ' of ' + questions.length;
      if (qCatEl) qCatEl.textContent = q.category;
      if (qTextEl) qTextEl.textContent = q.question;
      var letters = ['A', 'B', 'C', 'D'];
      if (qOptionsEl) {
        qOptionsEl.innerHTML = q.options.map(function (opt, i) {
          return (
            '<button class="quiz-option" data-idx="' + i + '">' +
              '<span class="quiz-option-letter">' + letters[i] + '</span>' +
              '<span>' + escapeHtml(opt) + '</span>' +
            '</button>'
          );
        }).join('');
        qOptionsEl.querySelectorAll('.quiz-option').forEach(function (btn) {
          btn.addEventListener('click', function () {
            selectAnswer(parseInt(btn.getAttribute('data-idx'), 10));
          });
        });
      }
      renderLadder();
      startTimer();
    }

    function startTimer() {
      clearInterval(timerInterval);
      timeLeft = TIME_PER_Q;
      if (timerFillEl) {
        timerFillEl.style.transition = 'none';
        timerFillEl.style.width = '100%';
        timerFillEl.classList.remove('low');
        // force reflow so the transition re-applies next frame
        void timerFillEl.offsetWidth;
        timerFillEl.style.transition = 'width 1s linear, background 0.3s ease';
      }
      timerInterval = setInterval(function () {
        timeLeft -= 1;
        if (timerFillEl) {
          timerFillEl.style.width = Math.max(0, (timeLeft / TIME_PER_Q) * 100) + '%';
          if (timeLeft <= 6) timerFillEl.classList.add('low');
        }
        if (timeLeft <= 0) {
          clearInterval(timerInterval);
          selectAnswer(-1);
        }
      }, 1000);
    }

    function selectAnswer(idx) {
      if (locked || !questions.length) return;
      locked = true;
      clearInterval(timerInterval);
      var q = questions[order[current]];
      var buttons = qOptionsEl.querySelectorAll('.quiz-option');
      buttons.forEach(function (btn, i) {
        if (i === q.correct) btn.classList.add('correct');
        else if (i === idx) btn.classList.add('wrong');
        btn.disabled = true;
      });

      var isCorrect = idx === q.correct;
      setTimeout(function () {
        if (isCorrect) {
          current += 1;
          nextQuestion();
        } else {
          endGame(bankedScore(), 'lost');
        }
      }, 1200);
    }

    function walkAway() {
      if (!questions.length) return;
      clearInterval(timerInterval);
      var score = current > 0 ? LADDER[current - 1] : 0;
      endGame(score, 'walked');
    }

    function endGame(score, outcome) {
      show('end');
      if (endScoreEl) endScoreEl.textContent = score.toLocaleString();
      if (outcome === 'won') {
        if (endStampEl) { endStampEl.className = 'stamp gold'; endStampEl.textContent = '🏆'; }
        if (endTitleEl) endTitleEl.textContent = 'WAGMI — you’re a real Builder.';
        if (endSubEl) endSubEl.textContent = 'All 15 questions, no mistakes. Certified.';
      } else if (outcome === 'walked') {
        if (endStampEl) { endStampEl.className = 'stamp gold'; endStampEl.textContent = '🟡'; }
        if (endTitleEl) endTitleEl.textContent = 'Smart move.';
        if (endSubEl) endSubEl.textContent = 'You walked away with your score banked.';
      } else {
        if (endStampEl) { endStampEl.className = 'stamp crimson'; endStampEl.textContent = '✕'; }
        if (endTitleEl) endTitleEl.textContent = 'Game over.';
        if (endSubEl) endSubEl.textContent = score > 0
          ? 'Wrong answer — but your checkpoint saved some of it.'
          : 'Wrong answer on question ' + (current + 1) + '. Better luck next run.';
      }
      if (submitStatusEl) submitStatusEl.textContent = '';
      if (nameForm) nameForm.dataset.score = score;
    }

    if (startBtn) startBtn.addEventListener('click', startGame);
    if (againBtn) againBtn.addEventListener('click', startGame);
    if (walkBtn) walkBtn.addEventListener('click', walkAway);

    if (nameForm) {
      nameForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var name = nameInput.value.trim();
        var score = parseInt(nameForm.dataset.score || '0', 10);
        if (!name) return;
        var submitBtn = nameForm.querySelector('button[type="submit"]');
        var original = submitBtn.textContent;

        if (!supabaseClient) {
          if (submitStatusEl) submitStatusEl.textContent = 'Not connected — try again later.';
          return;
        }

        submitBtn.textContent = 'Submitting…';
        submitBtn.disabled = true;

        supabaseClient.from('leaderboard').insert({ name: name, score: score }).then(function (res) {
          submitBtn.disabled = false;
          submitBtn.textContent = original;
          if (res.error) {
            console.error('leaderboard submit failed', res.error);
            if (submitStatusEl) submitStatusEl.textContent = 'Something went wrong — try again.';
            return;
          }
          if (submitStatusEl) submitStatusEl.textContent = 'Score submitted ✓';
          nameForm.reset();
          loadLeaderboard();
        });
      });
    }

    renderLadder();
  }

  // ---------- Leaderboard (always loaded if present on page) ----------
  var leaderboardList = document.getElementById('leaderboard-list');
  function loadLeaderboard() {
    if (!leaderboardList) return;
    var load = supabaseClient
      ? supabaseClient.from('leaderboard').select('*').order('score', { ascending: false }).limit(10)
          .then(function (res) {
            if (res.error) throw res.error;
            return res.data;
          })
      : Promise.resolve([]);

    load
      .then(function (rows) {
        if (!rows || !rows.length) {
          leaderboardList.innerHTML =
            '<div class="empty-state">' +
              '<p class="empty-title">No scores yet.</p>' +
              '<p class="empty-sub">Be the first to prove it.</p>' +
            '</div>';
          return;
        }
        leaderboardList.innerHTML = rows.map(function (row, i) {
          var rankCls = i === 0 ? 'leaderboard-rank gold' : 'leaderboard-rank';
          return (
            '<div class="leaderboard-row">' +
              '<span class="' + rankCls + ' mono">' + (i + 1) + '</span>' +
              '<span>' + escapeHtml(row.name) + '</span>' +
              '<span class="mono">' + Number(row.score).toLocaleString() + '</span>' +
            '</div>'
          );
        }).join('');
      })
      .catch(function (err) {
        console.error('leaderboard failed to load', err);
        leaderboardList.innerHTML =
          '<div class="empty-state">' +
            '<p class="empty-title">Couldn’t load the leaderboard.</p>' +
            '<p class="empty-sub">Try refreshing in a bit.</p>' +
          '</div>';
      });
  }
  loadLeaderboard();
})();

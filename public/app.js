// StudyStreak v0.5 frontend — login, today's loop, chapters tracking.

const $ = id => document.getElementById(id);
const screens = {
  auth:     $('screen-auth'),
  today:    $('screen-today'),
  chapters: $('screen-chapters'),
  squad:    $('screen-squad'),
  session:  $('screen-session'),
  reward:   $('screen-reward'),
};

let state = {
  me: null,
  today: null,
  catchup: null,
  squad: null,
  activeLecture: null,
  timerHandle: null,
  timerSeconds: 25 * 60,
  pendingLectureForReflect: null,
  inviteFromUrl: null,           // pre-filled inviter id from ?invite=
};

function show(name) {
  for (const [k, el] of Object.entries(screens)) el.style.display = (k === name) ? 'flex' : 'none';
  const mainScreens = ['today', 'chapters', 'squad', 'session', 'reward'];
  $('bottomNav').style.display = (state.me && mainScreens.includes(name)) ? 'flex' : 'none';
  document.querySelectorAll('.nav-btn[data-screen]').forEach(b => {
    b.classList.toggle('active', b.dataset.screen === name);
  });
  window.scrollTo({ top: 0 });
}

async function api(method, path, body) {
  const opts = { method, headers: { 'content-type': 'application/json' }, credentials: 'include' };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) {
    const err = new Error(data?.error || `http_${res.status}`);
    err.detail = data?.detail; err.status = res.status;
    throw err;
  }
  return data;
}

// ---------- Auth ----------

document.querySelectorAll('[data-auth-tab]').forEach(t => {
  t.addEventListener('click', () => {
    document.querySelectorAll('[data-auth-tab]').forEach(b => b.classList.remove('active'));
    t.classList.add('active');
    const which = t.dataset.authTab;
    $('loginForm').style.display  = which === 'login'  ? 'flex' : 'none';
    $('signupForm').style.display = which === 'signup' ? 'flex' : 'none';
  });
});

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('loginErr').textContent = '';
  try {
    const r = await api('POST', '/api/auth/login', {
      studentId: $('loginId').value.trim(),
      password: $('loginPass').value,
    });
    state.me = { userId: r.userId, displayName: r.displayName };
    await loadToday();
    show('today');
  } catch (e) {
    $('loginErr').textContent = e.message === 'invalid_credentials'
      ? 'Wrong student ID or password.'
      : (e.detail || e.message);
  }
});

$('signupForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('signupErr').textContent = '';
  try {
    const r = await api('POST', '/api/auth/signup', {
      displayName: $('signupName').value.trim(),
      studentId:   $('signupId').value.trim(),
      batch:       $('signupBatch').value.trim(),
      password:    $('signupPass').value,
      invitedBy:   state.inviteFromUrl || undefined,
    });
    state.me = { userId: r.userId, displayName: r.displayName };
    await loadToday();
    show('today');
  } catch (e) {
    const errMap = {
      student_id_taken: 'That student ID is taken — pick another.',
      password_too_short: 'Password must be at least 6 characters.',
      invalid_student_id: 'Use 3-32 chars: letters, digits, _, ., -',
      invalid_display_name: 'Enter your full name.',
    };
    $('signupErr').textContent = errMap[e.message] || (e.detail || e.message);
  }
});

$('logoutBtn').addEventListener('click', async () => {
  await api('POST', '/api/auth/logout').catch(() => {});
  state.me = null;
  show('auth');
});

// ---------- Bottom nav ----------

document.querySelectorAll('.nav-btn[data-screen]').forEach(b => {
  b.addEventListener('click', async () => {
    const target = b.dataset.screen;
    if (target === 'today') { await loadToday(); show('today'); }
    if (target === 'chapters') { await loadChapters(); show('chapters'); }
    if (target === 'squad') { await loadSquad(); show('squad'); }
  });
});

// Coverage pill jumps to Chapters
$('covPill')?.addEventListener('click', async () => { await loadChapters(); show('chapters'); });

// ---------- TODAY ----------

function fmtTime(iso) {
  const d = new Date(iso);
  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function isLive(lec) {
  const now = Date.now();
  const start = new Date(lec.scheduled_start).getTime();
  const end = start + lec.scheduled_duration_min * 60_000;
  return now >= start - 15 * 60_000 && now <= end && !lec.status;
}

function statusOrder(lec) {
  if (lec.status === 'Done' || lec.status === 'Revised') return 'done';
  if (isLive(lec)) return 'live';
  return 'normal';
}

async function loadToday() {
  // Fetch in parallel: today's lectures + chapter coverage
  const [data, chaps] = await Promise.all([
    api('GET', '/api/today'),
    api('GET', '/api/chapters'),
  ]);
  state.today = data;
  state.chapters = chaps;

  $('userName').textContent = data.user.displayName || 'there';

  // Total chapters covered, across all subjects
  let totalChapters = 0, completedChapters = 0;
  for (const t of Object.values(chaps.totals)) {
    totalChapters += t.total;
    completedChapters += t.completed;
  }
  $('covTotal').textContent = `${completedChapters}/${totalChapters}`;

  // Subject cards (Physics, Math, Chemistry — fixed order)
  const order = ['Physics', 'Math', 'Chemistry'];
  const labels = { Physics: 'Physics', Math: 'Math', Chemistry: 'Chem' };
  const cls = { Physics: 'P', Math: 'M', Chemistry: 'C' };
  const cards = $('subCards');
  cards.innerHTML = '';
  for (const sub of order) {
    const t = chaps.totals[sub] || { total: 12, completed: 0, inProgress: 0 };
    const pct = t.total ? Math.round(t.completed / t.total * 100) : 0;
    const div = document.createElement('div');
    div.className = `sub-card ${cls[sub]}`;
    div.innerHTML = `
      <div class="nm">${labels[sub]}</div>
      <div class="frac">${t.completed}<span class="denom">/${t.total}</span></div>
      <div class="bar"><i style="width:${pct}%"></i></div>
      <div class="meta">${t.inProgress} in progress</div>
    `;
    div.addEventListener('click', async () => { await loadChapters(); show('chapters'); });
    cards.appendChild(div);
  }

  const today = new Date(data.today + 'T00:00:00');
  const dayName = today.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' });
  $('dateLabel').textContent = dayName;

  // Lectures section header — describe today's load
  const total = data.summary.total;
  const done = data.summary.done;
  if (total === 0) {
    $('lecMeta').textContent = 'No sessions today';
  } else if (done === total) {
    $('lecMeta').textContent = `${total}/${total} done ✓`;
  } else {
    $('lecMeta').textContent = `${done}/${total} done`;
  }

  const list = $('lectureList');
  list.innerHTML = '';
  for (const l of data.lectures) {
    const order = statusOrder(l);
    const div = document.createElement('div');
    div.className = `lect ${order === 'done' ? 'done' : order === 'live' ? 'live' : ''}`;
    div.innerHTML = `
      <div class="ico ${l.subject}">${l.subject[0]}</div>
      <div class="t">
        <div class="tt">${l.topic}</div>
        <div class="ts">${fmtTime(l.scheduled_start)} · ${l.sub_topic || ''}</div>
      </div>
      <span class="chip ${l.status || (order === 'live' ? 'Live' : 'Soon')}">${l.status || (order === 'live' ? 'Live' : 'Soon')}</span>
    `;
    div.addEventListener('click', () => openSession(l));
    list.appendChild(div);
  }

  await loadCatchup();
}

async function loadCatchup() {
  try {
    const data = await api('GET', '/api/backlog');
    state.catchup = data;
    if (!data.top || data.top.length === 0) { $('catchupBox').style.display = 'none'; return; }
    $('catchupBox').style.display = 'block';
    $('catchupCount').textContent = `${data.backlogCount} pending · ${data.backlogDeferred} auto-deferred`;
    const list = $('catchupList');
    list.innerHTML = '';
    for (const it of data.top) {
      const div = document.createElement('div');
      div.className = `urg ${it.band}`;
      div.innerHTML = `
        <div class="row">
          <span class="tag ${it.band}">${it.band} · pick</span>
          <span class="chip ${it.subject || 'Soon'}">${it.subject}</span>
        </div>
        <div class="h">${it.topic}</div>
        <div class="meta">${it.daysSinceScheduled}d old · score ${it.score} · ${it.action}</div>
      `;
      div.addEventListener('click', () => openSession(it));
      list.appendChild(div);
    }
  } catch (e) { /* swallow */ }
}

// ---------- CHAPTERS ----------

const STATUS_OPTIONS = ['Not Started', 'In Progress', 'Completed'];

async function loadChapters() {
  const data = await api('GET', '/api/chapters');
  const totalsEl = $('chapterTotals');
  totalsEl.innerHTML = '';
  for (const [subject, t] of Object.entries(data.totals)) {
    const div = document.createElement('div');
    div.className = `chap-total ${subject}`;
    div.innerHTML = `
      <div class="ct-h">${subject}</div>
      <div class="ct-n">${t.completed}<span class="muted">/${t.total}</span></div>
      <div class="ct-bar"><i style="width:${t.total ? (t.completed / t.total * 100) : 0}%"></i></div>
      <div class="ct-meta">${t.inProgress} in progress</div>
    `;
    totalsEl.appendChild(div);
  }

  const list = $('chapterList');
  list.innerHTML = '';
  for (const [subject, topics] of Object.entries(data.grouped)) {
    const subEl = document.createElement('section');
    subEl.className = 'chap-sub';
    subEl.innerHTML = `<h3 class="chap-sub-h">${subject}</h3>`;
    for (const tp of topics) {
      const det = document.createElement('details');
      det.className = `topic-group ${tp.completed === tp.totalSessions ? 'all-done' : ''}`;
      const summary = document.createElement('summary');
      summary.className = 'topic-h';
      summary.innerHTML = `
        <div class="topic-name">${tp.topic}</div>
        <div class="topic-meta">
          <span class="topic-count">${tp.completed}/${tp.totalSessions}</span>
          <div class="topic-bar"><i style="width:${tp.totalSessions ? tp.completed / tp.totalSessions * 100 : 0}%"></i></div>
        </div>
      `;
      det.appendChild(summary);

      for (const s of tp.sessions) {
        const row = document.createElement('div');
        row.className = `sess-row status-${s.status.replace(/\s+/g, '')}`;
        const subTopicHtml = (s.subTopic || '').replace(/</g, '&lt;');
        row.innerHTML = `
          <div class="sess-name">
            <div class="sess-title">Session ${s.sessionNum}</div>
            <div class="sess-meta">${subTopicHtml || '—'}</div>
          </div>
          <select class="sess-status">
            ${STATUS_OPTIONS.map(opt => `<option value="${opt}" ${opt === s.status ? 'selected' : ''}>${opt}</option>`).join('')}
          </select>
        `;
        const sel = row.querySelector('select');
        sel.addEventListener('change', async () => {
          try {
            await api('PATCH', '/api/chapters', {
              subject, topic: tp.topic, sessionNum: s.sessionNum, status: sel.value,
            });
            await loadChapters();
          } catch (e) { alert('Failed: ' + e.message); }
        });
        det.appendChild(row);
      }
      subEl.appendChild(det);
    }
    list.appendChild(subEl);
  }
}

// ---------- SESSION ----------

function openSession(lec) {
  state.activeLecture = lec;
  $('sessSubject').textContent = `${lec.subject} · ${fmtTime(lec.scheduled_start)}`;
  $('sessTopic').textContent = lec.topic;
  $('sessSubtopic').textContent = lec.sub_topic || '';
  state.timerSeconds = (lec.scheduled_duration_min || 25) * 60;
  if (state.timerSeconds > 25 * 60) state.timerSeconds = 25 * 60;
  updateTimer();
  startTimer();
  show('session');
}

function updateTimer() {
  const m = Math.floor(state.timerSeconds / 60);
  const s = state.timerSeconds % 60;
  $('timer').textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  const total = (state.activeLecture?.scheduled_duration_min || 25) * 60;
  const cap = Math.min(total, 25 * 60);
  const pct = state.timerSeconds / cap;
  $('ringFg').setAttribute('stroke-dashoffset', 578 * (1 - pct));
}
function startTimer() {
  if (state.timerHandle) clearInterval(state.timerHandle);
  state.timerHandle = setInterval(() => {
    state.timerSeconds = Math.max(0, state.timerSeconds - 1);
    updateTimer();
    if (state.timerSeconds === 0) clearInterval(state.timerHandle);
  }, 1000);
}

document.querySelectorAll('.act').forEach(btn => {
  btn.addEventListener('click', async () => {
    if (!state.activeLecture) return;
    const status = btn.dataset.status;
    const lec = state.activeLecture;
    try {
      const res = await api('PATCH', `/api/lectures/${lec.id}/status`, { status });
      clearInterval(state.timerHandle);
      if (status === 'Done') showReward(res, lec);
      else { await loadToday(); show('today'); }
    } catch (e) { alert('Failed: ' + e.message); }
  });
});

$('sessBack').addEventListener('click', () => { clearInterval(state.timerHandle); show('today'); });
$('rewardBack').addEventListener('click', async () => { await loadToday(); show('today'); });

function showReward(res, lec) {
  state.pendingLectureForReflect = lec;
  const newStreak = res.streak;
  const grew = res.streakChanged;

  $('rewardStreakMsg').textContent = grew
    ? `${newStreak}-day streak! 🔥`
    : `Lecture sealed · streak ${newStreak}🔥`;
  $('rewardStreakSub').textContent = grew
    ? (newStreak >= 7 ? 'Top 9% of droppers in your batch.' : `Best so far: ${res.longestStreak} days.`)
    : 'XP banked. Keep stacking.';

  const mb = $('mysteryBox');
  if (res.reward && res.reward.type === 'mystery_box') {
    mb.style.display = 'block';
    $('mysteryXp').textContent = `+ ${res.reward.xp} XP`;
    const rarity = res.reward.xp >= 380 ? 'rare drop · 1 in 20'
      : res.reward.xp >= 200 ? 'uncommon · 1 in 10'
      : 'common · 1 in 5';
    $('mysteryMeta').textContent = `${rarity} · p=${res.reward.p.toFixed(3)}`;
  } else {
    mb.style.display = 'none';
  }

  $('reflectQ').textContent = `What was hardest about ${lec.topic}?`;
  $('reflectText').value = '';
  show('reward');
}

$('reflectSave').addEventListener('click', async () => {
  const text = $('reflectText').value.trim();
  if (!text) return;
  try {
    await api('POST', '/api/reflections', { lectureId: state.pendingLectureForReflect.id, text });
    await loadToday(); show('today');
  } catch (e) { alert(e.message); }
});

$('reflectSkip').addEventListener('click', async () => { await loadToday(); show('today'); });

// ---------- SQUAD ----------

const CHEER_TEMPLATES = [
  "You got this 💪",
  "Don't break it 🔥",
  "25-min sprint? ⏱️",
  "Study together? 🤝",
  "Way to go 🎯",
];

async function loadSquad() {
  const data = await api('GET', '/api/squad');
  state.squad = data;

  // Update badge
  if (data.unreadCheers > 0) {
    $('cheerBadge').textContent = data.unreadCheers;
    $('cheerBadge').style.display = 'inline-flex';
  } else {
    $('cheerBadge').style.display = 'none';
  }

  $('squadHi').textContent = data.squadSize === 0 ? 'Build your crew' : `Your squad (${data.squadSize}/${data.cap})`;
  $('squadSub').textContent = data.squadSize > 0 ? `You're rank #${data.myRank}` : 'Better with friends.';

  // Cheers panel — load and render
  await loadCheersPanel();

  // Leaderboard
  const lb = $('leaderboard');
  const empty = $('emptySquad');
  if (data.squad.length === 1) {
    // Just self — show empty state
    lb.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  lb.innerHTML = '';
  data.squad.forEach((m, i) => {
    const rank = i + 1;
    const div = document.createElement('div');
    div.className = `lb-row ${m.isSelf ? 'is-self' : ''}`;
    const initial = (m.displayName || m.studentId).charAt(0).toUpperCase();
    div.innerHTML = `
      <div class="lb-rank">${rank}</div>
      <div class="lb-av">${initial}</div>
      <div class="lb-info">
        <div class="lb-name">${m.displayName || m.studentId}${m.isSelf ? ' <span class="muted">(you)</span>' : ''}</div>
        <div class="lb-meta">📚 ${m.chaptersCompleted}/${data.totalChapters} topics · ${m.sessionsCompleted} sessions${m.batch ? ' · ' + m.batch : ''}</div>
      </div>
      ${m.isSelf ? '' : `<button class="cheer-btn" data-id="${m.studentId}" data-name="${m.displayName || m.studentId}">👋</button>`}
    `;
    lb.appendChild(div);
  });
  // Wire cheer buttons
  document.querySelectorAll('.cheer-btn').forEach(btn => {
    btn.addEventListener('click', () => openCheerModal(btn.dataset.id, btn.dataset.name));
  });
}

async function loadCheersPanel() {
  try {
    const data = await api('GET', '/api/squad/cheers');
    if (!data.cheers || data.cheers.length === 0) {
      $('cheersCard').style.display = 'none';
      return;
    }
    $('cheersCard').style.display = 'block';
    const box = $('cheersList');
    box.innerHTML = '';
    data.cheers.slice(0, 5).forEach(c => {
      const row = document.createElement('div');
      row.className = 'cheer-row';
      row.innerHTML = `
        <div class="cheer-msg">${c.message}</div>
        <div class="cheer-from">— ${c.fromName} · ${new Date(c.createdAt).toLocaleDateString('en-IN')}</div>
      `;
      box.appendChild(row);
    });
    // Reset badge after viewing
    $('cheerBadge').style.display = 'none';
  } catch (e) { /* swallow */ }
}

// Invite modal

function openInviteModal() {
  const url = `${window.location.origin}/?invite=${encodeURIComponent(state.me.userId)}`;
  $('inviteLink').textContent = url;
  $('inviteModal').style.display = 'flex';
}
$('inviteBtn')?.addEventListener('click', openInviteModal);
$('inviteClose').addEventListener('click', () => $('inviteModal').style.display = 'none');
$('inviteCopy').addEventListener('click', async () => {
  const url = $('inviteLink').textContent;
  try {
    await navigator.clipboard.writeText(url);
    $('inviteCopy').textContent = 'Copied ✓';
    setTimeout(() => $('inviteCopy').textContent = 'Copy link', 1500);
  } catch { alert(url); }
});
$('inviteShare').addEventListener('click', () => {
  const url = $('inviteLink').textContent;
  const msg = `Hey! Join me on StudyStreak — we'll keep each other consistent. ${url}`;
  window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
});

// Add by Student ID
$('addBtn').addEventListener('click', async () => {
  const id = $('addId').value.trim().toLowerCase();
  $('addMsg').textContent = '';
  $('addMsg').className = 'add-msg';
  if (!id) { $('addMsg').textContent = 'Enter a student ID.'; return; }
  try {
    const res = await api('POST', '/api/squad/add', { studentId: id });
    if (res.alreadyLinked) {
      $('addMsg').className = 'add-msg ok';
      $('addMsg').textContent = `${id} is already in your squad.`;
    } else {
      $('addMsg').className = 'add-msg ok';
      $('addMsg').textContent = `✓ Added ${res.addedName}. Refreshing…`;
      $('addId').value = '';
      setTimeout(async () => {
        $('inviteModal').style.display = 'none';
        $('addMsg').textContent = '';
        await loadSquad();
      }, 900);
    }
  } catch (e) {
    $('addMsg').className = 'add-msg err';
    const map = {
      not_found: 'No student with that ID.',
      cannot_add_self: 'You can\'t add yourself.',
      squad_full: 'Your squad is full (8/8).',
      their_squad_full: 'Their squad is full (8/8).',
    };
    $('addMsg').textContent = map[e.message] || e.detail || e.message;
  }
});
$('addId').addEventListener('keydown', e => { if (e.key === 'Enter') $('addBtn').click(); });

// Cheer modal
let cheerTarget = null;
function openCheerModal(toId, toName) {
  cheerTarget = toId;
  $('cheerToName').textContent = toName;
  const opts = $('cheerOptions');
  opts.innerHTML = '';
  CHEER_TEMPLATES.forEach(t => {
    const b = document.createElement('button');
    b.className = 'cheer-opt';
    b.textContent = t;
    b.addEventListener('click', async () => {
      try {
        await api('POST', '/api/squad/cheer', { toUser: cheerTarget, message: t });
        $('cheerModal').style.display = 'none';
        // Tiny success animation could go here
      } catch (e) { alert('Failed: ' + e.message); }
    });
    opts.appendChild(b);
  });
  $('cheerModal').style.display = 'flex';
}
$('cheerClose').addEventListener('click', () => $('cheerModal').style.display = 'none');

// ---------- BOOT ----------

(async () => {
  // Detect ?invite=<userid> in URL and prep the auth screen
  const params = new URLSearchParams(window.location.search);
  const invite = params.get('invite');
  if (invite && /^[a-zA-Z0-9_.\-]{3,32}$/.test(invite)) {
    state.inviteFromUrl = invite.toLowerCase();
    $('inviteText').textContent = `${invite} invited you to StudyStreak.`;
    $('inviteBanner').style.display = 'block';
    // Pre-flip to Sign up tab
    document.querySelector('[data-auth-tab="signup"]').click();
  }

  try {
    const me = await api('GET', '/api/auth/me');
    if (me.authenticated) {
      state.me = { userId: me.userId, displayName: me.displayName };
      await loadToday();
      // Pull cheer count badge in background
      api('GET', '/api/squad').then(d => {
        if (d.unreadCheers > 0) {
          $('cheerBadge').textContent = d.unreadCheers;
          $('cheerBadge').style.display = 'inline-flex';
        }
      }).catch(() => {});
      show('today');
    } else {
      show('auth');
    }
  } catch (e) {
    document.body.innerHTML = '<div style="padding:40px;text-align:center;color:#fff">App failed to load: ' + e.message + '</div>';
  }
})();

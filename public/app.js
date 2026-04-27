// StudyStreak v0 frontend — vanilla JS hitting the real API.
// Three screens (Today, Live session, Reward) with full Hooked-loop transitions.

const $ = id => document.getElementById(id);
const screens = {
  today:   $('screen-today'),
  session: $('screen-session'),
  reward:  $('screen-reward'),
};

let state = {
  today: null,
  catchup: null,
  activeLecture: null,
  timerHandle: null,
  timerSeconds: 25 * 60,
  pendingLectureForReflect: null,
};

function show(name) {
  for (const [k, el] of Object.entries(screens)) el.style.display = (k === name) ? 'flex' : 'none';
  window.scrollTo({ top: 0 });
}

async function api(method, path, body) {
  const opts = { method, headers: { 'content-type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

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
  const data = await api('GET', '/api/today');
  state.today = data;

  $('userName').textContent = data.user.displayName || 'there';
  $('streakNum').textContent = data.summary.streak;
  $('statXp').textContent = data.summary.totalXp;
  $('statStreak').textContent = data.summary.streak;
  $('statLongest').textContent = data.summary.longestStreak;

  const today = new Date(data.today + 'T00:00:00');
  const dayName = today.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' });
  $('dateLabel').textContent = dayName;

  const total = data.summary.total;
  const done = data.summary.done;
  $('progDone').textContent = `${done} of ${total} done`;
  $('progBar').style.width = `${total ? Math.round(done / total * 100) : 0}%`;
  if (done === total && total > 0) {
    $('missionText').textContent = 'Mission complete · streak protected ✨';
    $('progXp').textContent = '🔥 Day cleared';
  } else if (done > 0) {
    $('missionText').textContent = `${total - done} ${total - done === 1 ? 'lecture' : 'lectures'} left to seal today's streak`;
  } else {
    $('missionText').textContent = `Finish ${total} ${total === 1 ? 'lecture' : 'lectures'} to keep the streak alive`;
  }

  // Render lecture list
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

  // Catch-up
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
  } catch (e) {
    console.warn('catchup load failed', e);
  }
}

// ---------- Session ----------

function openSession(lec) {
  state.activeLecture = lec;
  $('sessSubject').textContent = `${lec.subject} · ${fmtTime(lec.scheduled_start)}`;
  $('sessTopic').textContent = lec.topic;
  $('sessSubtopic').textContent = lec.sub_topic || '';
  state.timerSeconds = (lec.scheduled_duration_min || 25) * 60;
  // Cap demo timer at 25 min so it's playable
  if (state.timerSeconds > 25 * 60) state.timerSeconds = 25 * 60;
  updateTimer();
  startTimer();
  show('session');
}

function updateTimer() {
  const m = Math.floor(state.timerSeconds / 60);
  const s = state.timerSeconds % 60;
  $('timer').textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  // Ring animation
  const total = (state.activeLecture?.scheduled_duration_min || 25) * 60;
  const cap = Math.min(total, 25 * 60);
  const pct = state.timerSeconds / cap;
  const dash = 578;
  $('ringFg').setAttribute('stroke-dashoffset', dash * (1 - pct));
}

function startTimer() {
  if (state.timerHandle) clearInterval(state.timerHandle);
  state.timerHandle = setInterval(() => {
    state.timerSeconds = Math.max(0, state.timerSeconds - 1);
    updateTimer();
    if (state.timerSeconds === 0) clearInterval(state.timerHandle);
  }, 1000);
}

// ---------- Action handlers ----------

document.querySelectorAll('.act').forEach(btn => {
  btn.addEventListener('click', async () => {
    if (!state.activeLecture) return;
    const status = btn.dataset.status;
    const lec = state.activeLecture;
    try {
      const res = await api('PATCH', `/api/lectures/${lec.id}/status`, { status });
      clearInterval(state.timerHandle);
      if (status === 'Done') {
        showReward(res, lec);
      } else {
        await loadToday();
        show('today');
      }
    } catch (e) {
      alert('Failed: ' + e.message);
    }
  });
});

$('sessBack').addEventListener('click', () => { clearInterval(state.timerHandle); show('today'); });
$('rewardBack').addEventListener('click', async () => { await loadToday(); show('today'); });

// ---------- Reward ----------

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

  // Mystery box
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

  // Reflection prompt
  $('reflectQ').textContent = `What was hardest about ${lec.topic}?`;
  $('reflectText').value = '';

  show('reward');
}

$('reflectSave').addEventListener('click', async () => {
  const text = $('reflectText').value.trim();
  if (!text) return;
  try {
    const res = await api('POST', '/api/reflections', { lectureId: state.pendingLectureForReflect.id, text });
    await loadToday();
    show('today');
  } catch (e) { alert(e.message); }
});

$('reflectSkip').addEventListener('click', async () => { await loadToday(); show('today'); });

// ---------- Reset (demo) ----------

$('resetBtn').addEventListener('click', async () => {
  if (!confirm('Reset demo data? This will re-seed the database.')) return;
  await fetch('/api/__reset', { method: 'POST' }).catch(() => {});
  location.reload();
});

// ---------- Boot ----------

(async () => {
  try {
    await loadToday();
    show('today');
  } catch (e) {
    document.body.innerHTML = '<div style="padding:40px;text-align:center;color:#fff">API not reachable: ' + e.message + '</div>';
  }
})();

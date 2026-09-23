/* Laya Demo — frontend logic
 * SPDX-License-Identifier: 0BSD
 * Author: Michael Amador <me@almodover.fr> · https://github.com/almodover/laya-demo
 */
console.info('%cLaya Demo%c by Michael Amador · me@almodover.fr',
             'color:#0049D9;font-weight:800', 'color:inherit');
const $ = id => document.getElementById(id);
let currentFile = null, sortMode = 'pct', lastResult = null;

/* ---------- health ---------- */
function health() {
  return fetch('/api/health').then(r => r.json()).then(h => {
    const dev = h.device === 'cuda' ? 'Radeon 8060S · ROCm' + (h.compiled ? ' · compiled' : '')
                                    : `CPU · ${h.threads || '-'} threads`;
    $('engineInfo').textContent = `${h.dimensions} dims · ${dev}`;
    if (h.warm === 'warming') setStatus('busy', 'warming up models…');
    else if (String(h.warm).startsWith('error')) setStatus('err', 'warm-up failed');
    else if (!$('analyzeBtn').disabled) setStatus('ok', 'engine ready');
    return h;
  }).catch(() => setStatus('err', 'engine offline'));
}
health();
// Keep the header honest while models compile at startup (~1 min).
const _hp = setInterval(() => health().then(h => { if (h && h.warm !== 'warming') clearInterval(_hp); }), 3000);

function setStatus(cls, txt) {
  $('statusDot').className = 'dot' + (cls ? ' ' + cls : '');
  $('statusTxt').textContent = txt;
  $('statusTxt').className = cls === 'err' ? '' : 'ok';
}

/* ---------- tabs ---------- */
document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
  t.classList.add('active');
  $('tab-paste').style.display = t.dataset.tab === 'paste' ? '' : 'none';
  $('tab-file').style.display = t.dataset.tab === 'file' ? '' : 'none';
}));

/* ---------- dropzone ---------- */
const dz = $('dropzone'), fi = $('fileInput');
dz.addEventListener('click', () => fi.click());
dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag'); });
dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
dz.addEventListener('drop', e => {
  e.preventDefault(); dz.classList.remove('drag');
  if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]);
});
fi.addEventListener('change', () => { if (fi.files[0]) setFile(fi.files[0]); });

function setFile(f) {
  currentFile = f;
  $('filechip').style.display = 'flex';
  $('fileName').textContent = f.name;
  $('fileSize').textContent = fmtBytes(f.size);
  updateMeter();
}
function fmtBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}
function fileActive() { return $('tab-file').style.display !== 'none'; }

$('txt').addEventListener('input', updateMeter);
function updateMeter() {
  const n = fileActive() && currentFile ? currentFile.size : $('txt').value.length;
  $('meter').textContent = n ? (fileActive() && currentFile ? fmtBytes(n) + ' loaded' : n.toLocaleString() + ' characters') : '';
}

/* ---------- analyze ---------- */
$('analyzeBtn').addEventListener('click', start);
$('resetBtn').addEventListener('click', () => {
  $('results').style.display = 'none';
  $('inputPanel').style.display = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
});
$('sortBtn').addEventListener('click', () => {
  sortMode = sortMode === 'pct' ? 'alpha' : 'pct';
  $('sortBtn').textContent = 'Sort: ' + (sortMode === 'pct' ? 'by %' : 'A → Z');
  if (lastResult) renderSections(lastResult.stats);
});

function esc(s) { const d = document.createElement('div'); d.textContent = String(s); return d.innerHTML; }
function fmtMs(ms) { return ms < 1000 ? Math.round(ms) + ' ms' : (ms / 1000).toFixed(1) + ' s'; }

async function start() {
  $('errorBox').style.display = 'none';
  const fd = new FormData();
  const isFile = fileActive();
  if (isFile) {
    if (!currentFile) { showError('Choose a document first.'); return; }
    fd.append('file', currentFile);
  } else {
    const t = $('txt').value.trim();
    if (!t) { showError('Paste some text first.'); return; }
    fd.append('text', t);
  }
  let model = $('model').value;
  if (model === 'auto') model = guessModel(isFile ? null : $('txt').value);
  if (model) fd.append('model', model);

  $('analyzeBtn').disabled = true;
  $('inputPanel').style.display = 'none';
  $('progress').style.display = 'block';
  setBar(2, 'Warming the engine…');
  setStatus('busy', 'analyzing');

  try {
    const r = await fetch('/api/analyze', { method: 'POST', body: fd });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'analyze failed');
    poll(j.job_id);
  } catch (e) { fail(e.message); }
}

function showError(msg) {
  const eb = $('errorBox'); eb.textContent = '⚠ ' + msg; eb.style.display = 'block';
}

function guessModel(t) {
  if (!t) return 'english';
  const odd = t.match(/[^\x00-\x7F]/g) || [];
  const total = t.replace(/\s/g, '').length || 1;
  return (odd.length / total) > 0.10 ? 'multilingual' : 'english';
}

async function poll(jobId) {
  try {
    const r = await fetch('/api/job/' + jobId);
    const j = await r.json();
    if (j.status === 'done') { setBar(100, 'Complete'); finish(j.result); return; }
    if (j.status === 'error') { fail(j.error || 'analysis error'); return; }
    const pct = Math.max(3, Math.round((j.progress || 0) * 100));
    let msg = 'Loading model & reading document…';
    if (j.progress > 0.05 && j.chunks) {
      const done = Math.min(j.chunks, Math.max(1, Math.round(((j.progress - 0.05) / 0.9) * j.chunks)));
      msg = `Parallel pass ${done} of ${j.chunks} · scoring 82 dimensions…`;
    }
    // Thermal governor: the server pauses between passes when the chip is hot.
    $('progress').classList.toggle('cooling', !!j.cooling);
    if (j.cooling) {
      msg = `Letting the chip cool · ${Math.round(j.temp || 0)} °C…`;
      setStatus('warm', 'cooling');
    } else setStatus('busy', 'analyzing');
    setBar(pct, msg);
    setTimeout(() => poll(jobId), 500);
  } catch (e) { fail('Lost contact with engine.'); }
}

function setBar(pct, txt) {
  $('barFill').style.width = pct + '%';
  $('progressPct').textContent = pct + '%';
  $('progressText').childNodes[0].textContent = (txt || '') + ' ';
}

function finish(res) {
  lastResult = res;
  $('analyzeBtn').disabled = false;
  setStatus('ok', 'engine ready');
  $('progress').style.display = 'none';
  $('results').style.display = 'block';

  const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : '—';
  const g = res.choice.primary_genre, m = res.choice.dominant_mood;
  $('hGenre').textContent = cap(g.answer);
  $('hGenreBar').style.width = g.confidence + '%';
  $('hGenreConf').textContent = g.confidence + '%';
  $('hMood').textContent = cap(m.answer);
  $('hMoodBar').style.width = m.confidence + '%';
  $('hMoodConf').textContent = m.confidence + '%';
  $('hWords').textContent = res.words.toLocaleString() + ' words';
  $('hDocMeta').textContent = res.filename + ' · ' + res.chunks + ' pass' + (res.chunks > 1 ? 'es' : '');
  $('hLatency').textContent = fmtMs(res.latency_ms);
  $('hEngine').textContent = res.model + ' · ' + (res.device === 'cuda' ? 'GPU' : 'CPU') +
    (res.cooling_ms > 0 ? ' · +' + fmtMs(res.cooling_ms) + ' cooling' : '');

  $('topChips').innerHTML = res.top_signals.map(s =>
    `<div class="chip">${esc(s.name)} <span>· ${s.pct}% · ${esc(s.category)}</span></div>`).join('');

  renderSections(res.stats);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderSections(stats) {
  const host = $('sections');
  host.innerHTML = '';
  Object.keys(stats).forEach(cat => {
    let rows = stats[cat].slice();
    if (sortMode === 'alpha') rows.sort((a, b) => a.name.localeCompare(b.name));

    const sec = document.createElement('div');
    sec.className = 'section card';

    const head = document.createElement('div');
    head.className = 'sec-head';
    head.innerHTML = `<h3>${esc(cat)}</h3><span class="count">${rows.length} dimensions</span>
      <span class="chev"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></span>`;
    head.addEventListener('click', () => sec.classList.toggle('closed'));
    sec.appendChild(head);

    const body = document.createElement('div');
    body.className = 'sec-body';
    rows.forEach((r, i) => {
      const st = document.createElement('div');
      st.className = 'stat' + (r.pct >= 75 ? ' peak' : '');
      st.title = `${r.name} — ${r.pct}% (raw ${r.raw})`;
      st.innerHTML = `<div class="sname">${esc(r.name)}</div>
        <div class="track"><div class="fill"></div></div>
        <div class="spct">${r.pct.toFixed(1)}%</div>`;
      body.appendChild(st);
      const fill = st.querySelector('.fill');
      setTimeout(() => { fill.style.width = r.pct + '%'; }, 60 + i * 28);
    });
    sec.appendChild(body);
    host.appendChild(sec);
  });
}

function fail(msg) {
  $('progress').style.display = 'none';
  $('progress').classList.remove('cooling');
  $('inputPanel').style.display = '';
  $('analyzeBtn').disabled = false;
  setStatus('err', 'error');
  showError(msg);
}

/* 操作系统刷题 PWA（修订版题库）
 * 数据按需 fetch + 内存缓存 / 分片渲染 / content-visibility /
 * 事件委托 / 双字倒排搜索索引 / IndexedDB 持久化（localStorage 兜底 + 旧数据迁移）/
 * 章节抽屉导航 / 手势切换章节 / 进度导入导出 / Service Worker 离线缓存
 *
 * 题库位置：data/ch0.json … ch15.json（章节名见 data/chapters.json），可直接编辑。
 */
'use strict';

const LS_KEY = 'os_quiz_state_v2';
const THEME_KEY = 'os_theme';
const IDB_NAME = 'os-quiz-db';
const IDB_STORE = 'kv';
const STATE_ID = 'state';
const BATCH_SIZE = 10;

const state = {
  chapters: [],
  dataCache: {},
  searchIndex: {},
  current: 0,
  answers: {},
  filterMode: 'all',
  searchTerm: '',
  rendering: false,
  renderToken: 0
};

const $ = (id) => document.getElementById(id);
const labels = ['A', 'B', 'C', 'D'];

/* ============ IndexedDB 持久化（localStorage 兜底） ============ */
const storage = (() => {
  let dbPromise = null;
  function openDB() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('no-idb'));
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(IDB_STORE)) {
          req.result.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return {
    async get(key) {
      try {
        const db = await openDB();
        return await new Promise((resolve, reject) => {
          const tx = db.transaction(IDB_STORE, 'readonly');
          const r = tx.objectStore(IDB_STORE).get(key);
          r.onsuccess = () => resolve(r.result || null);
          r.onerror = () => reject(r.error);
        });
      } catch (e) {
        try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
      }
    },
    async set(key, value) {
      try {
        const db = await openDB();
        await new Promise((resolve, reject) => {
          const tx = db.transaction(IDB_STORE, 'readwrite');
          tx.objectStore(IDB_STORE).put(value, key);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      } catch (e) {
        try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
      }
    }
  };
})();

let saveTimer = null;
function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    storage.set(STATE_ID, { answers: state.answers, current: state.current });
  }, 150);
}

// 兼容旧版本 localStorage 数据迁移
async function migrateLegacy() {
  try {
    const existing = await storage.get(STATE_ID);
    if (existing && existing.answers) return existing;
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      await storage.set(STATE_ID, parsed);
      localStorage.removeItem(LS_KEY);
      return parsed;
    }
  } catch {}
  return null;
}

/* ============ 主题 ============ */
function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === 'dark' || (!saved && matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.setAttribute('data-theme', 'dark');
    $('theme-btn').textContent = '☀️';
  }
}
function toggleTheme() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  if (isDark) {
    document.documentElement.removeAttribute('data-theme');
    $('theme-btn').textContent = '🌓';
    localStorage.setItem(THEME_KEY, 'light');
  } else {
    document.documentElement.setAttribute('data-theme', 'dark');
    $('theme-btn').textContent = '☀️';
    localStorage.setItem(THEME_KEY, 'dark');
  }
}

/* ============ Toast ============ */
let toastTimer;
function showToast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2000);
}

/* ============ 数据按需加载 ============ */
async function loadChapter(idx) {
  if (state.dataCache[idx]) return state.dataCache[idx];
  const res = await fetch(`data/ch${idx}.json`, { cache: 'no-cache' });
  if (!res.ok) throw new Error('章节数据加载失败: ' + idx);
  const questions = await res.json();
  state.dataCache[idx] = questions;
  // 实际题数回写元信息（手动增删题后即使忘记改 chapters.json 也能自愈）
  if (state.chapters[idx]) state.chapters[idx].count = questions.length;
  buildSearchIndex(idx, questions);
  return questions;
}

/* ============ 双字倒排搜索索引（中文 bigram） ============ */
function buildSearchIndex(idx, questions) {
  const index = new Map();
  questions.forEach((q, i) => {
    const text = (q.q + Object.values(q.o).join('') + q.x).toLowerCase();
    const grams = new Set();
    for (let k = 0; k < text.length - 1; k++) grams.add(text.slice(k, k + 2));
    grams.forEach(g => {
      if (!index.has(g)) index.set(g, []);
      index.get(g).push(i);
    });
  });
  state.searchIndex[idx] = index;
}
function searchChapter(idx, term) {
  const questions = state.dataCache[idx];
  const index = state.searchIndex[idx];
  if (!term) return questions.map((_, i) => i);
  if (term.length < 2 || !index) {
    const hits = [];
    questions.forEach((q, i) => {
      const text = (q.q + Object.values(q.o).join('') + q.x).toLowerCase();
      if (text.includes(term)) hits.push(i);
    });
    return hits;
  }
  const grams = [];
  for (let k = 0; k < term.length - 1; k++) grams.push(term.slice(k, k + 2));
  const lists = grams.map(g => index.get(g) || []);
  if (lists.some(l => l.length === 0)) return [];
  lists.sort((a, b) => a.length - b.length);
  const base = lists[0];
  const rest = lists.slice(1);
  const hits = [];
  for (const i of base) {
    if (rest.every(l => l.includes(i))) {
      const text = (questions[i].q + Object.values(questions[i].o).join('') + questions[i].x).toLowerCase();
      if (text.includes(term)) hits.push(i);
    }
  }
  return hits;
}

/* ============ 分片渲染 ============ */
function createCard(q, idx, tabIdx) {
  const card = document.createElement('div');
  card.className = 'q-card';
  card.dataset.id = q.id;
  card.dataset.tab = tabIdx;
  card.dataset.answer = q.a;

  const entries = Object.entries(q.o);
  for (let i = entries.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [entries[i], entries[j]] = [entries[j], entries[i]];
  }
  let optsHTML = '';
  for (let i = 0; i < entries.length; i++) {
    const [origKey, val] = entries[i];
    optsHTML += `<div class="opt" data-opt="${origKey}" data-label="${labels[i]}"><span class="dot">${labels[i]}</span>${val}</div>`;
  }
  card.innerHTML =
    `<div class="q-title"><span class="q-type s">单选</span><span class="num">${idx + 1}. 第${q.id}题</span> ${q.q}</div>` +
    `<div class="options">${optsHTML}</div>` +
    `<div class="analysis"><span class="label">解析：</span>${q.x}</div>`;
  return card;
}

function renderBatch(questions, tabIdx, done) {
  const container = $('quiz-container');
  let index = 0;
  const token = state.renderToken;
  function next() {
    if (token !== state.renderToken) return;
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < BATCH_SIZE && index < questions.length; i++, index++) {
      fragment.appendChild(createCard(questions[index], index, tabIdx));
    }
    container.appendChild(fragment);
    // 用 setTimeout 续批而非纯 rAF：页面失焦/后台标签页中 rAF 会被节流甚至暂停
    if (index < questions.length) setTimeout(next, 16);
    else done();
  }
  next();
}

async function renderChapter(tabIdx, opts = {}) {
  state.rendering = true;
  state.renderToken++;
  const container = $('quiz-container');
  container.innerHTML = '<div class="loading-state"><div class="spinner"></div>题目加载中…</div>';
  let questions;
  try {
    questions = await loadChapter(tabIdx);
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><div class="icon">📡</div><p>章节数据加载失败，请检查网络后重试<br><small>${e.message}</small></p></div>`;
    state.rendering = false;
    return;
  }
  if (state.current !== tabIdx) return;
  container.innerHTML = '';
  renderBatch(questions, tabIdx, () => {
    state.rendering = false;
    restoreAnswers(container, state.answers[tabIdx] || {});
    applyFilter();
    updateAll();
    if (opts.scrollToFirstUndone) scrollToFirstUndone(container);
  });
}

function scrollToFirstUndone(container) {
  const first = container.querySelector('.q-card:not(.done)');
  if (first) first.scrollIntoView({ block: 'center' });
}

function restoreAnswers(container, tabAnswers) {
  Object.entries(tabAnswers).forEach(([qid, record]) => {
    const card = container.querySelector(`.q-card[data-id="${qid}"]`);
    if (!card) return;
    card.classList.add('done');
    card.dataset.correct = record.correct;
    card.querySelectorAll('.opt').forEach(o => {
      if (o.dataset.opt === card.dataset.answer) o.classList.add('ok');
      if (o.dataset.opt === record.userAnswer && record.userAnswer !== card.dataset.answer) o.classList.add('err');
    });
  });
}

/* ============ 判分 ============ */
function judgeSingle(card, selectedOpt) {
  const answer = card.dataset.answer;
  const userAnswer = selectedOpt.dataset.opt;
  const correct = userAnswer === answer ? '1' : '0';
  card.classList.add('done');
  card.dataset.correct = correct;
  card.querySelectorAll('.opt').forEach(o => {
    if (o.dataset.opt === answer) o.classList.add('ok');
    else if (o === selectedOpt) o.classList.add('err');
  });
  const tabIdx = Number(card.dataset.tab);
  if (!state.answers[tabIdx]) state.answers[tabIdx] = {};
  state.answers[tabIdx][card.dataset.id] = { userAnswer, correct };
  selectedOpt.classList.add('sel');
  setTimeout(() => selectedOpt.classList.remove('sel'), 180);
}

/* ============ 统计 ============ */
function updateScore() {
  const container = $('quiz-container');
  const allCards = container.querySelectorAll('.q-card');
  const totalAll = allCards.length;
  let correctAll = 0, doneAll = 0;
  allCards.forEach(c => {
    if (c.classList.contains('done')) {
      doneAll++;
      if (c.dataset.correct === '1') correctAll++;
    }
  });
  $('score-num').textContent = correctAll;
  $('total-num').textContent = totalAll;
  $('score-pct').textContent = totalAll > 0 ? Math.round(correctAll / totalAll * 100) + '%' : '0%';
  $('reset-btn').style.display = doneAll > 0 ? 'inline-block' : 'none';
}

function updateProgressBar() {
  let totalQuestions = 0, totalCorrect = 0, totalDone = 0;
  state.chapters.forEach((ch, i) => {
    totalQuestions += ch.count;
    const tabAnswers = state.answers[i] || {};
    totalDone += Object.keys(tabAnswers).length;
    Object.values(tabAnswers).forEach(r => { if (r.correct === '1') totalCorrect++; });
  });
  const pct = totalQuestions > 0 ? Math.round(totalDone / totalQuestions * 100) : 0;
  $('progress-bar').style.width = pct + '%';
  $('progress-label').textContent = `${totalCorrect}✓ / ${totalDone}/${totalQuestions}`;
}

function updateTabBadges() {
  document.querySelectorAll('.tab-btn, .drawer-item').forEach(btn => {
    const idx = Number(btn.dataset.tab);
    if (Number.isNaN(idx)) return;
    const doneInTab = Object.keys(state.answers[idx] || {}).length;
    const totalInTab = state.chapters[idx]?.count || 0;
    const text = doneInTab > 0 ? `✅${doneInTab}/${totalInTab}` : `（${totalInTab}题）`;
    const prog = btn.classList.contains('drawer-item')
      ? btn.querySelector('.di-progress')
      : btn.querySelector('.tab-progress');
    if (prog) prog.textContent = text;
  });
}

function updateAll() {
  updateScore();
  updateProgressBar();
  updateTabBadges();
}

/* ============ 章节切换 ============ */
function switchTab(tabIdx, opts = {}) {
  if (tabIdx < 0 || tabIdx >= state.chapters.length) return;
  state.current = tabIdx;
  document.querySelectorAll('.tab-btn').forEach(b =>
    b.classList.toggle('active', Number(b.dataset.tab) === tabIdx));
  document.querySelectorAll('.drawer-item').forEach(b =>
    b.classList.toggle('active', Number(b.dataset.tab) === tabIdx));
  $('ch-title').textContent = state.chapters[tabIdx].name;
  $('prev-ch-btn').disabled = tabIdx === 0;
  $('next-ch-btn').disabled = tabIdx === state.chapters.length - 1;
  const activeTab = document.querySelector(`.tab-btn[data-tab="${tabIdx}"]`);
  if (activeTab) activeTab.scrollIntoView({ inline: 'center', block: 'nearest' });
  closeDrawer();
  saveState();
  renderChapter(tabIdx, opts);
  $('search-input').value = state.searchTerm;
  $('filter-select').value = state.filterMode;
  syncFilterStyle();
  if (!opts.keepScroll) window.scrollTo({ top: 0 });
}

/* ============ 筛选与搜索 ============ */
function syncFilterStyle() {
  $('filter-select').classList.toggle('active-filter', state.filterMode !== 'all');
}

function applyFilter() {
  const container = $('quiz-container');
  const cards = container.querySelectorAll('.q-card');
  const filter = state.filterMode;
  const term = state.searchTerm.toLowerCase().trim();
  const hitSet = new Set(searchChapter(state.current, term));
  let visibleCount = 0;
  cards.forEach((card, i) => {
    const isDone = card.classList.contains('done');
    const isCorrect = card.dataset.correct === '1';
    let passes = true;
    switch (filter) {
      case 'done': passes = isDone; break;
      case 'undone': passes = !isDone; break;
      case 'wrong': passes = isDone && !isCorrect; break;
      case 'correct': passes = isDone && isCorrect; break;
    }
    if (term) passes = passes && hitSet.has(i);
    card.classList.toggle('hidden', !passes);
    if (passes) visibleCount++;
  });
  container.querySelector('.empty-state')?.remove();
  if (visibleCount === 0 && cards.length > 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = '<div class="icon">📭</div><p>没有匹配的题目</p>';
    container.appendChild(empty);
  }
  updateAll();
}

/* ============ 章节抽屉 ============ */
function openDrawer() {
  $('drawer').classList.add('open');
  $('drawer-mask').classList.add('open');
  const active = $('drawer').querySelector('.drawer-item.active');
  if (active) active.scrollIntoView({ block: 'center' });
}
function closeDrawer() {
  $('drawer').classList.remove('open');
  $('drawer-mask').classList.remove('open');
}

/* ============ 进度导入 / 导出 ============ */
function exportProgress() {
  const payload = {
    app: 'os-quiz',
    exportedAt: new Date().toISOString(),
    answers: state.answers,
    current: state.current
  };
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `操作系统刷题进度_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  showToast('进度已导出');
}

function importProgress(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data || typeof data.answers !== 'object') throw new Error('格式不正确');
      if (!confirm('导入将覆盖当前全部答题记录，确定继续？')) return;
      state.answers = data.answers;
      if (Number.isInteger(data.current)) state.current = data.current;
      saveState();
      switchTab(state.current, { scrollToFirstUndone: true });
      showToast('进度导入成功');
    } catch (e) {
      showToast('导入失败：' + e.message);
    }
  };
  reader.readAsText(file);
}

/* ============ 导航构建 ============ */
function buildNav() {
  const tabs = $('tabs-container');
  const drawerList = $('drawer-list');
  state.chapters.forEach(ch => {
    const t = document.createElement('button');
    t.className = 'tab-btn';
    t.dataset.tab = ch.idx;
    t.innerHTML = `${ch.name}<span class="badge">（${ch.count}题）</span><span class="tab-progress"></span>`;
    tabs.appendChild(t);

    const d = document.createElement('button');
    d.className = 'drawer-item';
    d.dataset.tab = ch.idx;
    d.innerHTML = `<span>${ch.name}</span><span class="di-progress">（${ch.count}题）</span>`;
    drawerList.appendChild(d);
  });
}

/* ============ 事件绑定（全部委托） ============ */
function bindEvents() {
  $('quiz-container').addEventListener('click', (e) => {
    const opt = e.target.closest('.opt');
    if (!opt) return;
    const card = opt.closest('.q-card');
    if (!card || card.classList.contains('done')) return;
    judgeSingle(card, opt);
    updateAll();
    saveState();
  });

  $('tabs-container').addEventListener('click', (e) => {
    const btn = e.target.closest('.tab-btn');
    if (btn) switchTab(Number(btn.dataset.tab));
  });
  $('drawer-list').addEventListener('click', (e) => {
    const btn = e.target.closest('.drawer-item');
    if (btn) switchTab(Number(btn.dataset.tab));
  });

  $('menu-btn').addEventListener('click', openDrawer);
  $('drawer-mask').addEventListener('click', closeDrawer);
  $('drawer-close').addEventListener('click', closeDrawer);
  $('prev-ch-btn').addEventListener('click', () => switchTab(state.current - 1));
  $('next-ch-btn').addEventListener('click', () => switchTab(state.current + 1));

  $('show-all-btn').addEventListener('click', () => {
    const container = $('quiz-container');
    const cards = container.querySelectorAll('.q-card:not(.done):not(.hidden)');
    if (cards.length === 0) {
      const all = container.querySelectorAll('.q-card:not(.done)');
      showToast(all.length === 0 ? '当前分组所有题目已作答完毕！' : '当前筛选条件下所有题目已作答完毕，请调整筛选条件');
      return;
    }
    if (!confirm(`当前可见还有 ${cards.length} 道未作答，确定要展开所有答案吗？`)) return;
    cards.forEach(card => {
      card.classList.add('done');
      card.dataset.correct = '0';
      card.querySelectorAll('.opt').forEach(o => {
        if (o.dataset.opt === card.dataset.answer) o.classList.add('ok');
      });
      const tabIdx = Number(card.dataset.tab);
      if (!state.answers[tabIdx]) state.answers[tabIdx] = {};
      state.answers[tabIdx][card.dataset.id] = { userAnswer: null, correct: '0' };
    });
    saveState();
    updateAll();
  });

  $('reset-btn').addEventListener('click', () => {
    if (!confirm('确定要重新作答当前分组吗？已做的答案将被清除。')) return;
    delete state.answers[state.current];
    saveState();
    renderChapter(state.current);
  });

  let searchDebounce;
  $('search-input').addEventListener('input', (e) => {
    state.searchTerm = e.target.value;
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(applyFilter, 200);
  });

  $('filter-select').addEventListener('change', (e) => {
    state.filterMode = e.target.value;
    syncFilterStyle();
    applyFilter();
  });

  $('theme-btn').addEventListener('click', toggleTheme);
  $('export-btn').addEventListener('click', exportProgress);
  $('import-btn').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', (e) => {
    if (e.target.files[0]) importProgress(e.target.files[0]);
    e.target.value = '';
  });

  const backBtn = $('back-to-top');
  backBtn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  let scrollTicking = false;
  addEventListener('scroll', () => {
    if (scrollTicking) return;
    scrollTicking = true;
    requestAnimationFrame(() => {
      backBtn.classList.toggle('show', scrollY > 400);
      scrollTicking = false;
    });
  }, { passive: true });

  // 触屏左右滑动切换章节
  let touchX = 0, touchY = 0, touching = false;
  $('quiz-container').addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    touching = true;
    touchX = e.touches[0].clientX;
    touchY = e.touches[0].clientY;
  }, { passive: true });
  $('quiz-container').addEventListener('touchend', (e) => {
    if (!touching) return;
    touching = false;
    const dx = e.changedTouches[0].clientX - touchX;
    const dy = e.changedTouches[0].clientY - touchY;
    if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      if (dx < 0) switchTab(state.current + 1);
      else switchTab(state.current - 1);
    }
  }, { passive: true });

  document.addEventListener('keydown', e => {
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
    const key = e.key.toUpperCase();
    if (['A', 'B', 'C', 'D'].includes(key)) {
      e.preventDefault();
      const first = $('quiz-container').querySelector('.q-card:not(.done):not(.hidden)');
      if (!first) return;
      const target = first.querySelector(`.opt[data-label="${key}"]`);
      if (target) {
        target.click();
        setTimeout(() => $('quiz-container').querySelector('.q-card:not(.done):not(.hidden)')
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 150);
      }
      return;
    }
    if (key >= '1' && key <= '9') {
      const idx = Number(key) - 1;
      if (idx < state.chapters.length) switchTab(idx);
    }
    if (e.ctrlKey && e.key === 'Enter') $('show-all-btn').click();
    if (e.ctrlKey && key === 'R') { e.preventDefault(); $('reset-btn').click(); }
    if (key === 'ARROWLEFT') switchTab(state.current - 1);
    if (key === 'ARROWRIGHT') switchTab(state.current + 1);
  });

  const updateNet = () => {
    const badge = $('net-badge');
    badge.classList.toggle('offline', !navigator.onLine);
    badge.querySelector('.net-text').textContent = navigator.onLine ? '在线' : '离线';
  };
  addEventListener('online', updateNet);
  addEventListener('offline', updateNet);
  updateNet();
}

/* ============ Service Worker ============ */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW 注册失败:', err));
  });
}

/* ============ 启动 ============ */
(async function init() {
  initTheme();
  bindEvents();
  const [meta, saved] = await Promise.all([
    fetch('data/chapters.json', { cache: 'no-cache' }).then(r => r.json()),
    migrateLegacy()
  ]);
  state.chapters = meta;
  if (saved) {
    state.answers = saved.answers || {};
    state.current = Number.isInteger(saved.current) ? saved.current : 0;
  }
  if (!(state.current >= 0 && state.current < state.chapters.length)) state.current = 0;
  buildNav();
  switchTab(state.current, { scrollToFirstUndone: true, keepScroll: true });
})();

"use strict";

const PREF_ORDER = [
  "北海道",
  "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県",
  "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県",
  "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県",
  "岐阜県", "静岡県", "愛知県", "三重県",
  "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県",
  "鳥取県", "島根県", "岡山県", "広島県", "山口県",
  "徳島県", "香川県", "愛媛県", "高知県",
  "福岡県", "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県",
  "沖縄県"
];

const MODES = {
  normal: "通常",
  time: "時間",
  reading: "読み",
  prefecture: "都道府県",
  weak: "復習"
};

const STORE_KEY = "municipality-quiz-pwa-state-v1";
const $app = document.querySelector("#app");

let master = [];
let prefs = [];
let prefTotals = {};
let indexCache = new Map();
let state = loadState();
let timer = null;
let deferredInstallPrompt = null;

function loadState() {
  const fallback = {
    tab: "play",
    pref: "北海道",
    mode: "normal",
    timeLimit: 180,
    active: null,
    sessions: [],
    reviewPref: "すべて",
    recordsScope: "all",
    lastSavedAt: null
  };
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(STORE_KEY) || "{}") };
  } catch {
    return fallback;
  }
}

function saveState() {
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
}

function nfkc(value) {
  return String(value || "").normalize("NFKC").trim();
}

function kataToHira(value) {
  return Array.from(value).map((char) => {
    const code = char.charCodeAt(0);
    return code >= 0x30a1 && code <= 0x30f6 ? String.fromCharCode(code - 0x60) : char;
  }).join("");
}

function normalizeInput(value) {
  return kataToHira(nfkc(value).replace(/\s/g, ""));
}

function stripSuffixKanji(value) {
  return nfkc(value).replace(/[市町村区]$/, "");
}

function stripAdminSuffixHira(value) {
  return normalizeInput(value).replace(/(ちょう|ちよう|まち|むら|そん|し|く)$/, "");
}

function enrich(row) {
  const item = {
    code: String(row.code),
    pref_kanji: nfkc(row.pref_kanji),
    ctv_kanji: nfkc(row.ctv_kanji),
    pref_kana: nfkc(row.pref_kana),
    ctv_kana: nfkc(row.ctv_kana),
    ctv_omi_kanji: nfkc(row.ctv_omi_kanji),
    ctv_omi_kana: nfkc(row.ctv_omi_kana)
  };
  item.ctv_kanji_base = stripSuffixKanji(item.ctv_kanji);
  item.ctv_omi_kanji_base = stripSuffixKanji(item.ctv_omi_kanji);
  item.ctv_kana_hira_full = normalizeInput(item.ctv_kana);
  item.ctv_kana_hira_base = stripAdminSuffixHira(item.ctv_kana_hira_full);
  item.ctv_omi_kana_hira_full = normalizeInput(item.ctv_omi_kana);
  item.ctv_omi_kana_hira_base = stripAdminSuffixHira(item.ctv_omi_kana_hira_full);
  return item;
}

function buildPrefIndex(pref) {
  if (indexCache.has(pref)) return indexCache.get(pref);
  const idx = new Map();
  const add = (type, key, code) => {
    if (!key) return;
    const k = `${type}:${key}`;
    if (!idx.has(k)) idx.set(k, new Set());
    idx.get(k).add(code);
  };
  master.filter((row) => row.pref_kanji === pref).forEach((row) => {
    add("kanji_full", row.ctv_kanji, row.code);
    add("kanji_base", row.ctv_kanji_base, row.code);
    add("kanji_full", row.ctv_omi_kanji, row.code);
    add("kanji_base", row.ctv_omi_kanji_base, row.code);
    add("kana_full", row.ctv_kana_hira_full, row.code);
    add("kana_base", row.ctv_kana_hira_base, row.code);
    add("kana_full", row.ctv_omi_kana_hira_full, row.code);
    add("kana_base", row.ctv_omi_kana_hira_base, row.code);
  });
  indexCache.set(pref, idx);
  return idx;
}

function getCodes(idx, type, key) {
  return new Set(idx.get(`${type}:${key}`) || []);
}

function judgeCity(pref, value) {
  const raw = nfkc(value);
  if (!raw) return { ok: false, codes: new Set(), reason: "empty" };
  const idx = buildPrefIndex(pref);
  const hira = normalizeInput(raw);
  const hiraBase = stripAdminSuffixHira(hira);
  const checks = [
    ["kanji_full", raw, "漢字一致"],
    ["kanji_base", stripSuffixKanji(raw), "漢字省略一致"],
    ["kana_full", hira, "かな一致"],
    ["kana_base", hira, "かな省略一致"],
    ["kana_base", hiraBase, "かな省略一致"]
  ];
  for (const [type, key, reason] of checks) {
    const codes = getCodes(idx, type, key);
    if (codes.size) return { ok: true, codes, reason };
  }
  return { ok: false, codes: new Set(), reason: "not_found" };
}

function rowsByCodes(codes) {
  const set = new Set(codes);
  return master.filter((row) => set.has(row.code));
}

function nowIso() {
  return new Date().toISOString();
}

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatTime(seconds) {
  const sec = Math.max(0, Math.floor(seconds || 0));
  const m = String(Math.floor(sec / 60)).padStart(2, "0");
  const s = String(sec % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function elapsed(active = state.active) {
  if (!active) return 0;
  return (Date.now() - active.startMs) / 1000;
}

function activeRemaining() {
  if (!state.active || state.active.mode !== "time") return null;
  return Math.max(0, state.active.limitSec - elapsed());
}

function computeScore(session) {
  const total = session.total || 0;
  const unique = session.uniqueCorrect || 0;
  const duration = Math.max(session.durationSec || 1, 1);
  const inputAccuracy = session.totalInputs ? session.correctInputs / session.totalInputs : 0;
  if (!total) return Math.round(unique * 1000 + (unique / duration) * 10000);
  const progress = unique / total;
  const avgSec = duration / Math.max(unique, 1);
  const speedBonus = Math.max(0, 1 - (avgSec - 3) / 57) * 15000;
  return Math.round(progress * 80000 + speedBonus + inputAccuracy * 5000);
}

function getCurrentTotal() {
  if (state.mode === "prefecture") return master.length;
  if (state.mode === "weak") return weakRowsForPref(state.pref).length || prefTotals[state.pref] || 0;
  return prefTotals[state.pref] || 0;
}

function startGame() {
  const pref = state.mode === "prefecture" ? "全国" : state.pref;
  state.active = {
    id: uid(),
    mode: state.mode,
    pref,
    startIso: nowIso(),
    startMs: Date.now(),
    limitSec: state.timeLimit,
    total: getCurrentTotal(),
    correctCodes: [],
    log: [],
    lastResult: null,
    streak: 0,
    maxStreak: 0,
    question: null
  };
  if (state.mode === "reading" || state.mode === "prefecture") nextQuestion();
  saveAndRender();
}

function finishGame(auto = false) {
  if (!state.active) return;
  const active = state.active;
  const durationSec = active.mode === "time" && auto ? active.limitSec : elapsed(active);
  const totalInputs = active.log.length;
  const correctInputs = active.log.filter((row) => row.result === "ok").length;
  const session = {
    id: active.id,
    mode: active.mode,
    pref: active.pref,
    startIso: active.startIso,
    endIso: nowIso(),
    durationSec: Math.round(durationSec * 10) / 10,
    total: active.total,
    totalInputs,
    correctInputs,
    uniqueCorrect: active.correctCodes.length,
    correctCodes: active.correctCodes,
    log: active.log,
    maxStreak: active.maxStreak
  };
  session.score = computeScore(session);
  state.sessions.unshift(session);
  state.lastSavedAt = nowIso();
  state.active = null;
  saveAndRender();
}

function resetGame() {
  state.active = null;
  saveAndRender();
}

function addLog(input, ok, matchedCodes, reason, matchedText, extra = {}) {
  const active = state.active;
  const before = active.correctCodes.length;
  const nextCodes = new Set(active.correctCodes);
  matchedCodes.forEach((code) => nextCodes.add(code));
  active.correctCodes = Array.from(nextCodes);
  const newly = active.correctCodes.length > before;
  if (ok && newly) {
    active.streak += 1;
    active.maxStreak = Math.max(active.maxStreak, active.streak);
  } else if (!ok) {
    active.streak = 0;
  }
  active.log.push({
    seq: active.log.length + 1,
    elapsedSec: Math.round(elapsed(active) * 10) / 10,
    input,
    result: ok ? "ok" : "ng",
    reason,
    matched: matchedText,
    matchedCodes,
    newly,
    ...extra
  });
  active.lastResult = { ok, newly, input, matched: matchedText, reason };
}

function submitAnswer(event) {
  event.preventDefault();
  if (!state.active) return;
  const input = document.querySelector("#answerInput")?.value || "";
  if (!input.trim()) return;
  const active = state.active;

  if (active.mode === "normal" || active.mode === "time" || active.mode === "weak") {
    const result = judgeCity(state.pref, input);
    let ok = result.ok;
    let codes = Array.from(result.codes);
    let reason = result.reason;
    if (active.mode === "weak" && ok) {
      const weakCodes = new Set(weakRowsForPref(state.pref).map((row) => row.code));
      codes = codes.filter((code) => weakCodes.has(code));
      ok = codes.length > 0;
      reason = ok ? "復習対象に一致" : "正解済みのため対象外";
    }
    const matchedText = rowsByCodes(codes).map((row) => row.ctv_kanji).join(" / ");
    addLog(input, ok, codes, reason, matchedText);
  }

  if (active.mode === "reading") {
    const q = active.question;
    const correct = normalizeInput(q.ctv_kana);
    const base = stripAdminSuffixHira(correct);
    const answer = normalizeInput(input);
    const ok = answer === correct || stripAdminSuffixHira(answer) === base;
    addLog(input, ok, ok ? [q.code] : [], ok ? "読み一致" : `正解: ${q.ctv_kana}`, q.ctv_kanji);
    nextQuestion(false);
  }

  if (active.mode === "prefecture") {
    const q = active.question;
    const answer = nfkc(input);
    const ok = answer === q.pref_kanji || stripPrefSuffix(answer) === stripPrefSuffix(q.pref_kanji);
    addLog(input, ok, ok ? [q.code] : [], ok ? "都道府県一致" : `正解: ${q.pref_kanji}`, `${q.ctv_kanji}（${q.pref_kanji}）`);
    nextQuestion(false);
  }

  saveAndRender();
}

function stripPrefSuffix(value) {
  return nfkc(value).replace(/[都道府県]$/, "");
}

function nextQuestion(render = true) {
  if (!state.active) return;
  const active = state.active;
  let pool = [];
  if (active.mode === "reading") {
    pool = master.filter((row) => row.pref_kanji === state.pref);
  } else if (active.mode === "prefecture") {
    pool = master;
  }
  if (!pool.length) return;
  active.question = pool[Math.floor(Math.random() * pool.length)];
  if (render) saveAndRender();
}

function hintList() {
  if (!state.active) return [];
  const solved = new Set(state.active.correctCodes);
  let pool = master.filter((row) => row.pref_kanji === state.pref && !solved.has(row.code));
  if (state.active.mode === "weak") {
    const weak = new Set(weakRowsForPref(state.pref).map((row) => row.code));
    pool = pool.filter((row) => weak.has(row.code));
  }
  return pool.sort(() => Math.random() - 0.5).slice(0, 12).map((row) => `${row.ctv_kana_hira_full[0] || row.ctv_kanji[0]}...（${row.ctv_kanji[0]}）`);
}

function achievementByPref() {
  const solved = new Map();
  state.sessions.forEach((session) => {
    if (!solved.has(session.pref)) solved.set(session.pref, new Set());
    session.correctCodes.forEach((code) => solved.get(session.pref).add(code));
  });
  return prefs.map((pref) => {
    const count = solved.get(pref)?.size || 0;
    const total = prefTotals[pref] || 0;
    return { pref, count, total, rate: total ? count / total : 0 };
  });
}

function weakRowsForPref(pref) {
  const solved = new Set();
  state.sessions.filter((session) => session.pref === pref).forEach((session) => {
    session.correctCodes.forEach((code) => solved.add(code));
  });
  return master.filter((row) => row.pref_kanji === pref && !solved.has(row.code));
}

function allWeakRows() {
  const played = new Set(state.sessions.map((session) => session.pref).filter((pref) => pref !== "全国"));
  return Array.from(played).flatMap((pref) => weakRowsForPref(pref));
}

function topMissedRows(limit = 30) {
  const sessionsByPref = new Map();
  state.sessions.forEach((session) => {
    if (session.pref === "全国") return;
    if (!sessionsByPref.has(session.pref)) sessionsByPref.set(session.pref, []);
    sessionsByPref.get(session.pref).push(session);
  });
  const rows = [];
  sessionsByPref.forEach((sessions, pref) => {
    const totalSessions = sessions.length;
    master.filter((row) => row.pref_kanji === pref).forEach((row) => {
      const solvedSessions = sessions.filter((session) => session.correctCodes.includes(row.code)).length;
      rows.push({
        ...row,
        miss: totalSessions - solvedSessions,
        totalSessions,
        rate: totalSessions ? (totalSessions - solvedSessions) / totalSessions : 0
      });
    });
  });
  return rows.sort((a, b) => b.rate - a.rate || b.miss - a.miss || a.ctv_kanji.localeCompare(b.ctv_kanji, "ja")).slice(0, limit);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}

function modeOptions() {
  return Object.entries(MODES).map(([key, label]) => `
    <button type="button" class="${state.mode === key ? "active" : ""}" data-action="mode" data-mode="${key}" ${state.active ? "disabled" : ""}>${label}</button>
  `).join("");
}

function prefOptions(selected = state.pref) {
  return prefs.map((pref) => `<option value="${pref}" ${pref === selected ? "selected" : ""}>${pref}</option>`).join("");
}

function renderPlay() {
  const active = state.active;
  const mode = active?.mode || state.mode;
  const correct = active?.correctCodes.length || 0;
  const total = active?.total || getCurrentTotal();
  const pct = total ? Math.min(100, (correct / total) * 100) : 0;
  const remaining = activeRemaining();
  const timeLabel = active ? (remaining === null ? formatTime(elapsed(active)) : formatTime(remaining)) : "00:00";
  const canStart = !(state.mode === "weak" && weakRowsForPref(state.pref).length === 0);
  return `
    <section class="hero-panel">
      <div class="hero-head">
        <div class="hero-kicker">${escapeHtml(MODES[mode])}モード</div>
        <h1 class="hero-title">${escapeHtml(active?.pref === "全国" ? "全国" : state.pref)} 市町村クイズ</h1>
        <p class="hero-copy">${active ? "進捗と履歴は端末に保存されます。" : "漢字・かな・カナ・省略OK。"}</p>
      </div>

      <div class="hero-controls">
        <label>
          <span class="field-label">都道府県</span>
          <select class="select" id="prefSelect" ${active ? "disabled" : ""}>${prefOptions()}</select>
        </label>
        <div>
          <span class="field-label">モード</span>
          <div class="segmented">${modeOptions()}</div>
        </div>
        ${state.mode === "time" && !active ? `
          <label>
            <span class="field-label">制限時間</span>
            <select class="select" id="limitSelect">
              ${[60, 90, 120, 180, 300].map((sec) => `<option value="${sec}" ${state.timeLimit === sec ? "selected" : ""}>${formatTime(sec)}</option>`).join("")}
            </select>
          </label>
        ` : ""}
      </div>

      <div class="stats-grid">
        <div class="stat-card"><div class="stat-label">${remaining === null ? "経過" : "残り"}</div><div class="stat-value">${timeLabel}</div><div class="stat-sub">${active ? "プレイ中" : "待機中"}</div></div>
        <div class="stat-card"><div class="stat-label">正解</div><div class="stat-value">${correct}/${total}</div><div class="stat-sub">${pct.toFixed(1)}%</div></div>
        <div class="stat-card"><div class="stat-label">連続</div><div class="stat-value">${active?.streak || 0}</div><div class="stat-sub">最大 ${active?.maxStreak || 0}</div></div>
      </div>

      <div class="answer-zone">
        <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
        <div class="actions">
          ${active ? `<button class="btn primary" data-action="finish">終了して保存</button><button class="btn danger" data-action="reset">リセット</button>` : `<button class="btn primary" data-action="start" ${canStart ? "" : "disabled"}>ゲーム開始</button><button class="btn ghost" data-action="hint" ${active ? "" : "disabled"}>ヒント</button>`}
        </div>
        ${renderQuestionOrInput(active)}
        ${renderLastResult(active)}
      </div>
    </section>
    ${renderSolvedPanel(active)}
    ${renderLogPanel(active)}
  `;
}

function renderQuestionOrInput(active) {
  if (!active) {
    if (state.mode === "weak" && weakRowsForPref(state.pref).length === 0) {
      return `<div class="result warn">この都道府県には復習対象がまだありません。</div>`;
    }
    return `<input class="text-input" disabled value="ゲーム開始後に入力できます" />`;
  }
  let question = "";
  let placeholder = "例: 札幌市 / さっぽろ / サッポロ";
  if (active.mode === "reading" && active.question) {
    question = `<div class="question-card"><div class="question-label">読みを答える</div><div class="question-main">${escapeHtml(active.question.ctv_kanji)}</div></div>`;
    placeholder = "例: さっぽろ";
  }
  if (active.mode === "prefecture" && active.question) {
    question = `<div class="question-card"><div class="question-label">都道府県を答える</div><div class="question-main">${escapeHtml(active.question.ctv_kanji)}</div></div>`;
    placeholder = "例: 北海道";
  }
  return `
    ${question}
    <form class="answer-form" id="answerForm">
      <input id="answerInput" class="text-input" autocomplete="off" enterkeyhint="send" placeholder="${placeholder}" />
      <button class="btn primary" type="submit">送信</button>
    </form>
    <div class="toolbar">
      <button class="btn ghost" data-action="showHint">ヒント</button>
      ${active.mode === "reading" || active.mode === "prefecture" ? `<button class="btn ghost" data-action="nextQuestion">次の問題</button>` : ""}
    </div>
  `;
}

function renderLastResult(active) {
  if (!active?.lastResult) return "";
  const r = active.lastResult;
  const cls = r.ok ? "ok" : "bad";
  const label = r.ok ? (r.newly ? "正解" : "正解済み") : "不正解";
  const detail = r.ok ? r.matched : `「${r.input}」`;
  return `<div class="result ${cls}">${label}: ${escapeHtml(detail)} <span class="row-sub">${escapeHtml(r.reason)}</span></div>`;
}

function renderSolvedPanel(active) {
  if (!active) return "";
  const rows = rowsByCodes(active.correctCodes).filter((row) => active.pref === "全国" || row.pref_kanji === state.pref);
  const hints = state.showHints ? hintList() : [];
  return `
    <section class="panel">
      <h2 class="panel-title">正解済み <span>${rows.length}</span></h2>
      ${hints.length ? `<div class="chips">${hints.map((h) => `<span class="chip">${escapeHtml(h)}</span>`).join("")}</div>` : ""}
      ${rows.length ? `<div class="chips">${rows.slice(0, 80).map((row) => `<span class="chip">${escapeHtml(row.ctv_kanji)}</span>`).join("")}</div>` : `<div class="empty">まだ正解がありません。</div>`}
    </section>
  `;
}

function renderLogPanel(active) {
  if (!active?.log.length) return "";
  return `
    <section class="panel">
      <h2 class="panel-title">入力履歴 <span>${active.log.length}</span></h2>
      <div class="list">
        ${active.log.slice(-10).reverse().map((row) => `
          <div class="row-card">
            <div class="row-main">${row.result === "ok" ? "○" : "×"} ${escapeHtml(row.input)}</div>
            <div class="row-sub">${formatTime(row.elapsedSec)} ${escapeHtml(row.matched || row.reason)}</div>
          </div>
        `).join("")}
      </div>
    </section>
  `;
}

function renderRecords() {
  const ach = achievementByPref();
  const played = ach.filter((row) => row.count > 0).length;
  const cleared = ach.filter((row) => row.rate >= 1).length;
  const avg = ach.reduce((sum, row) => sum + row.rate, 0) / Math.max(ach.length, 1);
  const sessions = [...state.sessions].sort((a, b) => b.score - a.score || new Date(b.endIso) - new Date(a.endIso));
  return `
    <section class="panel">
      <h2 class="panel-title">全国クリア率</h2>
      <div class="stats-grid">
        <div class="stat-card"><div class="stat-label">プレイ済み</div><div class="stat-value">${played}/47</div></div>
        <div class="stat-card"><div class="stat-label">完全制覇</div><div class="stat-value">${cleared}</div></div>
        <div class="stat-card"><div class="stat-label">平均</div><div class="stat-value">${(avg * 100).toFixed(1)}%</div></div>
      </div>
    </section>
    <section class="panel">
      <h2 class="panel-title">都道府県別</h2>
      <div class="dashboard-grid">
        ${ach.map((row) => `
          <div class="pref-tile ${row.rate >= 1 ? "full" : ""}">
            <div class="pref-name"><span>${row.pref}</span><span>${Math.round(row.rate * 100)}%</span></div>
            <div class="pref-detail">${row.count}/${row.total}</div>
            <div class="progress-track"><div class="progress-fill" style="width:${row.rate * 100}%"></div></div>
          </div>
        `).join("")}
      </div>
    </section>
    <section class="panel">
      <h2 class="panel-title">スコアランキング</h2>
      ${sessions.length ? `<div class="list">${sessions.slice(0, 30).map((s, i) => `
        <div class="row-card">
          <div class="row-main">${i + 1}. ${escapeHtml(MODES[s.mode])} / ${escapeHtml(s.pref)} / ${s.score.toLocaleString()}点</div>
          <div class="row-sub">${s.uniqueCorrect}/${s.total} 正解・${formatTime(s.durationSec)}・${new Date(s.endIso).toLocaleString("ja-JP")}</div>
        </div>
      `).join("")}</div>` : `<div class="empty">保存済みの履歴はまだありません。</div>`}
    </section>
  `;
}

function renderReview() {
  const weak = state.reviewPref === "すべて" ? allWeakRows() : weakRowsForPref(state.reviewPref);
  const missed = topMissedRows();
  const reviewPrefs = ["すべて", ...prefs.filter((pref) => state.sessions.some((s) => s.pref === pref))];
  return `
    <section class="panel">
      <h2 class="panel-title">苦手リスト <span>${weak.length}</span></h2>
      <select class="select" id="reviewPref">${reviewPrefs.map((pref) => `<option value="${pref}" ${state.reviewPref === pref ? "selected" : ""}>${pref}</option>`).join("")}</select>
      ${weak.length ? `<div class="list" style="margin-top:10px">${weak.slice(0, 80).map((row) => `
        <div class="row-card"><div class="row-main">${escapeHtml(row.ctv_kanji)}</div><div class="row-sub">${escapeHtml(row.pref_kanji)} / ${escapeHtml(row.ctv_kana)}</div></div>
      `).join("")}</div>` : `<div class="empty">復習対象はまだありません。</div>`}
    </section>
    <section class="panel">
      <h2 class="panel-title">未回答ランキング</h2>
      ${missed.length ? `<div class="list">${missed.map((row) => `
        <div class="row-card">
          <div class="row-main">${escapeHtml(row.pref_kanji)} ${escapeHtml(row.ctv_kanji)}</div>
          <div class="row-sub">未回答率 ${Math.round(row.rate * 100)}% / ${row.miss}/${row.totalSessions}</div>
        </div>
      `).join("")}</div>` : `<div class="empty">保存済みの履歴が増えると表示されます。</div>`}
    </section>
  `;
}

function renderSettings() {
  const payload = encodeURIComponent(JSON.stringify({ version: 1, exportedAt: nowIso(), sessions: state.sessions }));
  return `
    <section class="panel">
      <h2 class="panel-title">データ管理</h2>
      <div class="toolbar">
        <a class="btn primary" style="display:grid;place-items:center;text-decoration:none" download="municipality-quiz-history.json" href="data:application/json;charset=utf-8,${payload}">履歴を書き出し</a>
        <button class="btn danger" data-action="clearHistory">履歴を削除</button>
      </div>
    </section>
    <section class="panel">
      <h2 class="panel-title">読み込み</h2>
      <input class="text-input" type="file" id="importFile" accept="application/json" />
    </section>
    <section class="panel">
      <h2 class="panel-title">ホーム画面保存</h2>
      <div class="row-sub">ブラウザの共有メニューからホーム画面に追加できます。対応ブラウザでは上部の保存ボタンも使えます。</div>
    </section>
  `;
}

function render() {
  const body = state.tab === "play" ? renderPlay()
    : state.tab === "records" ? renderRecords()
      : state.tab === "review" ? renderReview()
        : renderSettings();
  $app.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div class="brand">
          <img src="./icons/icon.svg" alt="" />
          <div><div class="brand-title">市町村クイズ</div><div class="brand-sub">${master.length.toLocaleString()}件の自治体データ</div></div>
        </div>
        <button class="install-pill ${deferredInstallPrompt ? "show" : ""}" data-action="install">保存</button>
      </header>
      <main class="page">${body}</main>
      <nav class="bottom-nav" aria-label="画面切り替え">
        ${[
          ["play", "プレイ"],
          ["records", "記録"],
          ["review", "復習"],
          ["settings", "設定"]
        ].map(([key, label]) => `<button class="nav-btn ${state.tab === key ? "active" : ""}" data-tab="${key}">${label}</button>`).join("")}
      </nav>
    </div>
  `;
  bindEvents();
}

function bindEvents() {
  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.tab = button.dataset.tab;
      saveAndRender();
    });
  });
  document.querySelectorAll("[data-action]").forEach((el) => {
    el.addEventListener("click", handleAction);
  });
  document.querySelectorAll("[data-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      state.mode = button.dataset.mode;
      saveAndRender();
    });
  });
  document.querySelector("#prefSelect")?.addEventListener("change", (event) => {
    state.pref = event.target.value;
    saveAndRender();
  });
  document.querySelector("#limitSelect")?.addEventListener("change", (event) => {
    state.timeLimit = Number(event.target.value);
    saveAndRender();
  });
  document.querySelector("#answerForm")?.addEventListener("submit", submitAnswer);
  document.querySelector("#answerInput")?.focus();
  document.querySelector("#reviewPref")?.addEventListener("change", (event) => {
    state.reviewPref = event.target.value;
    saveAndRender();
  });
  document.querySelector("#importFile")?.addEventListener("change", importHistory);
}

function handleAction(event) {
  const action = event.currentTarget.dataset.action;
  if (action === "start") startGame();
  if (action === "finish") finishGame(false);
  if (action === "reset") resetGame();
  if (action === "showHint") {
    state.showHints = !state.showHints;
    saveAndRender();
  }
  if (action === "nextQuestion") nextQuestion(true);
  if (action === "clearHistory" && confirm("保存済み履歴を削除しますか？")) {
    state.sessions = [];
    saveAndRender();
  }
  if (action === "install" && deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    deferredInstallPrompt = null;
    render();
  }
}

function importHistory(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result || "{}"));
      if (!Array.isArray(parsed.sessions)) throw new Error("bad format");
      state.sessions = parsed.sessions;
      saveAndRender();
    } catch {
      alert("履歴ファイルを読み込めませんでした。");
    }
  };
  reader.readAsText(file);
}

function saveAndRender() {
  saveState();
  render();
}

function checkTimer() {
  if (state.active?.mode === "time" && activeRemaining() <= 0) {
    finishGame(true);
    return;
  }
  if (state.active) render();
}

async function init() {
  const response = await fetch("./data/municipalities.json");
  const data = await response.json();
  master = data.map(enrich);
  const prefSet = new Set(master.map((row) => row.pref_kanji));
  prefs = PREF_ORDER.filter((pref) => prefSet.has(pref)).concat([...prefSet].filter((pref) => !PREF_ORDER.includes(pref)).sort());
  prefTotals = Object.fromEntries(prefs.map((pref) => [pref, new Set(master.filter((row) => row.pref_kanji === pref).map((row) => row.code)).size]));
  if (!prefs.includes(state.pref)) state.pref = prefs[0] || "北海道";
  render();
  timer = setInterval(checkTimer, 1000);
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {});
  }
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  render();
});

init().catch((error) => {
  $app.innerHTML = `<div class="boot"><div class="boot-mark">!</div><p>読み込みに失敗しました</p><pre>${escapeHtml(error.message)}</pre></div>`;
});

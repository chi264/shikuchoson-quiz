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
  prefecture: "都道府県当て",
  weak: "復習"
};

const AREA_GROUPS = [
  { key: "all", label: "全国", prefs: PREF_ORDER },
  { key: "hokkaido", label: "北海道", prefs: ["北海道"] },
  { key: "north-tohoku", label: "北東北", prefs: ["青森県", "岩手県", "秋田県"] },
  { key: "south-tohoku", label: "南東北", prefs: ["宮城県", "山形県", "福島県"] },
  { key: "north-kanto", label: "北関東", prefs: ["茨城県", "栃木県", "群馬県", "埼玉県"] },
  { key: "south-kanto", label: "南関東", prefs: ["千葉県", "神奈川県", "山梨県"] },
  { key: "tokyo", label: "東京", prefs: ["東京都"] },
  { key: "hokushinetsu", label: "北信越", prefs: ["新潟県", "長野県", "富山県", "石川県", "福井県"] },
  { key: "tokai", label: "東海", prefs: ["静岡県", "岐阜県", "愛知県", "三重県"] },
  { key: "north-kinki", label: "北近畿", prefs: ["滋賀県", "京都府", "大阪府", "兵庫県"] },
  { key: "south-kinki", label: "南近畿", prefs: ["三重県", "奈良県", "和歌山県"] },
  { key: "chugoku", label: "中国", prefs: ["岡山県", "広島県", "鳥取県", "島根県", "山口県"] },
  { key: "shikoku", label: "四国", prefs: ["香川県", "愛媛県", "徳島県", "高知県"] },
  { key: "north-kyushu", label: "北部九州", prefs: ["福岡県", "佐賀県", "長崎県"] },
  { key: "central-south-kyushu", label: "中南部九州", prefs: ["熊本県", "大分県", "宮崎県"] },
  { key: "south-kyushu-okinawa", label: "南九沖縄", prefs: ["鹿児島県", "沖縄県"] }
];

const APP_VERSION = "v0.4.1";
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
    scope: "pref:北海道",
    mode: "normal",
    timeLimit: 600,
    active: null,
    sessions: [],
    reviewPref: "すべて",
    recordsMode: "all",
    notes: {},
    wikiSummaries: {},
    lastCompleted: null,
    selectedPrefStats: null,
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

function getScope(scopeKey = state.scope) {
  if (scopeKey?.startsWith("pref:")) {
    const pref = scopeKey.slice(5);
    return { key: scopeKey, label: pref, prefs: [pref], type: "pref" };
  }
  const group = AREA_GROUPS.find((area) => `area:${area.key}` === scopeKey || area.key === scopeKey);
  if (group) return { ...group, key: `area:${group.key}`, type: group.key === "all" ? "all" : "area" };
  return { key: "pref:北海道", label: "北海道", prefs: ["北海道"], type: "pref" };
}

function scopeRows(scopeKey = state.scope) {
  const scope = getScope(scopeKey);
  if (scope.type === "all") return master;
  const targetPrefs = new Set(scope.prefs);
  return master.filter((row) => targetPrefs.has(row.pref_kanji));
}

function scopeLabel(scopeKey = state.scope) {
  return getScope(scopeKey).label;
}

function buildScopeIndex(scopeKey) {
  if (indexCache.has(scopeKey)) return indexCache.get(scopeKey);
  const idx = new Map();
  const add = (type, key, code) => {
    if (!key) return;
    const k = `${type}:${key}`;
    if (!idx.has(k)) idx.set(k, new Set());
    idx.get(k).add(code);
  };
  scopeRows(scopeKey).forEach((row) => {
    add("kanji_full", row.ctv_kanji, row.code);
    add("kanji_base", row.ctv_kanji_base, row.code);
    add("kanji_full", row.ctv_omi_kanji, row.code);
    add("kanji_base", row.ctv_omi_kanji_base, row.code);
    add("kana_full", row.ctv_kana_hira_full, row.code);
    add("kana_base", row.ctv_kana_hira_base, row.code);
    add("kana_full", row.ctv_omi_kana_hira_full, row.code);
    add("kana_base", row.ctv_omi_kana_hira_base, row.code);
  });
  indexCache.set(scopeKey, idx);
  return idx;
}

function getCodes(idx, type, key) {
  return new Set(idx.get(`${type}:${key}`) || []);
}

function judgeCity(scopeKey, value) {
  const raw = nfkc(value);
  if (!raw) return { ok: false, codes: new Set(), reason: "empty" };
  const idx = buildScopeIndex(scopeKey);
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

function bestComparableScore(mode, scopeKey, excludeId = null) {
  const comparable = state.sessions.filter((session) =>
    session.id !== excludeId && session.mode === mode && (session.scopeKey || "") === (scopeKey || "")
  );
  return comparable.reduce((best, session) => Math.max(best, session.score || 0), 0);
}

function prefectureStats(pref) {
  const prefRows = master.filter((row) => row.pref_kanji === pref);
  const prefCodes = new Set(prefRows.map((row) => row.code));
  const sessions = state.sessions.filter((session) =>
    (session.correctCodes || []).some((code) => prefCodes.has(code))
  );
  const solved = new Set();
  sessions.forEach((session) => {
    (session.correctCodes || []).forEach((code) => {
      if (prefCodes.has(code)) solved.add(code);
    });
  });
  const bestScore = sessions.reduce((best, session) => Math.max(best, session.score || 0), 0);
  const wrongInputs = sessions.reduce((sum, session) => sum + (session.log || []).filter((row) => row.result === "ng").length, 0);
  const totalInputs = sessions.reduce((sum, session) => sum + (session.totalInputs || 0), 0);
  return {
    pref,
    sessions: sessions.length,
    solved: solved.size,
    total: prefRows.length,
    rate: prefRows.length ? solved.size / prefRows.length : 0,
    bestScore,
    wrongInputs,
    totalInputs
  };
}

function weakStats(row) {
  const sessions = state.sessions.filter((session) =>
    (session.scopeKey && scopeRows(session.scopeKey).some((item) => item.code === row.code)) ||
    (session.correctCodes || []).includes(row.code) ||
    session.pref === row.pref_kanji
  );
  const solvedSessions = sessions.filter((session) => (session.correctCodes || []).includes(row.code)).length;
  return {
    played: sessions.length,
    solved: solvedSessions,
    missed: Math.max(0, sessions.length - solvedSessions)
  };
}

function getCurrentTotal() {
  if (state.mode === "weak") return weakRowsForScope(state.scope).length || scopeRows(state.scope).length;
  return scopeRows(state.scope).length;
}

function startGame() {
  const scope = getScope(state.scope);
  state.active = {
    id: uid(),
    mode: state.mode,
    pref: scope.label,
    scopeKey: scope.key,
    scopeLabel: scope.label,
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
  state.lastCompleted = session;
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
    const result = judgeCity(active.scopeKey || state.scope, input);
    let ok = result.ok;
    let codes = Array.from(result.codes);
    let reason = result.reason;
    if (active.mode === "weak" && ok) {
      const weakCodes = new Set(weakRowsForScope(active.scopeKey || state.scope).map((row) => row.code));
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
    pool = scopeRows(active.scopeKey || state.scope);
  } else if (active.mode === "prefecture") {
    pool = scopeRows(active.scopeKey || state.scope);
  }
  const solved = new Set(active.correctCodes);
  pool = pool.filter((row) => !solved.has(row.code));
  if (!pool.length) {
    active.question = null;
    if (render) saveAndRender();
    return;
  }
  active.question = pool[Math.floor(Math.random() * pool.length)];
  if (render) saveAndRender();
}

function achievementByPref() {
  const solved = new Map();
  state.sessions.forEach((session) => {
    session.correctCodes.forEach((code) => {
      const row = master.find((item) => item.code === code);
      if (!row) return;
      if (!solved.has(row.pref_kanji)) solved.set(row.pref_kanji, new Set());
      solved.get(row.pref_kanji).add(code);
    });
  });
  return prefs.map((pref) => {
    const count = solved.get(pref)?.size || 0;
    const total = prefTotals[pref] || 0;
    return { pref, count, total, rate: total ? count / total : 0 };
  });
}

function solvedCodesGlobal() {
  const solved = new Set();
  state.sessions.forEach((session) => {
    session.correctCodes.forEach((code) => solved.add(code));
  });
  return solved;
}

function weakRowsForScope(scopeKey) {
  const solved = solvedCodesGlobal();
  return scopeRows(scopeKey).filter((row) => !solved.has(row.code));
}

function allWeakRows() {
  const solved = solvedCodesGlobal();
  return master.filter((row) => !solved.has(row.code));
}

function topMissedRows(limit = 30) {
  const sessionsByPref = new Map();
  state.sessions.forEach((session) => {
    const scope = getScope(session.scopeKey || (session.pref && `pref:${session.pref}`));
    scope.prefs.forEach((pref) => {
      if (!prefs.includes(pref)) return;
      if (!sessionsByPref.has(pref)) sessionsByPref.set(pref, []);
      sessionsByPref.get(pref).push(session);
    });
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

function wikipediaUrl(row) {
  const query = `${row.pref_kanji} ${row.ctv_kanji}`;
  return `https://ja.wikipedia.org/w/index.php?search=${encodeURIComponent(query)}`;
}

function wikiSummary(row) {
  return state.wikiSummaries?.[row.code] || "";
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

function scopeOptions(selected = state.scope) {
  const areaOptions = AREA_GROUPS
    .filter((area) => area.key === "all" || area.prefs.some((pref) => prefs.includes(pref)))
    .map((area) => {
      const value = `area:${area.key}`;
      return `<option value="${value}" ${value === selected ? "selected" : ""}>${area.label}</option>`;
    }).join("");
  const prefOptionHtml = prefs.map((pref) => {
    const value = `pref:${pref}`;
    return `<option value="${value}" ${value === selected ? "selected" : ""}>${pref}</option>`;
  }).join("");
  return `<optgroup label="地方・全国">${areaOptions}</optgroup><optgroup label="都道府県">${prefOptionHtml}</optgroup>`;
}

function renderPlay() {
  const active = state.active;
  const mode = active?.mode || state.mode;
  const correct = active?.correctCodes.length || 0;
  const total = active?.total || getCurrentTotal();
  const pct = total ? Math.min(100, (correct / total) * 100) : 0;
  const remaining = activeRemaining();
  const timeLabel = active ? (remaining === null ? formatTime(elapsed(active)) : formatTime(remaining)) : "00:00";
  const canStart = !(state.mode === "weak" && weakRowsForScope(state.scope).length === 0);
  const currentScopeLabel = active?.scopeLabel || scopeLabel(state.scope);
  return `
    <section class="hero-panel">
      <div class="hero-head">
        <div class="hero-kicker">${escapeHtml(MODES[mode])}モード</div>
        <h1 class="hero-title">${escapeHtml(currentScopeLabel)} 市町村クイズ</h1>
        <p class="hero-copy">${active ? "進捗と履歴は端末に保存されます。" : "漢字・かな・カナ・省略OK。"}</p>
      </div>

      <div class="hero-controls">
        <label>
          <span class="field-label">範囲</span>
          <select class="select" id="scopeSelect" ${active ? "disabled" : ""}>${scopeOptions()}</select>
        </label>
        <div>
          <span class="field-label">モード</span>
          <div class="segmented">${modeOptions()}</div>
        </div>
        ${state.mode === "time" && !active ? `
          <label>
            <span class="field-label">制限時間</span>
            <select class="select" id="limitSelect">
              ${[180, 600, 900, 1800].map((sec) => `<option value="${sec}" ${state.timeLimit === sec ? "selected" : ""}>${formatTime(sec)}</option>`).join("")}
            </select>
          </label>
        ` : ""}
      </div>

      <div class="stats-grid">
        <div class="stat-card"><div class="stat-label">${remaining === null ? "経過" : "残り"}</div><div class="stat-value" id="timeValue">${timeLabel}</div><div class="stat-sub">${active ? "プレイ中" : "待機中"}</div></div>
        <div class="stat-card"><div class="stat-label">正解</div><div class="stat-value">${correct}/${total}</div><div class="stat-sub">${pct.toFixed(1)}%</div></div>
        <div class="stat-card"><div class="stat-label">連続</div><div class="stat-value">${active?.streak || 0}</div><div class="stat-sub">最大 ${active?.maxStreak || 0}</div></div>
      </div>

      <div class="answer-zone">
        <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
        <div class="actions">
          ${active ? `<button class="btn primary wide" data-action="finish">終了して保存</button>` : `<button class="btn primary wide" data-action="start" ${canStart ? "" : "disabled"}>ゲーム開始</button>`}
        </div>
        ${renderQuestionOrInput(active)}
        ${renderLastResult(active)}
      </div>
    </section>
    ${renderLastCompleted()}
    ${renderSolvedPanel(active)}
    ${renderLogPanel(active)}
  `;
}

function renderLastCompleted() {
  const session = state.lastCompleted;
  if (!session || state.active) return "";
  const previousBest = bestComparableScore(session.mode, session.scopeKey, session.id);
  const isBest = previousBest <= session.score;
  const speed = session.durationSec ? (session.uniqueCorrect / session.durationSec) * 60 : 0;
  return `
    <section class="panel score-result">
      <h2 class="panel-title">前回スコア <span>${isBest ? "自己ベスト" : ""}</span></h2>
      <div class="stats-grid">
        <div class="stat-card"><div class="stat-label">ポイント</div><div class="stat-value">${(session.score || 0).toLocaleString()}</div><div class="stat-sub">pt</div></div>
        <div class="stat-card"><div class="stat-label">正答数</div><div class="stat-value">${session.uniqueCorrect}/${session.total}</div></div>
        <div class="stat-card"><div class="stat-label">速さ</div><div class="stat-value">${speed.toFixed(1)}</div><div class="stat-sub">問/分</div></div>
      </div>
    </section>
  `;
}

function renderQuestionOrInput(active) {
  if (!active) {
    if (state.mode === "weak" && weakRowsForScope(state.scope).length === 0) {
      return `<div class="result warn">この範囲には復習対象がまだありません。</div>`;
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
  if ((active.mode === "reading" || active.mode === "prefecture") && !active.question) {
    question = `<div class="result ok">このモードの全問を正解しました。終了して保存できます。</div>`;
  }
  return `
    ${question}
    <form class="answer-form" id="answerForm">
      <input id="answerInput" class="text-input" autocomplete="off" enterkeyhint="send" placeholder="${placeholder}" ${(active.mode === "reading" || active.mode === "prefecture") && !active.question ? "disabled" : ""} />
      <button class="btn primary" type="submit" ${(active.mode === "reading" || active.mode === "prefecture") && !active.question ? "disabled" : ""}>送信</button>
    </form>
    <div class="toolbar">
      ${active.mode === "reading" || active.mode === "prefecture" ? `<button class="btn ghost" data-action="nextQuestion">次の問題</button>` : ""}
      <button class="btn danger" data-action="reset">保存せずリセット</button>
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
  const scopeCodes = new Set(scopeRows(active.scopeKey || state.scope).map((row) => row.code));
  const rows = rowsByCodes(active.correctCodes).filter((row) => scopeCodes.has(row.code));
  return `
    <section class="panel">
      <h2 class="panel-title">正解済み <span>${rows.length}</span></h2>
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
  const modeEntries = [["all", "全て"], ...Object.entries(MODES)];
  const sessions = [...state.sessions]
    .filter((session) => state.recordsMode === "all" || session.mode === state.recordsMode)
    .sort((a, b) => b.score - a.score || new Date(b.endIso) - new Date(a.endIso));
  const pointsByMode = Object.fromEntries(Object.keys(MODES).map((mode) => [
    mode,
    state.sessions.filter((session) => session.mode === mode).reduce((sum, session) => sum + (session.score || 0), 0)
  ]));
  const totalPoints = state.sessions.reduce((sum, session) => sum + (session.score || 0), 0);
  const selectedStats = state.selectedPrefStats ? prefectureStats(state.selectedPrefStats) : null;
  return `
    <section class="panel">
      <h2 class="panel-title">ポイント</h2>
      <div class="stats-grid">
        <div class="stat-card"><div class="stat-label">合計</div><div class="stat-value">${totalPoints.toLocaleString()}</div><div class="stat-sub">pt</div></div>
        <div class="stat-card"><div class="stat-label">プレイ済み</div><div class="stat-value">${played}/47</div></div>
        <div class="stat-card"><div class="stat-label">完全制覇</div><div class="stat-value">${cleared}</div></div>
      </div>
      <div class="chips" style="margin-top:10px">
        ${Object.entries(MODES).map(([mode, label]) => `<span class="chip">${label}: ${Math.round(pointsByMode[mode] || 0).toLocaleString()}pt</span>`).join("")}
      </div>
    </section>
    <section class="panel">
      <h2 class="panel-title">都道府県別</h2>
      <div class="dashboard-grid">
        ${ach.map((row) => `
          <button class="pref-tile ${row.rate >= 1 ? "full" : ""}" data-pref-stats="${row.pref}">
            <div class="pref-name"><span>${row.pref}</span><span>${Math.round(row.rate * 100)}%</span></div>
            <div class="pref-detail">${row.count}/${row.total}</div>
            <div class="progress-track"><div class="progress-fill" style="width:${row.rate * 100}%"></div></div>
          </button>
        `).join("")}
      </div>
    </section>
    ${selectedStats ? `
      <section class="panel">
        <h2 class="panel-title">${escapeHtml(selectedStats.pref)} の記録</h2>
        <div class="stats-grid">
          <div class="stat-card"><div class="stat-label">達成率</div><div class="stat-value">${Math.round(selectedStats.rate * 100)}%</div><div class="stat-sub">${selectedStats.solved}/${selectedStats.total}</div></div>
          <div class="stat-card"><div class="stat-label">最高</div><div class="stat-value">${selectedStats.bestScore.toLocaleString()}</div><div class="stat-sub">pt</div></div>
          <div class="stat-card"><div class="stat-label">不正解</div><div class="stat-value">${selectedStats.wrongInputs}</div><div class="stat-sub">${selectedStats.totalInputs}入力中</div></div>
        </div>
      </section>
    ` : ""}
    <section class="panel">
      <h2 class="panel-title">種別ごとの記録</h2>
      <div class="segmented compact">
        ${modeEntries.map(([mode, label]) => `<button type="button" class="${state.recordsMode === mode ? "active" : ""}" data-records-mode="${mode}">${label}</button>`).join("")}
      </div>
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
  const weak = state.reviewPref === "すべて" ? allWeakRows() : weakRowsForScope(`pref:${state.reviewPref}`);
  const missed = topMissedRows();
  const playedPrefs = new Set();
  state.sessions.forEach((session) => {
    (session.correctCodes || []).forEach((code) => {
      const row = master.find((item) => item.code === code);
      if (row) playedPrefs.add(row.pref_kanji);
    });
  });
  const reviewPrefs = ["すべて", ...prefs.filter((pref) => playedPrefs.has(pref))];
  return `
    <section class="panel">
      <h2 class="panel-title">苦手リスト <span>${weak.length}</span></h2>
      <select class="select" id="reviewPref">${reviewPrefs.map((pref) => `<option value="${pref}" ${state.reviewPref === pref ? "selected" : ""}>${pref}</option>`).join("")}</select>
      ${weak.length ? `<div class="list" style="margin-top:10px">${weak.slice(0, 80).map((row) => `
        <div class="row-card review-card">
          <div class="row-main">${escapeHtml(row.ctv_kanji)}</div>
          <div class="row-sub">${escapeHtml(row.pref_kanji)} / ${escapeHtml(row.ctv_kana)}</div>
          ${(() => {
            const stats = weakStats(row);
            return `<div class="chips"><span class="chip">未正解 ${stats.missed}回</span><span class="chip">対象プレイ ${stats.played}回</span></div>`;
          })()}
          <div class="toolbar">
            <a class="btn ghost link-btn" href="${wikipediaUrl(row)}" target="_blank" rel="noopener">Wikipedia</a>
            <button class="btn ghost" data-action="wikiSummary" data-code="${row.code}">概要取得</button>
          </div>
          ${wikiSummary(row) ? `<div class="wiki-summary">${escapeHtml(wikiSummary(row))}</div>` : ""}
          <label>
            <span class="field-label">メモ</span>
            <textarea class="text-input memo-input" data-note-code="${row.code}" rows="3" placeholder="覚え方、行ったこと、関連情報など">${escapeHtml(state.notes?.[row.code] || "")}</textarea>
          </label>
        </div>
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
  const payload = encodeURIComponent(JSON.stringify({
    version: 2,
    exportedAt: nowIso(),
    sessions: state.sessions,
    notes: state.notes || {},
    wikiSummaries: state.wikiSummaries || {}
  }));
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
          <div><div class="brand-title">市町村クイズ</div><div class="brand-sub">${APP_VERSION} / ${master.length.toLocaleString()}件の自治体データ</div></div>
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
  document.querySelectorAll("[data-records-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      state.recordsMode = button.dataset.recordsMode;
      saveAndRender();
    });
  });
  document.querySelectorAll("[data-pref-stats]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedPrefStats = button.dataset.prefStats;
      saveAndRender();
    });
  });
  document.querySelector("#scopeSelect")?.addEventListener("change", (event) => {
    state.scope = event.target.value;
    if (state.scope.startsWith("pref:")) state.pref = state.scope.slice(5);
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
  document.querySelectorAll("[data-note-code]").forEach((input) => {
    input.addEventListener("change", () => {
      state.notes = state.notes || {};
      state.notes[input.dataset.noteCode] = input.value;
      saveState();
    });
  });
  document.querySelector("#importFile")?.addEventListener("change", importHistory);
}

async function handleAction(event) {
  const action = event.currentTarget.dataset.action;
  if (action === "start") startGame();
  if (action === "finish") finishGame(false);
  if (action === "reset" && confirm("今回のプレイを保存せずにリセットしますか？")) resetGame();
  if (action === "nextQuestion") nextQuestion(true);
  if (action === "wikiSummary") await fetchWikiSummary(event.currentTarget.dataset.code);
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

async function fetchWikiSummary(code) {
  const row = master.find((item) => item.code === code);
  if (!row) return;
  const buttonText = document.querySelector(`[data-action="wikiSummary"][data-code="${CSS.escape(code)}"]`);
  if (buttonText) buttonText.textContent = "取得中";
  try {
    const title = encodeURIComponent(row.ctv_kanji);
    const response = await fetch(`https://ja.wikipedia.org/api/rest_v1/page/summary/${title}`);
    if (!response.ok) throw new Error("not found");
    const data = await response.json();
    state.wikiSummaries = state.wikiSummaries || {};
    state.wikiSummaries[code] = data.extract || "概要を取得できませんでした。";
  } catch {
    state.wikiSummaries = state.wikiSummaries || {};
    state.wikiSummaries[code] = "概要を取得できませんでした。Wikipediaリンクから確認してください。";
  }
  saveAndRender();
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
      state.notes = parsed.notes || state.notes || {};
      state.wikiSummaries = parsed.wikiSummaries || state.wikiSummaries || {};
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
  if (state.active) {
    const timeValue = document.querySelector("#timeValue");
    if (timeValue) {
      const remaining = activeRemaining();
      timeValue.textContent = remaining === null ? formatTime(elapsed(state.active)) : formatTime(remaining);
    }
  }
}

async function init() {
  const response = await fetch("./data/municipalities.json");
  const data = await response.json();
  master = data.map(enrich);
  const prefSet = new Set(master.map((row) => row.pref_kanji));
  prefs = PREF_ORDER.filter((pref) => prefSet.has(pref)).concat([...prefSet].filter((pref) => !PREF_ORDER.includes(pref)).sort());
  prefTotals = Object.fromEntries(prefs.map((pref) => [pref, new Set(master.filter((row) => row.pref_kanji === pref).map((row) => row.code)).size]));
  if (!prefs.includes(state.pref)) state.pref = prefs[0] || "北海道";
  if (!state.scope) state.scope = `pref:${state.pref}`;
  const validScopes = new Set([
    ...AREA_GROUPS.map((area) => `area:${area.key}`),
    ...prefs.map((pref) => `pref:${pref}`)
  ]);
  if (!validScopes.has(state.scope)) state.scope = `pref:${state.pref}`;
  state.notes = state.notes || {};
  state.wikiSummaries = state.wikiSummaries || {};
  state.recordsMode = state.recordsMode || "all";
  render();
  timer = setInterval(checkTimer, 1000);
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./service-worker.js?v=0.4.1").then((registration) => {
      registration.update().catch(() => {});
    }).catch(() => {});
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

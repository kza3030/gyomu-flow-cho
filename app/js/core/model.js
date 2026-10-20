/* フローのデータ：YAML との変換と、読み込んだ値の整形（normalize）。
   core/ のファイルは画面（DOM）に触らない。Node のテスト（tests/）からも読み込む */
(() => {
"use strict";
const TYPES = { start:"開始", task:"作業", decision:"判断", system:"システム", document:"帳票", data:"データ", end:"終了" };
/* 矢印がステップのどの辺から出る（exit）・入る（entry）か。省くと自動。内部では T/B/L/R で持つ */
const SIDES = { top: "T", bottom: "B", left: "L", right: "R" };
const SIDE_NAME = { T: "上", B: "下", L: "左", R: "右" };
const sideIn = v => { const t = String(v ?? "").trim(); return SIDES[t.toLowerCase()] || ({ 上: "T", 下: "B", 左: "L", 右: "R" })[t] || (/^[TBLR]$/.test(t) ? t : ""); };
const sideOut = c => Object.keys(SIDES).find(k => SIDES[k] === c);
function normNext(n){
  if (n == null || n === "") return [];
  if (!Array.isArray(n)) n = [n];
  return n.map(x => {
    if (!x || typeof x !== "object") return { to: String(x), when: "" };
    const e = { to: String(x.to ?? ""), when: x.when != null ? String(x.when) : "" }, ex = sideIn(x.exit), en = sideIn(x.entry);
    if (ex) e.exit = ex;
    if (en) e.entry = en;
    return e;
  }).filter(e => e.to);
}
function normalize(raw){
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("先頭は name: / lanes: / steps: を持つ形にしてください。");
  const f = { name: String(raw.name ?? "無題のフロー"), owner: raw.owner != null ? String(raw.owner) : "", description: raw.description != null ? String(raw.description) : "", lanes: [], steps: [], memo: raw.memo != null ? String(raw.memo) : "" };
  const lanes = raw.lanes ?? [], steps = raw.steps ?? [];
  if (!Array.isArray(lanes)) throw new Error("lanes は「- id: … / name: …」の並びで書いてください。");
  if (!Array.isArray(steps)) throw new Error("steps は「- id: …」の並びで書いてください。");
  lanes.forEach((l, i) => {
    if (typeof l === "string") f.lanes.push({ id: l, name: l });
    else if (l && typeof l === "object") f.lanes.push({ id: String(l.id ?? ("lane" + (i + 1))), name: String(l.name ?? l.id ?? ("担当" + (i + 1))) });
  });
  steps.forEach((s, i) => {
    if (!s || typeof s !== "object") return;
    const st = { id: String(s.id ?? ("s" + (i + 1))), type: TYPES[s.type] ? s.type : "task", lane: String(s.lane ?? ""), label: String(s.label ?? ""), note: s.note != null ? String(s.note) : "", issue: s.issue != null ? String(s.issue) : "", next: normNext(s.next) };
    // col: 図で左から何列目に置くか（1 始まり）。省くと自動で決める
    if (Number.isInteger(+s.col) && +s.col >= 1) st.col = +s.col;
    // row: レーンの中で上から何段目に置くか（1 始まり。中身のない段は詰めて描く）。省くと自動で決める
    if (Number.isInteger(+s.row) && +s.row >= 1) st.row = +s.row;
    f.steps.push(st);
  });
  return f;
}
function toPlain(f){
  const o = { name: f.name };
  if (f.owner) o.owner = f.owner;
  if (f.description) o.description = f.description;
  o.lanes = f.lanes.map(l => ({ id: l.id, name: l.name }));
  o.steps = f.steps.map(s => {
    const r = { id: s.id, type: s.type, lane: s.lane };
    if (s.col) r.col = s.col;
    if (s.row) r.row = s.row;
    r.label = s.label;
    if (s.note) r.note = s.note;
    if (s.issue) r.issue = s.issue;
    if (s.next.length){
      if (s.next.every(e => !e.when && !e.exit && !e.entry)) r.next = s.next.length === 1 ? s.next[0].to : s.next.map(e => e.to);
      else r.next = s.next.map(e => {
        const o = { to: e.to };
        if (e.when) o.when = e.when;
        if (e.exit) o.exit = sideOut(e.exit);
        if (e.entry) o.entry = sideOut(e.entry);
        return o;
      });
    }
    return r;
  });
  // memo：フロー全体についての自由なメモ（図の下の欄）。長くなりやすいので最後に書く
  if (f.memo) o.memo = f.memo;
  return o;
}
const toYaml = f => jsyaml.dump(toPlain(f), { lineWidth: -1, noRefs: true });
function parseYaml(text){ return normalize(jsyaml.load(text)); }

function uid(prefix, taken){ let n = 1; while (taken.has(prefix + n)) n++; return prefix + n; }

Object.assign(globalThis.Flowbook ??= {}, { TYPES, SIDES, SIDE_NAME, sideIn, sideOut, normNext, normalize, toPlain, toYaml, parseYaml, uid });
})();

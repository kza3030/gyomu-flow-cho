/* フローのデータ：YAML との変換と、読み込んだ値の整形（normalize）。
   core/ のファイルは画面（DOM）に触らない。Node のテスト（tests/）からも読み込む */
(() => {
"use strict";
/* ステップの種類。データ（dataObject）・データストア（dataStore）の名前は BPMN 2.0 の Data Object・Data Store にならう。
   データ＝Excel ファイルなど単体で置くデータ、データストア＝データを蓄積する場所（データベースなど）。
   サブプロセス（subProcess）は別に定義した業務フローを指すステップで、BPMN 2.0 のたたまれたサブプロセスの形で描く */
const TYPES = { start:"開始", task:"作業", decision:"判断", subProcess:"サブプロセス", document:"帳票", dataObject:"データ", dataStore:"データストア", end:"終了" };
// 種類の書き方：大文字・小文字と「_」「-」は問わない。以前の data（円柱）は dataStore、system は subProcess として読む。わからなければ作業
const typeIn = v => {
  const t = String(v ?? "").trim().toLowerCase().replace(/[\s_-]/g, "");
  return t === "data" ? "dataStore" : t === "system" ? "subProcess" : Object.keys(TYPES).find(k => k.toLowerCase() === t) || "task";
};
/* ツール：ステップで使うシステム・ツール・伝達手段など（任意の自由記述）。「ツール・手段を表示」をオンにすると図の箱の中に出す */
const TOOL_NAME = "使用システム・ツール・手段";
const hasTool = s => !!(s.tool && String(s.tool).trim());
/* 以前（v1.9〜v2.0）の入出力・システムの項目。読み込むと、伝達手段（channel）はツールの後ろに「 ／ 」でつなぎ、
   入力情報・出力情報・関連ファイル・帳票は「項目名：値」の行にして補足の末尾に移す（書き出すときは書かない） */
const OLD_INFO = [["input", "入力情報"], ["output", "出力情報"], ["files", "関連ファイル・帳票"]];
/* 色：ステップの箱を塗る色（任意。開始・終了は塗らない）。[YAML のキー]: 画面の名前。YAML には日本語の名前でも書ける */
const COLORS = { red: "赤", orange: "橙", yellow: "黄", green: "緑", blue: "青", purple: "紫", gray: "灰" };
const colorIn = v => { const t = String(v ?? "").trim(); return COLORS[t.toLowerCase()] ? t.toLowerCase() : Object.keys(COLORS).find(k => COLORS[k] === t) || ""; };
const colorable = s => !!s && s.type !== "start" && s.type !== "end";
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
/* related：関連（点線）。BPMN の関連のように、ステップと、そこで作る帳票などの中間成果物を結ぶ。流れ（next）とは別に、相手の id だけを並べる。
   文字列・並び・{ to: … } のどれでも書ける。空と重複は捨てる */
function normRelated(r){
  if (r == null || r === "") return [];
  const ids = (Array.isArray(r) ? r : [r]).map(x => String(x && typeof x === "object" ? x.to ?? "" : x)).filter(Boolean);
  return [...new Set(ids)];
}
// 帳票・データ・データストア（中間成果物）。ほかのステップとは、流れではなく必ず関連（点線）で結ぶ
const ARTIFACT = new Set(["document", "dataObject", "dataStore"]);
const isArtifact = s => !!s && ARTIFACT.has(s.type);
/* 帳票・データから出る・帳票・データへ入る流れ（next）を、同じ向きの関連（related）に移す（条件・辺の指定は捨てる）。
   読み込み（normalize）と、画面での変更のたび（app.js の commit）に通す。移したものがあれば true */
function artifactLinks(f){
  const art = new Set(f.steps.filter(isArtifact).map(s => s.id));
  let moved = false;
  f.steps.forEach(s => {
    if (!s.next.some(e => art.has(s.id) || art.has(e.to))) return;
    const rel = s.related ||= [];
    s.next = s.next.filter(e => {
      if (!art.has(s.id) && !art.has(e.to)) return true;
      if (!rel.includes(e.to)) rel.push(e.to);
      moved = true; return false;
    });
  });
  return moved;
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
    const st = { id: String(s.id ?? ("s" + (i + 1))), type: typeIn(s.type), lane: String(s.lane ?? ""), label: String(s.label ?? ""), note: s.note != null ? String(s.note) : "", issue: s.issue != null ? String(s.issue) : "" };
    st.tool = [s.tool, s.channel].map(v => v != null ? String(v).trim() : "").filter(Boolean).join(" ／ ");
    const old = OLD_INFO.filter(([k]) => s[k] != null && String(s[k]).trim()).map(([k, name]) => `${name}：${String(s[k]).trim()}`);
    if (old.length) st.note = [st.note.replace(/\s+$/, ""), ...old].filter(Boolean).join("\n");
    const c = colorIn(s.color); if (c) st.color = c;
    st.next = normNext(s.next);
    st.related = normRelated(s.related);
    // col: 図で左から何列目に置くか（1 始まり）。省くと自動で決める
    if (Number.isInteger(+s.col) && +s.col >= 1) st.col = +s.col;
    // row: レーンの中で上から何段目に置くか（1 始まり。中身のない段は詰めて描く）。省くと自動で決める
    if (Number.isInteger(+s.row) && +s.row >= 1) st.row = +s.row;
    f.steps.push(st);
  });
  artifactLinks(f);
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
    if (s.color) r.color = s.color;
    r.label = s.label;
    if (s.note) r.note = s.note;
    if (s.issue) r.issue = s.issue;
    if (s.tool) r.tool = s.tool;
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
    if (s.related?.length) r.related = s.related.length === 1 ? s.related[0] : s.related.slice();
    return r;
  });
  // memo：フロー全体についての自由なメモ（図の下の欄）。長くなりやすいので最後に書く
  if (f.memo) o.memo = f.memo;
  return o;
}
const toYaml = f => jsyaml.dump(toPlain(f), { lineWidth: -1, noRefs: true });
function parseYaml(text){ return normalize(jsyaml.load(text)); }

function uid(prefix, taken){ let n = 1; while (taken.has(prefix + n)) n++; return prefix + n; }

Object.assign(globalThis.Flowbook ??= {}, { TYPES, typeIn, TOOL_NAME, hasTool, COLORS, colorIn, colorable, SIDES, SIDE_NAME, sideIn, sideOut, normNext, normRelated, ARTIFACT, isArtifact, artifactLinks, normalize, toPlain, toYaml, parseYaml, uid });
})();

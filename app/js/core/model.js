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
/* 辺のどこから出る（exitAt）・どこへ入る（entryAt）か。辺の端から端を 0〜100 で表す（上下の辺は左端が 0、左右の辺は上端が 0。50 が真ん中）。
   辺を指定したとき（exit・entry）だけ書ける。省くと、同じ辺に出入りするほかの矢印と並べて自動で決める */
const atIn = v => { const n = parseFloat(v); return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null; };
function normNext(n){
  if (n == null || n === "") return [];
  if (!Array.isArray(n)) n = [n];
  return n.map(x => {
    if (!x || typeof x !== "object") return { to: String(x), when: "" };
    const e = { to: String(x.to ?? ""), when: x.when != null ? String(x.when) : "" }, ex = sideIn(x.exit), en = sideIn(x.entry);
    if (ex){ e.exit = ex; const a = atIn(x.exitAt); if (a != null) e.exitAt = a; }
    if (en){ e.entry = en; const a = atIn(x.entryAt); if (a != null) e.entryAt = a; }
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
/* 流れの中のステップ X（id）の種類を type にする。帳票・データ・データストアに変えるとき、X から出る流れが 1 本（X→Q）なら、
   X へ入っていた流れ（P→X）を P→Q につなぎ直し（条件・出る辺は残し、入る辺は X→Q のものにする）、X は P と関連で結ぶ。
   流れの途中から帳票を抜き出して、P と Q の流れが切れないようにする（bpmn-js がステップを消すときに前後をつなぎ直すのにならう）。
   出る流れが 0 本・2 本以上のときは種類を変えるだけ（残った流れは artifactLinks が関連に移す）。つなぎ直したら true */
function toArtifact(f, id, type){
  const x = f.steps.find(s => s.id === id); if (!x) return false;
  const was = isArtifact(x); x.type = type;
  if (was || !isArtifact(x) || x.next.length !== 1 || x.next[0].to === x.id) return false;
  const out = x.next[0];
  f.steps.forEach(p => {
    if (p === x || !p.next.some(e => e.to === x.id)) return;
    p.next = p.next.filter(e => {
      if (e.to !== x.id) return true;
      // 自分へ戻る矢印・同じ相手への 2 本目の矢印になるなら、つなぎ直さずに外す
      if (p.id === out.to || p.next.some(o => o.to === out.to)) return false;
      e.to = out.to;
      if (out.entry) e.entry = out.entry; else delete e.entry;
      if (out.entryAt != null) e.entryAt = out.entryAt; else delete e.entryAt;
      return true;
    });
    if (!(p.related ||= []).includes(x.id) && !(x.related || []).includes(p.id)) p.related.push(x.id);
  });
  x.next = [];
  return true;
}
/* AsIs／ToBe の比較。変更の種類（change.kind）：ECRS（廃止・統合・入替・簡素化）と、自動化・システム化・移管・その他。
   [YAML のキー]: 画面の名前。色と同じく日本語の名前でも書ける。知らない種類は「その他」として読む */
const KINDS = { eliminate: "廃止", combine: "統合", rearrange: "入替", simplify: "簡素化", automate: "自動化", systemize: "システム化", transfer: "移管", other: "その他" };
const kindIn = v => { const t = String(v ?? "").trim(); if (!t) return ""; return KINDS[t.toLowerCase()] ? t.toLowerCase() : Object.keys(KINDS).find(k => KINDS[k] === t) || "other"; };
// change：ToBe のステップを AsIs からどう・なぜ変えたか（任意）。種類も理由もなければ持たない
function changeIn(c){
  if (!c || typeof c !== "object") return null;
  const o = {}, k = kindIn(c.kind), r = c.reason != null ? String(c.reason) : "";
  if (k) o.kind = k;
  if (r.trim()) o.reason = r;
  return o.kind || o.reason ? o : null;
}
const changeOut = c => { const o = {}; if (c.kind) o.kind = c.kind; if (c.reason) o.reason = c.reason; return o; };
// フローの ID（id）：名前やファイル名を変えても変わらない。ToBe が比較元（compare.base）を指すのに使う
const newFlowId = () => "f" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
function normStep(s, i){
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
  // from：ToBe のステップが、比較元（AsIs）のどのステップにあたるか。ID が同じなら書かなくてよい（統合・分割・置き換えのときに書く）
  const from = normRelated(s.from); if (from.length) st.from = from;
  const ch = changeIn(s.change); if (ch) st.change = ch;
  return st;
}
function normLanes(lanes){
  if (!Array.isArray(lanes)) throw new Error("lanes は「- id: … / name: …」の並びで書いてください。");
  const out = [];
  lanes.forEach((l, i) => {
    if (typeof l === "string") out.push({ id: l, name: l });
    else if (l && typeof l === "object") out.push({ id: String(l.id ?? ("lane" + (i + 1))), name: String(l.name ?? l.id ?? ("担当" + (i + 1))) });
  });
  return out;
}
function normSteps(steps){
  if (!Array.isArray(steps)) throw new Error("steps は「- id: …」の並びで書いてください。");
  return steps.map((s, i) => s && typeof s === "object" ? normStep(s, i) : null).filter(Boolean);
}
/* compare：このフローを ToBe として、比較元（AsIs）と比べるための情報。
   base＝比較元のフローの id / at＝写しを取った（最後に取り込んだ）日時 / snapshot＝その時点の比較元の lanes・steps（写し）。
   比べる相手は写しなので、後から比較元を直しても ToBe の変化点は変わらない */
function normCompare(c){
  if (!c || typeof c !== "object" || Array.isArray(c) || c.base == null || String(c.base).trim() === "") return null;
  const snap = c.snapshot && typeof c.snapshot === "object" ? c.snapshot : {};
  const o = { base: String(c.base).trim(), at: c.at != null ? (c.at instanceof Date ? c.at.toISOString() : String(c.at)) : "", snapshot: { lanes: normLanes(snap.lanes ?? []), steps: normSteps(snap.steps ?? []) } };
  artifactLinks(o.snapshot);
  return o;
}
// removed：比較元から削除したステップの、変更の種類と理由（任意）。ToBe にはそのステップがないので、ここに書く
function normRemoved(r){
  if (!Array.isArray(r)) r = r != null && r !== "" ? [r] : [];
  const seen = new Set(), out = [];
  r.forEach(x => {
    const id = String(x && typeof x === "object" ? x.id ?? "" : x ?? "").trim();
    if (!id || seen.has(id)) return; seen.add(id);
    out.push({ id, ...(changeIn(x) || {}) });
  });
  return out;
}
function normalize(raw){
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("先頭は name: / lanes: / steps: を持つ形にしてください。");
  const f = { name: String(raw.name ?? "無題のフロー"), owner: raw.owner != null ? String(raw.owner) : "", description: raw.description != null ? String(raw.description) : "", lanes: normLanes(raw.lanes ?? []), steps: normSteps(raw.steps ?? []), memo: raw.memo != null ? String(raw.memo) : "" };
  if (raw.id != null && String(raw.id).trim()) f.id = String(raw.id).trim();
  const removed = normRemoved(raw.removed); if (removed.length) f.removed = removed;
  const cmp = normCompare(raw.compare); if (cmp) f.compare = cmp;
  artifactLinks(f);
  return f;
}
function toPlain(f){
  const o = {};
  if (f.id) o.id = f.id;
  o.name = f.name;
  if (f.owner) o.owner = f.owner;
  if (f.description) o.description = f.description;
  o.lanes = lanesPlain(f.lanes);
  o.steps = stepsPlain(f.steps);
  if (f.removed?.length) o.removed = f.removed.map(r => ({ id: r.id, ...changeOut(r) }));
  // memo：フロー全体についての自由なメモ（図の下の欄）。長くなりやすいので最後に書く
  if (f.memo) o.memo = f.memo;
  // compare：写し（snapshot）はフロー 1 つ分の長さがあるので、メモよりさらに後ろに書く
  if (f.compare) o.compare = { base: f.compare.base, ...(f.compare.at ? { at: f.compare.at } : {}), snapshot: { lanes: lanesPlain(f.compare.snapshot.lanes), steps: stepsPlain(f.compare.snapshot.steps) } };
  return o;
}
const lanesPlain = lanes => lanes.map(l => ({ id: l.id, name: l.name }));
function stepsPlain(steps){
  return steps.map(s => {
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
        if (e.exit && e.exitAt != null) o.exitAt = e.exitAt;
        if (e.entry) o.entry = sideOut(e.entry);
        if (e.entry && e.entryAt != null) o.entryAt = e.entryAt;
        return o;
      });
    }
    if (s.related?.length) r.related = s.related.length === 1 ? s.related[0] : s.related.slice();
    if (s.from?.length) r.from = s.from.length === 1 ? s.from[0] : s.from.slice();
    if (s.change) r.change = changeOut(s.change);
    return r;
  });
}
const toYaml = f => jsyaml.dump(toPlain(f), { lineWidth: -1, noRefs: true });
function parseYaml(text){ return normalize(jsyaml.load(text)); }

function uid(prefix, taken){ let n = 1; while (taken.has(prefix + n)) n++; return prefix + n; }

Object.assign(globalThis.Flowbook ??= {}, { TYPES, typeIn, KINDS, kindIn, newFlowId, TOOL_NAME, hasTool, COLORS, colorIn, colorable, SIDES, SIDE_NAME, sideIn, sideOut, atIn, normNext, normRelated, ARTIFACT, isArtifact, artifactLinks, toArtifact, normalize, toPlain, toYaml, parseYaml, uid });
})();

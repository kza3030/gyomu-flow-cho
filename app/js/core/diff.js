/* AsIs／ToBe の比較：差分の計算（diffFlows）、写しの後の比較元の更新（updatesSince）と取り込み（resolveUpdate）、
   ToBe の作成（makeToBe・setBase）、AsIs と ToBe でぶつからないステップ ID（familyIds）。
   ToBe は比較元（AsIs）の写し（compare.snapshot）と比べる。後から AsIs を直しても、ToBe の変化点には混ざらない。
   core/ のファイルは画面（DOM）に触らない。Node のテスト（tests/）からも読み込む */
(() => {
"use strict";
const { newFlowId } = globalThis.Flowbook; // model.js

/* 比べる項目。位置（col・row）・色・辺の指定は見た目なので比べない */
const DIFF_FIELDS = { label: "内容", type: "種類", tool: "ツール", note: "補足", issue: "課題" };
const UPDATE_FIELDS = { ...DIFF_FIELDS, lane: "担当" };
const clone = o => JSON.parse(JSON.stringify(o));
const val = (s, k) => s?.[k] ?? "";
const ekey = (a, b) => a + ">" + b;
const rkey = (a, b) => a + "~" + b;

/* base（AsIs の写し）と target（ToBe）を比べる。どちらも { lanes, steps } を持つ形。
   ステップは ID が同じなら同じものとし、ID が違うものは target の from で base のステップに対応させる。
   返すもの：
   steps：target のステップ ID -> { st, base, src, fields, moved, branch }
     st＝same（変わらない）/ add（追加）/ rep（from で置き換え・統合・分割）/ chg（変更）/ move（担当の移動だけ）
     base＝対応する base のステップ / src＝from で指した base のステップ（rep のとき）
     fields＝[項目, 前, 後] の並び / moved＝[前の担当, 後の担当] / branch＝[前の条件, 後の条件, 行き先] の並び
   base：base のステップ ID -> st（same・chg・move のほか、repsrc＝置き換え元 / del＝削除）
   edges：{ base, target }。矢印は "元>先"、関連は "元~先" をキーに、same・add（target だけ）・del（base だけ）・chg（条件だけ違う）
   removed：削除した base のステップの並び */
function diffFlows(base, target){
  const bBy = new Map(base.steps.map(s => [s.id, s])), tBy = new Map(target.steps.map(s => [s.id, s]));
  // target のステップが base のどれにあたるか。ID が base にあればそれ、なければ from
  const srcIds = t => bBy.has(t.id) ? [t.id] : (t.from || []).filter(id => bBy.has(id));
  const usedAsSrc = new Map();
  target.steps.forEach(t => { if (!bBy.has(t.id)) srcIds(t).forEach(id => usedAsSrc.set(id, t.id)); });
  const steps = new Map();
  target.steps.forEach(t => {
    const ids = srcIds(t), b = ids.length ? bBy.get(ids[0]) : null, rep = !!b && !bBy.has(t.id);
    const d = { st: "same", base: b, src: rep ? ids.map(id => bBy.get(id)) : null, fields: [], moved: null, branch: [] };
    if (!b) d.st = "add";
    else {
      Object.keys(DIFF_FIELDS).forEach(k => { if (val(b, k) !== val(t, k)) d.fields.push([k, val(b, k), val(t, k)]); });
      if (b.lane !== t.lane) d.moved = [b.lane, t.lane];
    }
    steps.set(t.id, d);
  });
  // 矢印・関連：target の両端を base の ID に読み替えて比べる（統合したステップは、元のどれとも同じものとして扱う）
  const keysOf = id => { const t = tBy.get(id); return t ? (srcIds(t).length ? srcIds(t) : [id]) : [id]; };
  const tEdges = new Map(), tIndex = new Map(), tRel = new Map(), tRelIndex = new Map();
  target.steps.forEach(s => {
    s.next.forEach(e => { const k = ekey(s.id, e.to); tEdges.set(k, e); keysOf(s.id).forEach(a => keysOf(e.to).forEach(b => { if (!tIndex.has(ekey(a, b))) tIndex.set(ekey(a, b), [k, e]); })); });
    (s.related || []).forEach(to => { const k = rkey(s.id, to); tRel.set(k, true); keysOf(s.id).forEach(a => keysOf(to).forEach(b => tRelIndex.set(rkey(a, b), k))); });
  });
  const edges = { base: new Map(), target: new Map() };
  const merged = (a, b) => usedAsSrc.has(a) && usedAsSrc.get(a) === usedAsSrc.get(b);
  base.steps.forEach(s => {
    s.next.forEach(e => {
      const k = ekey(s.id, e.to), hit = tIndex.get(k);
      if (!hit){ edges.base.set(k, merged(s.id, e.to) ? "same" : "del"); return; }
      const [tk, te] = hit, st = (e.when || "") !== (te.when || "") ? "chg" : "same";
      edges.base.set(k, st);
      if (!edges.target.has(tk) || st === "chg") edges.target.set(tk, st);
      if (st === "chg") steps.get(tk.split(">")[0])?.branch.push([e.when || "", te.when || "", te.to]);
    });
    (s.related || []).forEach(to => { const k = rkey(s.id, to), tk = tRelIndex.get(k); edges.base.set(k, tk ? "same" : "del"); if (tk) edges.target.set(tk, "same"); });
  });
  tEdges.forEach((e, k) => { if (!edges.target.has(k)) edges.target.set(k, "add"); });
  tRel.forEach((_, k) => { if (!edges.target.has(k)) edges.target.set(k, "add"); });
  steps.forEach(d => { if (d.st === "same") d.st = d.src ? "rep" : d.fields.length || d.branch.length ? "chg" : d.moved ? "move" : "same"; });
  const baseSt = new Map(), removed = [];
  base.steps.forEach(s => {
    if (tBy.has(s.id)) baseSt.set(s.id, steps.get(s.id).st);
    else if (usedAsSrc.has(s.id)) baseSt.set(s.id, "repsrc");
    else { baseSt.set(s.id, "del"); removed.push(s); }
  });
  return { steps, base: baseSt, edges, removed };
}

/* 写し（snapshot）を取った後に、比較元（current）がどう変わったか。tobe はその写しを持つ ToBe。
   ステップ ID が同じものを同じステップとして比べる（from は使わない）。返す並びの 1 件：
   { key, type, … , canApply, conflict }
     type：laneName（担当の名前）/ addLane / delLane / field（ステップの項目）/ addStep / delStep / edgeWhen（矢印の条件）/ addEdge / delEdge / addRel / delRel
     canApply：ToBe にもそのまま反映できるか（第 1 段では項目・条件・担当の名前だけ。ステップや矢印の追加・削除は「取り込まない」だけ）
     conflict：ToBe でも同じ所を変えている（反映すると ToBe の変更を上書きする）
   足された・消されたステップに出入りする矢印は、そのステップの件（addStep・delStep）の edges にまとめる */
function updatesSince(tobe, current){
  const snap = tobe.compare?.snapshot; if (!snap) return [];
  const out = [];
  const sBy = new Map(snap.steps.map(s => [s.id, s])), cBy = new Map(current.steps.map(s => [s.id, s])), tBy = new Map(tobe.steps.map(s => [s.id, s]));
  const sLane = new Map(snap.lanes.map(l => [l.id, l])), cLane = new Map(current.lanes.map(l => [l.id, l])), tLane = new Map(tobe.lanes.map(l => [l.id, l]));
  current.lanes.forEach(l => {
    const s = sLane.get(l.id);
    if (!s) out.push({ key: "lane+" + l.id, type: "addLane", lane: clone(l), canApply: false, conflict: false });
    else if (s.name !== l.name){ const t = tLane.get(l.id); out.push({ key: "lane:" + l.id, type: "laneName", lane: l.id, from: s.name, to: l.name, canApply: !!t, conflict: !!t && t.name !== s.name }); }
  });
  snap.lanes.forEach(l => { if (!cLane.has(l.id)) out.push({ key: "lane-" + l.id, type: "delLane", lane: clone(l), canApply: false, conflict: false }); });
  const stepItems = new Map();
  current.steps.forEach(c => {
    const s = sBy.get(c.id);
    if (!s){ const it = { key: "step+" + c.id, type: "addStep", id: c.id, step: clone(c), edges: [], canApply: false, conflict: tBy.has(c.id) }; stepItems.set(c.id, it); out.push(it); return; }
    const t = tBy.get(c.id);
    Object.keys(UPDATE_FIELDS).forEach(k => {
      if (val(s, k) === val(c, k)) return;
      out.push({ key: `field:${c.id}:${k}`, type: "field", id: c.id, field: k, from: val(s, k), to: val(c, k), canApply: !!t, conflict: !!t && val(t, k) !== val(s, k) });
    });
  });
  snap.steps.forEach(s => {
    if (cBy.has(s.id)) return;
    const used = tBy.has(s.id) || tobe.steps.some(t => (t.from || []).includes(s.id));
    const it = { key: "step-" + s.id, type: "delStep", id: s.id, step: clone(s), edges: [], canApply: false, conflict: used }; stepItems.set(s.id, it); out.push(it);
  });
  // 矢印・関連。足された・消されたステップに出入りするものは、そのステップの件にまとめる
  const edgeItem = (it, a, b) => { const g = stepItems.get(a) || stepItems.get(b); if (g) g.edges.push(it); else out.push(it); };
  const nextOf = (by, id) => by.get(id)?.next || [], relOf = (by, id) => by.get(id)?.related || [];
  const ids = new Set([...sBy.keys(), ...cBy.keys()]);
  ids.forEach(id => {
    const sn = nextOf(sBy, id), cn = nextOf(cBy, id);
    cn.forEach(e => {
      const o = sn.find(x => x.to === e.to);
      if (!o) edgeItem({ key: `edge+${id}>${e.to}`, type: "addEdge", from: id, to: e.to, edge: clone(e), canApply: false, conflict: false }, id, e.to);
      else if ((o.when || "") !== (e.when || "")){
        const te = nextOf(tBy, id).find(x => x.to === e.to);
        out.push({ key: `when:${id}>${e.to}`, type: "edgeWhen", from: id, to: e.to, old: o.when || "", now: e.when || "", canApply: !!te, conflict: !!te && (te.when || "") !== (o.when || "") });
      }
    });
    sn.forEach(o => { if (!cn.some(e => e.to === o.to)) edgeItem({ key: `edge-${id}>${o.to}`, type: "delEdge", from: id, to: o.to, edge: clone(o), canApply: false, conflict: false }, id, o.to); });
    const sr = relOf(sBy, id), cr = relOf(cBy, id);
    cr.forEach(to => { if (!sr.includes(to)) edgeItem({ key: `rel+${id}~${to}`, type: "addRel", from: id, to, canApply: false, conflict: false }, id, to); });
    sr.forEach(to => { if (!cr.includes(to)) edgeItem({ key: `rel-${id}~${to}`, type: "delRel", from: id, to, canApply: false, conflict: false }, id, to); });
  });
  return out;
}

/* 写しの後の更新 1 件を決める。how：apply＝ToBe にも反映する / keep＝取り込まない（ToBe はそのまま。違いは ToBe での変更として残る）。
   どちらでも写しをその件の分だけ今の比較元に進める。すべて決め終わったら compare.at を now にする。
   tobe（の写し）をその場で書き換える。反映できない件で apply を頼まれたら、何もせず false を返す */
function resolveUpdate(tobe, current, item, how, now){
  if (how === "apply" && !item.canApply) return false;
  const snap = tobe.compare.snapshot;
  const apply = how === "apply" ? [snap, tobe] : [snap];
  const stepOf = (F, id) => F.steps.find(s => s.id === id);
  const edgeChange = (F, it) => {
    const s = stepOf(F, it.from);
    if (it.type === "addEdge"){ if (s && !s.next.some(e => e.to === it.to)) s.next.push(clone(it.edge)); }
    else if (it.type === "delEdge"){ if (s) s.next = s.next.filter(e => e.to !== it.to); }
    else if (it.type === "addRel"){ if (s){ s.related ||= []; if (!s.related.includes(it.to)) s.related.push(it.to); } }
    else if (it.type === "delRel"){ if (s) s.related = (s.related || []).filter(to => to !== it.to); }
  };
  apply.forEach(F => {
    switch (item.type){
      case "laneName": { const l = F.lanes.find(x => x.id === item.lane); if (l) l.name = item.to; break; }
      case "addLane": if (!F.lanes.some(l => l.id === item.lane.id)){ const i = current.lanes.findIndex(l => l.id === item.lane.id); F.lanes.splice(Math.min(i, F.lanes.length), 0, clone(item.lane)); } break;
      case "delLane": F.lanes = F.lanes.filter(l => l.id !== item.lane.id); break;
      case "field": { const s = stepOf(F, item.id); if (s) s[item.field] = item.to; break; }
      case "edgeWhen": { const e = stepOf(F, item.from)?.next.find(x => x.to === item.to); if (e) e.when = item.now; break; }
      case "addStep": if (!stepOf(F, item.id)){ const s = clone(item.step); s.next = []; s.related = []; F.steps.push(s); } item.edges.forEach(e => edgeChange(F, e)); break;
      case "delStep":
        F.steps = F.steps.filter(s => s.id !== item.id);
        F.steps.forEach(s => { s.next = s.next.filter(e => e.to !== item.id); s.related = (s.related || []).filter(to => to !== item.id); });
        break;
      default: edgeChange(F, item);
    }
  });
  if (!updatesSince(tobe, current).length) tobe.compare.at = now;
  return true;
}

/* 比較元の写し：lanes・steps だけを持つ。比較元自身の比較の情報（from・change）は持ち込まない */
function snapshotOf(f){
  const s = clone({ lanes: f.lanes, steps: f.steps });
  s.steps.forEach(st => { delete st.from; delete st.change; });
  return s;
}
/* asis をもとに ToBe を作る。ステップの ID は引き継ぐので、作った直後の差分はない。フローの ID は新しく振る。
   name を省くと「〇〇（ToBe）」 */
function makeToBe(asis, now, name){
  const f = clone(asis);
  f.id = newFlowId();
  f.name = name || asis.name + "（ToBe）";
  f.steps.forEach(st => { delete st.from; delete st.change; });
  delete f.removed;
  f.compare = { base: asis.id, at: now, snapshot: snapshotOf(asis) };
  return f;
}
/* 新しい ToBe の名前。siblings は同じ比較元の ToBe の名前。
   1 つ目は「〇〇（ToBe）」。2 つ目からは「〇〇（ToBe 案B）」「案C」…とし、名前を変えていない 1 つ目（〇〇（ToBe））は「案A」に変える（first に変える前と後の名前） */
const planLetter = n => (n >= 26 ? planLetter(Math.floor(n / 26) - 1) : "") + String.fromCharCode(65 + n % 26);
function toBeName(asisName, siblings){
  const one = asisName + "（ToBe）", plan = n => `${asisName}（ToBe 案${planLetter(n)}）`;
  if (!siblings.length) return { name: one, first: null };
  const used = new Set(siblings), first = used.has(one) && !used.has(plan(0)) ? { from: one, to: plan(0) } : null;
  if (first) used.add(first.to);
  let n = 0; while (used.has(plan(n))) n++;
  return { name: plan(n), first };
}
/* 今あるフロー f の比較元を asis にする（写しを今の asis で取り直す）。asis が null なら比較をやめる */
function setBase(f, asis, now){
  if (!asis){ delete f.compare; return; }
  f.compare = { base: asis.id, at: now, snapshot: snapshotOf(asis) };
}

/* 新しいステップ ID を振るときに避ける ID：自分・自分の写し・比較元（今の版）、自分を比較元にしている ToBe（とその写し）のステップ。
   AsIs と ToBe で別々に同じ番号を振ると、中身の違うステップを同じものとして比べてしまうため。flows は読み込んだすべてのフロー */
function familyIds(f, flows){
  const ids = new Set(), add = F => F && F.steps.forEach(s => ids.add(s.id));
  add(f); add(f.compare?.snapshot);
  if (f.compare) add(flows.find(g => g.id === f.compare.base));
  if (f.id) flows.forEach(g => { if (g !== f && g.compare?.base === f.id){ add(g); add(g.compare.snapshot); } });
  return ids;
}
/* 写しの後に、ToBe と比較元の両方で別々に足した同じ ID（中身の違うステップを同じものとして比べてしまう） */
function idClashes(tobe, current){
  const snap = new Set((tobe.compare?.snapshot.steps || []).map(s => s.id)), cur = new Set(current.steps.map(s => s.id));
  return tobe.steps.filter(s => !snap.has(s.id) && cur.has(s.id)).map(s => s.id);
}

Object.assign(globalThis.Flowbook ??= {}, { DIFF_FIELDS, UPDATE_FIELDS, diffFlows, updatesSince, resolveUpdate, snapshotOf, makeToBe, toBeName, setBase, familyIds, idClashes });
})();

/* 図の配置の計算：ステップの置き場所、矢印の経路、条件ラベル・課題の吹き出しの置き方。
   ここでは座標を決めるだけで、SVG にするのは app.js（layout & render）。
   core/ のファイルは画面（DOM）に触らない。Node のテスト（tests/）からも読み込む */
(() => {
"use strict";
// gap: 列と列の最小のすき間 / track: すき間を縦に走る線どうしの間隔 / chan: レーン上下端を横に走る線どうしの間隔
const G = { label: 104, pad: 22, gap: 44, nodeW: 134, nodeH: 58, laneH: 124, track: 8, chan: 6 };
// 条件ラベル：1行の文字数の目安（全角換算）と最大行数。超えた分は「…」で省略し、全文はホバーで見せる
const LB = { per: 8, max: 2, lineH: 12, font: 10 };
const textW = t => [...t].reduce((a, ch) => a + (/[\x00-\xff]/.test(ch) ? 0.58 : 1) * LB.font, 0);
function edgeLabel(t){
  const lines = wrapLabel(t, LB.per, LB.max);
  return { t, lines, w: Math.max(...lines.map(textW)) + 12, h: lines.length * LB.lineH + 6 };
}
/* 課題の吹き出し（「課題を表示」中）。幅は空きに合わせて minW〜maxW、文は最大 lines 行（超える分は、マウスを乗せる・選ぶと全文）。
   gap はステップとの間。roomT / roomB は吹き出しとレーンの端の間に空ける幅（レーンの端を通る線と条件ラベルの通り道） */
const CO = { minW: 150, maxW: 300, lines: 4, lineH: 18, font: 12, padX: 9, padY: 7, icon: 21, gap: 14, roomT: 16, roomB: 18 };
const labelCut = t => !!t && edgeLabel(t).lines.join("") !== t;
/* ステップから出る線：流れ（next）と関連（related。点線）。関連は、流れの矢印と同じ相手・自分自身へのものは描かない。
   関連の線の e は、その場で作る { to, when: "", assoc: true, k: related の何番目か } */
const outLinks = s => [...s.next, ...(s.related || []).flatMap((to, k) => to !== s.id && !s.next.some(e => e.to === to) ? [{ to, when: "", assoc: true, k }] : [])];
// ほかのステップと矢印・関連の線でつながっているステップの id（自分へ戻る矢印・つなぎ先のない矢印は数えない）
function linkedIds(f){
  const ids = new Set(f.steps.map(s => s.id)), on = new Set();
  f.steps.forEach(s => outLinks(s).forEach(e => { if (e.to !== s.id && ids.has(e.to)){ on.add(s.id); on.add(e.to); } }));
  return on;
}
// co は課題の吹き出しの置き方（calloutPlan の結果）。渡すと、吹き出しを入れるレーンをその分だけ上下に広げて配置する。
// placeOnly なら、ステップの置き場所（レーン・段・列）だけを決めて返す（線は引かない）
function layout(f, co, placeOnly){
  const lanes = f.lanes.slice();
  const laneIdx = new Map(lanes.map((l, i) => [l.id, i]));
  if (f.steps.some(s => !laneIdx.has(s.lane))){ laneIdx.set("__none", lanes.length); lanes.push({ id: "__none", name: "（担当未設定）", ghost: true }); }
  const rowOf = s => laneIdx.has(s.lane) ? laneIdx.get(s.lane) : laneIdx.get("__none");
  const byId = new Map(); f.steps.forEach(s => { if (!byId.has(s.id)) byId.set(s.id, s); });
  const steps = [...byId.values()];
  // 関連（点線）も、配置では流れと同じく、関連元の後ろへ相手を置く
  const outs = new Map(steps.map(s => [s.id, outLinks(s)]));
  // detect back edges with DFS from starts, then the rest in order
  const st = {}, back = new Set();
  const dfs = id => { st[id] = 1; for (const e of outs.get(id)){ if (!byId.has(e.to)) continue; if (st[e.to] === 1) back.add(id + "\u0000" + e.to); else if (!st[e.to]) dfs(e.to); } st[id] = 2; };
  steps.filter(s => s.type === "start").forEach(s => { if (!st[s.id]) dfs(s.id); });
  steps.forEach(s => { if (!st[s.id]) dfs(s.id); });
  const isBack = (a, b) => back.has(a + "\u0000" + b);
  // topological order on forward edges
  const indeg = new Map(steps.map(s => [s.id, 0])), preds = new Map(steps.map(s => [s.id, []]));
  steps.forEach(s => outs.get(s.id).forEach(e => { if (byId.has(e.to) && !isBack(s.id, e.to) && e.to !== s.id){ indeg.set(e.to, indeg.get(e.to) + 1); preds.get(e.to).push(s.id); } }));
  const q = steps.filter(s => indeg.get(s.id) === 0).map(s => s.id), order = [];
  while (q.length){ const id = q.shift(); order.push(id); outs.get(id).forEach(e => { if (byId.has(e.to) && !isBack(id, e.to) && e.to !== id){ indeg.set(e.to, indeg.get(e.to) - 1); if (indeg.get(e.to) === 0) q.push(e.to); } }); }
  steps.forEach(s => { if (!order.includes(s.id)) order.push(s.id); });

  /* columns: 同じレーンの前ステップなら次の列へ。別レーンから受け取るだけなら同じ列の真下・真上に置く。
     段：レーンの中は上から段 0, 1, … に分かれる。同じレーンの前ステップの段（複数なら一番上）を引き継ぎ、
     同じ前ステップから分かれた先どうしが同じマスを取り合うときは、右へずらさず同じ列の下の段に置く（縦に並べる）。
     マスは レーン r・段 t・列 c。cells = ステップのあるマス、segs = 同じ列を縦に走る矢印（両端の [レーン, 段]） */
  const col = new Map(), tier = new Map(), cells = new Map(), segs = [];
  const cell = (r, t, c) => r + ":" + t + ":" + c, cmp = (p, q) => p[0] - q[0] || p[1] - q[1];
  const tiers = lanes.map(() => new Set([0]));
  const between = (p, q, m) => { const [lo, hi] = cmp(p, q) < 0 ? [p, q] : [q, p]; return cmp(lo, m) < 0 && cmp(m, hi) < 0; };
  const cellFree = (r, t, c) => !cells.has(cell(r, t, c)) && !segs.some(g => g.c === c && between(g.a, g.b, [r, t]));
  // 列 c で a と b の間（両端を除く）にある段がすべて空いているか
  const pathFree = (a, b, c) => lanes.every((l, r) => [...tiers[r]].every(t => !between(a, b, [r, t]) || cellFree(r, t, c)));
  const place = (id, r, t, c) => { cells.set(cell(r, t, c), id); col.set(id, c); tier.set(id, t); tiers[r].add(t); };
  const succ = new Map(steps.map(s => [s.id, new Set()])); preds.forEach((ps, id) => ps.forEach(p => succ.get(p).add(id)));
  // 列を指定したステップ（図で左右に動かしたもの）は先にその列へ置く。同じマスが埋まっていれば右へずらす
  order.forEach(id => {
    const s = byId.get(id); if (!s.col) return;
    const r = rowOf(s), t = s.row ? s.row - 1 : 0; let c = s.col - 1;
    while (cells.has(cell(r, t, c))) c++;
    place(id, r, t, c);
  });
  order.forEach(id => {
    if (col.has(id)) return;
    const s = byId.get(id), r = rowOf(s), ps = [...new Set(preds.get(id))].filter(p => col.has(p)).map(p => ({ id: p, c: col.get(p), r: rowOf(byId.get(p)), t: tier.get(p) }));
    // 別のレーンからこのレーンへ 2 つ以上に分かれた先は、真下・真上ではなく前ステップの次の列に縦に並べる
    const fork = p => p.r !== r && [...succ.get(p.id)].filter(x => rowOf(byId.get(x)) === r).length > 1;
    let c = 0; ps.forEach(p => { c = Math.max(c, p.c + (p.r === r || fork(p) ? 1 : 0)); });
    const own = ps.filter(p => p.r === r), t0 = s.row ? s.row - 1 : own.length ? Math.min(...own.map(p => p.t)) : 0;
    const ok = (t, c) => cellFree(r, t, c) && ps.every(p => p.c !== c || pathFree([p.r, p.t], [r, t], c));
    let t = t0;
    while (!ok(t, c)){
      // ふさいでいるのが同じ前ステップから分かれた先なら下の段へ。それ以外は右の列へ
      const o = cells.get(cell(r, t, c));
      if (!s.row && o && ps.some(p => succ.get(p.id).has(o))) t++;
      else { c++; t = t0; }
    }
    place(id, r, t, c);
    ps.forEach(p => { if (p.c === c) segs.push({ c, a: [p.r, p.t], b: [r, t] }); });
  });
  const maxCol = Math.max(0, ...col.values());
  /* 段を詰めて、図の上から通し番号の「行」にする（中身のない段は描かない。どのレーンも 1 行以上）。
     ここから先の線の引き回しは行ごとに考える。rows[g] = { r: レーン, t: 詰めたあとの段, t0: 詰める前の段 }
     occ = ステップのある行・列、pass = 縦の矢印が通り抜ける行・列 */
  const rows = [], rowAt = new Map();
  lanes.forEach((l, r) => {
    const ts = [...new Set(steps.filter(s => rowOf(s) === r).map(s => tier.get(s.id)))].sort((a, b) => a - b);
    (ts.length ? ts : [0]).forEach((t0, t) => { rowAt.set(r + ":" + t0, rows.length); rows.push({ r, t, t0 }); });
  });
  const gOf = s => rowAt.get(rowOf(s) + ":" + tier.get(s.id));
  const occ = new Set(), pass = new Set(), key = (g, c) => g + ":" + c;
  steps.forEach(s => occ.add(key(gOf(s), col.get(s.id))));
  rows.forEach((w, g) => segs.forEach(sg => { if (between(sg.a, sg.b, [w.r, w.t0])) pass.add(key(g, sg.c)); }));
  const free = (g, c) => !occ.has(key(g, c)) && !pass.has(key(g, c));
  const span = (r1, r2) => { const a = []; for (let r = Math.min(r1, r2) + 1; r < Math.max(r1, r2); r++) a.push(r); return a; };
  /* 行の縦の位置。bandY[g] が行 g の上端（bandY[rows.length] が図の下端）。吹き出しのぶん padT / padB を足す。
     laneY[r] はレーン r の上端（laneY[lanes.length] が図の下端） */
  const padT = rows.map(() => 0), padB = rows.map(() => 0);
  (co || []).forEach(c => { const s = byId.get(c.id); if (!s) return; const g = gOf(s); if (c.side === "T") padT[g] = Math.max(padT[g], c.h + CO.roomT); else padB[g] = Math.max(padB[g], c.h + CO.roomB); });
  const bandY = [0]; rows.forEach((w, g) => bandY.push(bandY[g] + padT[g] + G.laneH + padB[g]));
  const rowY = rows.map((w, g) => bandY[g] + padT[g] + (G.laneH - G.nodeH) / 2);
  const laneY = lanes.map((l, r) => bandY[rows.findIndex(w => w.r === r)]); laneY.push(bandY[rows.length]);
  // pos.r は行、l はレーン、t はレーンの中の段（詰めたあと）
  const pos = new Map();
  steps.forEach(s => { const g = gOf(s), c = col.get(s.id); pos.set(s.id, { x: 0, y: rowY[g], w: G.nodeW, h: G.nodeH, r: g, l: rows[g].r, t: rows[g].t, c }); });
  if (placeOnly) return { lanes, rows, steps, pos };
  const blocked = (r, c1, c2) => { for (let c = c1 + 1; c < c2; c++) if (occ.has(key(r, c))) return true; return false; };

  /* edges: 経路の種類を決める
     straight 同じレーンを右へ / elbow すき間で折れて別レーンへ / skip レーン端を通って列を飛ばす（dskip は判断の下の頂点から）
     vert 同じ列の別レーンへ縦に / dv 判断の上下の頂点から出て別レーンへ / loop 前の列へ戻る（下側を通る） / self 自分へ戻る
     assoc は関連（点線）の線。k は、流れなら next の、関連なら related の何番目か */
  const edges = [];
  steps.forEach(s => outs.get(s.id).forEach(e => {
    const t = byId.get(e.to); if (!t) return;
    const a = pos.get(s.id), b = pos.get(t.id);
    const E = { s, t, e, a, b, assoc: !!e.assoc, k: e.assoc ? e.k : s.next.indexOf(e), back: isBack(s.id, t.id) || s.id === t.id, label: e.when ? edgeLabel(e.when) : null };
    if (s.id === t.id) E.kind = "self";
    else if (E.back || b.c < a.c) E.kind = "loop";
    else if (b.c === a.c) E.kind = span(a.r, b.r).some(m => occ.has(key(m, a.c))) ? "loop" : "vert";
    else if (a.r === b.r) E.kind = blocked(a.r, a.c, b.c) ? "skip" : "straight";
    else E.kind = blocked(b.r, a.c, b.c) ? "skip" : "elbow";
    // 出入りする辺を指定した矢印は custom で引く。指定のない側は、自動で決まる経路（auto）の辺を使う
    if (E.kind !== "self" && (e.exit || e.entry)){ E.auto = E.kind; E.kind = "custom"; }
    edges.push(E);
  }));
  // 判断から別レーンへの分岐は、上下の頂点から縦に出す（向きごとに1本まで）
  steps.filter(s => s.type === "decision").forEach(s => {
    const mine = edges.filter(E => E.s === s);
    [true, false].forEach(up => {
      if (mine.some(E => (E.kind === "vert" || E.kind === "dv") && (E.b.r < E.a.r) === up)) return;
      const cand = mine.filter(E => (E.kind === "elbow" || E.kind === "skip") && E.b.r !== E.a.r && (E.b.r < E.a.r) === up
        && [...span(E.a.r, E.b.r), E.b.r].every(m => free(m, E.a.c)) && !blocked(E.b.r, E.a.c, E.b.c))
        .sort((x, y) => Math.abs(x.b.r - x.a.r) - Math.abs(y.b.r - y.a.r))[0];
      if (cand) cand.kind = "dv";
    });
    // 同じレーンで列を飛ばす分岐は、下の頂点から出してレーン下端を通す（右の頂点は隣の列へ渡す）
    const skip = mine.find(E => E.kind === "skip" && E.a.r === E.b.r);
    if (skip && mine.some(E => E !== skip && /straight|elbow/.test(E.kind)) && !mine.some(E => (E.kind === "vert" || E.kind === "dv") && E.b.r > E.a.r)) skip.kind = "dskip";
  });
  // ports: 同じ辺から出入りする矢印は、相手の位置の順に並べて少しずつずらす
  const ports = new Map();
  const addPort = (id, sd, E, end, o) => { const k = id + "\u0000" + sd; if (!ports.has(k)) ports.set(k, []); ports.get(k).push({ E, end, o }); };
  // 判断の上下の頂点から縦に出る線が通るマス
  const dvCells = new Set();
  edges.forEach(E => { if (E.kind === "dv") [...span(E.a.r, E.b.r), E.b.r].forEach(m => dvCells.add(key(m, E.a.c))); });
  // 前の列へ戻る矢印を、戻り先の真下から（列のすき間を回らず）上げられるか
  const loopDirect = E => E.b.r < E.a.r && [...span(E.a.r, E.b.r), E.a.r].every(m => free(m, E.b.c) && !dvCells.has(key(m, E.b.c)));
  edges.forEach(E => {
    const up = E.b.r < E.a.r;
    if (E.kind === "self") return;
    const k = E.kind === "custom" ? E.auto : E.kind;
    if (k === "dv") [E.so, E.ti] = [up ? "T" : "B", "L"];
    else if (k === "dskip") [E.so, E.ti] = ["B", "L"];
    else if (k === "vert") [E.so, E.ti] = up ? ["T", "B"] : ["B", "T"];
    else if (k === "loop") [E.so, E.ti] = ["B", "B"];
    else [E.so, E.ti] = ["R", "L"];
    if (E.e.exit) E.so = E.e.exit;
    if (E.e.entry) E.ti = E.e.entry;
  });
  /* 前の列へ戻る矢印は戻り先の下へ入れるのが基本。ただし戻り先の左の辺にほかの矢印がなく、
     左から入るほうが道のりが短ければ左へ入れる（下へ入れるために大きく回り込まないように） */
  {
    const cw = G.nodeW + G.gap, cx = c => c * cw + G.nodeW / 2, gx = c => c * cw - G.gap / 2;
    const chB = r => bandY[r + 1] - 9, mid = r => rowY[r] + G.nodeH / 2, bot = r => mid(r) + G.nodeH / 2;
    const leftUsed = id => edges.some(F => (F.t.id === id && F.ti === "L") || (F.s.id === id && F.so === "L"));
    edges.forEach(E => {
      if (E.kind !== "loop" || leftUsed(E.t.id)) return;
      const { a, b } = E, sx = cx(a.c), sy = chB(a.r);
      const viaBottom = a.r === b.r || loopDirect(E)
        ? Math.abs(sx - cx(b.c)) + Math.abs(sy - bot(b.r))
        : Math.abs(sx - gx(b.c)) + Math.abs(sy - chB(b.r)) + (cx(b.c) - gx(b.c)) + (chB(b.r) - bot(b.r));
      const viaLeft = Math.abs(sx - gx(b.c)) + Math.abs(sy - mid(b.r)) + G.gap / 2;
      if (viaLeft < viaBottom){ E.ti = "L"; E.leftIn = true; }
    });
  }
  /* 左右の辺に並ぶ矢印は、線が来る（向かう）高さの順に並べる。レーン端の通り道を通る線はその高さで比べる
     （同じレーンから下を回って入る線を、まっすぐ入る線より下にして交差させない） */
  const away = (E, end) => {
    const { a, b } = E, chB = r => bandY[r + 1] - 9;
    if (E.kind === "dskip" || (E.kind === "skip" && a.r === b.r) || (E.leftIn && end === "t")) return chB(a.r);
    if (E.kind === "skip") return b.r > a.r ? bandY[b.r] + 9 : chB(b.r);
    const o = end === "s" ? b : a; return rowY[o.r] + G.nodeH / 2;
  };
  edges.forEach(E => { if (E.so){ addPort(E.s.id, E.so, E, "s", E.b); addPort(E.t.id, E.ti, E, "t", E.a); } });
  ports.forEach((list, k) => {
    const horiz = /[TB]$/.test(k);
    if (!horiz) list.forEach(p => { p.y = away(p.E, p.end); });
    list.sort((p, q) => horiz ? (p.o.c - q.o.c) || (p.o.r - q.o.r) : (p.y - q.y) || (p.o.r - q.o.r) || (p.o.c - q.o.c));
    const n = list.length, half = horiz ? G.nodeW / 2 - 22 : G.nodeH / 2 - 12, step = n > 1 ? Math.min(horiz ? 18 : 14, 2 * half / (n - 1)) : 0;
    /* 位置を指定した端（exitAt・entryAt）はその位置に置き、並べる枠のうちいちばん近いものをふさぐ。
       ほかの端は、残った枠に順に置く（指定した端と重ならないように） */
    const slots = list.map((p, i) => (i - (n - 1) / 2) * step), at = p => p.E.e[p.end === "s" ? "exitAt" : "entryAt"];
    list.forEach(p => {
      if (at(p) == null) return;
      p.off = atOff(p.end === "s" ? p.E.s : p.E.t, p.end === "s" ? p.E.so : p.E.ti, at(p)); p.E[p.end === "s" ? "fo" : "fi"] = true;
      let j = 0; slots.forEach((v, i) => { if (Math.abs(v - p.off) < Math.abs(slots[j] - p.off)) j = i; }); slots.splice(j, 1);
    });
    list.filter(p => at(p) == null).forEach((p, i) => { p.off = slots[i]; });
    list.forEach(p => { p.E[p.end === "s" ? "oo" : "io"] = p.off; p.E[p.end === "s" ? "on" : "in"] = n; });
  });
  edges.forEach(E => { if (E.so){ E.sy = portAt(E.s, E.a, E.so, E.oo)[1]; E.ty = portAt(E.t, E.b, E.ti, E.io)[1]; } });

  // channels: レーン上下端を横に走る線は、同じ端を使う順に少しずつずらす
  const chans = new Map();
  const chan = (r, sd) => { const k = r + sd, i = chans.get(k) || 0; chans.set(k, i + 1); return sd === "B" ? bandY[r + 1] - 9 - (i % 3) * G.chan : bandY[r] + 9 + (i % 3) * G.chan; };
  // tracks: 列のすき間を縦に走る線。gap g は列 g と g+1 の間（-1 はレーン名の右）
  const tracks = new Map(), zone = new Map();
  const track = (g, E, role, y1, y2) => { if (!tracks.has(g)) tracks.set(g, []); const t = { E, role, y1, y2 }; tracks.get(g).push(t); return t; };
  edges.forEach(E => {
    const { a, b } = E;
    if (E.label && /^(straight|elbow|skip)$/.test(E.kind)) zone.set(a.c, Math.max(zone.get(a.c) || 0, E.label.w + 10));
    if (E.kind === "straight" && E.sy !== E.ty) E.tn = track(b.c - 1, E, "n", E.sy, E.ty);
    else if (E.kind === "elbow") E.tx = track(a.c, E, "x", E.sy, E.ty);
    else if (E.kind === "skip"){
      E.ch = a.r === b.r ? chan(a.r, "B") : chan(b.r, b.r > a.r ? "T" : "B");
      E.tx = track(a.c, E, "x", E.sy, E.ch); E.tn = track(b.c - 1, E, "n", E.ch, E.ty);
    } else if (E.kind === "dskip"){
      E.ch = chan(a.r, "B"); E.tn = track(b.c - 1, E, "n", E.ch, E.ty);
    } else if (E.kind === "loop"){
      E.chS = chan(a.r, "B");
      // 戻り先の左へ入る：戻り先の左のすき間を縦に通り、そのまま左の辺へ
      if (E.leftIn) E.tb = track(b.c - 1, E, "b", E.chS, E.ty);
      else if (a.r === b.r) E.chT = E.chS;
      // 上のレーンへ戻り、戻り先の真下が空いていれば、列のすき間を回らず真下から上がる
      else if (loopDirect(E)) E.direct = true;
      else { E.chT = chan(b.r, "B"); E.tb = track(b.c - 1, E, "b", E.chS, E.chT); }
    }
  });
  const rank = t => t.role === "x" ? (t.y2 < t.y1 ? [0, t.y1] : [1, -t.y1]) : t.role === "n" ? (t.y1 < t.y2 ? [2, -t.y2] : [3, t.y2]) : [4, t.y2];
  /* 同じすき間の縦線の並び：交差と横線の重なりが最も少ない順を選ぶ（重なりは交差より重く数える。同点なら rank の順）
     stubs = 縦線の両端から出る横線の高さと向き（L は左の箱から来る、R は右へ出ていく） */
  const stubs = t => t.role === "b" ? [[t.y1, "R"], [t.y2, "R"]] : [[t.y1, "L"], [t.y2, "R"]];
  const inside = (y, t) => y > Math.min(t.y1, t.y2) + 0.5 && y < Math.max(t.y1, t.y2) - 0.5;
  const pairCost = (P, Q) => { // P が左、Q が右
    let c = 0;
    stubs(P).forEach(([y, sd]) => { if (sd === "R"){ if (inside(y, Q)) c += 1; if (stubs(Q).some(([y2]) => Math.abs(y2 - y) < 1)) c += 10; } });
    stubs(Q).forEach(([y, sd]) => { if (sd === "L"){ if (inside(y, P)) c += 1; if (stubs(P).some(([y2, s2]) => s2 === "L" && Math.abs(y2 - y) < 1)) c += 10; } });
    return c;
  };
  const bestOrder = list => {
    const n = list.length; if (n < 2) return list;
    const cost = o => { let c = 0; for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) c += pairCost(o[i], o[j]); return c; };
    let best = list, bc = cost(list);
    if (n <= 7){
      const perm = (pre, rest) => { if (!bc) return; if (!rest.length){ const c = cost(pre); if (c < bc){ bc = c; best = pre; } return; } rest.forEach((t, i) => perm([...pre, t], rest.filter((_, k) => k !== i))); };
      perm([], list);
    } else { // 本数が多いときは隣どうしの入れ替えで改善する
      let moved = true;
      while (moved){ moved = false; for (let i = 0; i + 1 < n; i++){ const o = best.slice(); [o[i], o[i + 1]] = [o[i + 1], o[i]]; const c = cost(o); if (c < bc){ bc = c; best = o; moved = true; } } }
    }
    return best;
  };
  /* 左の縦線へ入る横線と、右の縦線から出る横線が同じ高さだと1本の線に見える。
     どちらかの箱の出入り口を、その縦線が伸びる向きへ少しずらす（その辺に矢印が1本だけのときに限る） */
  const portOf = (t, k) => t.role === "x" ? (k ? (t.E.kind === "elbow" ? "t" : null) : "s") : t.role === "n" ? (k ? "t" : (t.E.kind === "straight" ? "s" : null)) : null;
  const nudge = (t, k) => {
    const end = portOf(t, k); if (!end || t.E[end === "s" ? "on" : "in"] !== 1 || t.E[end === "s" ? "fo" : "fi"]) return false;
    const y = k ? t.y2 : t.y1, dir = Math.sign((k ? t.y1 : t.y2) - y); if (!dir) return false;
    const o = end === "s" ? "oo" : "io", lim = G.nodeH / 2 - 10;
    t.E[o] = Math.max(-lim, Math.min(lim, t.E[o] + dir * 10));
    t[k ? "y2" : "y1"] = y + dir * 10; return true;
  };
  const gapW = new Map();
  for (let g = -1; g <= maxCol; g++){
    const list = bestOrder((tracks.get(g) || []).sort((p, q) => { const a = rank(p), b = rank(q); return a[0] - b[0] || a[1] - b[1]; }));
    list.forEach((P, i) => list.slice(i + 1).forEach(Q => {
      if (P.role !== "b" && Q.role !== "b" && P.E !== Q.E && Math.abs(P.y1 - Q.y2) < 6) nudge(Q, 1) || nudge(P, 0);
    }));
    const z = zone.get(g) || 0, n = list.length;
    const need = z + (n ? 10 + (n - 1) * G.track + 12 : z ? 14 : 0);
    gapW.set(g, Math.max(g < 0 ? G.pad : G.gap, need));
    const extra = z ? 0 : (gapW.get(g) - need) / 2;
    list.forEach((t, i) => { t.off = z + extra + 10 + i * G.track; });
  }
  const colX = [G.label + gapW.get(-1)];
  for (let c = 1; c <= maxCol; c++) colX[c] = colX[c - 1] + G.nodeW + gapW.get(c - 1);
  pos.forEach(p => { p.x = colX[p.c]; });
  const gapX = g => g < 0 ? G.label : colX[g] + G.nodeW;
  const tx = (g, t) => gapX(g) + t.off;
  const width = colX[maxCol] + G.nodeW + G.pad;

  /* 課題の吹き出しの位置。ステップの上（T）か下（B）の辺の ax から短い線を出し、その先に置く。
     横の位置は ax からのずれ（dx）で受け取る（列の位置は吹き出しの有無で変わらない） */
  const callouts = [];
  (co || []).forEach(c => {
    const s = byId.get(c.id), p = s && pos.get(c.id); if (!p) return;
    const [ax, ay] = portAt(s, p, c.side, c.sx);
    const edge = c.side === "T" ? topY(s, p) : p.y + p.h + (s.type === "decision" ? 6 : 0);
    const x = Math.max(G.label + 2, Math.min(ax + c.dx, width - c.w - 2));
    const y = c.side === "T" ? edge - CO.gap - c.h : edge + CO.gap;
    callouts.push({ ...c, ax, ay, x, y, stemY: c.side === "T" ? y + c.h : y });
  });

  /* 辺を指定した矢印（custom）の経路：出口・入口から少し外へ出し、その間を縦横の線でつなぐ。
     折れる位置は、列のすき間の中央・レーン上下端の通り道などから、ステップの箱を横切らず短く折れの少ないものを選ぶ */
  const boxes = steps.map(s => { const p = pos.get(s.id), d = s.type === "decision"; return { id: s.id, x1: p.x - (d ? 4 : 0) - 3, y1: p.y - (d ? 6 : 0) - 3, x2: p.x + p.w + (d ? 4 : 0) + 3, y2: p.y + p.h + (d ? 6 : 0) + 3 }; });
  // 吹き出しと、ステップとの間の線も横切らないようにする
  callouts.forEach(c => boxes.push({ id: c.id, x1: c.x - 3, y1: Math.min(c.y, c.ay) - 3, x2: c.x + c.w + 3, y2: Math.max(c.y + c.h, c.ay) + 3 }));
  const DIR = { R: [1, 0], L: [-1, 0], T: [0, -1], B: [0, 1] };
  const cuts = (p, q, b) => p[1] === q[1]
    ? p[1] > b.y1 && p[1] < b.y2 && Math.max(p[0], q[0]) > b.x1 && Math.min(p[0], q[0]) < b.x2
    : p[0] > b.x1 && p[0] < b.x2 && Math.max(p[1], q[1]) > b.y1 && Math.min(p[1], q[1]) < b.y2;
  // 2本の縦横の線分が 5px 以内で平行に並び、10px 以上重なっているか
  const alongside = (p, q, u, v) => {
    if (p[1] === q[1] && u[1] === v[1] && Math.abs(p[1] - u[1]) < 5) return Math.min(Math.max(p[0], q[0]), Math.max(u[0], v[0])) - Math.max(Math.min(p[0], q[0]), Math.min(u[0], v[0])) > 10;
    if (p[0] === q[0] && u[0] === v[0] && Math.abs(p[0] - u[0]) < 5) return Math.min(Math.max(p[1], q[1]), Math.max(u[1], v[1])) - Math.max(Math.min(p[1], q[1]), Math.min(u[1], v[1])) > 10;
    return false;
  };
  const xsMid = []; for (let g = -1; g <= maxCol; g++) xsMid.push(gapX(g) + (g < maxCol ? gapW.get(g) : G.pad) / 2);
  const ysMid = []; rows.forEach((w, g) => ysMid.push(bandY[g] + 9, bandY[g + 1] - 9));
  function routeCustom(E, S, T){
    const d = 16, ds = DIR[E.so], dt = DIR[E.ti];
    const S0 = [S[0] + ds[0] * d, S[1] + ds[1] * d], T0 = [T[0] + dt[0] * d, T[1] + dt[1] * d];
    const cands = [];
    // ほかの線のすぐ横を避けられるよう、少しずらした位置も候補にする
    const near = v => [v, v - 10, v + 10];
    [...near((S0[0] + T0[0]) / 2), ...near(S0[0]), ...near(T0[0]), ...xsMid].forEach(x => cands.push([S, S0, [x, S0[1]], [x, T0[1]], T0, T]));
    [...near((S0[1] + T0[1]) / 2), ...near(S0[1]), ...near(T0[1]), ...ysMid].forEach(y => cands.push([S, S0, [S0[0], y], [T0[0], y], T0, T]));
    const score = raw => {
      const pts = raw.filter((p, i) => i === 0 || p[0] !== raw[i - 1][0] || p[1] !== raw[i - 1][1]);
      let sc = 0;
      for (let i = 1; i < pts.length; i++){
        const p = pts[i - 1], q = pts[i];
        sc += Math.abs(q[0] - p[0]) + Math.abs(q[1] - p[1]);
        // 出口・入口の短い線以外が箱を横切ったら大きく減点（自分の箱も含む）
        if (i > 1 && i < pts.length - 1) boxes.forEach(b => { if (cuts(p, q, b)) sc += 1000; });
        // すでに引いた線と、すぐそばを並んで走る区間は減点（1本の線に見えてしまう）
        edges.forEach(F => { if (F !== E && F.pts) for (let j = 1; j < F.pts.length; j++) if (alongside(p, q, F.pts[j - 1], F.pts[j])) sc += 200; });
      }
      sc += (pts.length - 2) * 15;
      // 出口から逆向きに折り返す・入口の手前で行き過ぎて戻る経路は避ける
      const v = (p, q) => [Math.sign(q[0] - p[0]), Math.sign(q[1] - p[1])];
      if (pts.length > 2){
        const f = v(pts[1], pts[2]); if (f[0] === -ds[0] && f[1] === -ds[1]) sc += 400;
        const l = v(pts[pts.length - 3], pts[pts.length - 2]); if (l[0] === dt[0] && l[1] === dt[1]) sc += 400;
      }
      return sc;
    };
    let best = cands[0], bs = Infinity;
    cands.forEach(c => { const sc = score(c); if (sc < bs){ bs = sc; best = c; } });
    const pts = best.filter((p, i) => i === 0 || p[0] !== best[i - 1][0] || p[1] !== best[i - 1][1]);
    // 一直線に並ぶ途中の点は省く（ラベルの置き場所を探しやすくする）
    return pts.filter((p, i) => i === 0 || i === pts.length - 1 || !((pts[i - 1][0] === p[0] && p[0] === pts[i + 1][0]) || (pts[i - 1][1] === p[1] && p[1] === pts[i + 1][1])));
  }

  // points（辺を指定した矢印は、ほかの線と重ならないよう最後に引く）
  [...edges.filter(E => E.kind !== "custom"), ...edges.filter(E => E.kind === "custom")].forEach(E => {
    const { a, b, s, t } = E;
    let pts;
    if (E.kind === "self"){
      // 箱の上側で小さくループさせ、右の出口とは重ねない
      const S = portAt(s, a, "T", 30), T = portAt(s, a, "T", -30), y = a.y - 22;
      pts = [S, [S[0], y], [T[0], y], T];
    } else {
      const S = portAt(s, a, E.so, E.oo), T = portAt(t, b, E.ti, E.io);
      switch (E.kind){
        case "straight": pts = E.tn ? [S, [tx(b.c - 1, E.tn), S[1]], [tx(b.c - 1, E.tn), T[1]], T] : [S, T]; break;
        case "elbow": { const x = tx(a.c, E.tx); pts = [S, [x, S[1]], [x, T[1]], T]; break; }
        case "skip": { const x1 = tx(a.c, E.tx), x2 = tx(b.c - 1, E.tn); pts = [S, [x1, S[1]], [x1, E.ch], [x2, E.ch], [x2, T[1]], T]; break; }
        case "dv": pts = [S, [S[0], T[1]], T]; break;
        case "dskip": { const x = tx(b.c - 1, E.tn); pts = [S, [S[0], E.ch], [x, E.ch], [x, T[1]], T]; break; }
        case "vert": { if (S[0] === T[0]) pts = [S, T]; else { const m = bandY[Math.max(a.r, b.r)]; pts = [S, [S[0], m], [T[0], m], T]; } break; }
        case "loop": {
          if (E.leftIn){ const x = tx(b.c - 1, E.tb); pts = [S, [S[0], E.chS], [x, E.chS], [x, T[1]], T]; }
          else if (a.r === b.r || E.direct) pts = [S, [S[0], E.chS], [T[0], E.chS], T];
          else { const x = tx(b.c - 1, E.tb); pts = [S, [S[0], E.chS], [x, E.chS], [x, E.chT], [T[0], E.chT], T]; }
          break;
        }
        case "custom": pts = routeCustom(E, S, T); break;
      }
    }
    E.pts = pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1]);
  });

  // labels: 分岐元に近い位置から順に、箱・矢じり・ほかのラベルと重ならない場所を探す
  const obst = [];
  steps.forEach(s => { const p = pos.get(s.id), d = s.type === "decision"; obst.push({ x1: p.x - (d ? 4 : 0) - 2, y1: p.y - (d ? 20 : 14), x2: p.x + p.w + (d ? 4 : 0) + 2, y2: p.y + p.h + (d ? 6 : 0) + 2, wt: 2 }); });
  edges.forEach(E => { const [x, y] = E.pts[E.pts.length - 1]; obst.push({ x1: x - 8, y1: y - 8, x2: x + 8, y2: y + 8, wt: 2 }); });
  callouts.forEach(c => obst.push({ x1: c.x - 3, y1: c.y - 3, x2: c.x + c.w + 3, y2: c.y + c.h + 3, wt: 3 }));
  edges.forEach(E => { if (E.label){ E.lp = placeLabel(E.pts, E.label, obst); obst.push({ x1: E.lp[0] - E.label.w / 2 - 3, y1: E.lp[1] - E.label.h / 2 - 3, x2: E.lp[0] + E.label.w / 2 + 3, y2: E.lp[1] + E.label.h / 2 + 3, wt: 3 }); } });

  return { lanes, rows, steps, pos, edges, colX, laneY, bandY, rowY, callouts, linked: linkedIds(f), width, height: lanes.length ? laneY[lanes.length] : G.laneH };
}
/* 課題の吹き出しの置き方を、吹き出しなしで配置した図 L から決める。
   ・向き：矢印が出入りしない辺（上を優先）。上下とも使われていれば、出入りの少ない辺
   ・線を出す位置：その辺の矢印の出入り口からいちばん離れた所（空いていれば真ん中）
   ・幅：同じレーンの同じ側の、縦に走る線・隣の吹き出しとぶつからない範囲で minW〜maxW
   ・高さ：文の長さに合わせて最大 CO.lines 行。収まらない分は最後の行を「…」で切る */
function calloutPlan(L){
  const segs = [];
  L.edges.forEach(E => { for (let i = 1; i < E.pts.length; i++){ const [x1, y1] = E.pts[i - 1], [x2, y2] = E.pts[i]; if (x1 === x2) segs.push({ x: x1, y1: Math.min(y1, y2), y2: Math.max(y1, y2) }); } });
  const items = L.steps.filter(s => s.issue && s.issue.trim() && L.pos.has(s.id)).map(s => {
    const p = L.pos.get(s.id), cx = p.x + p.w / 2;
    const ends = sd => L.edges.flatMap(E => {
      const n = E.pts.length - 1;
      if (E.kind === "self") return E.s === s && sd === "T" ? [E.pts[0][0], E.pts[n][0]] : [];
      return [...(E.s === s && E.so === sd ? [E.pts[0][0]] : []), ...(E.t === s && E.ti === sd ? [E.pts[n][0]] : [])];
    });
    const opt = side => {
      const used = ends(side);
      let sx = 0, far = -1;
      [0, -p.w / 4, p.w / 4, -(p.w / 2 - 16), p.w / 2 - 16].forEach(o => { const d = used.length ? Math.min(...used.map(x => Math.abs(cx + o - x))) : Infinity; if (d > far + 0.5){ far = d; sx = o; } });
      // 吹き出しが入る帯（レーンの上端〜ステップの上、またはステップの下〜レーンの下端）と、そこを縦に走る線にはさまれた空き [lo, hi]
      const ax = cx + sx, [y1, y2] = side === "T" ? [L.bandY[p.r], p.y] : [p.y + p.h, L.bandY[p.r + 1]];
      let lo = G.label + 6, hi = L.width - 6;
      segs.forEach(g => { if (g.y2 > y1 + 1 && g.y1 < y2 - 1){ if (g.x < ax - 4) lo = Math.max(lo, g.x + 8); else if (g.x > ax + 4) hi = Math.min(hi, g.x - 8); } });
      return { s, r: p.r, side, sx, ax, lo, hi, used: used.length };
    };
    // 矢印の出入りがない辺を優先（上を先に）。どちらにも出入りがあれば、空きの広いほう
    const [t, b] = [opt("T"), opt("B")];
    return !t.used ? t : !b.used ? b : (b.hi - b.lo > t.hi - t.lo ? b : t);
  });
  return items.map(it => {
    let { lo, hi } = it;
    items.forEach(o => { if (o !== it && o.r === it.r && o.side === it.side){ const m = (it.ax + o.ax) / 2; if (o.ax < it.ax) lo = Math.max(lo, m + 4); else hi = Math.min(hi, m - 4); } });
    const room = Math.max(CO.minW, Math.min(CO.maxW, hi - lo)), pad = CO.padX * 2 + CO.icon;
    const per = (room - pad) / CO.font - 0.6, full = wrapText(it.s.issue, per), cut = full.length > CO.lines;
    // 短い課題は、文の幅まで縮める
    const w = Math.min(room, Math.ceil(Math.max(...full.map(t => [...t].reduce((a, ch) => a + (/[\x00-\xff]/.test(ch) ? 0.58 : 1), 0))) * CO.font + pad + 4));
    const x = w > hi - lo ? it.ax - w / 2 : Math.min(Math.max(it.ax - w / 2, lo), hi - w);
    const lines = full.slice(0, CO.lines);
    if (cut){ let t = [...lines[CO.lines - 1]]; while (t.length && wrapText(t.join("") + "…", per).length > 1) t.pop(); lines[CO.lines - 1] = t.join("") + "…"; }
    const hOf = n => CO.padY * 2 + n * CO.lineH;
    return { id: it.s.id, side: it.side, sx: it.sx, dx: x - it.ax, w, h: hOf(lines.length), lines, full, fullH: hOf(full.length), cut };
  });
}
const DB_RY = 8; // データ（円柱）の上下の楕円の縦の半径
const topY = (st, p) => p.y + (st.type === "decision" ? -6 : (st.type === "start" || st.type === "end") ? 6 : 0);
/* 辺の中で矢印を出し入れできる範囲（辺の中央からのずれの最大）。左右の辺は上下の端を、上下の辺は角と判断の左右の頂点の近くを避ける。
   開始・終了の上下の辺は、両端の丸みにかからない所まで */
function portSpan(st, side){
  if (side === "L" || side === "R") return G.nodeH / 2 - 8;
  return G.nodeW / 2 - (st.type === "start" || st.type === "end" ? (G.nodeH - 12) / 2 + 2 : 10);
}
// 辺の位置（exitAt・entryAt の 0〜100）と、辺の中央からのずれ（portAt の off）の変換
const atOff = (st, side, at) => (at / 50 - 1) * portSpan(st, side);
const offAt = (st, side, off) => Math.max(0, Math.min(100, (off / portSpan(st, side) + 1) * 50));
// 図形の辺上の点。side は R/L/T/B、off は辺の中央からのずれ
function portAt(st, p, side, off = 0){
  const cx = p.x + p.w / 2, cy = p.y + p.h / 2, lr = side === "R" || side === "L";
  if (st.type === "decision"){
    const hw = p.w / 2 + 4, hh = p.h / 2 + 6;
    if (lr){ const x = hw * (1 - Math.min(Math.abs(off) / hh, 0.8)); return [side === "R" ? cx + x : cx - x, cy + off]; }
    const y = hh * (1 - Math.min(Math.abs(off) / hw, 0.8)); return [cx + off, side === "B" ? cy + y : cy - y];
  }
  const pill = st.type === "start" || st.type === "end";
  if (lr){
    let dx = 0; if (pill){ const rr = (p.h - 12) / 2; dx = rr - Math.sqrt(Math.max(0, rr * rr - off * off)); }
    return [side === "R" ? p.x + p.w - dx : p.x + dx, cy + off];
  }
  if (st.type === "dataStore"){ // 円柱の上下は楕円の外側の弧に合わせる
    const k = DB_RY * Math.sqrt(Math.max(0, 1 - (2 * off / p.w) ** 2));
    return [cx + off, side === "T" ? p.y + DB_RY - k : p.y + p.h - DB_RY + k];
  }
  if (side === "T") return [cx + off, topY(st, p)];
  if (st.type === "document") return [cx + off, p.y + p.h - 8 + 7 * Math.sin(2 * Math.PI * (p.w / 2 - off) / p.w)];
  return [cx + off, p.y + p.h - (pill ? 6 : 0)];
}
function placeLabel(pts, lb, obst){
  const cands = [];
  for (let i = 1; i < pts.length; i++){
    const [x1, y1] = pts[i - 1], [x2, y2] = pts[i], len = Math.abs(x2 - x1) + Math.abs(y2 - y1);
    const need = (y1 === y2 ? lb.w : lb.h) / 2, lo = need + 4, hi = len - need - (i === pts.length - 1 ? 14 : 2);
    for (let d = lo; d <= hi; d += 3){ const k = d / len; cands.push([x1 + (x2 - x1) * k, y1 + (y2 - y1) * k]); }
  }
  if (!cands.length){
    let best = 1, bl = 0;
    for (let i = 1; i < pts.length; i++){ const l = Math.abs(pts[i][0] - pts[i - 1][0]) + Math.abs(pts[i][1] - pts[i - 1][1]); if (l > bl){ bl = l; best = i; } }
    cands.push([(pts[best][0] + pts[best - 1][0]) / 2, (pts[best][1] + pts[best - 1][1]) / 2]);
  }
  let pick = cands[0], min = Infinity;
  for (const [x, y] of cands){
    const b = { x1: x - lb.w / 2, y1: y - lb.h / 2, x2: x + lb.w / 2, y2: y + lb.h / 2 };
    const sc = obst.reduce((a, o) => a + (b.x1 < o.x2 && o.x1 < b.x2 && b.y1 < o.y2 && o.y1 < b.y2 ? o.wt : 0), 0);
    if (sc < min){ min = sc; pick = [x, y]; if (!sc) break; }
  }
  return pick;
}
// 課題の文を、全角 per 文字分の幅ごとの行に分ける。改行はそのまま残し、句読点や閉じ括弧は行頭に来ないよう前の行へぶら下げる
function wrapText(t, per){
  const lines = [];
  String(t).replace(/\s+$/, "").split(/\r?\n/).forEach(par => {
    let cur = "", w = 0;
    for (const ch of [...par]){
      const cw = /[\x00-\xff]/.test(ch) ? 0.58 : 1;
      if (w + cw > per && cur && !/[、。，．,.)）」』】！？!?]/.test(ch)){ lines.push(cur); cur = ""; w = 0; }
      cur += ch; w += cw;
    }
    lines.push(cur);
  });
  return lines;
}
function wrapLabel(t, per = 9, max = 3){
  const lines = []; let cur = "", w = 0;
  for (const ch of [...t]){ const cw = /[\x00-\xff]/.test(ch) ? 0.55 : 1; if (w + cw > per){ lines.push(cur); cur = ""; w = 0; } cur += ch; w += cw; }
  if (cur) lines.push(cur);
  if (lines.length > max){ lines.length = max; lines[max - 1] = lines[max - 1].slice(0, -1) + "…"; }
  return lines;
}

Object.assign(globalThis.Flowbook ??= {}, { G, LB, CO, DB_RY, textW, edgeLabel, labelCut, linkedIds, layout, calloutPlan, topY, portSpan, atOff, offAt, portAt, placeLabel, wrapText, wrapLabel });
})();

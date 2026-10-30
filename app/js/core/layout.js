/* 図の配置の計算：ステップの置き場所、矢印の経路、条件ラベル・課題の吹き出しの置き方。
   ここでは座標を決めるだけで、SVG にするのは app.js（layout & render）。
   core/ のファイルは画面（DOM）に触らない。Node のテスト（tests/）からも読み込む */
(() => {
"use strict";
const { isArtifact } = globalThis.Flowbook; // model.js
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
   関連の線の e は、related の 1 件（to と辺の指定）から、その場で作る { …, when: "", assoc: true, k: related の何番目か } */
const outLinks = s => [...s.next, ...(s.related || []).flatMap((r, k) => r.to !== s.id && !s.next.some(e => e.to === r.to) ? [{ ...r, when: "", assoc: true, k }] : [])];
// ほかのステップと矢印・関連の線でつながっているステップの id（自分へ戻る矢印・つなぎ先のない矢印は数えない）
function linkedIds(f){
  const ids = new Set(f.steps.map(s => s.id)), on = new Set();
  f.steps.forEach(s => outLinks(s).forEach(e => { if (e.to !== s.id && ids.has(e.to)){ on.add(s.id); on.add(e.to); } }));
  return on;
}
// co は課題の吹き出しの置き方（calloutPlan の結果）。渡すと、吹き出しを入れるレーンをその分だけ上下に広げて配置する。
// placeOnly なら、ステップの置き場所（レーン・段・列）だけを決めて返す（線は引かない）。
// extra は列のすき間 g（-1 はレーン名の右）ごとに足す幅（alignGaps の結果。AsIs と ToBe を上下に並べるときに列の横の位置をそろえる）
function layout(f, co, placeOnly, extra){
  const lanes = f.lanes.slice();
  const laneIdx = new Map(lanes.map((l, i) => [l.id, i]));
  if (f.steps.some(s => !laneIdx.has(s.lane))){ laneIdx.set("__none", lanes.length); lanes.push({ id: "__none", name: "（担当未設定）", ghost: true }); }
  const rowOf = s => laneIdx.has(s.lane) ? laneIdx.get(s.lane) : laneIdx.get("__none");
  const byId = new Map(); f.steps.forEach(s => { if (!byId.has(s.id)) byId.set(s.id, s); });
  const steps = [...byId.values()];
  const outs = new Map(steps.map(s => [s.id, outLinks(s)]));
  /* 配置で使うつながり（ここから相手を後ろへ置く）。関連（点線）も流れと同じく関連元の後ろへ相手を置くが、
     帳票・データとほかのステップの関連は、向きによらずステップの後ろに帳票・データを置く（使う帳票が流れのステップを押し出さず、向きを変えても動かない） */
  const pouts = new Map(steps.map(s => [s.id, []]));
  steps.forEach(s => outs.get(s.id).forEach(e => {
    const t = byId.get(e.to);
    if (e.assoc && t && isArtifact(s) && !isArtifact(t)) pouts.get(t.id).push({ to: s.id }); else pouts.get(s.id).push(e);
  }));
  // detect back edges with DFS from starts, then the rest in order
  const st = {}, back = new Set();
  const dfs = id => { st[id] = 1; for (const e of pouts.get(id)){ if (!byId.has(e.to)) continue; if (st[e.to] === 1) back.add(id + "\u0000" + e.to); else if (!st[e.to]) dfs(e.to); } st[id] = 2; };
  steps.filter(s => s.type === "start").forEach(s => { if (!st[s.id]) dfs(s.id); });
  steps.forEach(s => { if (!st[s.id]) dfs(s.id); });
  const isBack = (a, b) => back.has(a + "\u0000" + b);
  // topological order on forward edges
  const indeg = new Map(steps.map(s => [s.id, 0])), preds = new Map(steps.map(s => [s.id, []]));
  steps.forEach(s => pouts.get(s.id).forEach(e => { if (byId.has(e.to) && !isBack(s.id, e.to) && e.to !== s.id){ indeg.set(e.to, indeg.get(e.to) + 1); preds.get(e.to).push(s.id); } }));
  const q = steps.filter(s => indeg.get(s.id) === 0).map(s => s.id), order = [];
  while (q.length){ const id = q.shift(); order.push(id); pouts.get(id).forEach(e => { if (byId.has(e.to) && !isBack(id, e.to) && e.to !== id){ indeg.set(e.to, indeg.get(e.to) - 1); if (indeg.get(e.to) === 0) q.push(e.to); } }); }
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
  /* 位置（col・row）を持つステップがあれば、位置を覚えた図（sketch）として置く。位置を持つステップはそのマスに置き、つなぎ方では動かさない。
     位置のないステップ（図で足した・YAML に書き足した）だけを矢印に合わせて差し込み、置く所がふさがっているときや、
     後ろのステップより右に来てしまうときは、そこから右の列を全部 1 列ずらして場所を空ける（列の差し込み）。最後に、どのレーンも空の列を詰める。
     位置を持つステップが 1 つもなければ、すべて矢印から決める（自動の配置） */
  const sketch = steps.some(s => s.col), fixed = new Set(steps.filter(s => s.col).map(s => s.id));
  const want = new Map(steps.filter(s => s.col).map(s => [s.id, s.col - 1]));
  // 列 c0 から右を 1 列ずらす（置いたステップ・これから置く位置を持つステップ・縦に走る矢印）
  const shift = c0 => {
    want.forEach((c, id) => { if (c >= c0) want.set(id, c + 1); });
    const mv = [...col].filter(([, c]) => c >= c0);
    mv.forEach(([id, c]) => cells.delete(cell(rowOf(byId.get(id)), tier.get(id), c)));
    mv.forEach(([id, c]) => { col.set(id, c + 1); cells.set(cell(rowOf(byId.get(id)), tier.get(id), c + 1), id); });
    segs.forEach(g => { if (g.c >= c0) g.c++; });
  };
  // x の後ろ（前へ進む矢印の先で、もう置いたステップ）が x より左（同じレーンなら x の列まで）にあれば、x の右へ動かす。動かした先も同じように確かめる
  const pull = (x, seen) => {
    const cx = col.get(x), rx = rowOf(byId.get(x));
    succ.get(x).forEach(y => {
      if (!col.has(y) || seen.has(y)) return;
      const ry = rowOf(byId.get(y)), ty = tier.get(y); let n = cx + (ry === rx ? 1 : 0);
      if (col.get(y) >= n) return;
      // 真下・真上のマスがふさがっていれば右隣の列へ。そこもふさがっていれば列を差し込む
      if (cells.has(cell(ry, ty, n))){ if (n === cx) n++; if (cells.has(cell(ry, ty, n))) shift(n); }
      seen.add(y); cells.delete(cell(ry, ty, col.get(y))); col.set(y, n); cells.set(cell(ry, ty, n), y);
      pull(y, seen);
    });
  };
  /* 位置を持つステップを先にそのマスへ置く。同じマスを取り合う（YAML の書き違い・担当を書き換えたなど）ときは、
     後のステップ（流れの順）のために右へ列を差し込んで置き、その後ろのステップが左に残らないようにする */
  const bumped = [];
  order.forEach(id => {
    const s = byId.get(id); if (!s.col) return;
    const r = rowOf(s), t = s.row ? s.row - 1 : 0; let c = want.get(id);
    if (cells.has(cell(r, t, c))){ shift(c + 1); c++; bumped.push(id); }
    place(id, r, t, c);
  });
  bumped.forEach(id => pull(id, new Set([id])));
  order.forEach(id => {
    if (col.has(id)) return;
    const s = byId.get(id), r = rowOf(s), ps = [...new Set(preds.get(id))].filter(p => col.has(p)).map(p => ({ id: p, c: col.get(p), r: rowOf(byId.get(p)), t: tier.get(p) }));
    // 別のレーンからこのレーンへ 2 つ以上に分かれた先は、真下・真上ではなく前ステップの次の列に縦に並べる
    const fork = p => p.r !== r && [...succ.get(p.id)].filter(x => rowOf(byId.get(x)) === r).length > 1;
    let c = 0; ps.forEach(p => { c = Math.max(c, p.c + (p.r === r || fork(p) ? 1 : 0)); });
    const own = ps.filter(p => p.r === r), t0 = s.row ? s.row - 1 : own.length ? Math.min(...own.map(p => p.t)) : 0;
    const ok = (t, c) => cellFree(r, t, c) && ps.every(p => p.c !== c || pathFree([p.r, p.t], [r, t], c));
    // 後ろの、もう置いたステップ（位置を覚えた図で、間や前にステップを足したとき）。need は、このステップを置ける一番右の列
    const after = sketch ? [...succ.get(id)].filter(x => col.has(x)) : [], need = x => col.get(x) - (rowOf(byId.get(x)) === r ? 1 : 0);
    if (after.length && !ps.length){
      // 前のないステップは、後ろのステップのすぐ手前に置く。ふさがっていれば、後ろのステップの列に差し込む
      const b = after.reduce((x, y) => need(y) < need(x) ? y : x);
      c = need(b);
      if (c < 0 || !ok(t0, c)){ c = col.get(b); shift(c); }
    } else if (after.some(x => need(x) < c)){
      // 後ろのステップがこのステップより左に来てしまうなら、列を差し込んで場所を空ける（真下・真上に受け取るときは、前ステップの右隣に）
      if (ps.some(p => p.c === c)) c++;
      shift(c);
    }
    let t = t0;
    while (!ok(t, c)){
      // ふさいでいるのが同じ前ステップから分かれた先なら下の段へ。位置を覚えた図でほかのステップがふさいでいれば列を差し込む
      // （真下・真上に受け取るときは前ステップの右隣の列に）。それ以外は右の列へ
      const o = cells.get(cell(r, t, c));
      if (!s.row && o && ps.some(p => succ.get(p.id).has(o))) t++;
      else if (sketch && o && fixed.has(o)){ if (ps.some(p => p.c === c)) c++; shift(c); t = t0; }
      else { c++; t = t0; }
    }
    place(id, r, t, c);
    ps.forEach(p => { if (p.c === c) segs.push({ c, a: [p.r, p.t], b: [r, t] }); });
    if (sketch) pull(id, new Set([id]));
  });
  // 位置を覚えた図では、どのレーンにもステップのない列を詰める（段は行にするときに詰める）
  if (sketch){ const at = new Map([...new Set(col.values())].sort((a, b) => a - b).map((c, i) => [c, i])); col.forEach((c, id) => col.set(id, at.get(c))); }
  const maxCol = Math.max(0, ...col.values());
  /* 段を詰めて、図の上から通し番号の「行」にする（中身のない段は描かない。どのレーンも 1 行以上）。
     ここから先の線の引き回しは行ごとに考える。rows[g] = { r: レーン, t: 詰めたあとの段, t0: 詰める前の段 } */
  const rows = [], rowAt = new Map();
  lanes.forEach((l, r) => {
    const ts = [...new Set(steps.filter(s => rowOf(s) === r).map(s => tier.get(s.id)))].sort((a, b) => a - b);
    (ts.length ? ts : [0]).forEach((t0, t) => { rowAt.set(r + ":" + t0, rows.length); rows.push({ r, t, t0 }); });
  });
  const gOf = s => rowAt.get(rowOf(s) + ":" + tier.get(s.id));
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
  /* edges：ステップから出る線。前へ進む線も前の列へ戻る線も分けず、すべて同じやり方（route）で引く。
     kind は self（自分へ戻る。箱の上で小さく回す）/ custom（出入りする辺を指定した線）/ auto（辺も自動で選ぶ）。
     assoc は関連（点線）の線。k は、流れなら next の、関連なら related の何番目か */
  const edges = [];
  steps.forEach(s => outs.get(s.id).forEach(e => {
    const t = byId.get(e.to); if (!t) return;
    edges.push({ s, t, e, a: pos.get(s.id), b: pos.get(t.id), assoc: !!e.assoc, k: e.assoc ? e.k : s.next.indexOf(e), kind: s.id === t.id ? "self" : e.exit || e.entry ? "custom" : "auto", label: e.when ? edgeLabel(e.when) : null });
  }));

  /* 線の通り道の格子。横の位置 X は列のすき間（偶数。X = 2g + 2 が列 g と g + 1 のすき間、0 はレーン名の右）と列の中央（奇数。X = 2c + 1）、
     縦の位置 Y は行 r ごとの上端の通り道・中央・下端の通り道（Y = 3r, 3r + 1, 3r + 2）。ステップのあるマスの中央だけは通れない。
     線ごとに、この格子の上で「長さ＋折れ＋ほかの線との交差・相乗り＋使う辺」の点数がいちばん低い道を選ぶ（A*）。
     点数は決まった寸法の仮の座標で測る（課題の吹き出しでレーンが広がっても、道が変わらないように）。
     同じ通り道を通る線どうしをどれだけずらすかは、道が決まってから決める */
  const NX = 2 * maxCol + 3, NY = 3 * rows.length, NN = NX * NY;
  const boxAt = new Uint8Array(NN); steps.forEach(s => { const p = pos.get(s.id); boxAt[(3 * p.r + 1) * NX + 2 * p.c + 1] = 1; });
  const ex = Float64Array.from({ length: NX }, (_, X) => X * (G.nodeW + G.gap) / 2 - G.gap / 2);
  const ey = Float64Array.from({ length: NY }, (_, Y) => Math.floor(Y / 3) * G.laneH + [9, G.laneH / 2, G.laneH - 9][Y % 3]);
  // 向き 0〜3 は 右・下・左・上。OUT は辺から外へ出る向き、portNode は辺の出入り口の格子の点
  const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1], OUT = { R: 0, B: 1, L: 2, T: 3 }, SIDES = "RBLT";
  const portNode = (p, sd) => sd === "R" ? (3 * p.r + 1) * NX + 2 * p.c + 2 : sd === "L" ? (3 * p.r + 1) * NX + 2 * p.c : sd === "T" ? 3 * p.r * NX + 2 * p.c + 1 : (3 * p.r + 2) * NX + 2 * p.c + 1;
  /* 点数。bend：折れ 1 回 / cross：ほかの線を横切る 1 回 / share：同じ格子の辺を通るほかの線 1 本ごと /
     out・in：出る・入る辺ごとの基本（右から出て左へ入るのを基本にする）/ same・mix：その辺をすでに使う線 1 本ごと（同じ向き・出入りが混ざる） */
  const RC = { bend: 80, cross: 200, share: 20, out: { R: 0, B: 10, T: 10, L: 25 }, in: { L: 0, T: 10, B: 10, R: 25 }, same: 30, mix: 80 };
  /* use：格子の辺を通る線の本数（点 n から右へは 2n、下へは 2n + 1）/ thru：点を横（0）・縦（1）にまっすぐ通り抜ける線の本数 /
     sideUse：ステップの辺を使う線の本数（キーは ステップID・辺・o＝出る / i＝入る） */
  const use = new Int16Array(NN * 2), thru = [new Int16Array(NN), new Int16Array(NN)], sideUse = new Map();
  const sk = (id, sd, io) => id + "\u0000" + sd + io, su = k => sideUse.get(k) || 0, addSide = (k, v) => sideUse.set(k, su(k) + v);
  const sideCost = (id, sd, io) => RC[io === "o" ? "out" : "in"][sd] + RC.same * su(sk(id, sd, io)) + RC.mix * su(sk(id, sd, io === "o" ? "i" : "o"));
  /* E の道を探す。返すのは { so: 出る辺, ti: 入る辺, nodes: 出口の点から入口の点までの格子の点 }。
     状態は 点 × 来た向き（n * 4 + d）で、cost・prev は線ごとに使い回す（seen が今の線の番号でない所は、まだ来ていない） */
  const cost = new Float64Array(NN * 4), prev = new Int32Array(NN * 4), seen = new Int32Array(NN * 4);
  let routeNo = 0;
  function route(E){
    const no = ++routeNo, starts = E.e.exit ? [E.e.exit] : [...SIDES];
    // 入口の点から箱へ入る最後の一歩（向き d）の点数は、別に gCost に持つ
    const goals = (E.e.entry ? [E.e.entry] : [...SIDES]).map(sd => { const n = portNode(E.b, sd); return { sd, n, x: ex[n % NX], y: ey[Math.floor(n / NX)], d: (OUT[sd] + 2) % 4, c: sideCost(E.t.id, sd, "i") }; });
    const h = n => { const x = ex[n % NX], y = ey[Math.floor(n / NX)]; let v = Infinity; for (const o of goals) v = Math.min(v, Math.abs(o.x - x) + Math.abs(o.y - y)); return v; };
    const q = minHeap(), gCost = goals.map(() => Infinity), gPrev = goals.map(() => -1);
    const visit = (st, c, from, n) => { if (seen[st] === no && c >= cost[st]) return; seen[st] = no; cost[st] = c; prev[st] = from; q.push(c + h(n), st); };
    starts.forEach(sd => { const n = portNode(E.a, sd); visit(n * 4 + OUT[sd], sideCost(E.s.id, sd, "o"), -1, n); });
    while (q.size()){
      const [k, st] = q.pop();
      if (st < 0){
        const gi = -1 - st; if (k > gCost[gi]) continue;
        const nodes = []; let s0 = gPrev[gi];
        for (let x = s0; x >= 0; x = prev[x]){ nodes.unshift(x >> 2); s0 = x; }
        return { so: SIDES[s0 & 3], ti: goals[gi].sd, nodes };
      }
      const n = st >> 2, d = st & 3, X = n % NX, Y = (n - X) / NX, g = cost[st];
      if (k > g + h(n) + 1e-9) continue;
      /* 点 n を向き nd へ抜けるときの点数。まっすぐ抜けるなら、そこを縦横反対にまっすぐ通る線と交差する。
         折れるなら、そこをまっすぐ通る線の通り道に入る（出る）ので、後で横切ることが多い。半分の交差と数える */
      const turn = RC.bend + RC.cross / 2 * (thru[0][n] + thru[1][n]), at = nd => nd === d ? RC.cross * thru[1 - (nd & 1)][n] : turn;
      for (let gi = 0; gi < goals.length; gi++){
        const o = goals[gi]; if (o.n !== n || d === (o.d + 2) % 4) continue;
        const c = g + o.c + at(o.d);
        if (c < gCost[gi]){ gCost[gi] = c; gPrev[gi] = st; q.push(c, -1 - gi); }
      }
      for (let nd = 0; nd < 4; nd++){
        const x = X + DX[nd], y = Y + DY[nd], m = y * NX + x;
        if (nd === (d + 2) % 4 || x < 0 || x >= NX || y < 0 || y >= NY || boxAt[m]) continue;
        visit(m * 4 + nd, g + Math.abs(ex[x] - ex[X]) + Math.abs(ey[y] - ey[Y]) + RC.share * use[2 * Math.min(n, m) + (nd & 1)] + at(nd), st, m);
      }
    }
    return null;
  }
  // 道 r の通る所を数える（v = 1 で足し、-1 で引く）
  function mark(E, r, v){
    const { nodes } = r, dirs = [OUT[r.so]];
    for (let i = 1; i < nodes.length; i++){ const a = nodes[i - 1], b = nodes[i], d = b - a === 1 ? 0 : b - a === -1 ? 2 : b > a ? 1 : 3; dirs.push(d); use[2 * Math.min(a, b) + (d & 1)] += v; }
    dirs.push((OUT[r.ti] + 2) % 4);
    nodes.forEach((n, i) => { if (dirs[i] === dirs[i + 1]) thru[dirs[i] & 1][n] += v; });
    addSide(sk(E.s.id, r.so, "o"), v); addSide(sk(E.t.id, r.ti, "i"), v);
  }
  // 自分へ戻る線は箱の上の辺を使う
  edges.forEach(E => { if (E.kind === "self"){ addSide(sk(E.s.id, "T", "o"), 1); addSide(sk(E.s.id, "T", "i"), 1); } });
  // 流れを先に、近いものから順に引く。そのあと 1 本ずつ外しては引き直し、ほかの線を見ながら選び直す（交差を減らす）
  const far = E => Math.abs(E.a.c - E.b.c) + Math.abs(E.a.r - E.b.r), rt = new Map();
  const routed = edges.filter(E => E.kind !== "self").sort((x, y) => x.assoc - y.assoc || far(x) - far(y));
  for (let pass = 0; pass < 3; pass++) routed.forEach(E => { if (rt.has(E)) mark(E, rt.get(E), -1); const r = route(E); rt.set(E, r); mark(E, r, 1); });

  /* 道を、出口の辺の上の点から入口の辺の上の点までの縦横の線分に分ける（座標は格子のまま。箱の辺は箱の中央から 0.5）。
     線分は { h: 横か, slot: 通り道（横なら Y、縦なら X）, a1 → a2: 範囲, t1・t2: その端で折れて進む向き（-1/+1。箱の辺で終わるなら 0） }。
     bySlot は通り道（"h" / "v" + slot）ごとの線分 */
  const edgeAt = (p, sd) => sd === "R" ? [2 * p.c + 1.5, 3 * p.r + 1] : sd === "L" ? [2 * p.c + 0.5, 3 * p.r + 1] : sd === "T" ? [2 * p.c + 1, 3 * p.r + 0.5] : [2 * p.c + 1, 3 * p.r + 1.5];
  const bySlot = new Map();
  routed.forEach(E => {
    const r = rt.get(E); E.so = r.so; E.ti = r.ti;
    const raw = [edgeAt(E.a, r.so), ...r.nodes.map(n => [n % NX, Math.floor(n / NX)]), edgeAt(E.b, r.ti)];
    const P = raw.filter((p, i) => i === 0 || i === raw.length - 1 || !((raw[i - 1][0] === p[0] && p[0] === raw[i + 1][0]) || (raw[i - 1][1] === p[1] && p[1] === raw[i + 1][1])));
    E.segs = P.slice(1).map((q, i) => {
      const p = P[i], h = p[1] === q[1], o = h ? 1 : 0;
      const S = { E, i, h, slot: p[o], a1: p[1 - o], a2: q[1 - o], t1: i ? Math.sign(P[i - 1][o] - p[o]) : 0, t2: i + 2 < P.length ? Math.sign(P[i + 2][o] - q[o]) : 0 };
      const k = (h ? "h" : "v") + S.slot; if (!bySlot.has(k)) bySlot.set(k, []); bySlot.get(k).push(S);
      return S;
    });
  });
  const extent = (S, v1, v2) => Object.assign(S, v1 <= v2 ? { lo: v1, hi: v2, tl: S.t1, th: S.t2 } : { lo: v2, hi: v1, tl: S.t2, th: S.t1 });
  /* 横の線分の高さ。行の中央を通る線分（ステップの左右の辺に出入りする）は中央から上下へ、
     レーン上下端の通り道は端から内へずらす（本数が多いときは間隔を詰め、箱にかからないようにする） */
  bySlot.forEach((list, k) => {
    if (k[0] !== "h") return;
    const Y = +k.slice(1), r = Math.floor(Y / 3);
    list.forEach(S => extent(S, S.a1, S.a2));
    arrange(list, 1e-6).forEach(g => {
      if (Y % 3 === 1){ spread(g, 14, G.nodeH / 2 - 12); g.forEach(S => { S.y = rowY[r] + G.nodeH / 2 + S.off; }); return; }
      const st = g[0].m > 1 ? Math.min(G.chan, 18 / (g[0].m - 1)) : 0;
      g.forEach(S => { S.y = Y % 3 ? bandY[r + 1] - 9 - (S.m - 1 - S.lv) * st : bandY[r] + 9 + S.lv * st; });
    });
  });
  /* 縦の線分の位置。範囲は両端の横の線分の高さ（箱の辺で終わる端は箱の上下）で測る。
     列の中央を通る線分（ステップの上下の辺に出入りする）は中央から左右へずらし、列のすき間では段の数に合わせてすき間を広げる。
     gapW：すき間 g（列 g と g + 1 の間。-1 はレーン名の右）の幅。zone：すき間の左に取っておく、右へ出る線の条件ラベルの置き場所 */
  const endY = (S, k) => {
    const { E } = S, j = S.i + (k ? 1 : -1);
    if (j >= 0 && j < E.segs.length) return E.segs[j].y;
    const [st, p, sd] = k ? [E.t, E.b, E.ti] : [E.s, E.a, E.so]; return sd === "T" ? topY(st, p) : p.y + p.h;
  };
  const zone = new Map(), gapW = new Map();
  routed.forEach(E => { if (E.label && E.so === "R") zone.set(E.a.c, Math.max(zone.get(E.a.c) || 0, E.label.w + 10)); });
  for (let g = -1; g <= maxCol; g++){ const z = zone.get(g) || 0; gapW.set(g, Math.max(g < 0 ? G.pad : G.gap, z ? z + 14 : 0)); }
  bySlot.forEach((list, k) => {
    if (k[0] !== "v") return;
    const X = +k.slice(1);
    list.forEach(S => extent(S, endY(S, 0), endY(S, 1)));
    const groups = arrange(list, 0.5);
    if (X % 2){ groups.forEach(g => spread(g, 18, G.nodeW / 2 - 22)); return; }
    const g0 = X / 2 - 1, z = zone.get(g0) || 0, w = Math.max(gapW.get(g0), z + 10 + (Math.max(...groups.map(g => g[0].m)) - 1) * G.track + 12);
    gapW.set(g0, w);
    groups.forEach(g => g.forEach(S => { S.off = z ? z + 10 + S.lv * G.track : (w + (extra?.get(g0) || 0)) / 2 + (S.lv - (S.m - 1) / 2) * G.track; }));
  });
  if (extra) gapW.forEach((w, g) => gapW.set(g, w + (extra.get(g) || 0)));
  const colX = [G.label + gapW.get(-1)];
  for (let c = 1; c <= maxCol; c++) colX[c] = colX[c - 1] + G.nodeW + gapW.get(c - 1);
  pos.forEach(p => { p.x = colX[p.c]; });
  const gapX = g => g < 0 ? G.label : colX[g] + G.nodeW;
  bySlot.forEach((list, k) => { if (k[0] === "v"){ const X = +k.slice(1); list.forEach(S => { S.x = X % 2 ? colX[(X - 1) / 2] + G.nodeW / 2 + S.off : gapX(X / 2 - 1) + S.off; }); } });
  // 右端の列の右を通る線があれば、そのすき間の分だけ図を広げる
  const width = colX[maxCol] + G.nodeW + (bySlot.has("v" + (NX - 1)) ? gapW.get(maxCol) : G.pad);

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

  // points：縦横の線分の交わる所を角にする。出口・入口は、線分のずれをそのまま辺の中央からのずれにする
  edges.forEach(E => {
    const { a, b, s, t } = E;
    let pts;
    if (E.kind === "self"){
      // 箱の上側で小さくループさせ、右の出口とは重ねない
      E.so = E.ti = "T";
      const S = portAt(s, a, "T", 30), T = portAt(s, a, "T", -30), y = a.y - 22;
      pts = [S, [S[0], y], [T[0], y], T];
    } else {
      const sg = E.segs, l = sg[sg.length - 1];
      pts = [portAt(s, a, E.so, sg[0].off)];
      for (let i = 0; i + 1 < sg.length; i++){ const [h, v] = sg[i].h ? [sg[i], sg[i + 1]] : [sg[i + 1], sg[i]]; pts.push([v.x, h.y]); }
      // 入口の位置の指定が、同じ線分の出口の位置の指定と食い違うときは、入口の手前で小さく折って合わせる
      const want = E.e.entry && E.e.entryAt != null ? atOff(t, E.ti, E.e.entryAt) : l.off, T = portAt(t, b, E.ti, want);
      if (want !== l.off){ const d = OUT[E.ti]; if (l.h){ const x = T[0] + DX[d] * 12; pts.push([x, l.y], [x, T[1]]); } else { const y = T[1] + DY[d] * 12; pts.push([l.x, y], [T[0], y]); } }
      pts.push(T);
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
/* 位置を覚える（編集のたびに app.js の commit から呼ぶ）。prev は編集の前の図のステップの置き場所（layout の pos）。
   位置（col）を持たないステップのうち、編集の前の図にあったものにはその列と、段（編集で段だけ決めていなければ）を書く
   （つなぎ方を変えても動かない。初めて編集するフローも、ここで今の配置を覚える）。
   そのうえで配置し直し、足したステップの位置・列の差し込み・空いた列の詰めを、すべてのステップの col・row に書く */
function keepPlaces(f, prev){
  if (prev) f.steps.forEach(s => { const p = !s.col && prev.get(s.id); if (p){ s.col = p.c + 1; s.row ??= p.t + 1; } });
  const { pos } = layout(f, null, true);
  f.steps.forEach(s => { const p = pos.get(s.id); if (p){ s.col = p.c + 1; s.row = p.t + 1; } });
}
/* AsIs（A）と ToBe（B）の図で、列どうしの対応 [A の列, B の列] の並び。match(A のステップ ID) は B で対応するステップの ID の並び。
   A の列ごとに、対応するステップがいちばん多く置かれた B の列を選び、どちらの列も左から右へ増えていく組をなるべく多く残す */
function colPairs(A, B, match){
  const votes = new Map();
  A.pos.forEach((p, id) => match(id).forEach(t => { const q = B.pos.get(t); if (!q) return; const v = votes.get(p.c) || new Map(); v.set(q.c, (v.get(q.c) || 0) + 1); votes.set(p.c, v); }));
  const cand = [...votes].map(([a, v]) => [a, [...v].sort((x, y) => y[1] - x[1] || x[0] - y[0])[0][0]]).sort((x, y) => x[0] - y[0]);
  // 最長増加部分列（列の数は多くないので O(n²)）
  const len = cand.map(() => 1), prev = cand.map(() => -1);
  cand.forEach(([, b], i) => { for (let j = 0; j < i; j++) if (cand[j][1] < b && len[j] + 1 > len[i]){ len[i] = len[j] + 1; prev[i] = j; } });
  const out = []; for (let i = len.indexOf(Math.max(0, ...len)); i >= 0; i = prev[i]) out.unshift(cand[i]);
  return out;
}
/* 上下に並べた A と B で、対応する列（pairs）が同じ横の位置に来るよう、遅れているほうの列の左のすき間を広げる幅。[A の extra, B の extra]（layout の extra） */
function alignGaps(A, B, pairs){
  const ea = new Map(), eb = new Map(); let da = 0, db = 0;
  pairs.forEach(([a, b]) => {
    const xa = A.colX[a] + da, xb = B.colX[b] + db;
    if (xa < xb){ ea.set(a - 1, (ea.get(a - 1) || 0) + xb - xa); da += xb - xa; }
    else if (xb < xa){ eb.set(b - 1, (eb.get(b - 1) || 0) + xa - xb); db += xa - xb; }
  });
  return [ea, eb];
}
/* ToBe（B）の図に描く、削除したステップの跡。A は比較元（AsIs の写し）の図、ids は削除したステップの ID。
   A で置いていた列に対応する B の列（pairs）の、同じ担当・同じ段のマスが空いていれば、そこに置く { id, step, x, y }（空いていなければ描かない） */
function ghostSpots(A, B, pairs, ids){
  const colOf = new Map(pairs);
  return ids.flatMap(id => {
    const p = A.pos.get(id), st = A.steps.find(s => s.id === id), c = p && colOf.get(p.c); if (c == null) return [];
    const l = B.lanes.findIndex(x => x.id === A.lanes[p.l].id && !x.ghost), g = B.rows.findIndex(w => w.r === l && w.t === p.t);
    if (l < 0 || g < 0 || [...B.pos.values()].some(q => q.l === l && q.t === p.t && q.c === c)) return [];
    return [{ id, step: st, x: B.colX[c], y: B.rowY[g] }];
  });
}
// 位置（col・row）を使わずに、矢印だけから決めた配置（「配置を整える」で並べ直す先）。ステップの置き場所だけを返す
function autoLayout(f){
  const L = layout({ ...f, steps: f.steps.map(({ col, row, ...s }) => s) }, null, true);
  // 位置を覚えた図と比べられるよう、空の列を詰めておく
  const at = new Map([...new Set([...L.pos.values()].map(p => p.c))].sort((a, b) => a - b).map((c, i) => [c, i]));
  L.pos.forEach(p => { p.c = at.get(p.c); });
  return L;
}
/* 左の列へ戻る流れの矢印のうち、ループ（つなぎ先から流れをたどって元のステップへ戻れる。差戻し・再提出など）でないもの。
   位置を覚えた図でつなぎ直したあとに残りやすく、「配置を整える」で並べ直す目安にする。L は layout の結果 */
function backLinks(L){
  const by = new Map(L.steps.map(s => [s.id, s]));
  const reach = (a, b) => { const seen = new Set([a]), q = [a]; while (q.length){ const x = q.shift(); if (x === b) return true; (by.get(x)?.next || []).forEach(e => { if (!seen.has(e.to) && by.has(e.to)){ seen.add(e.to); q.push(e.to); } }); } return false; };
  return L.edges.filter(E => !E.assoc && E.kind !== "self" && E.b.c < E.a.c && !reach(E.t.id, E.s.id));
}
// 点数（k）の小さい順に取り出す
function minHeap(){
  const a = [];
  return {
    size: () => a.length,
    push(k, v){ a.push([k, v]); for (let i = a.length - 1; i;){ const j = (i - 1) >> 1; if (a[j][0] <= a[i][0]) break; [a[i], a[j]] = [a[j], a[i]]; i = j; } },
    pop(){
      const top = a[0], last = a.pop();
      if (a.length){ a[0] = last; for (let i = 0;;){ const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[i], a[m]] = [a[m], a[i]]; i = m; } }
      return top;
    }
  };
}
/* 同じ通り道を通る線分（lo〜hi の範囲と、その両端で折れて進む向き tl・th を持つ）を並べる。範囲が重なる（端が触れるだけのものも含む）
   線分どうしは別の段（lv）にし、並び順は、端で折れて出る線がほかの線分を横切る数がいちばん少ないものにする（並び順の後ろほど座標の大きい側）。
   重なりでつながる線分のまとまりごとに、並び順の配列を返す（m はそのまとまりの段の数） */
function arrange(list, eps){
  const over = (p, q) => p.lo <= q.hi + eps && q.lo <= p.hi + eps;
  const inside = (v, S) => v > S.lo + eps && v < S.hi - eps, at = (v, w) => Math.abs(v - w) <= eps;
  // P が手前（座標の小さい側）、Q が後ろのときに横切る数。同じ所で反対へ折れる 2 本も 1 回と数える
  const hit = (v, Q) => inside(v, Q) || (at(v, Q.lo) && Q.tl < 0) || (at(v, Q.hi) && Q.th < 0);
  const cross = (P, Q) => (P.tl > 0 && hit(P.lo, Q)) + (P.th > 0 && hit(P.hi, Q)) + (Q.tl < 0 && inside(Q.lo, P)) + (Q.th < 0 && inside(Q.hi, P));
  const groups = []; let hi = -Infinity;
  [...list].sort((p, q) => p.lo - q.lo || p.hi - q.hi).forEach(S => { if (!groups.length || S.lo > hi + eps) groups.push([]); groups[groups.length - 1].push(S); hi = Math.max(hi, S.hi); });
  return groups.map(g => {
    // 両端とも小さい側へ折れる線分を手前に、大きい側へ折れる線分を後ろに置いた並びから探し始める
    const ord = bestOrder(g.sort((p, q) => (p.tl + p.th) - (q.tl + q.th) || p.lo - q.lo), cross);
    ord.forEach((S, i) => { S.lv = 0; for (let j = 0; j < i; j++) if (over(ord[j], S)) S.lv = Math.max(S.lv, ord[j].lv + 1); });
    const m = Math.max(...ord.map(S => S.lv)) + 1; ord.forEach(S => { S.m = m; });
    return ord;
  });
}
// list の並べ替えのうち、組ごとの cross(手前, 後ろ) の合計がいちばん小さいもの（同点なら元の順に近いもの）。7 本までは全部試し、多いときは隣どうしの入れ替えで改善する
function bestOrder(list, cross){
  const n = list.length; if (n < 2) return list;
  // 組ごとの数は先に表にしておき、並びは list の番号で試す
  const M = list.map(P => list.map(Q => P === Q ? 0 : cross(P, Q)));
  const cost = o => { let c = 0; for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) c += M[o[i]][o[j]]; return c; };
  let best = list.map((_, i) => i), bc = cost(best);
  if (n <= 7){
    const perm = (pre, rest) => { if (!bc) return; if (!rest.length){ const c = cost(pre); if (c < bc){ bc = c; best = pre; } return; } rest.forEach((t, i) => perm([...pre, t], rest.filter((_, k) => k !== i))); };
    perm([], best);
  } else {
    let moved = true;
    while (moved){ moved = false; for (let i = 0; i + 1 < n; i++){ const o = best.slice(); [o[i], o[i + 1]] = [o[i + 1], o[i]]; const c = cost(o); if (c < bc){ bc = c; best = o; moved = true; } } }
  }
  return best.map(i => list[i]);
}
// 線分 S が、辺の中の位置を指定した出口・入口（exitAt・entryAt）で終わるなら、その辺の中央からのずれ。出口の指定を先に見る
function fixedOff(S){
  const { E } = S;
  if (S.i === 0 && E.e.exit && E.e.exitAt != null) return atOff(E.s, E.so, E.e.exitAt);
  if (S.i === E.segs.length - 1 && E.e.entry && E.e.entryAt != null) return atOff(E.t, E.ti, E.e.entryAt);
  return null;
}
/* まとまり g（並び順）の線分に、通り道の中央からのずれ off を振る。段の間隔は max まで、全体で中央から ±lim に収める。
   辺の中の位置を指定した端のある線分はその位置に置き、ほかの線分は残りの枠に並び順で置く（そのときは 1 本ずつ別の枠にする） */
function spread(g, max, lim){
  const fx = g.map(fixedOff);
  if (fx.every(v => v == null)){ const m = g[0].m, st = m > 1 ? Math.min(max, 2 * lim / (m - 1)) : 0; g.forEach(S => { S.off = (S.lv - (m - 1) / 2) * st; }); return; }
  const n = g.length, st = n > 1 ? Math.min(max, 2 * lim / (n - 1)) : 0, slots = g.map((_, i) => (i - (n - 1) / 2) * st);
  g.forEach((S, i) => { if (fx[i] == null) return; S.off = fx[i]; let j = 0; slots.forEach((v, k) => { if (Math.abs(v - S.off) < Math.abs(slots[j] - S.off)) j = k; }); slots.splice(j, 1); });
  g.forEach((S, i) => { if (fx[i] == null) S.off = slots.shift(); });
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

Object.assign(globalThis.Flowbook ??= {}, { G, LB, CO, DB_RY, textW, edgeLabel, labelCut, linkedIds, layout, keepPlaces, autoLayout, backLinks, colPairs, alignGaps, ghostSpots, calloutPlan, topY, portSpan, atOff, offAt, portAt, placeLabel, wrapText, wrapLabel });
})();

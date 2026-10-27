(() => {
"use strict";
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const {
  TEMPLATES,
  TYPES, TOOL_NAME, hasTool, COLORS, colorable, SIDES, sideIn, sideOut, normNext, isArtifact, artifactLinks, toArtifact, normalize, toYaml, parseYaml, uid,
  validate,
  G, LB, CO, DB_RY, textW, edgeLabel, labelCut, linkedIds, layout, calloutPlan, topY, portAt, placeLabel, wrapText, wrapLabel
} = Flowbook; // js/core/ の各ファイルで定義
// 共有の状態（js/state.js）。読むのは S.〇〇、変えるのは下の関数だけ（S.〇〇 = … はエラーになる）
const {
  state: S,
  setStore, setDir, setHistDir, setLastDir, setPendingCreate, setFirstRecords, setConflictId, setBroken, setScanning,
  setCurrentId, setFlow, setYamlSrc, setIssues, setSelected, setSelEdge,
  setDirty, setSaving, setAgain, setSaveTimer, setZoom, setTab, setLastL, setShowIssues, setShowInfo,
  setRecord, forgetRecord, clearRecords, setFileMeta, forgetFileMeta, clearFileMeta, markUnexported, markExported, clearUnexported,
  pushUndo, resetUndo, takeUndo
} = Flowbook;
const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
// 作業フォルダの参照（中身は含まない）だけを IndexedDB に置く。使えない環境では何もしない
function idb(mode, fn){
  return new Promise(res => {
    try {
      const rq = indexedDB.open("flowbook", 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore("handles");
      rq.onerror = () => res(null);
      rq.onsuccess = () => {
        const d = rq.result;
        try { const tx = d.transaction("handles", mode), r = fn(tx.objectStore("handles")); tx.oncomplete = () => { d.close(); res(r.result ?? null); }; tx.onerror = tx.onabort = () => { d.close(); res(null); }; }
        catch { d.close(); res(null); }
      };
    } catch { res(null); }
  });
}
const idbGet = k => idb("readonly", s => s.get(k));
const idbSet = (k, v) => idb("readwrite", s => s.put(v, k));

/* ---------- render ---------- */
// 配置の計算（layout など）は js/core/layout.js
const CUT_TIP = "長いため図では省略されます（全文は矢印のラベルにマウスを乗せると表示）";
const markCut = el => { const c = labelCut(el.value); el.classList.toggle("cut", c); el.title = c ? CUT_TIP : ""; };
// 図に描く配置。「課題を表示」中（issues）は、吹き出しなしでいったん配置して吹き出しの置き方を決め、その分レーンを広げて配置し直す
function diagramLayout(f, issues = S.showIssues){
  const L = layout(f);
  return issues && f.steps.some(s => s.issue && s.issue.trim()) ? layout(f, calloutPlan(L)) : L;
}
// 折れ線の角を少し丸める。曲がり角と、線どうしがつながって見える所とを見分けやすくする
function pathD(pts, r = 5){
  const f = v => Math.round(v * 100) / 100;
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 1; i < pts.length - 1; i++){
    const [px, py] = pts[i - 1], [x, y] = pts[i], [nx, ny] = pts[i + 1];
    const l1 = Math.hypot(x - px, y - py), l2 = Math.hypot(nx - x, ny - y), k = Math.min(r, l1 / 2, l2 / 2);
    d += ` L${f(x - (x - px) / l1 * k)} ${f(y - (y - py) / l1 * k)} Q${f(x)} ${f(y)} ${f(x + (nx - x) / l2 * k)} ${f(y + (ny - y) / l2 * k)}`;
  }
  const [lx, ly] = pts[pts.length - 1];
  return d + ` L${f(lx)} ${f(ly)}`;
}
/* ステップの図形。開始・終了のほかは塗らず（color を選んだときだけその色で塗る）、線は同じ色にそろえる */
const fillOf = color => color && COLORS[color] ? `var(--c-${color})` : "var(--surface)";
function shapeSvg(type, x, y, w, h, color){
  const cls = 'class="shape"', fill = fillOf(color), line = 'stroke="var(--ink)" stroke-width="1.3"';
  switch (type){
    case "start": return `<rect ${cls} x="${x}" y="${y + 6}" width="${w}" height="${h - 12}" rx="${(h - 12) / 2}" fill="var(--accent)" stroke="var(--accent)"/>`;
    case "end": return `<rect ${cls} x="${x}" y="${y + 6}" width="${w}" height="${h - 12}" rx="${(h - 12) / 2}" fill="var(--ink)" stroke="var(--ink)"/>`;
    case "decision": { const cx = x + w / 2, cy = y + h / 2; return `<path ${cls} d="M${cx} ${y - 6} L${x + w + 4} ${cy} L${cx} ${y + h + 6} L${x - 4} ${cy}Z" fill="${fill}" ${line}/>`; }
    // サブプロセス：作業の角丸の四角の下の中央に「＋」の小さな四角（BPMN のたたまれたサブプロセス）
    case "subProcess": { const mx = x + w / 2 - 5, my = y + h - 14; return `<rect ${cls} x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${fill}" ${line}/><rect x="${mx}" y="${my}" width="10" height="10" fill="none" stroke="var(--ink)" stroke-width="1"/><path d="M${mx + 5} ${my + 2}v6M${mx + 2} ${my + 5}h6" stroke="var(--ink)" stroke-width="1"/>`; }
    case "document": return `<path ${cls} d="M${x} ${y}h${w}v${h - 8}q${-w / 4} 14 ${-w / 2} 0t${-w / 2} 0Z" fill="${fill}" ${line}/>`;
    // データ：右上の角を折った紙（BPMN の Data Object）
    case "dataObject": { const k = 14; return `<path ${cls} d="M${x} ${y}h${w - k}l${k} ${k}v${h - k}h${-w}Z" fill="${fill}" ${line}/><path d="M${x + w - k} ${y}v${k}h${k}" fill="none" stroke="var(--ink)" stroke-width="1.1"/>`; }
    // データストア：データベースの円柱。上の楕円の手前側の弧を重ねて立体に見せる
    case "dataStore": { const rx = w / 2, ry = DB_RY; return `<path ${cls} d="M${x} ${y + ry}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}Z" fill="${fill}" ${line}/><path d="M${x} ${y + ry}A${rx} ${ry} 0 0 0 ${x + w} ${y + ry}" fill="none" stroke="var(--ink)" stroke-width="1.1"/>`; }
    default: return `<rect ${cls} x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${fill}" ${line}/>`;
  }
}
// 矢印の条件ラベル（E.lp を中心に、枠の色 c）
function labelSvg(E, c){
  const { lines, w, h } = E.label, [x, y] = E.lp;
  let g = `<rect x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" rx="${Math.min(10, h / 2)}" fill="var(--surface)" stroke="${c}"/>`;
  lines.forEach((ln, k) => { g += `<text x="${x}" y="${y - (lines.length - 1) * LB.lineH / 2 + k * LB.lineH + 1}" text-anchor="middle" dominant-baseline="middle" font-size="${LB.font}" fill="var(--ink)">${esc(ln)}</text>`; });
  return g;
}
// レーン名の列（x は 0〜G.label）。ui なら、ドラッグ中に移動先のレーンを示す枠（ふだんは隠しておく）も描く
function laneHeadSvg(L, W, H, ui){
  let h = "";
  L.lanes.forEach((l, i) => {
    const y = L.laneY[i], lh = L.laneY[i + 1] - y;
    h += `<rect x="0" y="${y}" width="${G.label}" height="${lh}" fill="var(--lane-head)"/>`;
    const lines = wrapLabel(l.name, 6, 3), ly = y + lh / 2 - (lines.length - 1) * 9;
    lines.forEach((t, k) => { h += `<text x="${G.label / 2}" y="${ly + k * 18}" text-anchor="middle" dominant-baseline="middle" font-size="13" font-weight="600" fill="${l.ghost ? "var(--bad)" : "var(--ink)"}">${esc(t)}</text>`; });
    if (i) h += `<line x1="0" x2="${W}" y1="${y}" y2="${y}" stroke="var(--line-strong)"/>`;
  });
  if (ui) h += `<rect class="lane-hi" x="1" y="0" width="${G.label - 2}" height="${G.laneH}" visibility="hidden"/>`;
  return h + `<line x1="${G.label}" x2="${G.label}" y1="0" y2="${H}" stroke="var(--line-strong)"/>`;
}
/* 矢印の指し方 { sid, k, rel }：流れは sid の next の k 番目、関連（点線）は related の k 番目で rel が true。
   図の data-k は、関連なら "r" + k（流れの k と区別する） */
const edgeKey = E => (E.assoc ? "r" : "") + E.k;
const refOf = (sid, key) => ({ sid, k: parseInt(String(key).replace(/^r/, ""), 10), ...(String(key)[0] === "r" ? { rel: true } : {}) });
const isRef = (E, ref) => !!ref && E.s.id === ref.sid && E.k === ref.k && E.assoc === !!ref.rel;
// ref の線のつなぎ先の id。もうない線なら undefined
const refTo = ref => { const s = ref && S.flow?.steps.find(x => x.id === ref.sid); return s && (ref.rel ? s.related?.[ref.k] : s.next[ref.k]?.to); };
// 折れ線 pts の、端から長さの割合 r の点
function alongPts(pts, r){
  const seg = pts.slice(1).map((q, i) => Math.hypot(q[0] - pts[i][0], q[1] - pts[i][1]));
  let d = seg.reduce((a, b) => a + b, 0) * r;
  for (let i = 0; i < seg.length; i++){
    if (d <= seg[i] || i === seg.length - 1){ const t = seg[i] ? Math.min(1, d / seg[i]) : 0, [a, b] = [pts[i], pts[i + 1]]; return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; }
    d -= seg[i];
  }
  return pts[0];
}
// 矢印の＋を置く点：真ん中から順に、条件ラベルと重ならない所を探す（どこも重なれば真ん中）
function edgePlusAt(E){
  const off = ([x, y]) => !E.label || Math.abs(x - E.lp[0]) > E.label.w / 2 + 12 || Math.abs(y - E.lp[1]) > E.label.h / 2 + 12;
  for (const r of [0.5, 0.35, 0.65, 0.25, 0.75]){ const q = alongPts(E.pts, r); if (off(q)) return q; }
  return alongPts(E.pts, 0.5);
}
// 関連の線の見た目：点線と、塗らない矢じり（BPMN の関連にならう）
const ASSOC_DASH = 'stroke-dasharray="2 3"';
/* 図の本体（レーンの帯・矢印・ステップ・条件ラベル・課題の吹き出し）。座標は配置 L のまま（帯は x = 0〜W に描く）。
   o.ui = { selected, selEdge, issueBy } なら画面用：選択と強調・矢印の当たり判定・チェックの丸・補足と課題のしるし・
   全文の吹き出し・＋ハンドルを足す。o.ui がなければ画像用：操作のための部品は出さず、CSS のクラスで付けている色は属性で書く。
   o.edgeFilter(E) が false の矢印は描かない */
function diagramBodySvg(f, L, W, H, o){
  const ui = o.ui, coBy = new Map(L.callouts.map(c => [c.id, c]));
  const marker = (id, c, o = 1) => `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 1 9 5 0 9z" fill="var(${c})" fill-opacity="${o}"/></marker>`;
  // 関連の線の矢じり（塗らない「く」の字）
  const open = (id, c, o = 1) => `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M1 1.5 9 5 1 8.5" fill="none" stroke="var(${c})" stroke-opacity="${o}" stroke-width="1.5"/></marker>`;
  let s = `<defs>${marker("arr", "--muted")}${open("oar", "--muted")}${ui ? marker("arrS", "--sel") + marker("arrH", "--sel", 0.6) + open("oarS", "--sel") + open("oarH", "--sel", 0.6) : ""}</defs>`;
  L.lanes.forEach((l, i) => {
    const y = L.laneY[i], lh = L.laneY[i + 1] - y;
    s += `<rect x="0" y="${y}" width="${W}" height="${lh}" fill="${i % 2 ? "var(--lane-b)" : "var(--lane-a)"}"/>`;
    if (i) s += `<line x1="0" x2="${W}" y1="${y}" y2="${y}" stroke="var(--line-strong)"/>`;
  });
  // ドラッグ中に移動先のレーンを示す枠（ふだんは隠しておく）
  if (ui) s += `<rect class="lane-hi" x="${G.label}" y="0" width="${W - G.label}" height="${G.laneH}" visibility="hidden"/>`;
  const selected = ui ? ui.selected : null, selEdge = ui ? ui.selEdge : null;
  // 選択中のステップに出入りする矢印（矢印を選んだときはその矢印）は強調して最前面に
  const isSelEdge = E => isRef(E, selEdge);
  const hot = E => selEdge ? isSelEdge(E) : !!selected && (E.s.id === selected || E.t.id === selected);
  const shown = o.edgeFilter ? L.edges.filter(o.edgeFilter) : L.edges;
  const edges = [...shown.filter(E => !hot(E)), ...shown.filter(hot)];
  edges.forEach(E => {
    const h = hot(E), c = h ? "var(--sel)" : "var(--muted)";
    const m = (E.assoc ? "oar" : "arr") + (h ? "S" : "");
    s += `<path class="edge${E.assoc ? " assoc" : ""}${h ? " hot" : ""}${isSelEdge(E) ? " sel-edge" : ""}" data-s="${esc(E.s.id)}" data-t="${esc(E.t.id)}" data-k="${edgeKey(E)}" d="${pathD(E.pts)}" fill="none" stroke="${c}" stroke-width="${h ? 2.2 : 1.4}" ${E.assoc ? ASSOC_DASH : ""} marker-end="url(#${m})"/>`;
  });
  // 細い矢印でもダブルクリックしやすいよう、透明の太い線を重ねる（data-k は edgeKey）
  if (ui) edges.forEach(E => {
    const tip = E.assoc ? "関連（点線）\nクリックで選び、端のドラッグでつなぎ替え" : (E.label ? `条件「${E.label.t}」\nダブルクリックで条件を編集` : "ダブルクリックで条件を追加") + "\nクリックで選ぶと、＋で間にステップを入れられる";
    s += `<path class="ehit" data-edge="${esc(E.s.id)}" data-k="${edgeKey(E)}" d="${pathD(E.pts)}"><title>${esc(tip)}</title></path>`;
  });
  L.steps.forEach(st => {
    const p = L.pos.get(st.id), sel = st.id === selected;
    const onDark = st.type === "start" || st.type === "end";
    s += ui ? `<g class="node" data-step="${esc(st.id)}" tabindex="0" role="button" aria-label="${esc(TYPES[st.type] + "：" + (st.label || st.id) + (st.issue ? "（課題あり）" : ""))}">` : "<g>";
    if (sel) s += `<rect x="${p.x - 8}" y="${p.y - 12}" width="${p.w + 16}" height="${p.h + 24}" rx="10" fill="none" stroke="var(--sel)" stroke-width="2.5"/>`;
    s += shapeSvg(st.type, p.x, p.y, p.w, p.h, colorable(st) ? st.color : "");
    // 「ツール・手段を表示」中（o.info）は、使用システム・ツール・手段を内容の下に小さく 1 行出す（内容は 2 行まで）。判断・開始・終了は狭いので出さない
    const sub = o.info && !/^(decision|start|end)$/.test(st.type) ? (st.tool || "").trim().replace(/\s*\n\s*/g, "・") : "";
    const sp = st.type === "subProcess", per = st.type === "decision" ? 7 : 9;
    const lines = wrapLabel(st.label || "（未記入）", per, st.type === "decision" ? 2 : sp ? (sub ? 1 : 2) : sub ? 2 : 3);
    // 帳票は下の波に、サブプロセスは下の「＋」に、1 行足すときはさらに上げて重ならないようにする
    const ty = p.y + p.h / 2 - (lines.length - 1) * 8 - (st.type === "document" ? (sub ? 7 : 3) : 0) - (sp ? 6 : 0) + (st.type === "dataStore" ? 4 : 0) - (sub ? 7 : 0);
    if (sub) s += `<text class="sub" x="${p.x + p.w / 2}" y="${ty + (lines.length - 1) * 16 + 15}" text-anchor="middle" dominant-baseline="middle" font-size="10" fill="var(--muted)">${esc(wrapLabel(sub, 12, 1)[0])}</text>`;
    lines.forEach((t, k) => { s += `<text x="${p.x + p.w / 2}" y="${ty + k * 16}" text-anchor="middle" dominant-baseline="middle" font-size="12.5" font-weight="500" fill="${onDark ? (st.type === "start" ? "var(--accent-ink)" : "var(--paper)") : (st.label ? "var(--ink)" : "var(--muted)")}">${esc(t)}</text>`; });
    if (ui) s += `<text x="${p.x + 2}" y="${p.y - 4 - (st.type === "decision" ? 6 : 0)}" font-size="10" font-family="IBM Plex Mono, monospace" fill="var(--muted)">${esc(st.id)}</text>`;
    if (ui){
      // 右上のしるし：課題（赤い角丸の四角に「!」）を一番右に、補足（メモ）はその左に並べる。
      // 課題を吹き出しで出している間は、しるしが二重にならないよう課題のしるしは出さない（補足を右端へ詰める）
      const by = p.y + (onDark ? 8 : -3); // 上辺にまたがせ、3行の文言とも重ならない高さ
      let bx = p.x + p.w - 4;
      if (st.issue && !coBy.has(st.id)){ s += `<rect x="${bx - 8}" y="${by - 8}" width="16" height="16" rx="4" fill="var(--bad)" stroke="var(--surface)" stroke-width="1.5"/><path d="M${bx} ${by - 4.2}v5" stroke="var(--surface)" stroke-width="2" stroke-linecap="round"/><circle cx="${bx}" cy="${by + 4}" r="1.2" fill="var(--surface)"/>`; bx -= 20; }
      // 補足は課題と同じ大きさの角丸の四角。白地に灰色の枠とメモの線で、赤い課題より目立たないようにする
      if (st.note) s += `<rect x="${bx - 8}" y="${by - 8}" width="16" height="16" rx="4" fill="var(--surface)" stroke="var(--muted)" stroke-width="1.3"/><path d="M${bx - 4} ${by - 3.5}h8M${bx - 4} ${by}h8M${bx - 4} ${by + 3.5}h5" stroke="var(--muted)" stroke-width="1.4" stroke-linecap="round"/>`;
      const lv = ui.issueBy.get(st.id);
      if (lv === "bad" || lv === "warn") s += `<circle cx="${p.x + 4}" cy="${p.y + (onDark ? 8 : 2)}" r="5" fill="var(--${lv})" stroke="var(--surface)" stroke-width="1.5"/>`;
    }
    s += `</g>`;
  });
  // 条件ラベルは箱より手前に描き、隠れないようにする
  edges.forEach(E => {
    if (!E.label) return;
    s += ui ? `<g class="elabel" data-edge="${esc(E.s.id)}" data-k="${edgeKey(E)}"><title>${esc(E.label.t + "\nダブルクリックで条件を編集")}</title>` : "<g>";
    s += labelSvg(E, hot(E) ? "var(--sel)" : "var(--line-strong)") + `</g>`;
  });
  // 課題の吹き出し。ステップとは短い線でつなぐ。文を省いたものは、マウスを乗せる・選ぶと全文の吹き出しを一番手前に重ねる（co-pop）
  const coBody = (c, y, h, lines) => {
    const ix = c.x + CO.padX, iy = y + CO.padY + CO.lineH / 2 - 7;
    let g = `<rect class="co-box" x="${c.x}" y="${y}" width="${c.w}" height="${h}" rx="7"${ui ? "" : ' fill="var(--issue-bg)" stroke="var(--issue-line)"'}/>`;
    g += `<rect x="${ix}" y="${iy}" width="14" height="14" rx="3" fill="var(--bad)"/><path d="M${ix + 7} ${iy + 3.2}v4.6" stroke="var(--surface)" stroke-width="2" stroke-linecap="round"/><circle cx="${ix + 7}" cy="${iy + 10.8}" r="1.1" fill="var(--surface)"/>`;
    lines.forEach((t, k) => { g += `<text x="${ix + CO.icon}" y="${y + CO.padY + CO.lineH / 2 + k * CO.lineH}" dominant-baseline="middle" font-size="${CO.font}" fill="var(--ink)">${esc(t)}</text>`; });
    return g;
  };
  L.callouts.forEach(c => {
    s += `<g class="callout" data-co="${esc(c.id)}" aria-hidden="true"><path class="co-stem" d="M${c.ax} ${c.ay}V${c.stemY}"${ui ? "" : ' fill="none" stroke="var(--bad)" stroke-width="1.6"'}/><circle cx="${c.ax}" cy="${c.ay}" r="2.6" fill="var(--bad)"/>${coBody(c, c.y, c.h, c.lines)}</g>`;
  });
  if (!ui) return s;
  let pops = "";
  L.callouts.filter(c => c.cut).forEach(c => {
    const y = c.side === "T" ? c.y + c.h - c.fullH : Math.min(c.y, H - 2 - c.fullH);
    pops += `<g class="co-pop${c.id === selected ? " sel" : ""}" data-co="${esc(c.id)}" aria-hidden="true">${coBody(c, Math.max(2, y), c.fullH, c.full)}</g>`;
  });
  // 選択中のステップの上下左右に「＋」。右は同じ担当、上・下は1つ上・下のレーンの担当で次のステップを作る（ドラッグでつなぐ）。
  // 左は同じ担当で前のステップを作る（ドラッグで別のステップからつなぐ）
  const ss = selected && L.steps.find(x => x.id === selected);
  if (ss){
    const p = L.pos.get(ss.id), li = f.lanes.findIndex(l => l.id === ss.lane), above = li > 0 ? f.lanes[li - 1] : null, below = li >= 0 ? f.lanes[li + 1] : null;
    const handle = (side, x, y, tip) => `<g class="handle" data-handle="${side}" data-x="${x}" data-y="${y}" tabindex="0" role="button" aria-label="${esc(tip)}"><title>${esc(tip)}</title><circle cx="${x}" cy="${y}" r="9"/><path d="M${x - 4} ${y}h8M${x} ${y - 4}v8"/></g>`;
    const own = li >= 0 ? f.lanes[li].name : "同じ担当";
    if (ss.type !== "start") s += handle("L", Math.max(p.x - 22, G.label + 11), p.y + p.h / 2, `前のステップを追加（${own}。種類を選ぶ）・ドラッグで別のステップからつなぐ`);
    if (ss.type !== "end"){
      s += handle("R", p.x + p.w + 22, p.y + p.h / 2, `次のステップを追加（${own}。種類を選ぶ）・ドラッグで別のステップにつなぐ`);
      if (above) s += handle("T", p.x + p.w / 2, p.y - 22, `次のステップを「${above.name}」に追加（種類を選ぶ）・ドラッグで別のステップにつなぐ`);
      if (below) s += handle("B", p.x + p.w / 2, p.y + p.h + 22, `次のステップを「${below.name}」に追加（種類を選ぶ）・ドラッグで別のステップにつなぐ`);
    }
  }
  // 選択中の矢印の両端に丸。ドラッグでつなぎ替え・出入りする辺の指定
  const SE = L.edges.find(isSelEdge);
  if (SE){
    const end = (k, [x, y], tip) => `<circle class="ehandle" data-end="${k}" cx="${x}" cy="${y}" r="6"><title>${esc(tip)}</title></circle>`;
    s += end("s", SE.pts[0], SE.assoc ? "ドラッグで関連元のステップを変える" : "ドラッグで出るステップ・出る辺を変える");
    s += end("t", SE.pts[SE.pts.length - 1], SE.assoc ? "ドラッグで関連先のステップを変える" : "ドラッグでつなぎ先・入る辺を変える");
    // 流れの矢印の途中に＋。押すと、選んだ種類のステップを矢印の間に入れる（関連の線には出さない）
    if (!SE.assoc){
      const [x, y] = edgePlusAt(SE), tip = "この矢印の間にステップを入れる（種類を選ぶ）";
      s += `<g class="handle eplus" data-eplus="1" tabindex="0" role="button" aria-label="${esc(tip)}"><title>${esc(tip)}</title><circle cx="${x}" cy="${y}" r="9"/><path d="M${x - 4} ${y}h8M${x} ${y - 4}v8"/></g>`;
    }
  }
  return s + pops;
}
function renderSvg(f, issues, selected, selEdge){
  const L = diagramLayout(f);
  const issueBy = new Map(); issues.forEach(i => { if (i.step && (!issueBy.has(i.step) || i.level === "bad")) issueBy.set(i.step, i.level); });
  const W = Math.max(L.width, 420), H = Math.max(L.height, G.laneH);
  setLastL(L);
  // レーン名の列は別のSVGにして左端に固定（横スクロールしても見えるように）。図本体は label 以降だけを描く
  const FONT = "IBM Plex Sans JP, Hiragino Sans, sans-serif";
  const head = `<svg class="lanes" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${G.label} ${H}" width="${G.label * S.zoom}" height="${H * S.zoom}" role="img" aria-label="担当（レーン）" font-family="${FONT}">${laneHeadSvg(L, W, H, true)}</svg>`;
  const body = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${G.label} 0 ${W - G.label} ${H}" width="${(W - G.label) * S.zoom}" height="${H * S.zoom}" role="img" aria-label="${esc(f.name)}のフロー図" font-family="${FONT}">${diagramBodySvg(f, L, W, H, { ui: { selected, selEdge, issueBy }, info: S.showInfo })}</svg>`;
  return `<div class="diagram">${head}${body}</div>`;
}

/* ---------- state ---------- */
// 共有の状態は js/state.js。元に戻す（Ctrl+Z）/ やり直す（Ctrl+Y・Ctrl+Shift+Z）の記録（pushUndo など）もそちら
let hovMouse = null, hovFocus = null; // マウスを乗せた・キーボードで選んだステップや矢印（applyHover）
setShowIssues(lsGet("flowbook.showIssues") === "1"); // 課題を吹き出しで常に表示する（この端末で覚えておく）
setShowInfo(lsGet("flowbook.showInfo") === "1"); // 使用システム・ツール・手段をステップの中に表示する（この端末で覚えておく）

function setStatus(kind, text){
  const el = $("#saveState"), mem = S.store === "memory";
  // memory：ファイルに保存（エクスポート）していない変更があるうちは「未保存」と出す
  if (kind === "saved" && !text && mem && S.unexported.has(S.currentId)) kind = "dirty";
  const map = { loading: "読み込み中", dirty: mem ? "未保存（このタブのみ）" : "未保存の変更", saving: "保存中…", saved: mem ? "ファイルに保存済み" : "保存済み", error: "保存できませんでした" };
  el.className = "pill " + kind; el.textContent = text || map[kind] || "";
}
let toastT = 0;
// 開いているダイアログ（画像として出力など）は画面の一番上に重なるので、そのときはトーストをダイアログの中に出す
function toast(msg){ const t = $("#toast"), host = document.querySelector("dialog[open]") || document.body; if (t.parentElement !== host) host.append(t); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 2400); }

function fmtTime(ms){ if (!ms) return ""; const d = new Date(ms); const p = n => String(n).padStart(2, "0"); return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; }
function newDocId(){ return "f" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

/* ---------- persistence ---------- */
// 保存先（store）：folder＝作業フォルダの .yaml ファイル / memory＝このタブのメモリだけ
// ブラウザ内（localStorage・IndexedDB）にはフローの中身を置かない。置くのはパネルの幅と、作業フォルダの参照だけ
const HIST_DIR = ".flowbook-history"; // 版の履歴：1フロー1ファイル（最大20版）
const histMark = h => (h || []).length + ":" + ((h || [])[0]?.at || 0);

function recordOf(name, text, at, history){
  let f = null; try { f = parseYaml(text); } catch {}
  return { name: f ? f.name : name.replace(/\.ya?ml$/i, ""), yaml: text, updatedAt: at, history: history || [] };
}
async function readHist(name){
  if (!S.histDir) return [];
  try {
    const v = jsyaml.load(await (await (await S.histDir.getFileHandle(name)).getFile()).text());
    return Array.isArray(v) ? v.filter(e => e && typeof e.yaml === "string").slice(0, 20) : [];
  } catch { return []; }
}
// 作業フォルダ直下の .yaml / .yml を読む。前回から変わっていないファイルは読み直さない
async function scanDir(){
  try { setHistDir(await S.dir.getDirectoryHandle(HIST_DIR)); } catch { setHistDir(null); }
  const seen = new Set();
  for await (const [name, h] of S.dir.entries()){
    if (h.kind !== "file" || !/\.ya?ml$/i.test(name)) continue;
    seen.add(name);
    const file = await h.getFile(), m = S.fileMeta.get(name);
    if (m && m.mod === file.lastModified && S.records.has(name)) continue;
    if (name === S.currentId && S.saving) continue;
    // 編集中のフローがほかで変わった：上書きせず、どちらを残すか選んでもらう
    if (name === S.currentId && S.dirty){ setConflictId(name); continue; }
    const history = await readHist(name);
    setRecord(name, recordOf(name, await file.text(), file.lastModified, history));
    setFileMeta(name, { mod: file.lastModified, hist: histMark(history) });
  }
  [...S.records.keys()].forEach(k => { if (!seen.has(k) && k !== S.pendingCreate){ forgetRecord(k); forgetFileMeta(k); } });
}
async function writeText(dh, name, text){
  const h = await dh.getFileHandle(name, { create: true }), w = await h.createWritable();
  await w.write(text); await w.close();
  return h;
}
async function persistFile(id, rec, force){
  const m = S.fileMeta.get(id);
  let h = null; try { h = await S.dir.getFileHandle(id); } catch {}
  if (h && m && !force && (await h.getFile()).lastModified !== m.mod) throw Object.assign(new Error("changed"), { code: "conflict" });
  h = await writeText(S.dir, id, rec.yaml);
  const hist = histMark(rec.history);
  if (!m || m.hist !== hist){
    if (rec.history.length){
      setHistDir(S.histDir || await S.dir.getDirectoryHandle(HIST_DIR, { create: true }));
      await writeText(S.histDir, id, jsyaml.dump(rec.history, { lineWidth: -1, noRefs: true }));
    } else if (S.histDir) await S.histDir.removeEntry(id).catch(() => {});
  }
  setFileMeta(id, { mod: (await h.getFile()).lastModified, hist });
}
async function removeRecord(id){
  markExported(id);
  if (S.store !== "folder") return;
  forgetFileMeta(id);
  if (S.histDir) await S.histDir.removeEntry(id).catch(() => {});
  await S.dir.removeEntry(id).catch(e => { if (e?.name !== "NotFoundError") throw e; });
}
// フロー名からファイル名を決める。ほかのフローと重なるときは「（2）」などを付ける
async function freeName(title, self){
  const base = safeName(title || "無題").trim() || "flow";
  for (let k = 1; ; k++){
    const n = base + (k > 1 ? `（${k}）` : "") + ".yaml";
    if (n === self) return n;
    if (S.records.has(n)) continue;
    try { await S.dir.getFileHandle(n); continue; } catch {}
    return n;
  }
}
// フロー名を変えたら、ファイル名（と履歴のファイル名）も合わせる
async function renameFile(){
  if (S.store !== "folder" || !S.dir || !S.currentId || S.broken) return;
  const old = S.currentId;
  const want = await freeName(S.flow.name, old);
  if (want === old) return;
  const wait = async () => { while (S.saving) await new Promise(r => setTimeout(r, 50)); };
  await wait(); if (S.dirty) await saveNow(); await wait();
  if (S.dirty || S.conflictId === old || S.currentId !== old) return;
  const rec = S.records.get(old); if (!rec) return;
  try {
    await persistFile(want, rec);
    if (S.histDir) await S.histDir.removeEntry(old).catch(() => {});
    await S.dir.removeEntry(old).catch(() => {});
  } catch { toast("ファイル名を変えられませんでした"); return; }
  forgetRecord(old); forgetFileMeta(old); setRecord(want, rec);
  if (S.currentId === old) setCurrentId(want);
  renderList(); toast(`ファイル名を「${want}」に変えました`);
}

async function chooseFolder(){
  let h;
  try { h = await window.showDirectoryPicker({ id: "gyomu-flow-folder", mode: "readwrite" }); }
  catch (e){ if (e?.name !== "AbortError") toast("フォルダを開けませんでした"); return false; }
  await openDir(h); return true;
}
async function reopenFolder(){
  try { if (S.lastDir && await S.lastDir.requestPermission({ mode: "readwrite" }) === "granted"){ await openDir(S.lastDir); return; } } catch {}
  toast("前回のフォルダを開けませんでした。フォルダを選び直してください");
}
async function openDir(h){
  if (S.dirty) await saveNow();
  setDir(h); setLastDir(h); setHistDir(null); idbSet("folder", h);
  setStore("folder");
  clearRecords(); clearFileMeta(); clearUnexported();
  setCurrentId(null); setFlow(null); setDirty(false); setConflictId(null);
  setStatus("loading");
  try { await scanDir(); } catch { toast("フォルダを読み込めませんでした"); }
  updateStoreUi();
  setFirstRecords(true); onRecords();
}
function startMemory(){
  setStore("memory"); setDir(null);
  updateStoreUi();
  setFirstRecords(true); onRecords();
}
function updateStoreUi(){
  const note = $("#storeNote");
  $("#folderBtn").hidden = !(S.store === "folder" && S.dir);
  if (S.dir) $("#folderName").textContent = S.dir.name;
  note.classList.toggle("warn", S.store === "memory");
  if (S.store === "folder") note.textContent = S.dir ? `フローは作業フォルダ「${S.dir.name}」に .yaml ファイルとして保存します。` : "作業フォルダを開くと、フローをそのフォルダに保存します。";
  else if (S.store === "memory") note.textContent = "タブを閉じると消えます。「エクスポート」で YAML ファイルに保存してください（Ctrl+S）。";
  renderNotice();
}
function renderNotice(){
  const el = $("#notice");
  if (S.conflictId && S.conflictId === S.currentId){
    el.innerHTML = `<span>このフローのファイル「${esc(S.currentId)}」が、ほかのアプリなどで変更されています。保存を止めています。</span><button class="btn sm primary" data-note="reload">ファイルの内容を読み込む</button><button class="btn sm danger" data-note="overwrite">この画面の内容で上書き</button>`;
    el.hidden = false; return;
  }
  el.hidden = true; el.innerHTML = "";
}
$("#notice").addEventListener("click", async ev => {
  const b = ev.target.closest("[data-note]"); if (!b) return;
  switch (b.dataset.note){
    case "reload": {
      setConflictId(null); setDirty(false); clearTimeout(S.saveTimer); forgetFileMeta(S.currentId);
      try { await scanDir(); } catch {}
      renderNotice();
      if (S.records.has(S.currentId)) open(S.currentId, true); else { const p = sortedIds()[0]; p ? open(p) : showEmpty(); }
      toast("ファイルの内容を読み込みました"); return;
    }
    case "overwrite": setConflictId(null); renderNotice(); await saveNow(true); return;
  }
});
function gateHtml(){
  const btns = S.lastDir
    ? `<button class="btn primary" data-folder="reopen">前回のフォルダ「${esc(S.lastDir.name)}」を開く</button><button class="btn" data-folder="pick">別のフォルダを選ぶ</button>`
    : `<button class="btn primary" data-folder="pick">作業フォルダを選ぶ</button>`;
  return `<div class="empty"><h2>作業フォルダを開きましょう</h2><p>フローは、選んだフォルダに 1 フローずつ .yaml ファイルとして保存します（共有フォルダや Git のフォルダも選べます）。</p><div class="row">${btns}</div><div class="row"><button class="btn ghost sm" data-folder="memory">フォルダを使わずに試す（タブを閉じると消えます）</button></div></div>`;
}
function folderAction(kind){
  if (kind === "reopen") reopenFolder();
  else if (kind === "pick") chooseFolder();
  else if (kind === "memory") startMemory();
}

async function initStore(){
  if (typeof window.showDirectoryPicker !== "function"){ startMemory(); return; }
  setStore("folder");
  setLastDir(await idbGet("folder"));
  // Chrome で「毎回許可」を選んでいれば、ボタンを押さなくても前回のフォルダを開く
  try { if (S.lastDir && await S.lastDir.queryPermission({ mode: "readwrite" }) === "granted"){ await openDir(S.lastDir); return; } } catch {}
  updateStoreUi();
  onRecords();
}
function onRecords(){
  renderList();
  if (S.firstRecords){
    setFirstRecords(false);
    const pick = sortedIds()[0];
    if (pick) open(pick); else showEmpty();
    return;
  }
  if (S.currentId && !S.records.has(S.currentId) && S.currentId !== S.pendingCreate){
    const pick = sortedIds()[0]; if (pick) open(pick); else showEmpty(); return;
  }
  if (!S.currentId){ const pick = sortedIds()[0]; if (pick) open(pick); return; }
  const r = S.records.get(S.currentId);
  if (r && !S.dirty && !S.saving && r.yaml !== S.yamlSrc) open(S.currentId, true);
  if (S.tab === "hist") renderHist();
}
function sortedIds(){ return [...S.records.entries()].sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0)).map(e => e[0]); }

function buildRecord(id){
  const prev = S.records.get(id);
  let history = (prev && Array.isArray(prev.history)) ? prev.history.slice() : [];
  if (prev && prev.yaml && prev.yaml !== S.yamlSrc){
    const last = history[0];
    if (!last || (Date.now() - last.at) > 10 * 60 * 1000) history.unshift({ at: prev.updatedAt || Date.now(), name: prev.name, yaml: prev.yaml });
  }
  history = history.slice(0, 20);
  return { name: S.flow.name, yaml: S.yamlSrc, updatedAt: Date.now(), history };
}
function markDirty(){
  setDirty(true); setStatus("dirty");
  clearTimeout(S.saveTimer); setSaveTimer(setTimeout(saveNow, 900));
}
// force：ほかのアプリでファイルが変わっていても上書きする（「この画面の内容で上書き」）
async function saveNow(force){
  if (!S.currentId || !S.flow) return;
  if (S.broken){ clearTimeout(S.saveTimer); setStatus("error", "読み取れないため保存していません"); return; }
  if (S.conflictId === S.currentId && force !== true){ clearTimeout(S.saveTimer); setStatus("error", "ほかで変更されています"); renderNotice(); return; }
  if (S.saving){ setAgain(true); return; }
  clearTimeout(S.saveTimer);
  setSaving(true); if (S.store !== "memory") setStatus("saving");
  const id = S.currentId, rec = buildRecord(id);
  setRecord(id, rec); setDirty(false);
  try {
    if (S.store === "folder") await persistFile(id, rec, force === true);
    else markUnexported(id);
    if (S.pendingCreate === id) setPendingCreate(null);
    setStatus(S.dirty ? "dirty" : "saved");
  } catch (err){
    setDirty(true);
    if (err && err.code === "conflict"){ setConflictId(id); renderNotice(); setStatus("error", "ほかで変更されています"); }
    else setStatus("error", "保存できませんでした");
  }
  setSaving(false);
  renderList();
  if (S.again){ setAgain(false); saveNow(); }
}

/* ---------- open / create ---------- */
function open(id, keepSel){
  const r = S.records.get(id); if (!r) return;
  if (S.dirty && S.currentId && S.currentId !== id) saveNow();
  const isNew = S.currentId !== id;
  if (S.conflictId && S.conflictId !== id) setConflictId(null);
  setCurrentId(id); resetUndo();
  setYamlSrc(r.yaml || "");
  let err = null;
  try { setFlow(parseYaml(S.yamlSrc)); } catch (e){ err = e; setFlow(normalize({ name: r.name || "読み込めないフロー", lanes: [], steps: [] })); }
  setBroken(!!err);
  if (!keepSel || !S.flow.steps.some(s => s.id === S.selected)) setSelected(null);
  setSelEdge(null);
  setDirty(false); setStatus("saved");
  $("#flowName").disabled = false; $("#exportBtn").disabled = false;
  $("#flowName").value = S.flow.name;
  $("#yamlText").value = S.yamlSrc; setYamlMsg();
  refresh(true);
  if (isNew) fitZoom();
  renderList();
  renderNotice();
  closeSide();
  // 読み取れない YAML：元の文面を消さないよう保存を止め、YAML タブで直してもらう
  if (err){ showTab("yaml"); setYamlMsg(`読み取れません。${err.mark ? err.mark.line + 1 + "行目：" : ""}${err.reason || err.message}（直すまで保存されません）`); setStatus("error", "読み取れません"); }
}
// opts.fromFile：ファイルから開いた（memory では、まだ保存していない変更として扱わない）
async function create(yamlText, opts = {}){
  if (S.store === "folder" && !S.dir && !(await chooseFolder())) return false;
  let f; try { f = parseYaml(yamlText); } catch (e){ toast("読み込めませんでした：" + e.message); return false; }
  let text = yamlText;
  if ([...S.records.values()].some(r => r.name === f.name)){ f.name += "（コピー）"; text = toYaml(f); }
  const id = S.store === "folder" ? await freeName(f.name) : newDocId();
  setPendingCreate(id);
  setRecord(id, { name: f.name, yaml: text, updatedAt: Date.now(), history: [] });
  open(id);
  setSelected(S.flow.steps[0]?.id || null); refresh(true);
  await saveNow();
  if (opts.fromFile && S.store === "memory"){ markExported(id); setStatus("saved"); }
  return true;
}
function showEmpty(){
  setCurrentId(null); setFlow(null); setBroken(false);
  $("#flowName").value = ""; $("#flowName").disabled = true; $("#exportBtn").disabled = true;
  setStatus("saved", "フローなし");
  renderNotice(); syncMemo();
  if (S.store === "folder" && !S.dir){
    $("#canvas").innerHTML = gateHtml();
    $("#tab-edit").innerHTML = `<p class="help">作業フォルダを開くと、ここでステップを編集できます。</p>`;
    $("#tab-setup").innerHTML = `<p class="help">作業フォルダを開くと、ここで管理部署や担当（レーン）を設定できます。</p>`;
    $("#tab-check").innerHTML = ""; $("#tab-hist").innerHTML = ""; $("#yamlText").value = "";
    $("#issueCount").textContent = "0"; $("#issueCount").className = "count"; updateIssueBtn(); updateInfoBtn();
    updateHint(); renderList();
    return;
  }
  $("#canvas").innerHTML = `<div class="empty"><h2>最初の業務フローをつくりましょう</h2><p>担当（レーン）とステップを並べるだけで、スイムレーン図が自動で描かれます。定義は読みやすい YAML テキストで保存されるので、あとから直すのも簡単です。</p><div class="row"><button class="btn primary" data-new="expense">経費精算のひな形から</button><button class="btn" data-new="order">受注〜出荷のひな形から</button><button class="btn" data-new="blank">白紙から</button></div></div>`;
  $("#tab-edit").innerHTML = `<p class="help">左の一覧または上のボタンからフローを作成すると、ここでステップを編集できます。</p>`;
  $("#tab-setup").innerHTML = `<p class="help">フローを作成すると、ここで管理部署や担当（レーン）を設定できます。</p>`;
  $("#tab-check").innerHTML = ""; $("#tab-hist").innerHTML = ""; $("#yamlText").value = "";
  $("#issueCount").textContent = "0"; $("#issueCount").className = "count"; updateIssueBtn(); updateInfoBtn();
  updateHint(); renderList();
}

/* ---------- refresh views ---------- */
function commit(opts = {}){
  // form changed the model -> regenerate yaml
  // opts.form: 構造の変更（フォームを描き直し、元に戻すの 1 回分にする）/ opts.select: 変更後に選ぶステップ
  // 読み取れない YAML のフローは、元の文面を上書きしないよう図やフォームからは変えない
  if (S.broken){ open(S.currentId, true); toast("YAML タブで読み取れない箇所を直してから編集してください"); return; }
  // 帳票・データとの流れ（種類を帳票に変えた・つなぎ先に帳票を選んだなど）は、関連（点線）に移す
  if (artifactLinks(S.flow)) toast("帳票・データとのつながりは、関連（点線）にしました");
  keepUnlinked();
  const text = toYaml(S.flow);
  if (text !== S.yamlSrc) pushUndo(opts.form ? "op" : "type");
  setYamlSrc(text);
  if ("select" in opts){ setSelected(opts.select); setSelEdge(opts.edge || null); }
  if (S.selEdge && refTo(S.selEdge) == null) setSelEdge(null);
  if (document.activeElement !== $("#yamlText")) { $("#yamlText").value = S.yamlSrc; setYamlMsg(); }
  refresh(opts.form);
  markDirty();
}
/* 矢印がすべて外れたステップは、自動の配置だと左端へ詰められて見失いやすい。
   直前の図で置かれていた列・段に固定（col・row）して、その場に留める */
function keepUnlinked(){
  if (!S.lastL?.linked) return;
  const now = linkedIds(S.flow);
  const lost = S.flow.steps.filter(s => !s.col && S.lastL.linked.has(s.id) && !now.has(s.id) && S.lastL.pos.has(s.id));
  if (!lost.length) return;
  const pos = layout(S.flow, null, true).pos;
  lost.forEach(s => { const c = S.lastL.pos.get(s.id).c; if (pos.get(s.id)?.c !== c) s.col = c + 1; });
  // 段も元のまま留める（列を固定すると段は引き継がれなくなるので、置き直して確かめる）
  const pos2 = layout(S.flow, null, true).pos;
  lost.forEach(s => { const t = S.lastL.pos.get(s.id).t; if (pos2.get(s.id) && pos2.get(s.id).t !== t) s.row = t + 1; });
}
function refresh(withForm){
  setIssues(validate(S.flow));
  drawCanvas();
  updateIssueBtn(); updateInfoBtn();
  const bad = S.issues.filter(i => i.level === "bad").length, warn = S.issues.filter(i => i.level === "warn").length;
  const c = $("#issueCount"); c.textContent = bad + warn; c.className = "count" + (bad ? " bad" : warn ? " warn" : "");
  if (withForm) renderForm(); else updateFlags();
  syncMemo();
  renderChecks();
  if (S.tab === "hist") renderHist();
}
function drawCanvas(){
  const c = $("#canvas"), sl = c.scrollLeft, st = c.scrollTop;
  const fid = document.activeElement?.closest?.("#canvas [data-step]")?.dataset.step;
  c.innerHTML = renderSvg(S.flow, S.issues, S.selected, S.selEdge);
  c.scrollLeft = sl; c.scrollTop = st;
  c.style.scrollPaddingLeft = G.label * S.zoom + 16 + "px";
  $("#zoomVal").textContent = Math.round(S.zoom * 100) + "%";
  // 描き直してもキーボードのフォーカスと、その場の入力欄の位置を保つ
  if (fid) focusNode(fid);
  if (inlineEd && !inlineEd.place()) inlineEd.finish(true);
  applyHover();
  updateHint();
}
function updateHint(){
  const h = $("#canvasHint"); h.hidden = !S.flow;
  // 選んでいるものに合わせて、主な操作だけを短く出す（細かい操作は README）
  h.innerHTML = S.selEdge?.rel
    ? `両端の丸をドラッグしてつなぎ替え・<kbd>Delete</kbd> で削除`
    : S.selEdge
    ? `<b>＋</b> で間にステップを入れる・両端の丸をドラッグしてつなぎ替え・ダブルクリックで条件を編集・<kbd>Delete</kbd> で削除`
    : S.selected
    ? `<b>＋</b> で種類を選んで次のステップを追加（ドラッグで別のステップとつなぐ）・<kbd>Enter</kbd> で文言を編集・<kbd>Delete</kbd> で削除`
    : `クリックで選択・ダブルクリックで文言を編集・ドラッグで移動`;
}
// 選択したステップが画面の外なら、見える位置までスクロールする（左のレーン名の列は避ける）
function revealStep(id){
  const c = $("#canvas"), g = c.querySelector(`[data-step="${CSS.escape(id)}"]`); if (!g) return;
  const cr = c.getBoundingClientRect(), r = g.getBoundingClientRect(), m = 16, left = cr.left + G.label * S.zoom + m;
  if (r.left < left) c.scrollLeft -= left - r.left;
  else if (r.right > cr.right - m) c.scrollLeft += Math.min(r.right - (cr.right - m), r.left - left);
  if (r.top < cr.top + m) c.scrollTop -= cr.top + m - r.top;
  else if (r.bottom > cr.bottom - m) c.scrollTop += Math.min(r.bottom - (cr.bottom - m), r.top - (cr.top + m));
}

function renderList(){
  const ul = $("#flowList");
  const ids = sortedIds();
  if (!ids.length){ ul.innerHTML = `<li class="help" style="padding:8px 10px">${S.store === "pending" ? "読み込み中…" : S.store === "folder" && !S.dir ? "作業フォルダを開いていません。" : "まだフローがありません。"}</li>`; return; }
  ul.innerHTML = ids.map(id => { const r = S.records.get(id); return `<li><button data-open="${esc(id)}" aria-current="${id === S.currentId}"${S.store === "folder" ? ` title="${esc(id)}"` : ""}><span class="fn">${esc(r.name || "無題")}</span></button></li>`; }).join("");
}

/* ---------- form editor ---------- */
// 種類のしるし（ステップ一覧）。色を選んだステップは、しるしもその色で塗る
const typeIcon = (t, c) => `<svg class="ticon" viewBox="0 0 22 16" aria-hidden="true">${{
  start: `<rect x="1" y="3" width="20" height="10" rx="5" fill="var(--accent)"/>`,
  end: `<rect x="1" y="3" width="20" height="10" rx="5" fill="var(--ink)"/>`,
  decision: `<path d="M11 1 21 8 11 15 1 8Z" fill="var(--surface)" stroke="var(--ink)"/>`,
  subProcess: `<rect x="1" y="2" width="20" height="12" rx="2" fill="var(--surface)" stroke="var(--ink)"/><rect x="8.5" y="8" width="5" height="5" fill="none" stroke="var(--ink)" stroke-width=".8"/><path d="M11 9v3M9.5 10.5h3" stroke="var(--ink)" stroke-width=".8"/>`,
  document: `<path d="M1 3h20v8q-5 4-10 0t-10 0Z" fill="var(--surface)" stroke="var(--ink)"/>`,
  dataObject: `<path d="M5 2h8l4 4v8H5Z" fill="var(--surface)" stroke="var(--ink)"/><path d="M13 2v4h4" fill="none" stroke="var(--ink)"/>`,
  dataStore: `<path d="M5 4a6 2.5 0 0 1 12 0v8a6 2.5 0 0 1-12 0Z" fill="var(--surface)" stroke="var(--ink)"/><path d="M5 4a6 2.5 0 0 0 12 0" fill="none" stroke="var(--ink)"/>`,
  task: `<rect x="1" y="3" width="20" height="10" rx="2" fill="var(--surface)" stroke="var(--ink)"/>`
}[t].replace('fill="var(--surface)"', `fill="${fillOf(c)}"`)}</svg>`;
// ステップ一覧の見出しに付けるしるし：チェックの警告（丸）と、登録した課題（!）
function flagOf(id){
  const l = S.issues.find(i => i.step === id && i.level !== "info"), s = S.flow.steps.find(x => x.id === id);
  return (l ? `<span class="flag ${l.level}" title="${esc(l.msg)}"></span>` : "") + (s?.issue ? ` <span class="imark" title="${esc("課題：" + s.issue)}">!</span>` : "");
}
/* 色の選択（開始・終了は塗らないので出さない）。「なし」と COLORS の見本を並べる */
function colorField(s){
  if (!colorable(s)) return "";
  const sw = (k, name) => `<button type="button" class="swatch${(s.color || "") === k ? " on" : ""}" data-act="color" data-color="${k}" aria-pressed="${(s.color || "") === k}" title="${name}" aria-label="色：${name}"${k ? ` style="background:var(--c-${k})"` : ""}>${k ? "" : "なし"}</button>`;
  return `<div class="field"><span class="lbl">色（任意）</span><div class="swatches">${sw("", "なし")}${Object.entries(COLORS).map(([k, v]) => sw(k, v)).join("")}</div></div>`;
}
/* 「ツール・つながり」の欄（使用システム・ツール・手段、次のステップ、関連）。つながりはふだん図で編集するのでたたんでおき、
   一度開いたら、ほかのステップを選んでも開いたままにする */
let infoOpen = false;
$("#tab-edit").addEventListener("toggle", ev => { if (ev.target.matches?.(".info-sec")) infoOpen = ev.target.open; }, true);
function renderForm(){
  if (!S.flow) return;
  const laneOpts = cur => S.flow.lanes.map(l => `<option value="${esc(l.id)}" ${l.id === cur ? "selected" : ""}>${esc(l.name)}</option>`).join("") + (S.flow.lanes.some(l => l.id === cur) ? "" : `<option value="${esc(cur)}" selected>（未設定：${esc(cur || "なし")}）</option>`);
  // flow：流れのつなぎ先の候補（帳票・データは出さない）
  const stepOpts = (cur, self, flow) => `<option value="">— 選択 —</option>` + S.flow.steps.filter(s => (s.id !== self && !(flow && isArtifact(s))) || s.id === cur).map(s => `<option value="${esc(s.id)}" ${s.id === cur ? "selected" : ""}>${esc(s.id)}：${esc(s.label || "（未記入）")}</option>`).join("") + (cur && !S.flow.steps.some(s => s.id === cur) ? `<option value="${esc(cur)}" selected>${esc(cur)}（存在しません）</option>` : "");
  let g = `<div class="sec"><div class="sec-head"><h3>基本情報</h3></div>
    <div class="field"><label for="fOwner">管理部署</label><input class="inp" id="fOwner" data-meta="owner" value="${esc(S.flow.owner)}" placeholder="例：経理部"></div>
    <div class="field"><label for="fDesc">説明</label><textarea class="inp" id="fDesc" data-meta="description" rows="2" placeholder="このフローの目的や適用範囲">${esc(S.flow.description)}</textarea></div></div>`;
  g += `<div class="sec"><div class="sec-head"><h3>担当（レーン）</h3><button class="btn sm" data-act="lane-add">＋ 担当を追加</button></div>`;
  S.flow.lanes.forEach((l, i) => {
    g += `<div class="lane-row"><div class="row"><input class="inp grow" id="lane-${esc(l.id)}" data-lane="${i}" value="${esc(l.name)}" aria-label="担当名"><input class="inp lane-id" data-lane-id="${i}" value="${esc(l.id)}" spellcheck="false" autocomplete="off" aria-label="担当ID" title="担当ID（変えると、この担当のステップの担当IDも置き換わります）"></div>
      <div class="ctrl"><button class="mini" data-act="lane-up" data-i="${i}" ${i ? "" : "disabled"} aria-label="上へ">↑</button><button class="mini" data-act="lane-down" data-i="${i}" ${i < S.flow.lanes.length - 1 ? "" : "disabled"} aria-label="下へ">↓</button><button class="mini" data-act="lane-del" data-i="${i}" aria-label="削除">✕</button></div></div>`;
  });
  if (!S.flow.lanes.length) g += `<p class="help">担当がありません。「＋ 担当を追加」で部署や役割を追加してください。</p>`;
  g += `</div>`;
  g += `<div class="sec"><div class="sec-head"><h3>このフローの管理</h3></div><div class="row" style="flex-wrap:wrap">
    <button class="btn sm" data-act="dup">複製</button><button class="btn sm danger" data-act="flow-del">このフローを削除</button></div></div>`;
  $("#tab-setup").innerHTML = g;
  let h = `<div class="sec"><div class="sec-head"><h3>ステップ</h3><button class="btn sm" data-act="step-add">＋ ステップを追加</button></div>
    <div class="step-tools"><button class="btn sm ghost" data-act="sort-flow" title="図の左から右、上から下の順に並べ替えます">図の順に並べる</button><button class="btn sm ghost" data-act="renumber" title="今の並び順でIDを 1 から振り直します。つながりも自動で書き換えます">IDを振り直す</button></div>`;
  S.flow.steps.forEach(s => {
    const laneName = S.flow.lanes.find(l => l.id === s.lane)?.name || "担当未設定";
    const isOpen = s.id === S.selected;
    h += `<div class="step ${isOpen ? "open" : ""}" data-stepcard="${esc(s.id)}">
      <button class="step-sum" data-act="select" data-id="${esc(s.id)}" aria-expanded="${isOpen}">${typeIcon(s.type, s.color)}<span class="lb"><span class="tag">${esc(s.id)}</span> ${esc(s.label || "（未記入）")} <span data-flag="${esc(s.id)}">${flagOf(s.id)}</span></span><span class="ln">${esc(laneName)}</span></button>`;
    if (isOpen){
      h += `<div class="step-body">
        <div class="field"><label for="sl-${esc(s.id)}">内容</label><input class="inp" id="sl-${esc(s.id)}" data-sf="label" value="${esc(s.label)}" placeholder="例：申請書を作成"></div>
        <div class="grid2"><div class="field"><label for="st-${esc(s.id)}">種類</label><select class="inp" id="st-${esc(s.id)}" data-sf="type">${Object.entries(TYPES).map(([k, v]) => `<option value="${k}" ${k === s.type ? "selected" : ""}>${v}</option>`).join("")}</select></div>
        <div class="field"><label for="sn-${esc(s.id)}">担当</label><select class="inp" id="sn-${esc(s.id)}" data-sf="lane">${laneOpts(s.lane)}</select></div></div>
        ${colorField(s)}
        ${s.col || s.row ? `<div class="row"><span class="help">図の位置：${[s.col ? `左から ${s.col} 列目` : "", s.row ? `上から ${(S.lastL?.pos.get(s.id)?.t ?? s.row - 1) + 1} 段目` : ""].filter(Boolean).join("・")}に固定（図でドラッグして指定）</span><button class="btn sm ghost" data-act="col-auto">位置を自動に戻す</button></div>` : ""}
        <div class="field"><label for="so-${esc(s.id)}">補足（帳票名・期限・ルールなど）</label><textarea class="inp" id="so-${esc(s.id)}" data-sf="note" rows="2">${esc(s.note)}</textarea></div>
        <div class="field"><label for="si-${esc(s.id)}">課題（問題点・改善したい点）</label><textarea class="inp issue-inp" id="si-${esc(s.id)}" data-sf="issue" rows="2" placeholder="例：紙の書類を目視で確認しており時間がかかる">${esc(s.issue)}</textarea></div>
`;
      const rel = s.related || [], free = S.flow.steps.filter(x => x.id !== s.id && !rel.includes(x.id) && !s.next.some(e => e.to === x.id));
      // たたんでいても中身がわかるよう、見出しの右に書いてあるものを短く出す
      const peek = [hasTool(s) ? "ツールあり" : "", s.next.length ? `次 ${s.next.length}` : "", rel.length ? `関連 ${rel.length}` : ""].filter(Boolean).join("・") || "なし";
      h += `<details class="info-sec" ${infoOpen ? "open" : ""}><summary>ツール・つながり<span class="peek">${peek}</span></summary>
        <div class="field"><label for="sx-tool-${esc(s.id)}">${TOOL_NAME}（任意）</label><textarea class="inp info-inp" id="sx-tool-${esc(s.id)}" data-sf="tool" rows="1" placeholder="例：Excel・基幹システム・メール">${esc(s.tool)}</textarea></div>`;
      // 帳票・データは流れに入れない（ほかのステップとは関連で結ぶ）ので、次のステップの欄は出さない。流れのつなぎ先にも帳票・データは出さない
      if (!isArtifact(s)){
      h += `<div class="field"><span class="lbl">次のステップ${s.type === "decision" ? "（分岐ごとに条件を書く）" : ""}</span>`;
      s.next.forEach((e, k) => {
        h += `<div class="next-row"><select class="inp" id="nx-${esc(s.id)}-${k}" data-nx="${k}" data-nf="to" aria-label="つなぎ先">${stepOpts(e.to, s.id, true)}</select><input class="inp${labelCut(e.when) ? " cut" : ""}" id="nw-${esc(s.id)}-${k}" data-nx="${k}" data-nf="when" value="${esc(e.when)}"${labelCut(e.when) ? ` title="${CUT_TIP}"` : ""} placeholder="${s.type === "decision" ? "条件（例：承認）" : "条件（任意）"}" aria-label="条件"><button class="mini" data-act="next-del" data-k="${k}" aria-label="このつながりを削除">✕</button></div>`;
      });
      if (!s.next.length) h += `<p class="help" style="margin:0">${s.type === "end" ? "終了ステップなので次はありません。" : "まだつながっていません。"}</p>`;
      h += `<div class="row"><button class="btn sm" data-act="next-add">＋ つながりを追加</button></div></div>`;
      }
      // 関連（点線）：流れとは別に、このステップで作る・使う帳票などと結ぶ。相手だけを選ぶ（条件・辺の指定はない）
      h += `<div class="field"><span class="lbl">${isArtifact(s) ? `関連（点線。この${TYPES[s.type]}を作る・使うステップ）` : "関連（点線。このステップで作る・使う帳票・データなど）"}</span>`;
      rel.forEach((to, k) => { h += `<div class="next-row rel-row"><select class="inp" id="rx-${esc(s.id)}-${k}" data-rx="${k}" aria-label="関連の相手">${stepOpts(to, s.id)}</select><button class="mini" data-act="rel-del" data-k="${k}" aria-label="この関連を削除">✕</button></div>`; });
      h += `<div class="next-row rel-row"><select class="inp" id="rx-${esc(s.id)}-new" data-rx="new" aria-label="関連を追加"><option value="">＋ 関連を追加…</option>${free.map(x => `<option value="${esc(x.id)}">${esc(x.id)}：${esc(x.label || "（未記入）")}</option>`).join("")}</select><span></span></div></div></details>
        <div class="step-actions">
          <button class="btn sm danger" data-act="step-del">削除</button>
        </div></div>`;
    }
    h += `</div>`;
  });
  if (!S.flow.steps.length) h += `<p class="help">「＋ ステップを追加」で最初のステップをつくると、図に表示されます。</p>`;
  h += `</div>`;
  $("#tab-edit").innerHTML = h;
}
function updateFlags(){
  document.querySelectorAll("[data-flag]").forEach(el => {
    const id = el.dataset.flag;
    el.innerHTML = flagOf(id);
    const lb = el.parentElement, s = S.flow.steps.find(x => x.id === id);
    if (s && lb.firstChild && lb.childNodes[1]) lb.childNodes[1].nodeValue = " " + (s.label || "（未記入）") + " ";
  });
}
const curStep = () => S.flow.steps.find(s => s.id === S.selected);

function select(id, scroll){
  setSelected(id); setSelEdge(null); renderForm(); drawCanvas(); revealStep(id);
  if (S.tab !== "edit") showTab("edit");
  if (scroll !== false){ const el = document.querySelector(`[data-stepcard="${CSS.escape(id)}"]`); el && el.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
}
// 図の何もないところをクリック / Esc で選択を外す（タブは切り替えない）
function deselect(){ if (!S.flow || (S.selected === null && !S.selEdge)) return; setSelected(null); setSelEdge(null); renderForm(); drawCanvas(); }
// 図の上で矢印（ref は refOf の形）を選ぶ。両端の丸をドラッグしてつなぎ替えられる
function selectEdge(ref){
  const cur = S.selEdge;
  if (cur && cur.sid === ref.sid && cur.k === ref.k && !!cur.rel === !!ref.rel) return; // 選び直しでは描き直さない（ダブルクリックで条件を編集できるように）
  const had = S.selected !== null; setSelected(null); setSelEdge(ref);
  if (had) renderForm();
  drawCanvas();
}
function deleteStep(id){
  const s = S.flow.steps.find(x => x.id === id); if (!s) return;
  // reconnect: predecessors that pointed here now point to this step's successors (when single)
  S.flow.steps.forEach(p => {
    const k = p.next.findIndex(e => e.to === s.id); if (k < 0) return;
    const repl = s.next.filter(e => e.to !== p.id && !p.next.some(x => x.to === e.to)).map(e => ({ to: e.to, when: p.next[k].when || e.when }));
    p.next.splice(k, 1, ...(s.next.length === 1 ? repl : []));
  });
  // 関連（点線）はつなぎ直さず外す
  S.flow.steps.forEach(p => { if (p.related?.includes(s.id)) p.related = p.related.filter(x => x !== s.id); });
  S.flow.steps.splice(S.flow.steps.indexOf(s), 1);
}
function newStepId(){ const taken = new Set(S.flow.steps.map(s => s.id)); const pre = (S.flow.steps.find(s => /^[a-z]+\d+$/i.test(s.id))?.id.match(/^[a-z]+/i) || ["s"])[0]; return uid(pre, taken); }

const onPanels = (type, fn) => ["#tab-edit", "#tab-setup"].forEach(sel => $(sel).addEventListener(type, fn));
onPanels("input", ev => {
  const t = ev.target; if (!S.flow) return;
  if (t.dataset.meta){ S.flow[t.dataset.meta] = t.value; commit(); return; }
  if (t.dataset.lane != null){ S.flow.lanes[+t.dataset.lane].name = t.value; commit(); return; }
  const s = curStep(); if (!s) return;
  if (t.dataset.sf === "label" || t.dataset.sf === "note" || t.dataset.sf === "issue" || t.dataset.sf === "tool"){ s[t.dataset.sf] = t.value; commit(); return; }
  if (t.dataset.nf === "when"){ s.next[+t.dataset.nx].when = t.value; markCut(t); commit(); }
});
onPanels("change", ev => {
  const t = ev.target; if (!S.flow) return;
  if (t.dataset.laneId != null){ renameLane(+t.dataset.laneId, t); return; }
  const s = curStep(); if (!s) return;
  // 流れの途中のステップを帳票・データに変えたら、前後の流れをつなぎ直す（toArtifact）
  if (t.dataset.sf === "type"){ if (toArtifact(S.flow, s.id, t.value)) toast("前後のステップを矢印でつなぎ直し、この" + TYPES[t.value] + "は前のステップと関連（点線）で結びました"); if (!colorable(s)) delete s.color; commit({ form: true }); }
  else if (t.dataset.sf === "lane"){ s.lane = t.value; commit({ form: true }); }
  else if (t.dataset.nf === "to"){ const e = s.next[+t.dataset.nx]; e.to = t.value; delete e.entry; if (!t.value) s.next.splice(+t.dataset.nx, 1); commit({ form: true }); }
  else if (t.dataset.rx != null){
    const rel = s.related ||= [], v = t.value;
    if (t.dataset.rx === "new"){ if (v && !rel.includes(v)) rel.push(v); }
    else if (!v || rel.some((x, k) => k !== +t.dataset.rx && x === v)) rel.splice(+t.dataset.rx, 1);
    else rel[+t.dataset.rx] = v;
    commit({ form: true });
  }
});
/* 担当IDを変える。その担当に割り振っていたステップの lane もまとめて新しいIDに置き換える。
   同じIDの担当がほかにも残る場合（YAMLで重複させたとき）は、どちらの担当のステップか決められないのでステップはそのままにする。 */
function renameLane(i, inp){
  const l = S.flow.lanes[i]; if (!l) return;
  const oldId = l.id, newId = inp.value.trim();
  if (newId === oldId){ inp.value = oldId; return; }
  if (!newId){ inp.value = oldId; toast("担当IDは空にできません"); return; }
  if (S.flow.lanes.some((x, k) => k !== i && x.id === newId)){ inp.value = oldId; toast(`担当ID「${newId}」はすでに使われています`); return; }
  const shared = S.flow.lanes.some((x, k) => k !== i && x.id === oldId);
  const moved = shared ? [] : S.flow.steps.filter(s => s.lane === oldId);
  l.id = newId; moved.forEach(s => s.lane = newId);
  commit({ form: true });
  toast(moved.length ? `担当IDを「${newId}」に変更し、${moved.length} 件のステップの担当IDも置き換えました` : `担当IDを「${newId}」に変更しました`);
}
let armed = null;
function arm(btn, key, label){
  if (armed === key){ armed = null; return true; }
  armed = key; btn.classList.add("armed"); btn.textContent = label;
  setTimeout(() => { if (armed === key){ armed = null; btn.classList.remove("armed"); btn.textContent = btn.dataset.orig; } }, 3500);
  return false;
}
onPanels("click", ev => {
  const b = ev.target.closest("[data-act]"); if (!b || !S.flow) return;
  const act = b.dataset.act, s = curStep(), i = +b.dataset.i;
  switch (act){
    case "select": select(S.selected === b.dataset.id ? null : b.dataset.id, false); return;
    case "lane-add": { const id = uid("lane", new Set(S.flow.lanes.map(l => l.id))); S.flow.lanes.push({ id, name: "新しい担当" }); commit({ form: true }); const el = $("#lane-" + CSS.escape(id)); el && (el.focus(), el.select()); return; }
    case "lane-up": [S.flow.lanes[i - 1], S.flow.lanes[i]] = [S.flow.lanes[i], S.flow.lanes[i - 1]]; break;
    case "lane-down": [S.flow.lanes[i + 1], S.flow.lanes[i]] = [S.flow.lanes[i], S.flow.lanes[i + 1]]; break;
    case "lane-del": {
      const l = S.flow.lanes[i], n = S.flow.steps.filter(x => x.lane === l.id).length;
      if (n){ b.dataset.orig = b.textContent; if (!arm(b, "lane" + l.id, "?")) { toast(`「${l.name}」には ${n} 件のステップがあります。もう一度 ✕ で削除します`); return; } }
      S.flow.lanes.splice(i, 1); break;
    }
    case "step-add": {
      const id = newStepId(); const last = S.flow.steps[S.flow.steps.length - 1];
      S.flow.steps.push({ id, type: S.flow.steps.length ? "task" : "start", lane: last?.lane || S.flow.lanes[0]?.id || "", label: "", note: "", issue: "", tool: "", related: [], next: [] });
      setSelected(id); commit({ form: true }); focusLabel(); return;
    }
    case "sort-flow": {
      const L = layout(S.flow), key = st => { const p = L.pos.get(st.id); return p ? p.c * 1000 + p.r : 1e9; };
      const before = S.flow.steps.map(x => x.id).join();
      S.flow.steps.sort((a, b2) => key(a) - key(b2));
      if (before === S.flow.steps.map(x => x.id).join()){ toast("すでに図の順に並んでいます"); return; }
      break;
    }
    case "renumber": {
      const cnt = {}; S.flow.steps.forEach(x => { const m = x.id.match(/^([A-Za-z_]+)\d+$/); if (m) cnt[m[1]] = (cnt[m[1]] || 0) + 1; });
      const pre = Object.keys(cnt).sort((p1, p2) => cnt[p2] - cnt[p1])[0] || "s";
      const map = new Map(S.flow.steps.map((x, k) => [x.id, pre + (k + 1)]));
      if (S.flow.steps.every(x => map.get(x.id) === x.id)){ toast("IDはすでに並び順どおりです"); return; }
      b.dataset.orig = "IDを振り直す"; if (!arm(b, "renum", "もう一度押して振り直す")) return;
      const r = S.records.get(S.currentId);
      if (r){ const history = (r.history || []).slice(); history.unshift({ at: Date.now(), name: S.flow.name, yaml: S.yamlSrc, memo: "ID振り直し前" }); setRecord(S.currentId, { ...r, history: history.slice(0, 20) }); }
      S.flow.steps.forEach(x => { x.id = map.get(x.id); x.next.forEach(e => { if (map.has(e.to)) e.to = map.get(e.to); }); if (x.related) x.related = x.related.map(t => map.get(t) || t); });
      if (S.selected) setSelected(map.get(S.selected) || null);
      toast(`IDを ${pre}1〜${pre}${S.flow.steps.length} に振り直しました（元の版は履歴に残しています）`); break;
    }
    case "step-del": {
      b.dataset.orig = "削除"; if (!arm(b, "step" + s.id, "もう一度押して削除")) return;
      deleteStep(s.id); commit({ form: true, select: null });
      toast("ステップを削除しました。前後のつながりは自動でつなぎ直しています（Ctrl+Z で元に戻せます）"); return;
    }
    case "next-del": s.next.splice(+b.dataset.k, 1); break;
    case "rel-del": s.related?.splice(+b.dataset.k, 1); break;
    case "color": if (b.dataset.color) s.color = b.dataset.color; else delete s.color; break;
    case "col-auto": delete s.col; delete s.row; break;
    case "dup": { const f = JSON.parse(JSON.stringify(S.flow)); f.name += "（コピー）"; create(toYaml(f)); return; }
    case "flow-del": {
      b.dataset.orig = "このフローを削除"; if (!arm(b, "flow" + S.currentId, "もう一度押すと完全に削除")) return;
      const id = S.currentId; forgetRecord(id); clearTimeout(S.saveTimer); setDirty(false);
      removeRecord(id).catch(() => toast("削除できませんでした"));
      setCurrentId(null); const pick = sortedIds()[0]; if (pick) open(pick); else showEmpty(); toast("フローを削除しました"); return;
    }
    default: return;
  }
  commit({ form: true });
});
function focusLabel(){ const el = document.querySelector(`#sl-${CSS.escape(S.selected)}`); if (el){ el.focus(); el.scrollIntoView({ block: "nearest" }); } }

/* fix: allow an empty "next" row to exist while choosing a target */
(function patchNextAdd(){
  const host = $("#tab-edit");
  host.addEventListener("click", ev => {
    const b = ev.target.closest('[data-act="next-add"]'); if (!b || !S.flow) return;
    ev.stopImmediatePropagation();
    const s = curStep(); if (!s) return;
    const k = s.next.length;
    const row = document.createElement("div"); row.className = "next-row";
    const opts = `<option value="">— 選択 —</option>` + S.flow.steps.filter(x => x.id !== s.id && !isArtifact(x)).map(x => `<option value="${esc(x.id)}">${esc(x.id)}：${esc(x.label || "（未記入）")}</option>`).join("");
    row.innerHTML = `<select class="inp" id="nx-${esc(s.id)}-new" aria-label="つなぎ先">${opts}</select><input class="inp" id="nw-${esc(s.id)}-new" placeholder="条件（任意）" aria-label="条件"><span></span>`;
    b.parentElement.before(row);
    const sel = row.querySelector("select"), w = row.querySelector("input");
    sel.addEventListener("change", e => { e.stopPropagation(); if (!sel.value) return; s.next.push({ to: sel.value, when: w.value }); commit({ form: true }); });
    sel.focus();
  }, true);
})();

/* ---------- canvas interactions ---------- */
$("#canvas").addEventListener("click", ev => {
  const g = ev.target.closest("[data-step]");
  // 選択中のステップをもう一度クリックしても描き直さない（ダブルクリックで編集できるように）
  if (g){ if (g.dataset.step !== S.selected) select(g.dataset.step); else if (S.tab !== "edit") showTab("edit"); return; }
  // 課題の吹き出し：そのステップを選ぶ
  const co = ev.target.closest("[data-co]"); if (co){ if (co.dataset.co !== S.selected) select(co.dataset.co); else if (S.tab !== "edit") showTab("edit"); return; }
  const n = ev.target.closest("[data-new]"); if (n){ startNew(n.dataset.new); return; }
  const fo = ev.target.closest("[data-folder]"); if (fo){ folderAction(fo.dataset.folder); return; }
  if (ev.target.closest("[data-eplus]")){ plusEdge(); return; }
  const e = ev.target.closest("[data-edge]"); if (e){ selectEdge(refOf(e.dataset.edge, e.dataset.k)); return; }
  if (ev.target.closest("[data-handle],[data-end]")) return;
  deselect();
});
$("#canvas").addEventListener("keydown", ev => {
  if (ev.key !== "Enter" && ev.key !== " ") return;
  const h = ev.target.closest("[data-handle]"); if (h){ ev.preventDefault(); ev.stopPropagation(); plus(h.dataset.handle); return; }
  if (ev.target.closest("[data-eplus]")){ ev.preventDefault(); ev.stopPropagation(); plusEdge(); return; }
  const g = ev.target.closest("[data-step]"); if (!g) return;
  ev.preventDefault(); ev.stopPropagation();
  if (ev.key === "Enter" && g.dataset.step === S.selected) editStepInline(S.selected); else select(g.dataset.step);
});
$("#canvas").addEventListener("dblclick", ev => {
  if (!S.flow) return;
  const g = ev.target.closest("[data-step]"); if (g){ ev.preventDefault(); editStepInline(g.dataset.step); return; }
  // 課題の吹き出しをダブルクリック：編集エリアの課題の欄で書き直す
  const co = ev.target.closest("[data-co]"); if (co){ ev.preventDefault(); editIssue(co.dataset.co); return; }
  const e = ev.target.closest("[data-edge]");
  // 関連（点線）には条件を書かない
  if (e && refOf(e.dataset.edge, e.dataset.k).rel){ toast("関連の線には条件を書けません"); return; }
  if (e) editEdgeInline(e.dataset.edge, +e.dataset.k, e.classList.contains("ehit") ? toSvg(ev.clientX, ev.clientY) : null);
});
// マウスを乗せた・キーボードで選んだステップや矢印に出入りする矢印と、その条件ラベルを強調する。
// 描き直さずにクラスだけ付け替える（描き直すとダブルクリックやフォーカスが途切れるため）
const hovKey = el => {
  const g = el?.closest?.("#canvas [data-step]"); if (g) return "step\n" + g.dataset.step;
  const co = el?.closest?.("#canvas [data-co]"); if (co) return "step\n" + co.dataset.co;
  const e = el?.closest?.("#canvas .ehit, #canvas .elabel"); return e ? "edge\n" + e.dataset.edge + "\n" + e.dataset.k : null;
};
function applyHover(){
  const c = $("#canvas"), key = hovMouse || hovFocus;
  c.querySelectorAll(".hv").forEach(el => el.classList.remove("hv"));
  const busy = ["dragging", "linking", "reattaching", "panning"].some(k => c.classList.contains(k));
  const [kind, id, k] = key && !busy ? key.split("\n") : [];
  showTip(kind === "step" ? id : null);
  if (!kind) return;
  // ステップと、その課題の吹き出しを一緒に強調する（どちらに乗せても、どれとどれが対応しているかわかるように）
  if (kind === "step") c.querySelectorAll(`[data-step="${CSS.escape(id)}"], [data-co="${CSS.escape(id)}"]`).forEach(el => el.classList.add("hv"));
  const paths = [...c.querySelectorAll("path.edge")].filter(p => kind === "step" ? p.dataset.s === id || p.dataset.t === id : p.dataset.s === id && p.dataset.k === k);
  const keys = new Set(paths.map(p => p.dataset.s + "\n" + p.dataset.k));
  paths.forEach(p => p.classList.add("hv"));
  c.querySelectorAll(".elabel").forEach(l => keys.has(l.dataset.edge + "\n" + l.dataset.k) && l.classList.add("hv"));
  // 強調した矢印はほかの矢印より手前へ（選択中の矢印と当たり判定よりは奥）
  const ref = c.querySelector("path.edge.hot") || c.querySelector(".ehit");
  paths.forEach(p => p.classList.contains("hot") || ref?.before(p));
}
/* 補足と課題のツールチップ。マウスを乗せた（キーボードで選んだ）ステップのすぐ下に、補足→課題の順で出す */
const TIP_ICON = {
  note: `<svg viewBox="0 0 14 14" aria-hidden="true"><rect x="1" y="1" width="12" height="12" rx="3" fill="var(--surface)" stroke="var(--muted)" stroke-width="1.2"/><path d="M4 4.5h6M4 7h6M4 9.5h4" stroke="var(--muted)" stroke-width="1.2" stroke-linecap="round"/></svg>`,
  issue: `<svg viewBox="0 0 14 14" aria-hidden="true"><rect width="14" height="14" rx="3" fill="var(--bad)"/><path d="M7 3.2v4.6" stroke="var(--surface)" stroke-width="2" stroke-linecap="round"/><circle cx="7" cy="10.8" r="1.1" fill="var(--surface)"/></svg>`,
  info: `<svg viewBox="0 0 14 14" aria-hidden="true"><rect x="1" y="1" width="12" height="12" rx="3" fill="var(--surface)" stroke="var(--muted)" stroke-width="1.2"/><path d="M4 5h3.5M4 9h3.5M9 3.5 11 5 9 6.5M9 7.5 11 9 9 10.5" fill="none" stroke="var(--muted)" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`
};
let tipId = null;
function showTip(id){
  const tip = $("#stepTip"), st = id && S.flow ? S.flow.steps.find(s => s.id === id) : null;
  // 課題を吹き出しで出しているときは、ツールチップには補足だけを出す
  const issue = st && !(S.lastL?.callouts.some(c => c.id === id)) ? st.issue : "";
  const g = st && (st.note || issue || hasTool(st)) && !inlineEd ? $("#canvas").querySelector(`[data-step="${CSS.escape(id)}"] .shape`) : null;
  if (!g){ tip.hidden = true; tipId = null; return; }
  if (tipId !== id + "\n" + !!issue){
    tipId = id + "\n" + !!issue;
    const sec = (cls, label, body) => `<div class="tt-sec ${cls}"><div class="tt-h">${TIP_ICON[cls.slice(3)]}${label}</div>${body}</div>`, txt = t => `<div class="tt-b">${esc(t)}</div>`;
    tip.innerHTML = (st.note ? sec("tt-note", "補足", txt(st.note)) : "") + (issue ? sec("tt-issue", "課題", txt(issue)) : "") + (hasTool(st) ? sec("tt-info", TOOL_NAME, txt(st.tool.trim())) : "");
  }
  // 図の見えている範囲から外れたステップには出さない
  const r = g.getBoundingClientRect(), cr = $("#canvas").getBoundingClientRect();
  if (r.bottom < cr.top || r.top > cr.bottom || r.right < cr.left + G.label * S.zoom || r.left > cr.right){ tip.hidden = true; return; }
  tip.hidden = false;
  const m = 8, w = tip.offsetWidth, h = tip.offsetHeight;
  const x = Math.max(m, Math.min(innerWidth - w - m, r.left + r.width / 2 - w / 2));
  let y = r.bottom + 10; if (y + h > innerHeight - m) y = Math.max(m, r.top - h - 10);
  tip.style.left = x + "px"; tip.style.top = y + "px";
}
const hideTip = () => { $("#stepTip").hidden = true; tipId = null; };
// ドラッグやダブルクリックでの編集を始めたら隠す（描き直したあとに、乗せたままなら出し直す）
$("#canvas").addEventListener("pointerdown", hideTip, true);
$("#canvas").addEventListener("dblclick", hideTip, true);
$("#canvas").addEventListener("scroll", () => { if (tipId) showTip(tipId.split("\n")[0]); });
$("#canvas").addEventListener("mouseover", ev => { const key = hovKey(ev.target); if (key !== hovMouse){ hovMouse = key; applyHover(); } });
$("#canvas").addEventListener("mouseleave", () => { if (hovMouse){ hovMouse = null; applyHover(); } });
$("#canvas").addEventListener("focusin", ev => { hovFocus = ev.target.matches(":focus-visible") ? hovKey(ev.target) : null; applyHover(); });
$("#canvas").addEventListener("focusout", () => { if (hovFocus){ hovFocus = null; applyHover(); } });
// 拡大縮小。(px, py) は canvas 内での基準点（省略時は表示の中心）で、その位置の図が動かないようにスクロールを直す
function zoomTo(z, px, py){
  const old = S.zoom; setZoom(Math.min(2, Math.max(0.2, Math.round(z * 100) / 100)));
  if (!S.flow || S.zoom === old) return;
  const c = $("#canvas"), PX = 16, PY = 20;
  if (px == null) px = c.clientWidth / 2;
  if (py == null) py = c.clientHeight / 2;
  const r = S.zoom / old, x = c.scrollLeft + px, y = c.scrollTop + py;
  drawCanvas();
  c.scrollLeft = (x - PX) * r + PX - px; c.scrollTop = (y - PY) * r + PY - py;
}
function fitZoom(){
  if (!S.flow) return; const L = diagramLayout(S.flow), c = $("#canvas"); if (!c.clientWidth) return;
  const z = Math.min((c.clientWidth - 34) / Math.max(L.width, 420), (c.clientHeight - 42) / L.height, 1.4);
  setZoom(Math.min(2, Math.max(0.2, Math.round(z * 100) / 100))); drawCanvas(); c.scrollLeft = 0; c.scrollTop = 0;
}
// ドラッグ操作のあとのクリックは「選択解除」として扱わない
$("#canvas").addEventListener("click", ev => {
  if (panMoved){ panMoved = false; ev.stopPropagation(); }
  else if (performance.now() < noClickUntil) ev.stopPropagation();
}, true);
// 10% ずつ拡大縮小する。「全体」で半端な倍率になっていても、10% 刻みの値にそろえる
const zoomStep = (dir, px, py) => zoomTo(dir > 0 ? Math.floor(S.zoom * 10 + 1e-6) / 10 + 0.1 : Math.ceil(S.zoom * 10 - 1e-6) / 10 - 0.1, px, py);
$("#zoomIn").onclick = () => zoomStep(1);
$("#zoomOut").onclick = () => zoomStep(-1);
$("#zoomFit").onclick = fitZoom;
// 課題を表示：課題をステップのそばの吹き出しで常に出す。オフのときは、ステップに乗せたときのツールチップだけで見せる
function updateIssueBtn(){
  const b = $("#issueBtn"), n = S.flow ? S.flow.steps.filter(s => s.issue && s.issue.trim()).length : 0;
  $("#issueBtnCount").textContent = n;
  b.disabled = !n;
  b.setAttribute("aria-pressed", String(S.showIssues));
  b.title = !n ? "課題が書かれたステップはありません" : S.showIssues ? "課題の吹き出しを隠します（ステップにマウスを乗せると表示）" : "課題を、ステップのそばの吹き出しで常に表示します";
}
$("#issueBtn").onclick = () => {
  setShowIssues(!S.showIssues); lsSet("flowbook.showIssues", S.showIssues ? "1" : "");
  updateIssueBtn(); drawCanvas();
  if (S.selected) revealStep(S.selected);
};
// ツール・手段を表示：使用システム・ツール・手段を、ステップの箱の中に小さく出す。オフのときは、ステップに乗せたときのツールチップだけで見せる
function updateInfoBtn(){
  const b = $("#infoBtn"), n = S.flow ? S.flow.steps.filter(hasTool).length : 0;
  $("#infoBtnCount").textContent = n;
  b.disabled = !n;
  b.setAttribute("aria-pressed", String(S.showInfo));
  b.title = !n ? `${TOOL_NAME}が書かれたステップはありません` : S.showInfo ? `ステップの中の${TOOL_NAME}を隠します（ステップにマウスを乗せると表示）` : `${TOOL_NAME}を、ステップの中に表示します`;
}
$("#infoBtn").onclick = () => {
  setShowInfo(!S.showInfo); lsSet("flowbook.showInfo", S.showInfo ? "1" : "");
  updateInfoBtn(); drawCanvas();
};
// 凡例：ふだんはたたんでおく（開け閉めはこの端末で覚えておく）。画像出力の凡例は、たたんでいても .legend の記号を読む
function setLegendOpen(on){
  $("#legend").hidden = !on;
  const b = $("#legendToggle"); b.setAttribute("aria-expanded", String(on)); b.title = on ? "凡例を閉じる" : "凡例を開く";
}
$("#legendToggle").onclick = () => { const on = $("#legend").hidden; setLegendOpen(on); lsSet("flowbook.legendOpen", on ? "1" : ""); };
setLegendOpen(lsGet("flowbook.legendOpen") === "1");
// 課題の欄を開いて書き直す（図の吹き出しのダブルクリック）
function editIssue(id){
  if ($(".body").classList.contains("focus")) $("#focusBtn").click();
  select(id);
  const t = $("#si-" + CSS.escape(id)); if (!t) return;
  t.scrollIntoView({ block: "nearest" }); t.focus(); t.setSelectionRange(t.value.length, t.value.length);
}
// 図だけ表示：フロー一覧と編集エリア・メモを隠す。図の上での編集はそのまま使える
$("#focusBtn").onclick = () => {
  const on = $(".body").classList.toggle("focus"), b = $("#focusBtn");
  b.setAttribute("aria-pressed", String(on));
  b.textContent = on ? "編集エリアを表示" : "図だけ表示";
  b.title = on ? "フロー一覧と編集エリア・メモを元どおり表示します" : "フロー一覧と編集エリア・メモを隠して、図を広く表示します";
  if (inlineEd && !inlineEd.place()) inlineEd.finish(true);
  if (S.selected) revealStep(S.selected);
};
// Ctrl＋ホイール（トラックパッドのピンチ含む）でマウス位置を中心に 10% ずつ拡大縮小。
// ホイール1目盛りで1段。ピンチのような細かい動きは、ある程度たまってから1段動かす
let wheelAcc = 0, wheelAt = 0;
$("#canvas").addEventListener("wheel", ev => {
  if (!ev.ctrlKey || !S.flow) return;
  ev.preventDefault();
  const now = performance.now(); if (now - wheelAt > 300) wheelAcc = 0; wheelAt = now;
  wheelAcc += ev.deltaY * (ev.deltaMode === 1 ? 33 : ev.deltaMode === 2 ? 100 : 1);
  if (Math.abs(wheelAcc) < 40) return;
  const dir = wheelAcc < 0 ? 1 : -1; wheelAcc = 0;
  const rect = $("#canvas").getBoundingClientRect();
  zoomStep(dir, ev.clientX - rect.left, ev.clientY - rect.top);
}, { passive: false });
// 空いているところをドラッグして図を動かす
let pan = null, panMoved = false;
$("#canvas").addEventListener("pointerdown", ev => {
  if (ev.button !== 0 || ev.target.closest("[data-step],[data-handle],[data-eplus],[data-end],[data-new],button")) return;
  const c = $("#canvas"); pan = { x: ev.clientX, y: ev.clientY, l: c.scrollLeft, t: c.scrollTop, id: ev.pointerId }; panMoved = false;
});
$("#canvas").addEventListener("pointermove", ev => {
  if (!pan || ev.pointerId !== pan.id) return;
  const dx = ev.clientX - pan.x, dy = ev.clientY - pan.y, c = $("#canvas");
  if (!panMoved){ if (Math.hypot(dx, dy) < 4) return; panMoved = true; c.classList.add("panning"); c.setPointerCapture(ev.pointerId); }
  c.scrollLeft = pan.l - dx; c.scrollTop = pan.t - dy;
});
const endPan = ev => { if (!pan || ev.pointerId !== pan.id) return; pan = null; $("#canvas").classList.remove("panning"); };
$("#canvas").addEventListener("pointerup", endPan);
$("#canvas").addEventListener("pointercancel", endPan);

/* ---------- editing on the diagram ---------- */
let noClickUntil = 0; // ドラッグや＋の直後に届くクリックを「選択解除」にしない
const mainSvg = () => $("#canvas .diagram svg:not(.lanes)");
const nodeEl = id => $(`#canvas [data-step="${CSS.escape(id)}"]`);
function focusNode(id){ const g = id && nodeEl(id); g && g.focus({ preventScroll: true }); }
// 画面の座標 ⇔ 図の座標（viewBox・拡大率・スクロールを含めて変換）
function toSvg(cx, cy){ const m = mainSvg()?.getScreenCTM(); if (!m) return null; const p = new DOMPoint(cx, cy).matrixTransform(m.inverse()); return [p.x, p.y]; }
function toClient(x, y){ const m = mainSvg()?.getScreenCTM(); if (!m) return null; const p = new DOMPoint(x, y).matrixTransform(m); return [p.x, p.y]; }
// 図の y 座標にあるレーン。図の外や「担当未設定」の仮レーンは null
function laneAt(y){ if (!S.lastL || y < 0) return null; const l = S.lastL.lanes[S.lastL.laneY.findIndex((t, i) => y < S.lastL.laneY[i + 1])]; return l && !l.ghost ? l : null; }
/* 図の y 座標にある段。行の帯の上下の端のすぐ近くは段と段の間（新しい段を差し込む）、それ以外はその段。
   { lane, t: レーンの中の段（0 始まり。差し込むときは差し込んだあとの段）, ins: 差し込むか, y: 置き場所の箱の上端, line: 差し込む位置の線の y } */
function slotAt(y){
  const lane = laneAt(y); if (!lane) return null;
  const li = S.lastL.lanes.indexOf(lane), B = S.lastL.bandY, gs = S.lastL.rows.map((w, g) => g).filter(g => S.lastL.rows[g].r === li);
  const g = gs.find(g => y < B[g + 1]) ?? gs[gs.length - 1], t = S.lastL.rows[g].t, q = Math.min(18, (B[g + 1] - B[g]) / 6);
  // 差し込む箱は境目にまたがせる（レーンの端では、レーンの内側に収める）
  const ins = (line, t) => ({ lane, t, ins: true, line, y: Math.max(S.lastL.laneY[li] + 3, Math.min(S.lastL.laneY[li + 1] - G.nodeH - 3, line - G.nodeH / 2)) });
  if (y < B[g] + q) return ins(B[g], t);
  if (y > B[g + 1] - q) return ins(B[g + 1], t + 1);
  return { lane, t, ins: false, y: S.lastL.rowY[g] };
}
// ステップをドラッグして p（図の座標）まで動かしたときの段。つかんだ位置によらず、動かした箱の真ん中の高さで決める
const dropSlot = (P, p, sp) => slotAt(p[1] - sp[1] + P.y + P.h / 2);
// 置き場所の箱（と差し込む位置の線）を見せる。sl が null なら隠す
function showSlot(sl, x){
  const sv = mainSvg(), gh = sv.querySelector(".drop-ghost"), ln = sv.querySelector(".drop-line");
  gh.setAttribute("visibility", sl ? "visible" : "hidden");
  ln.setAttribute("visibility", sl?.ins ? "visible" : "hidden");
  if (!sl) return;
  gh.setAttribute("x", x); gh.setAttribute("y", sl.y);
  if (sl.ins){ ln.setAttribute("x1", x - 14); ln.setAttribute("x2", x + G.nodeW + 14); ln.setAttribute("y1", sl.line); ln.setAttribute("y2", sl.line); }
}
// 列の左端の x（図の右端より先は、ふつうの列幅で並ぶものとして延ばす）と、x に一番近い列
const colLeft = c => { const X = S.lastL.colX, n = X.length - 1; return c <= n ? X[c] : X[n] + (c - n) * (G.nodeW + G.gap); };
function colAt(x){ let c = 0; while (Math.abs(colLeft(c + 1) + G.nodeW / 2 - x) < Math.abs(colLeft(c) + G.nodeW / 2 - x)) c++; return c; }
function showLaneHi(l){
  const i = l ? S.lastL.lanes.indexOf(l) : -1;
  document.querySelectorAll("#canvas .lane-hi").forEach(r => { r.setAttribute("visibility", i < 0 ? "hidden" : "visible"); if (i >= 0){ r.setAttribute("y", S.lastL.laneY[i]); r.setAttribute("height", S.lastL.laneY[i + 1] - S.lastL.laneY[i]); } });
}

/* その場の入力欄。anchor() は入力欄を重ねる位置（画面座標の矩形）を返し、スクロールや描き直しのたびに置き直す。
   Enter で確定、Esc で取り消し、ほかをクリックしたら確定 */
let inlineEd = null;
function inlineEdit(anchor, value, opts, done){
  if (inlineEd) inlineEd.finish(true);
  const el = document.createElement("input");
  el.className = "inline-edit"; el.value = value; el.placeholder = opts.placeholder || ""; el.setAttribute("aria-label", opts.label || "");
  const place = () => {
    const r = anchor(); if (!r) return false;
    const w = Math.max(r.width + 16, opts.minW || 170);
    Object.assign(el.style, { left: r.left + r.width / 2 - w / 2 + "px", top: r.top + r.height / 2 - 16 + "px", width: w + "px" });
    return true;
  };
  if (!place()) return;
  let fin = false;
  const finish = (ok, byKey) => {
    if (fin) return; fin = true; inlineEd = null;
    const v = el.value.trim(); el.remove();
    if (ok && v !== value.trim()) done(v);
    if (byKey && opts.focus) focusNode(opts.focus);
  };
  el.addEventListener("keydown", e => {
    if (e.isComposing || e.keyCode === 229) return; // 変換確定の Enter は無視
    if (e.key === "Enter"){ e.preventDefault(); finish(true, true); }
    else if (e.key === "Escape"){ e.preventDefault(); e.stopPropagation(); finish(false, true); }
  });
  el.addEventListener("blur", () => finish(true));
  if (opts.onInput){ el.addEventListener("input", () => opts.onInput(el)); opts.onInput(el); }
  document.body.appendChild(el); el.focus(); el.select();
  inlineEd = { el, finish, place };
}
$("#canvas").addEventListener("scroll", () => { if (inlineEd && !inlineEd.place()) inlineEd.finish(true); if (typeMn && !typeMn.place()) typeMn.close(); });
window.addEventListener("resize", () => { if (inlineEd && !inlineEd.place()) inlineEd.finish(true); if (typeMn && !typeMn.place()) typeMn.close(); });

function editStepInline(id){
  const s0 = S.flow && S.flow.steps.find(x => x.id === id); if (!s0) return;
  revealStep(id);
  inlineEdit(() => nodeEl(id)?.querySelector(".shape")?.getBoundingClientRect(), s0.label,
    { placeholder: "ステップの内容（例：申請書を作成）", label: "ステップの内容", focus: id },
    v => { const s = S.flow.steps.find(x => x.id === id); if (s){ s.label = v; commit({ form: true }); } });
}
// 矢印の条件を編集する。pt（図の座標）を省くと、ラベルの位置か矢印の出口近くに入力欄を出す
function editEdgeInline(sid, k, pt){
  const s0 = S.flow && S.flow.steps.find(x => x.id === sid), e0 = s0?.next[k]; if (!e0) return;
  const sel = cls => $(`#canvas .${cls}[data-edge="${CSS.escape(sid)}"][data-k="${k}"]`);
  if (!pt && !sel("elabel")){
    const path = sel("ehit"); if (!path) return;
    const q = path.getPointAtLength(Math.min(40, path.getTotalLength() / 2)); pt = [q.x, q.y];
  }
  const anchor = pt ? () => { const c = toClient(...pt); return c && { left: c[0], top: c[1], width: 0, height: 0 }; } : () => sel("elabel")?.getBoundingClientRect();
  const to = S.flow.steps.find(x => x.id === e0.to);
  inlineEdit(anchor, e0.when, { placeholder: "条件（例：承認）", label: `「${s0.label || sid}」から「${to?.label || e0.to}」への条件`, minW: 150, onInput: markCut },
    v => { const e = S.flow.steps.find(x => x.id === sid)?.next[k]; if (e){ e.when = v; commit({ form: true }); } });
}
function scrollCard(id){ const el = document.querySelector(`[data-stepcard="${CSS.escape(id)}"]`); el && el.scrollIntoView({ block: "nearest" }); }
const blankStep = (id, type, lane) => ({ id, type, lane, label: "", note: "", issue: "", tool: "", related: [], next: [] });
/* 種類 type の次のステップを作り、srcId からつなぐ。今の次のステップはそのまま残し、枝を 1 本足す（間に入れるのは矢印の＋の insertOnEdge）。
   帳票・データなら、流れではなく関連（点線）で結ぶ（srcId が帳票・データなら、それを使う作業を関連で結ぶ）。sl（slotAt の形）を渡すとその段に置く */
function addNext(srcId, laneId, type, sl){
  const s = S.flow.steps.find(x => x.id === srcId); if (!s) return;
  const id = newStepId(), ns = blankStep(id, type, laneId);
  if (isArtifact(ns) || isArtifact(s)) (s.related ||= []).push(id);
  else s.next.push({ to: id, when: "" });
  S.flow.steps.splice(S.flow.steps.indexOf(s) + 1, 0, ns);
  if (sl) pinSlot(ns, sl.lane, sl, null);
  commit({ form: true, select: id }); scrollCard(id); editStepInline(id);
}
/* 種類 type の前のステップを作り、dstId へつなぐ。dstId へ来ていた矢印はそのまま残す。
   帳票・データなら、dstId へ関連（点線）で結ぶ（dstId で使う帳票。dstId が帳票・データなら、それを作る作業） */
function addPrev(dstId, laneId, type, sl){
  const t = S.flow.steps.find(x => x.id === dstId); if (!t) return;
  const id = newStepId(), ns = blankStep(id, type, laneId);
  if (isArtifact(ns) || isArtifact(t)) ns.related.push(dstId); else ns.next.push({ to: dstId, when: "" });
  S.flow.steps.splice(S.flow.steps.indexOf(t), 0, ns);
  if (sl) pinSlot(ns, sl.lane, sl, null);
  commit({ form: true, select: id }); scrollCard(id); editStepInline(id);
}
/* 矢印の＋：流れの矢印 ref の間に種類 type のステップを入れる（前→新→後）。担当は矢印の元と同じ。
   条件・出る辺は前の矢印に、入る辺は新しいステップから出る矢印に残す */
function insertOnEdge(ref, type){
  const s = S.flow.steps.find(x => x.id === ref.sid), e = s?.next[ref.k]; if (!e) return;
  const id = newStepId(), ns = blankStep(id, type, s.lane), ne = { to: e.to, when: "" };
  if (e.entry){ ne.entry = e.entry; delete e.entry; }
  ns.next.push(ne); e.to = id;
  S.flow.steps.splice(S.flow.steps.indexOf(s) + 1, 0, ns);
  commit({ form: true, select: id }); scrollCard(id); editStepInline(id);
}
/* ＋から足せる種類。開始はつなぎ先に、終了は前のステップにならないので出さない。"-" は区切り。
   帳票・データから足すのは、それを作る・使うステップだけ。矢印の間には帳票・データを入れない（流れに入らないため） */
const ART_TYPES = ["document", "dataObject", "dataStore"], FLOW_TYPES = ["task", "decision", "subProcess"];
const plusTypes = (s, side) => isArtifact(s) ? FLOW_TYPES : side === "L" ? ["start", ...FLOW_TYPES, "-", ...ART_TYPES] : [...FLOW_TYPES, "end", "-", ...ART_TYPES];
// ステップの＋の担当：左右は同じ担当、上・下は 1 つ上・下のレーン
function plusLane(s, side){
  if (side === "L" || side === "R") return s.lane;
  const i = S.flow.lanes.findIndex(l => l.id === s.lane), l = i >= 0 && S.flow.lanes[i + (side === "T" ? -1 : 1)];
  return l ? l.id : null;
}
// ステップの＋を押した：種類を選ぶメニューを出し、選んだ種類のステップを足す
function plus(side){
  const s = curStep(), lane = s && plusLane(s, side); if (!lane) return;
  typeMenu(() => $(`#canvas [data-handle="${side}"]`)?.getBoundingClientRect(), plusTypes(s, side),
    type => side === "L" ? addPrev(s.id, lane, type) : addNext(s.id, lane, type));
}
// 選んだ矢印の＋を押した：種類を選ぶメニューを出し、矢印の間に入れる
function plusEdge(){
  const ref = S.selEdge; if (!ref || ref.rel || refTo(ref) == null) return;
  typeMenu(() => $("#canvas [data-eplus]")?.getBoundingClientRect(), FLOW_TYPES, type => insertOnEdge(ref, type));
}
/* 種類を選ぶメニュー（＋から足すステップの種類）。anchor() はメニューを添える位置（画面座標の矩形）を返し、スクロールのたびに置き直す。
   先頭の項目（作業）にフォーカスを置き、↑↓ で動かし、Enter・クリックで決める。Esc・ほかの所を押すと閉じる */
let typeMn = null;
function typeMenu(anchor, types, done){
  if (typeMn) typeMn.close();
  if (inlineEd) inlineEd.finish(true);
  const el = document.createElement("div"), back = document.activeElement, t0 = performance.now();
  el.className = "type-menu"; el.setAttribute("role", "menu"); el.setAttribute("aria-label", "足すステップの種類");
  el.innerHTML = types.map(t => t === "-" ? `<hr>` : `<button type="button" role="menuitem" data-type="${t}">${typeIcon(t)}<span>${TYPES[t]}</span></button>`).join("");
  const place = () => {
    const r = anchor(); if (!r) return false;
    const w = el.offsetWidth, h = el.offsetHeight, m = 8;
    const left = r.right + m + w <= innerWidth ? r.right + m : Math.max(m, r.left - m - w);
    Object.assign(el.style, { left: left + "px", top: Math.max(m, Math.min(r.top - 6, innerHeight - h - m)) + "px" });
    return true;
  };
  let fin = false;
  const close = byKey => {
    if (fin) return; fin = true; typeMn = null; el.remove();
    document.removeEventListener("pointerdown", outside, true);
    if (byKey) back?.isConnected ? back.focus({ preventScroll: true }) : focusNode(S.selected);
  };
  const outside = ev => { if (!el.contains(ev.target)) close(); };
  const items = () => [...el.querySelectorAll("button")];
  const choose = b => { close(); done(b.dataset.type); };
  el.addEventListener("click", ev => {
    const b = ev.target.closest("button[data-type]");
    // ＋を Space で押したときの、離した瞬間に届くクリック（キーからのクリックは detail が 0）は拾わない
    if (!b || (!ev.detail && performance.now() - t0 < 150)) return;
    choose(b);
  });
  el.addEventListener("keydown", ev => {
    const bs = items(), i = bs.indexOf(document.activeElement);
    if (ev.key === "Enter" && i >= 0){ ev.preventDefault(); choose(bs[i]); }
    else if (ev.key === "ArrowDown" || ev.key === "ArrowUp"){ ev.preventDefault(); bs[(i + (ev.key === "ArrowDown" ? 1 : -1) + bs.length) % bs.length].focus(); }
    else if (ev.key === "Home" || ev.key === "End"){ ev.preventDefault(); bs[ev.key === "Home" ? 0 : bs.length - 1].focus(); }
    else if (ev.key === "Escape"){ ev.preventDefault(); ev.stopPropagation(); close(true); }
    else if (ev.key === "Tab") close();
  });
  el.style.visibility = "hidden"; document.body.appendChild(el);
  if (!place()){ el.remove(); return; }
  el.style.visibility = "";
  document.addEventListener("pointerdown", outside, true);
  items()[0].focus({ preventScroll: true });
  typeMn = { el, close, place };
}
/* 前の列へ戻る矢印は、自動の経路（下や左から回り込む）だとつないだ向きと離れて見えるので、
   2つのステップのいちばん近い辺どうしを出る辺・入る辺に指定する（気に入らなければ端をドラッグしてつなぎ替えられる）。
   すでにほかの矢印が出入りしている辺は避け、空いている辺の中でいちばん近いものを選ぶ（全部ふさがっていれば近さだけで選ぶ）。
   used は、この矢印を足す前の図で矢印が出入りしている辺（ステップID + 辺）。
   fix で辺を決めた側（ドラッグを始めた＋の辺。{ exit } か { entry }）は、ふさがっていてもその辺を使う */
function pinNearest(e, used, fix = {}){
  const E = layout(S.flow).edges.find(E => E.e === e); if (!E || E.kind !== "loop") return;
  let best = Infinity;
  for (const so of fix.exit || "TBLR") for (const ti of fix.entry || "TBLR"){
    const [x1, y1] = portAt(E.s, E.a, so), [x2, y2] = portAt(E.t, E.b, ti);
    const d = Math.hypot(x2 - x1, y2 - y1) + (used.has(E.s.id + so) ? 1e5 : 0) + (used.has(E.t.id + ti) ? 1e5 : 0);
    if (d < best){ best = d; e.exit = so; e.entry = ti; }
  }
}
// 図の上で矢印が出入りしている辺（ステップID + 辺）。自分へ戻る矢印は上の辺を使う
const usedSides = L => new Set(L.edges.flatMap(E => E.kind === "self" ? [E.s.id + "T"] : [E.s.id + E.so, E.t.id + E.ti]));
/* a から b へつなぐ。rel なら流れではなく関連（点線）で結ぶ（帳票・データとは必ず関連）。関連で結んでいた相手へ流れをつなぐと、関連は流れに置き換える */
function connect(a, b, fix, rel){
  const s = S.flow.steps.find(x => x.id === a), t = S.flow.steps.find(x => x.id === b); if (!s || !t || a === b){ drawCanvas(); return; }
  rel ||= isArtifact(s) || isArtifact(t);
  if (s.next.some(e => e.to === b) || (rel && (s.related?.includes(b) || t.related?.includes(a)))){ toast("すでにつながっています"); drawCanvas(); return; }
  if (rel){ (s.related ||= []).push(b); commit({ form: true }); return; }
  if (s.related?.includes(b)) s.related = s.related.filter(x => x !== b);
  const used = usedSides(layout(S.flow)), e = { to: b, when: "" }; s.next.push(e); pinNearest(e, used, fix); commit({ form: true });
  if (s.type === "decision") editEdgeInline(a, s.next.length - 1);
}

/* 選んだ矢印の端を離した先。ステップの上なら { id, side, pt }。
   side は箱の外寄り（中心から縦横それぞれ半分より外）にいるときの一番近い辺で、真ん中なら null（自動） */
function reattachAt(ev, p, d){
  const g = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.("#canvas [data-step]"); if (!g) return null;
  const id = g.dataset.step, to = refTo(d.edge); if (to == null) return null;
  // 矢印の両端を同じステップにはしない
  if (d.reattach === "t" ? id === d.edge.sid : id === to) return null;
  // 関連（点線）は辺を指定しない
  if (d.edge.rel) return { id, side: null, pt: null };
  const st = S.lastL.steps.find(x => x.id === id), pos = S.lastL.pos.get(id);
  const dx = (p[0] - (pos.x + pos.w / 2)) / (pos.w / 2), dy = (p[1] - (pos.y + pos.h / 2)) / (pos.h / 2);
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 0.5) return { id, side: null, pt: null };
  // 一番近い辺（左右の辺までと上下の辺までの距離を比べる）
  const side = (1 - Math.abs(dx)) * pos.w < (1 - Math.abs(dy)) * pos.h ? (dx > 0 ? "R" : "L") : (dy > 0 ? "B" : "T");
  return { id, side, pt: portAt(st, pos, side) };
}
/* 矢印のつなぎ替え。end は動かした端（s = 出るステップ、t = つなぎ先）、side は出入りする辺（null で自動） */
function reattach(ref, end, id, side){
  if (ref.rel) return reattachRel(ref, end, id);
  const s = S.flow.steps.find(x => x.id === ref.sid), e = s?.next[ref.k]; if (!e){ drawCanvas(); return; }
  const pin = (k, v) => { if (v) e[k] = v; else delete e[k]; };
  if (end === "t"){
    if (id === e.to){ if ((e.entry || null) === side){ drawCanvas(); return; } pin("entry", side); commit({ form: true, select: null, edge: ref }); return; }
    if (s.next.some(x => x !== e && x.to === id)){ toast("すでにつながっています"); drawCanvas(); return; }
    e.to = id; pin("entry", side); commit({ form: true, select: null, edge: ref });
    return;
  }
  if (id === s.id){ if ((e.exit || null) === side){ drawCanvas(); return; } pin("exit", side); commit({ form: true, select: null, edge: ref }); return; }
  const ns = S.flow.steps.find(x => x.id === id); if (!ns){ drawCanvas(); return; }
  if (ns.next.some(x => x.to === e.to)){ toast("すでにつながっています"); drawCanvas(); return; }
  s.next.splice(ref.k, 1); pin("exit", side); ns.next.push(e);
  commit({ form: true, select: null, edge: { sid: ns.id, k: ns.next.length - 1 } });
}
// 関連（点線）のつなぎ替え。end = t なら相手を、s なら関連元を id に変える
function reattachRel(ref, end, id){
  const s = S.flow.steps.find(x => x.id === ref.sid), to = s?.related?.[ref.k]; if (to == null){ drawCanvas(); return; }
  const [a, b] = end === "t" ? [s.id, id] : [id, to], ns = S.flow.steps.find(x => x.id === a), nt = S.flow.steps.find(x => x.id === b);
  if (!ns || !nt || (a === s.id && b === to)){ drawCanvas(); return; }
  if (ns.next.some(e => e.to === b) || ns.related?.includes(b) || nt.related?.includes(a)){ toast("すでにつながっています"); drawCanvas(); return; }
  if (end === "t"){ s.related[ref.k] = id; commit({ form: true, select: null, edge: ref }); return; }
  s.related.splice(ref.k, 1); (ns.related ||= []).push(to);
  commit({ form: true, select: null, edge: { sid: ns.id, k: ns.related.length - 1, rel: true } });
}

/* ドラッグ：＋からは「つなぐ」（ステップの上で離すと接続、空いたところで離すとそこに新しいステップ。左の＋は向きが逆）。
   ステップ本体は左右に動かすと列が、別のレーンへ動かすと担当が変わる */
let drag = null;
const inCanvas = ev => { const r = $("#canvas").getBoundingClientRect(); return ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom; };
const targetAt = (ev, src) => { const g = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.("#canvas [data-step]"); return g && g.dataset.step !== src ? g.dataset.step : null; };
function autoScroll(ev){
  const c = $("#canvas"), r = c.getBoundingClientRect(), m = 32, v = 16;
  if (ev.clientX > r.right - m) c.scrollLeft += v; else if (ev.clientX < r.left + m) c.scrollLeft -= v;
  if (ev.clientY > r.bottom - m) c.scrollTop += v; else if (ev.clientY < r.top + m) c.scrollTop -= v;
}
$("#canvas").addEventListener("pointerdown", ev => {
  if (ev.button !== 0 || !S.flow) return;
  const en = ev.target.closest("[data-end]");
  if (en && S.selEdge){
    const sp = toSvg(ev.clientX, ev.clientY); if (!sp) return;
    const E = S.lastL.edges.find(E => isRef(E, S.selEdge)); if (!E) return;
    // 動かさない側の端（線の起点）
    const fixed = en.dataset.end === "s" ? E.pts[E.pts.length - 1] : E.pts[0];
    drag = { reattach: en.dataset.end, edge: { ...S.selEdge }, from: fixed, x: ev.clientX, y: ev.clientY, sp, pid: ev.pointerId, moved: false };
    ev.preventDefault(); return;
  }
  const h = ev.target.closest("[data-handle]"), g = !h && ev.target.closest("[data-step]");
  if (!h && !g) return;
  const sp = toSvg(ev.clientX, ev.clientY); if (!sp) return;
  drag = { link: !!h, id: h ? S.selected : g.dataset.step, side: h?.dataset.handle, from: h ? [+h.dataset.x, +h.dataset.y] : null, x: ev.clientX, y: ev.clientY, sp, pid: ev.pointerId, moved: false };
  if (h) ev.preventDefault();
});
$("#canvas").addEventListener("pointermove", ev => {
  if (!drag || ev.pointerId !== drag.pid) return;
  const c = $("#canvas");
  if (!drag.moved){
    if (Math.hypot(ev.clientX - drag.x, ev.clientY - drag.y) < 5) return;
    drag.moved = true; try { c.setPointerCapture(ev.pointerId); } catch {} c.classList.add(drag.reattach ? "reattaching" : drag.link ? "linking" : "dragging");
    if (inlineEd) inlineEd.finish(true);
    if (drag.link) mainSvg().insertAdjacentHTML("beforeend", `<path class="link-temp" marker-end="url(#arrS)"/><rect class="drop-ghost" width="${G.nodeW}" height="${G.nodeH}" rx="6" visibility="hidden"/><line class="drop-line" visibility="hidden"/>`);
    else if (!drag.reattach) mainSvg().insertAdjacentHTML("beforeend", `<rect class="drop-ghost" width="${G.nodeW}" height="${G.nodeH}" rx="6" visibility="hidden"/><line class="drop-line" visibility="hidden"/>`);
    if (drag.reattach) mainSvg().insertAdjacentHTML("beforeend", `<path class="link-temp" marker-end="url(#arrS)"/><circle class="side-mark" r="5" visibility="hidden"/>`);
  }
  // 関連（点線）の線を動かす・Shift を押しながら＋からつなぐときは、仮の線も関連の見た目にする
  if (drag.link) drag.rel = ev.shiftKey;
  const lt = mainSvg().querySelector(".link-temp"), rel = drag.reattach ? !!drag.edge.rel : drag.rel;
  if (lt && lt.classList.contains("assoc") !== !!rel){ lt.classList.toggle("assoc", !!rel); lt.setAttribute("marker-end", `url(#${rel ? "oarS" : "arrS"})`); }
  autoScroll(ev);
  const p = toSvg(ev.clientX, ev.clientY); if (!p) return;
  if (drag.reattach){
    const sv = mainSvg(), hit = reattachAt(ev, p, drag), mk = sv.querySelector(".side-mark");
    sv.querySelectorAll(".link-target").forEach(n => n.classList.remove("link-target"));
    if (hit) nodeEl(hit.id).classList.add("link-target");
    const q = hit?.pt || p;
    mk.setAttribute("visibility", hit?.side ? "visible" : "hidden");
    if (hit?.side){ mk.setAttribute("cx", q[0]); mk.setAttribute("cy", q[1]); }
    const [a, b] = drag.reattach === "t" ? [drag.from, q] : [q, drag.from];
    sv.querySelector(".link-temp").setAttribute("d", `M${a[0]} ${a[1]} L${b[0]} ${b[1]}`);
    return;
  }
  const lane = inCanvas(ev) ? laneAt(p[1]) : null;
  if (drag.link){
    const sv = mainSvg(), tgt = targetAt(ev, drag.id), gh = sv.querySelector(".drop-ghost");
    sv.querySelectorAll(".link-target").forEach(n => n.classList.remove("link-target"));
    if (tgt) nodeEl(tgt).classList.add("link-target");
    // 左の＋（前のステップ）からは、離した先から選択中のステップへ向かう矢印
    const [a, b] = drag.side === "L" ? [p, drag.from] : [drag.from, p];
    sv.querySelector(".link-temp").setAttribute("d", `M${a[0]} ${a[1]} L${b[0]} ${b[1]}`);
    const sl = !tgt && lane ? slotAt(p[1]) : null;
    showSlot(sl, p[0] - G.nodeW / 2);
    showLaneHi(sl ? lane : null);
  } else {
    const g = nodeEl(drag.id);
    if (g){ g.classList.add("dragging"); g.setAttribute("transform", `translate(${p[0] - drag.sp[0]} ${p[1] - drag.sp[1]})`); }
    // 離したときに置かれる場所（列・レーン・段）を点線の箱で示す。段を差し込むときは境目に線も出す
    const P = S.lastL.pos.get(drag.id), c = P && colAt(P.x + G.nodeW / 2 + p[0] - drag.sp[0]), sl = P && inCanvas(ev) ? dropSlot(P, p, drag.sp) : null;
    showSlot(sl && (sl.ins || c !== P.c || S.lastL.lanes.indexOf(sl.lane) !== P.l || sl.t !== P.t) ? sl : null, colLeft(c));
    showLaneHi(sl?.lane);
  }
});
function endDrag(ev, cancel){
  if (!drag || ev.pointerId !== drag.pid) return;
  const d = drag; drag = null;
  $("#canvas").classList.remove("linking", "dragging", "reattaching");
  if (!d.moved){ if (d.link && !cancel){ noClickUntil = performance.now() + 400; plus(d.side); } return; }
  noClickUntil = performance.now() + 400; showLaneHi(null);
  const p = !cancel && inCanvas(ev) && toSvg(ev.clientX, ev.clientY), lane = p && laneAt(p[1]);
  if (d.reattach){ const hit = p && reattachAt(ev, p, d); if (hit) reattach(d.edge, d.reattach, hit.id, hit.side); else drawCanvas(); return; }
  if (d.link){
    const tgt = p && targetAt(ev, d.id);
    const prev = d.side === "L", rel = !!p && ev.shiftKey;
    // 前の列へ戻るときは、ドラッグを始めた＋の辺から線を出す（左の＋は選択中のステップの左の辺へ入れる）。
    // 空いた所で離すと、種類を選ぶメニューを出してそこに置く。
    // Shift を押しながら離すと関連（点線）で結ぶ（空いた所なら、メニューを出さずに関連で結んだ帳票を作る）
    if (tgt) prev ? connect(tgt, d.id, { entry: "L" }, rel) : connect(d.id, tgt, { exit: d.side }, rel);
    else if (lane){
      const sl = slotAt(p[1]), s = S.flow.steps.find(x => x.id === d.id), add = type => prev ? addPrev(d.id, lane.id, type, sl) : addNext(d.id, lane.id, type, sl);
      drawCanvas();
      if (rel || isArtifact(s)) add(rel && !isArtifact(s) ? "document" : "task");
      else typeMenu(() => { const c = toClient(...p); return c && { left: c[0], top: c[1], right: c[0], bottom: c[1], width: 0, height: 0 }; }, plusTypes(s, d.side), add);
    }
    else drawCanvas();
    return;
  }
  const s = S.flow.steps.find(x => x.id === d.id), P = S.lastL.pos.get(d.id), sl = s && P && p ? dropSlot(P, p, d.sp) : null;
  const c = sl ? colAt(P.x + G.nodeW / 2 + p[0] - d.sp[0]) : -1;
  if (!sl || (sl.lane.id === s.lane && c === P.c && sl.t === P.t && !sl.ins)){ drawCanvas(); return; }
  moveStep(s, sl.lane, c, { ...sl, drop: true });
}
/* 図の位置の指定（col・row）を書く。s を lane の段 sl（slotAt の形）・c 列目（0 始まり。null なら列は自動のまま）に置く。
   置くマス（段と段の境目なら、その下の段のマス）にほかのステップがいるときは、その列（c）で置く段から下のステップを 1 段ずつ下げ、
   列も固定して同じ列の真下に留める。ほかの列のステップは動かさない（sl.drop のない左右だけの移動＝ Shift+←→ では下げない）。
   空いたマスなら、だれも動かさずにそこへ置く（境目でも段は増えない。一番下の境目なら新しい段になる）。
   列の決まっていない新しいステップ（c が null）を境目に置くときは、レーン全体で置く段から下を 1 段ずつ下げる。
   下げたステップには段を書き、もともと段を指定していたステップは今の段に書き直す（指定のないステップは前のステップの段を引き継ぐ）。
   Shift+←→ で同じマスに列を指定していたステップは、列の指定を外して自動の配置に戻す。最後に、外しても配置が変わらない指定を外す */
function pinSlot(s, lane, sl, c){
  const L0 = S.lastL, li = L0.lanes.indexOf(lane), touched = [s], P = L0.pos.get(s.id);
  const push = c != null && (sl.ins || sl.drop || !P || P.l !== li || P.t !== sl.t)
    && L0.steps.some(x => x.id !== s.id && L0.pos.get(x.id)?.l === li && L0.pos.get(x.id).t === sl.t && L0.pos.get(x.id).c === c);
  s.lane = lane.id;
  if (c != null) s.col = c + 1;
  S.flow.steps.forEach(x => {
    const p = x !== s && L0.pos.get(x.id); if (!p || p.l !== li) return;
    const down = p.t >= sl.t && (c != null ? push && p.c === c : sl.ins);
    if (down || x.row){ x.row = p.t + 1 + (down ? 1 : 0); touched.push(x); }
    if (push && down) x.col = c + 1;
    else if (c != null && !sl.ins && p.t === sl.t && x.col === s.col) delete x.col;
  });
  s.row = sl.t + 1;
  prunePins(touched);
}
// list のステップの col・row のうち、外してもステップの置き場所（レーン・段・列）が変わらないものを外す
function prunePins(list){
  const spots = () => { const P = layout(S.flow, null, true).pos; return S.flow.steps.map(x => { const p = P.get(x.id); return p ? p.l + ":" + p.t + ":" + p.c : ""; }).join(); };
  const want = spots();
  // 列の指定を外すと段が自動に戻ることがあるので、2 回まわす
  for (let i = 0; i < 2; i++) list.forEach(x => ["col", "row"].forEach(k => { if (!x[k]) return; const v = x[k]; delete x[k]; if (spots() !== want) x[k] = v; }));
}
/* ステップを lane の段 sl・c 列目（0 始まり）へ動かす。自動で決まる位置と同じなら指定（col・row）は外し、違えば残す */
function moveStep(s, lane, c, sl){
  pinSlot(s, lane, sl, c);
  commit({ form: true, select: s.id });
}
$("#canvas").addEventListener("pointerup", ev => endDrag(ev, false));
$("#canvas").addEventListener("pointercancel", ev => endDrag(ev, true));

function undo(redo){
  const e = takeUndo(redo);
  if (!e){ toast(redo ? "やり直せる操作はありません" : "元に戻せる操作はありません"); return; }
  setYamlSrc(e.yaml); setFlow(parseYaml(e.yaml));
  setSelected(S.flow.steps.some(s => s.id === e.sel) ? e.sel : null); setSelEdge(null);
  $("#yamlText").value = S.yamlSrc; setYamlMsg(); $("#flowName").value = S.flow.name;
  refresh(true); markDirty(); toast(redo ? "やり直しました" : "元に戻しました");
}
// 入力欄の外でのキー操作：Ctrl+Z / Ctrl+Y、選択中の Delete（削除）・Enter（文言の編集）
document.addEventListener("keydown", e => {
  if (!S.flow || inlineEd || drag || e.target.closest?.("input, textarea, select, [contenteditable], dialog")) return;
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (mod && !e.altKey && (k === "z" || k === "y")){ e.preventDefault(); undo(k === "y" || e.shiftKey); return; }
  // Shift+←→ で選択中のステップを左右の列へ、Shift+↑↓ で上下の段（レーンの端では隣のレーン）へ動かす（ドラッグと同じ）
  if (e.shiftKey && !mod && !e.altKey && /^Arrow/.test(e.key) && S.selected && !S.selEdge && S.lastL?.pos.has(S.selected)){
    const s = curStep(), P = S.lastL.pos.get(S.selected); if (!s) return;
    e.preventDefault();
    const dc = { ArrowLeft: -1, ArrowRight: 1 }[e.key] || 0, dr = { ArrowUp: -1, ArrowDown: 1 }[e.key] || 0;
    const w = S.lastL.rows[P.r + dr], lane = w && S.lastL.lanes[w.r], c = P.c + dc;
    if (!lane || lane.ghost || c < 0){ toast("これ以上は動かせません"); return; }
    moveStep(s, lane, c, { lane, t: w.t, ins: false }); return;
  }
  if (mod || e.altKey) return;
  if (S.selEdge && (e.key === "Delete" || e.key === "Backspace")){
    const ref = S.selEdge, s = S.flow.steps.find(x => x.id === ref.sid), to = refTo(ref); if (to == null) return;
    e.preventDefault(); (ref.rel ? s.related : s.next).splice(ref.k, 1); commit({ form: true, select: null });
    const t = S.flow.steps.find(x => x.id === to);
    toast(ref.rel ? `「${s.label || s.id}」と「${t?.label || to}」の関連を削除しました（Ctrl+Z で元に戻せます）` : `「${s.label || s.id}」から「${t?.label || to}」への矢印を削除しました（Ctrl+Z で元に戻せます）`);
    return;
  }
  const s = curStep(); if (!s) return;
  if (e.key === "Delete" || e.key === "Backspace"){
    e.preventDefault(); deleteStep(s.id); commit({ form: true, select: null });
    toast(`「${s.label || s.id}」を削除しました（Ctrl+Z で元に戻せます）`);
  } else if (e.key === "Enter" && (e.target === document.body || e.target.closest("#canvas"))){ e.preventDefault(); editStepInline(s.id); }
});

/* ---------- flow memo ---------- */
// フロー全体のメモ（図の下の欄）。中身は S.flow.memo（YAML の memo）。開け閉めと高さはこの端末で覚えておく
const memoOpen = () => $("#memo").classList.contains("open");
function syncMemo(){
  const t = $("#memoText"), was = $("#memo").hidden;
  $("#memo").hidden = !S.flow; if (!S.flow) return;
  if (was) fitMemo();
  if (t.value !== S.flow.memo) t.value = S.flow.memo; // 入力中は同じ値なので、カーソルの位置を崩さない
  t.disabled = S.broken;
  memoSum();
}
// 閉じているときは、見出しの横にメモの 1 行目を出す
function memoSum(){
  const lines = (S.flow?.memo || "").split("\n").map(l => l.trim()).filter(Boolean);
  $("#memoSum").textContent = memoOpen() ? "" : lines.length ? lines[0] + (lines.length > 1 ? ` …ほか ${lines.length - 1} 行` : "") : "まだありません";
}
function setMemoOpen(on, save){
  $("#memo").classList.toggle("open", on); $("#memoText").hidden = !on;
  const b = $("#memoToggle"); b.setAttribute("aria-expanded", String(on)); b.title = on ? "メモを閉じる" : "メモを開く";
  if (save) lsSet("flowbook.memoOpen", on ? "1" : "");
  if (on) fitMemo();
  memoSum();
}
$("#memoToggle").onclick = () => { const on = !memoOpen(); setMemoOpen(on, true); if (on) $("#memoText").focus(); };
$("#memoText").addEventListener("input", e => { if (!S.flow) return; S.flow.memo = e.target.value; commit(); });
// 高さ（--memo-h）は上の境目のドラッグ・矢印キーで変える。図とメモで分け合う高さのうち、図に 150px か 45% の多いほうを残す
const MEMO_MIN = 60, MEMO_KEY = "flowbook.memoH";
const memoH = () => parseFloat(getComputedStyle($("#memo")).getPropertyValue("--memo-h")) || 160;
function setMemoH(h){
  const room = $("#canvas").offsetHeight + $("#memoText").offsetHeight, max = Math.max(MEMO_MIN, room - Math.max(150, room * 0.45));
  $("#memo").style.setProperty("--memo-h", Math.round(Math.max(MEMO_MIN, Math.min(max, h))) + "px");
}
// 幅の狭い画面では境目を出さず、高さは CSS で決める
const fitMemo = () => { if (memoOpen() && $("#splitMemo").offsetParent) setMemoH(memoH()); };
{
  const sp = $("#splitMemo"), saved = parseFloat(lsGet(MEMO_KEY));
  if (saved >= MEMO_MIN) $("#memo").style.setProperty("--memo-h", saved + "px");
  sp.addEventListener("pointerdown", e => {
    if (e.button !== 0) return;
    e.preventDefault(); sp.setPointerCapture(e.pointerId);
    sp.classList.add("drag"); document.body.classList.add("resizing-row");
    const y0 = e.clientY, h0 = memoH();
    const move = ev => setMemoH(h0 + y0 - ev.clientY);
    const up = () => {
      sp.removeEventListener("pointermove", move); sp.removeEventListener("pointerup", up); sp.removeEventListener("pointercancel", up);
      sp.classList.remove("drag"); document.body.classList.remove("resizing-row");
      lsSet(MEMO_KEY, String(memoH()));
    };
    sp.addEventListener("pointermove", move); sp.addEventListener("pointerup", up); sp.addEventListener("pointercancel", up);
  });
  sp.addEventListener("dblclick", () => { $("#memo").style.removeProperty("--memo-h"); lsSet(MEMO_KEY, ""); fitMemo(); });
  sp.addEventListener("keydown", e => {
    const d = e.key === "ArrowUp" ? 1 : e.key === "ArrowDown" ? -1 : 0;
    if (!d) return;
    e.preventDefault(); setMemoH(memoH() + d * (e.shiftKey ? 40 : 10)); lsSet(MEMO_KEY, String(memoH()));
  });
  window.addEventListener("resize", fitMemo);
  setMemoOpen(lsGet("flowbook.memoOpen") === "1");
}

/* ---------- YAML tab ---------- */
let yamlT = 0;
function setYamlMsg(err){
  const m = $("#yamlMsg");
  if (err){ m.className = "yaml-msg err"; m.textContent = err; }
  else { m.className = "yaml-msg"; m.textContent = ""; }
}
$("#yamlText").addEventListener("input", () => {
  clearTimeout(yamlT);
  yamlT = setTimeout(() => {
    if (!S.currentId) return;
    const text = $("#yamlText").value;
    try {
      const f = parseYaml(text);
      if (text !== S.yamlSrc) pushUndo("yaml");
      setFlow(f); setYamlSrc(text); setBroken(false); setYamlMsg();
      if (!S.flow.steps.some(s => s.id === S.selected)) setSelected(null);
      $("#flowName").value = S.flow.name;
      refresh(true); markDirty();
    } catch (e){
      const line = e.mark ? `${e.mark.line + 1}行目：` : "";
      setYamlMsg(`読み取れません。${line}${e.reason || e.message}（直すまで保存されません）`);
    }
  }, 350);
});
$("#yamlText").addEventListener("keydown", e => {
  if (e.key === "Tab"){ e.preventDefault(); const t = e.target, a = t.selectionStart; t.setRangeText("  ", a, t.selectionEnd, "end"); t.dispatchEvent(new Event("input")); }
});

/* ---------- checks & history ---------- */
function renderChecks(){
  const el = $("#tab-check"); if (!S.flow) return;
  if (!S.issues.length){ el.innerHTML = `<div class="ok-box">問題は見つかりませんでした。</div>`; return; }
  const lv = { bad: "要修正", warn: "確認", info: "参考" };
  el.innerHTML = `<ul class="issues">` + S.issues.map(i => `<li><button class="issue ${i.level}" ${i.step ? `data-goto="${esc(i.step)}"` : ""}><span class="lv">${lv[i.level]}</span><span>${esc(i.msg)}</span></button></li>`).join("") + `</ul>`;
}
$("#tab-check").addEventListener("click", ev => { const b = ev.target.closest("[data-goto]"); if (b) select(b.dataset.goto); });
function renderHist(){
  const el = $("#tab-hist"); if (!S.currentId) { el.innerHTML = ""; return; }
  const r = S.records.get(S.currentId) || {}, h = r.history || [];
  let s = `<div class="sec"><div class="sec-head"><h3>版の履歴</h3></div><p class="help" style="margin:0">10分ごとに以前の版が残ります（最大20版。超えると古い版から消えます）。戻した後も、戻す前の版は履歴に残ります。${S.store === "folder" ? `版は作業フォルダの <code>${HIST_DIR}</code> フォルダに、1フローにつき1ファイルで保存します。` : S.store === "memory" ? "履歴はこのタブを閉じると消えます。" : ""}</p>`;
  s += h.length ? `<ul class="hist">` + h.map((e, k) => { let n = "—"; try { n = parseYaml(e.yaml).steps.length + " ステップ"; } catch {} return `<li><div><div class="t">${fmtTime(e.at)}</div><div class="d">${esc(e.name || "")} · ${n}${e.memo ? " · " + esc(e.memo) : ""}</div></div><button class="btn sm" data-hist="restore" data-k="${k}">この版に戻す</button></li>`; }).join("") + `</ul>` : `<p class="help">まだ以前の版はありません。</p>`;
  el.innerHTML = s + `</div>`;
}
$("#tab-hist").addEventListener("click", ev => {
  const b = ev.target.closest("[data-hist]"); if (!b || !S.currentId) return;
  const r = S.records.get(S.currentId); if (!r) return;
  const e = (r.history || [])[+b.dataset.k]; if (!e) return;
  b.dataset.orig = "この版に戻す"; if (!arm(b, "hist" + b.dataset.k, "もう一度押して戻す")) return;
  const history = (r.history || []).slice(); history.unshift({ at: Date.now(), name: r.name, yaml: r.yaml, memo: "戻す前の版" });
  setRecord(S.currentId, { ...r, history: history.slice(0, 20) });
  pushUndo("op"); setYamlSrc(e.yaml); setFlow(parseYaml(e.yaml)); setSelected(null);
  $("#yamlText").value = S.yamlSrc; $("#flowName").value = S.flow.name; setYamlMsg();
  refresh(true); setDirty(true); saveNow().then(renderHist); toast(fmtTime(e.at) + " の版に戻しました");
});

/* ---------- tabs ---------- */
function showTab(t){
  setTab(t);
  document.querySelectorAll("[data-tab]").forEach(b => b.setAttribute("aria-selected", String(b.dataset.tab === t)));
  ["edit", "setup", "yaml", "check", "hist"].forEach(k => $("#tab-" + k).hidden = k !== t);
  if (t === "hist") renderHist();
  if (t === "edit" && S.flow) renderForm();
  if (t === "yaml" && S.flow && document.activeElement !== $("#yamlText") && $("#yamlText").value !== S.yamlSrc){ $("#yamlText").value = S.yamlSrc; setYamlMsg(); }
}
document.querySelector(".tabs").addEventListener("click", ev => { const b = ev.target.closest("[data-tab]"); if (b) showTab(b.dataset.tab); });

/* ---------- header, list, new, import ---------- */
$("#flowName").addEventListener("input", e => { if (!S.flow) return; S.flow.name = e.target.value; commit(); });
$("#flowName").addEventListener("change", () => { if (S.flow) renameFile(); });
$("#flowList").addEventListener("click", ev => { const b = ev.target.closest("[data-open]"); if (b && b.dataset.open !== S.currentId) open(b.dataset.open); });
function startNew(kind){ create(TEMPLATES[kind] || TEMPLATES.blank); }
document.querySelector(".side").addEventListener("click", ev => { const n = ev.target.closest("[data-new]"); if (n) startNew(n.dataset.new); });
$("#importBtn").onclick = async () => {
  // 作業フォルダを開く前なら、先に選んでもらう（読み込んだフローの保存先になるため）
  if (S.store === "folder" && !S.dir && !(await chooseFolder())) return;
  $("#importFile").click();
};
$("#importFile").addEventListener("change", async ev => {
  const files = [...ev.target.files]; ev.target.value = "";
  const names = [];
  for (const file of files){
    let text = await file.text();
    const m = text.match(/```ya?ml\r?\n([\s\S]*?)```/); if (m) text = m[1];
    try { const f = normalize(jsyaml.load(text)); if (await create(/\.json$/i.test(file.name) ? toYaml(f) : text, { fromFile: true })) names.push(f.name); }
    catch (e){ toast(`「${file.name}」を読み込めませんでした：` + (e.reason || e.message)); return; }
  }
  if (names.length) toast(names.length === 1 ? `「${names[0]}」を読み込みました` : `${names.length} 件のフローを読み込みました`);
});
function closeMenus(){ $("#exportMenu").hidden = true; $("#exportBtn").setAttribute("aria-expanded", "false"); }
// 別の作業フォルダに切り替える（今のフォルダへの変更は openDir で保存してから）
$("#folderBtn").onclick = () => chooseFolder();
// ほかのアプリ（エディタ・Git など）で変えたファイルを、画面に戻ったときに反映する
window.addEventListener("focus", async () => {
  if (S.store !== "folder" || !S.dir || S.scanning) return;
  setScanning(true);
  try { await scanDir(); onRecords(); renderNotice(); } catch {}
  setScanning(false);
});
function closeSide(){ $("#side").classList.remove("open"); $("#scrim").classList.remove("open"); }
$("#menuBtn").onclick = () => { $("#side").classList.add("open"); $("#scrim").classList.add("open"); };
$("#scrim").onclick = closeSide;

/* ---------- export ---------- */
function mermaid(f){
  const nid = id => "n_" + id.replace(/[^A-Za-z0-9_]/g, "_");
  const q = t => '"' + String(t || " ").replace(/"/g, "#quot;") + '"';
  const shape = s => ({ start: `([${q(s.label)}])`, end: `([${q(s.label)}])`, decision: `{${q(s.label)}}`, subProcess: `[[${q(s.label)}]]`, document: `[/${q(s.label)}/]`, dataObject: `[\\${q(s.label)}\\]`, dataStore: `[(${q(s.label)})]` }[s.type] || `[${q(s.label)}]`);
  let out = "flowchart LR\n";
  f.lanes.forEach(l => { out += `  subgraph ${nid("lane_" + l.id)}[${q(l.name)}]\n`; f.steps.filter(s => s.lane === l.id).forEach(s => out += `    ${nid(s.id)}${shape(s)}\n`); out += "  end\n"; });
  f.steps.filter(s => !f.lanes.some(l => l.id === s.lane)).forEach(s => out += `  ${nid(s.id)}${shape(s)}\n`);
  f.steps.forEach(s => s.next.forEach(e => out += `  ${nid(s.id)} -->${e.when ? `|${q(e.when)}|` : ""} ${nid(e.to)}\n`));
  // 関連は点線の矢印
  f.steps.forEach(s => (s.related || []).forEach(to => { if (to !== s.id && !s.next.some(e => e.to === to)) out += `  ${nid(s.id)} -.-> ${nid(to)}\n`; }));
  return out;
}
function markdown(f){
  const laneName = id => f.lanes.find(l => l.id === id)?.name || id;
  const cell = t => String(t || "").replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n/g, " ");
  let md = `# ${f.name}\n\n`;
  if (f.owner) md += `- 管理部署：${f.owner}\n`;
  md += `- 最終更新：${fmtTime(Date.now())}\n\n`;
  if (f.description) md += `${f.description}\n\n`;
  // 関連（点線）・使用システム・ツール・手段は、書いたステップがあるときだけ列を足す
  const cols = [["ID", s => s.id], ["種類", s => TYPES[s.type]], ["担当", s => laneName(s.lane)], ["内容", s => s.label], ["次へ", s => s.next.map(e => e.to + (e.when ? `（${e.when}）` : "")).join("、")]];
  if (f.steps.some(s => s.related?.length)) cols.push(["関連", s => (s.related || []).join("、")]);
  if (f.steps.some(hasTool)) cols.push([TOOL_NAME, s => s.tool]);
  cols.push(["補足", s => s.note], ["課題", s => s.issue]);
  md += "## フロー図\n\n```mermaid\n" + mermaid(f) + "```\n\n## 手順一覧\n\n" + `| ${cols.map(([h]) => h).join(" | ")} |\n|${cols.map(() => "---|").join("")}\n`;
  f.steps.forEach(s => md += `| ${cols.map(([, v]) => cell(v(s))).join(" | ")} |\n`);
  if (f.memo.trim()) md += `\n## メモ\n\n${f.memo.trim()}\n`;
  md += "\n## 定義（YAML）\n\nこのブロックを業務フロー帳の「インポート」で取り込むと、編集を再開できます。\n\n```yaml\n" + S.yamlSrc.replace(/\n?$/, "\n") + "```\n";
  return md;
}
async function copyText(text, label){
  try { await navigator.clipboard.writeText(text); toast(label + "をコピーしました"); }
  catch { showTab("yaml"); const t = $("#yamlText"); if (label === "YAML"){ t.focus(); t.select(); toast("コピーできませんでした。選択した YAML を手動でコピーしてください"); } else toast("コピーできませんでした"); }
}
const SAVE_TYPES = {
  ".yaml": { description: "YAML ファイル", accept: { "application/x-yaml": [".yaml", ".yml"] } },
  ".md": { description: "Markdown ファイル", accept: { "text/markdown": [".md"] } },
  ".png": { description: "PNG 画像", accept: { "image/png": [".png"] } },
};
// 保存場所を選ぶダイアログ（Chrome・Edge など）。使えない環境では null を返し、従来のダウンロードに任せる
async function saveWithPicker(filename, data){
  if (!window.showSaveFilePicker) return null;
  const ext = filename.slice(filename.lastIndexOf("."));
  let handle;
  try { handle = await window.showSaveFilePicker({ suggestedName: filename, id: "gyomu-flow-export", types: SAVE_TYPES[ext] ? [SAVE_TYPES[ext]] : undefined }); }
  catch (e){ if (e && e.name === "AbortError") return false; return null; }
  try { const w = await handle.createWritable(); await w.write(data); await w.close(); toast("保存しました"); return true; }
  catch { toast("保存できませんでした"); return false; }
}
function downloadFile(filename, data){
  // data は文字列か Blob（画像）
  const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a"); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
// 保存できたら true を返す（memory で「ファイルに保存済み」にするため）
async function saveFile(filename, data){
  const picked = await saveWithPicker(filename, data);
  if (picked !== null) return picked;
  try { downloadFile(filename, data); toast("保存しました"); return true; }
  catch { toast("保存できませんでした。コピーをご利用ください"); return false; }
}
// 今のフローをファイルに保存する。memory では、保存できたら「ファイルに保存済み」にする
async function exportFlow(filename, data){
  if (S.store === "memory" && S.dirty) saveNow(); // 待っている保存を先に済ませ、あとから「未保存」に戻らないようにする
  const id = S.currentId, at = S.yamlSrc;
  if (await saveFile(filename, data) && S.store === "memory" && id === S.currentId && at === S.yamlSrc){ markExported(id); setStatus(S.dirty ? "dirty" : "saved"); }
}
const safeName = n => (n || "flow").replace(/[\\/:*?"<>|]/g, "_").slice(0, 80);
$("#exportBtn").onclick = e => { e.stopPropagation(); const m = $("#exportMenu"), show = m.hidden; closeMenus(); m.hidden = !show; $("#exportBtn").setAttribute("aria-expanded", String(show)); };
document.addEventListener("click", ev => { if (!ev.target.closest(".menu")) closeMenus(); });
$("#exportMenu").addEventListener("click", ev => {
  const b = ev.target.closest("[data-exp]"); if (!b || !S.flow) return;
  $("#exportMenu").hidden = true;
  switch (b.dataset.exp){
    case "copy-yaml": copyText(S.yamlSrc, "YAML"); break;
    case "copy-mermaid": copyText(mermaid(S.flow), "Mermaid記法"); break;
    case "image": openImgDialog(); break;
    case "save-yaml": exportFlow(safeName(S.flow.name) + ".yaml", S.yamlSrc.replace(/\n?$/, "\n")); break;
    case "save-md": exportFlow(safeName(S.flow.name) + ".md", markdown(S.flow)); break;
  }
});

/* ---------- 画像として出力（PowerPoint などに貼る PNG） ----------
   図の配置（layout）は 1 回だけ行い、その座標を列のすき間で切り出して 1 枚ずつの画像にする。縦（レーン）は分けない。
   どの枚も左端にレーン名の列を付け、全枚を同じ縮尺・同じ大きさにする。枚をまたぐ矢印は、切れ目の外側の帯に結合子（丸に A・B…）を置いてつなぐ。
   図の単位は「図の px」（画面で 100% のときの 1px）。縮尺 s は 1 図 px が貼ったときに何 pt になるか */
// 貼る先。w は貼る幅（インチ）、ar は高さ / 幅。fit は分割せず、図全体を比率そのままで 1 枚にする。
// 分割するときは、最後の枚より前の各枚に、画像の幅に収まるだけ列を詰める（余りは最後の枚に入る）
const IMG_SIZES = {
  "16:9": { w: 13.333, ar: 9 / 16 },
  "16:7": { w: 12.333, ar: 7 / 16 },
  fit: { w: 0, ar: 0 },
};
// px：画像の横のピクセル数（fit 以外）。m：外の余白、th：見出しの高さ、cw：結合子を置く帯の幅、r：結合子の半径、gapMin：結合子どうしの縦の間隔
const IMG = { px: 1920, m: 16, th: 30, cw: 50, r: 9, gapMin: 34, fitPx: 2, maxPx: 12000 };
// 画像の中ではページの Web フォントを使えないため、端末にあるフォントを並べる（Windows では游ゴシック UI）。
// 文字の幅を測るときも同じフォントになるよう、Web フォント（IBM Plex Sans JP）は入れない
const FONT_EXPORT = "'Yu Gothic UI','Meiryo','Hiragino Sans',sans-serif";
const NODE_FONT = 12.5; // ステップの文字の大きさ（図 px）。読みやすさの目安にする

// 列のすき間 g（列 g と g+1 の間）で切る位置の候補。条件ラベル・課題の吹き出しを横切らず、縦の線からなるべく離れた x を選ぶ
function cutCandidates(L){
  const vx = [], hs = [];
  L.edges.forEach(E => { for (let i = 1; i < E.pts.length; i++){ const [x1, y1] = E.pts[i - 1], [x2, y2] = E.pts[i]; if (x1 === x2) vx.push(x1); else if (y1 === y2) hs.push({ E, a: Math.min(x1, x2), b: Math.max(x1, x2) }); } });
  const blocks = [];
  L.edges.forEach(E => { if (E.label && E.lp) blocks.push([E.lp[0] - E.label.w / 2 - 3, E.lp[0] + E.label.w / 2 + 3]); });
  L.callouts.forEach(c => blocks.push([c.x - 3, c.x + c.w + 3]));
  const out = [];
  for (let g = 0; g + 1 < L.colX.length; g++){
    const lo = L.colX[g] + G.nodeW + 6, hi = L.colX[g + 1] - 6;
    let best = null;
    for (let x = Math.ceil(lo); x <= hi; x++){
      const hit = blocks.some(([a, b]) => x > a && x < b);
      const d = Math.min(x - lo, hi - x, ...vx.map(v => Math.abs(v - x)));
      const sc = (hit ? 1000 : 0) + (d < 3 ? 50 : 0) - Math.min(d, 20);
      if (!best || sc < best.sc) best = { x, sc };
    }
    if (!best) continue;
    // 切れ目をまたぐ矢印 1 本ごとに結合子が 2 つ増えるので、少ないほうを選ぶ
    const cross = new Set(hs.filter(h => h.a < best.x && h.b > best.x).map(h => h.E)).size;
    out.push({ x: best.x, cost: best.sc + 20 + cross * 12 });
  }
  return out;
}
// 画像の文字（FONT_EXPORT）で書いたときの文字列の幅
let measureCx = null;
function strW(t, font, bold){
  measureCx = measureCx || document.createElement("canvas").getContext("2d");
  measureCx.font = `${bold ? 700 : 400} ${font}px ${FONT_EXPORT}`;
  return measureCx.measureText(t).width;
}
/* 凡例。画面の上の凡例（.legend）の記号をそのまま使い、図に出てくるものだけを並べる。
   multi（複数枚に分けるとき）は結合子も加える。ww は記号と文字を合わせた幅 */
const LEGEND_USE = {
  開始: L => L.steps.some(s => s.type === "start"), 作業: L => L.steps.some(s => s.type === "task"), 判断: L => L.steps.some(s => s.type === "decision"),
  サブプロセス: L => L.steps.some(s => s.type === "subProcess"), 帳票: L => L.steps.some(s => s.type === "document"), データ: L => L.steps.some(s => s.type === "dataObject"),
  データストア: L => L.steps.some(s => s.type === "dataStore"),
  終了: L => L.steps.some(s => s.type === "end"), 課題: L => L.callouts.length > 0,
  流れ: L => L.edges.some(E => !E.assoc), 関連: L => L.edges.some(E => E.assoc),
};
const LG = { font: 11, gap: 14, row: 22 };
function legendItems(L, multi){
  const items = [];
  document.querySelectorAll(".legend > span:not(.sep)").forEach(sp => {
    const t = sp.textContent.trim(), svg = sp.querySelector("svg");
    if (!svg || !LEGEND_USE[t] || !LEGEND_USE[t](L)) return;
    const [, , w, h] = svg.getAttribute("viewBox").split(/\s+/).map(Number);
    items.push({ t, w, h, inner: svg.innerHTML });
  });
  if (multi) items.push({ t: "結合子（別の枚へ続く）", w: 22, h: 14, inner: `<circle cx="11" cy="7" r="6.2" fill="var(--surface)" stroke="var(--ink)" stroke-width="1.2"/><text x="11" y="7.4" text-anchor="middle" dominant-baseline="middle" font-size="7.5" font-weight="700" fill="var(--ink)">A</text>` });
  items.forEach(it => { it.ww = it.w + 4 + strW(it.t, LG.font); });
  return items;
}
const legendW = items => items.reduce((a, it) => a + it.ww, 0) + Math.max(0, items.length - 1) * LG.gap;
/* 縮尺と切り方を決める。o = { size, pt, title, legend }、name はフロー名（見出しの幅を見積もる）。
   見出しの行にはフロー名（左）と凡例（右）を並べ、入りきらなければ凡例を 2 行目に下ろす（P.legendRow） */
function paginate(L, o, name){
  const th = o.title || o.legend ? IMG.th : 0;
  let P = pagesAt(L, o, th, 0);
  if (!P || !o.legend) return P;
  let items = legendItems(L, P.pages.length > 1);
  const n = P.pages.length, room = n > 1 ? P.PW - 2 * P.M : L.width;
  const titleW = o.title ? strW(name + (n > 1 ? `（${n}/${n}）` : ""), 15, true) + 24 : 0;
  P.legendRow = 1;
  if (titleW + legendW(items) > room){
    // 分割しないときは、凡例が図より広ければ画像の幅を広げる
    P = pagesAt(L, o, o.title ? th + LG.row : th, legendW(items));
    if (!P) return P;
    items = legendItems(L, P.pages.length > 1);
    P.legendRow = o.title ? 2 : 1;
  }
  P.legend = items;
  return P;
}
/* ステップの文字が o.pt になる縮尺を基本に、全レーンと見出し（高さ th）が 1 枚の高さに入らなければ縮める。
   そのうえで、1 枚の幅に収まる最小の枚数で、最後の枚より前を幅いっぱいまで詰め、切れ目の結合子が少ない切り方を選ぶ。
   minW は分割しないときの中身の最小の幅 */
function pagesAt(L, o, th, minW){
  const H = Math.max(L.height, G.laneH), end = L.width, M = IMG.m;
  const sT = o.pt / NODE_FONT, Z = IMG_SIZES[o.size] || IMG_SIZES["16:9"];
  const pageW = (b, i, j, last) => G.label + (i ? IMG.cw : 0) + (b[j].x - b[i].x) + (j < last ? IMG.cw : 0) + 2 * M;
  if (!Z.ar){
    const s = sT, PW = Math.max(end, minW) + 2 * M, PH = H + 2 * M + th;
    const ppu = Math.min(IMG.fitPx, IMG.maxPx / Math.max(PW, PH));
    return { s, PW, PH, M, th, H, pages: [{ x0: G.label, x1: end }], pxW: Math.round(PW * ppu), pxH: Math.round(PH * ppu), dpi: ppu / s * 72 };
  }
  const Wpt = Z.w * 72;
  let s = Math.min(sT, Wpt * Z.ar / (H + 2 * M + th));
  const b = [{ x: G.label, cost: 0 }, ...cutCandidates(L), { x: end, cost: 0 }], last = b.length - 1;
  /* 境目 b[0]〜b[last] を、ちょうど k 枚・各枚の幅 PW 以内に分ける切り方のうち、点数の最も低いもの（分けられなければ null）。
     点数は、最後の枚より前の枚の右の余白が広いほど、切れ目の点数（結合子の数など）が高いほど高い。
     dp[j] = 境目 j までを n 枚で覆うときの最小の点数と、1 つ前の境目 */
  const split = (k, PW) => {
    let dp = b.map((_, j) => j ? null : { cost: 0, from: null, at: 0 });
    for (let n = 1; n <= k; n++){
      const nx = b.map(() => null);
      for (let i = 0; i < last; i++){
        if (!dp[i]) continue;
        for (let j = i + 1; j <= last; j++){
          const w = pageW(b, i, j, last); if (w > PW) break;
          if ((n === k) !== (j === last)) continue;
          const fill = j < last ? 1000 * (PW - w) / PW : 0;
          const c = dp[i].cost + fill + (j < last ? b[j].cost : 0);
          if (!nx[j] || c < nx[j].cost) nx[j] = { cost: c, from: dp[i], at: j };
        }
      }
      dp = nx;
    }
    return dp[last];
  };
  // 枚数の少ないほうから試し、分けられた最初の枚数を使う。1 枚の幅に 1 列も入らないほど狭いときは、縮尺を下げてやり直す
  let goal = null;
  for (let tries = 0; tries < 20 && !goal; tries++){
    if (tries) s *= 0.9;
    for (let k = 1; k <= last && !goal; k++) goal = split(k, Wpt / s);
  }
  if (!goal) return null;
  const at = []; for (let n = goal; n; n = n.from) at.unshift(n.at);
  const pages = at.slice(1).map((j, k) => ({ x0: b[at[k]].x, x1: b[j].x }));
  // 1 枚に収まる短いフローは、目標の 1.5 倍まで大きく描く
  if (pages.length === 1) s = Math.max(s, Math.min(1.5 * sT, Wpt * Z.ar / (H + 2 * M + th), Wpt / pageW(b, 0, last, last)));
  const PW = Wpt / s;
  return { s, PW, PH: PW * Z.ar, M, th, H, pages, pxW: IMG.px, pxH: Math.round(IMG.px * Z.ar), dpi: IMG.px / Z.w };
}
// 枚をまたぐ矢印に、つなぎ元の枚・つなぎ先の枚・結合子の文字（A, B, …, Z, AA, …）を付ける
function crossLinks(L, P){
  const pageOf = x => { const i = P.pages.findIndex(p => x < p.x1); return i < 0 ? P.pages.length - 1 : i; };
  const local = P.pages.map(() => []), cross = [];
  L.edges.forEach(E => {
    const ps = pageOf(E.pts[0][0]), pt = pageOf(E.pts[E.pts.length - 1][0]);
    if (ps === pt) local[ps].push(E); else cross.push({ E, ps, pt, y: E.pts[0][1] });
  });
  const letter = n => (n >= 26 ? letter(Math.floor(n / 26) - 1) : "") + String.fromCharCode(65 + n % 26);
  cross.sort((a, b) => a.ps - b.ps || a.pt - b.pt || a.y - b.y).forEach((c, i) => { c.letter = letter(i); });
  return { local, cross };
}
// 折れ線が枚 p の範囲から出る（out）・入る（in）ところで切った部分。切れ目は横線が横切る前提（縦線は切れ目に置かない）
function clipAtPage(pts, p, out){
  const inside = q => q[0] >= p.x0 && q[0] <= p.x1;
  if (out){
    for (let i = 0; i + 1 < pts.length; i++) if (inside(pts[i]) && !inside(pts[i + 1])){ const bx = pts[i + 1][0] < p.x0 ? p.x0 : p.x1; return { pts: [...pts.slice(0, i + 1), [bx, pts[i][1]]], side: bx === p.x0 ? "L" : "R" }; }
  } else {
    for (let i = pts.length - 1; i > 0; i--) if (inside(pts[i]) && !inside(pts[i - 1])){ const bx = pts[i - 1][0] < p.x0 ? p.x0 : p.x1; return { pts: [[bx, pts[i][1]], ...pts.slice(i)], side: bx === p.x0 ? "L" : "R" }; }
  }
  return null;
}
/* 色の変数をライトテーマの色に置き換える。CSS のルールは読まない（HTML ファイルを直接開くと、
   別ファイルの CSS のルールはスクリプトから読めず、すべて黒になってしまうため）。
   代わりに一瞬だけ data-theme="light" にして、計算済みのスタイルから値を取る（画面を描き直す前に元に戻すので、見た目は変わらない） */
function resolveVars(svg){
  const root = document.documentElement, prev = root.getAttribute("data-theme"), got = {};
  root.setAttribute("data-theme", "light");
  const cs = getComputedStyle(root);
  const out = svg.replace(/var\((--[\w-]+)\)/g, (m, k) => got[k] || (got[k] = cs.getPropertyValue(k).trim() || "#000"));
  if (prev == null) root.removeAttribute("data-theme"); else root.setAttribute("data-theme", prev);
  return out;
}
// 1 枚分の SVG。o = { title, ids }。i は何枚目か（0 始まり）
function pageSvg(f, L, P, links, i, o){
  const p = P.pages[i], n = P.pages.length, H = P.H, M = P.M;
  const cl = i > 0 ? IMG.cw : 0, cr = i < n - 1 ? IMG.cw : 0;
  // 1 枚だけのときは左右の真ん中に置く。複数枚では、どの枚も同じ位置（左寄せ）にして貼ったときにそろえる
  const cw = G.label + cl + (p.x1 - p.x0) + cr, lx = n > 1 ? M : Math.max(M, (P.PW - cw) / 2);
  const ox = lx + G.label + cl - p.x0, oy = M + P.th; // 図の座標 → 画像の座標
  const xa = p.x0 - cl, xb = p.x1 + cr; // 結合子の帯を含む範囲
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${P.PW} ${P.PH}" width="${P.pxW}" height="${P.pxH}" font-family="${FONT_EXPORT}">`;
  s += `<rect width="${P.PW}" height="${P.PH}" fill="#FFFFFF"/>`;
  if (o.title) s += `<text x="${lx}" y="${M + 11}" dominant-baseline="middle" font-size="15" font-weight="700" fill="var(--ink)">${esc(f.name)}${n > 1 ? `<tspan fill="var(--muted)" font-weight="500">（${i + 1}/${n}）</tspan>` : ""}</text>`;
  // 凡例：見出しの行の右端にそろえる（複数枚ではどの枚も同じ位置）。2 行目のときはフロー名の下に左から並べる
  if (P.legend && P.legend.length){
    const lw = legendW(P.legend), right = n > 1 ? P.PW - M : lx + cw, y = M + 11 + (P.legendRow === 2 ? LG.row : 0);
    let x = P.legendRow === 2 ? Math.max(M, Math.min(lx, P.PW - M - lw)) : Math.max(M, right - lw);
    P.legend.forEach(it => {
      s += `<svg x="${x}" y="${y - it.h / 2}" width="${it.w}" height="${it.h}" viewBox="0 0 ${it.w} ${it.h}">${it.inner}</svg>`;
      s += `<text x="${x + it.w + 4}" y="${y}" dominant-baseline="middle" font-size="${LG.font}" fill="var(--muted)">${esc(it.t)}</text>`;
      x += it.ww + LG.gap;
    });
  }
  s += `<defs><clipPath id="pg"><rect x="${p.x0}" y="0" width="${p.x1 - p.x0}" height="${H}"/></clipPath></defs>`;
  s += `<g transform="translate(${ox} ${oy})">`;
  // 結合子の帯にもレーンの帯を伸ばしておく（本体は切り出した範囲の上に重なる）
  L.lanes.forEach((l, k) => { const y = L.laneY[k]; s += `<rect x="${xa}" y="${y}" width="${xb - xa}" height="${L.laneY[k + 1] - y}" fill="${k % 2 ? "var(--lane-b)" : "var(--lane-a)"}"/>`; if (k) s += `<line x1="${xa}" x2="${xb}" y1="${y}" y2="${y}" stroke="var(--line-strong)"/>`; });
  s += `<g clip-path="url(#pg)">${diagramBodySvg(f, { ...L, edges: links.local[i] }, Math.max(L.width, 420), H, { info: o.info })}</g>`;
  // 切れ目：前の枚・次の枚へ続くことを破線で示す
  if (cl) s += `<line x1="${p.x0}" x2="${p.x0}" y1="0" y2="${H}" stroke="var(--line-strong)" stroke-dasharray="4 4"/>`;
  if (cr) s += `<line x1="${p.x1}" x2="${p.x1}" y1="0" y2="${H}" stroke="var(--line-strong)" stroke-dasharray="4 4"/>`;
  // 枚をまたぐ矢印：この枚から出るものは結合子まで、この枚へ入るものは結合子から先まで描く
  const ends = [];
  links.cross.forEach(c => {
    const out = c.ps === i, part = out ? clipAtPage(c.E.pts, p, true) : c.pt === i ? clipAtPage(c.E.pts, p, false) : null;
    if (part) ends.push({ c, out, ...part, y: out ? part.pts[part.pts.length - 1][1] : part.pts[0][1] });
  });
  // 同じ側の結合子が近すぎるときは上下にずらす（はみ出す分は上へ戻す）
  ["L", "R"].forEach(sd => {
    const list = ends.filter(e => e.side === sd).sort((a, b) => a.y - b.y);
    list.forEach((e, k) => { e.by = Math.max(e.y, k ? list[k - 1].by + IMG.gapMin : IMG.r + 2); });
    for (let k = list.length - 1; k >= 0; k--){ const lim = (k < list.length - 1 ? list[k + 1].by - IMG.gapMin : H - IMG.r - 14); if (list[k].by > lim) list[k].by = lim; }
  });
  let marks = "", labels = "";
  ends.forEach(e => {
    const dir = e.side === "R" ? 1 : -1, bx = e.side === "R" ? p.x1 : p.x0, cx = bx + dir * IMG.cw / 2, r = IMG.r;
    // ずらした結合子へは、切れ目のすぐ外側で縦に折れてつなぐ（隣の結合子の「○枚目へ」の文字にかからないように）
    const leg = e.by === e.y ? [[cx - dir * r, e.y]] : [[bx + dir * 3, e.y], [bx + dir * 3, e.by], [cx - dir * r, e.by]];
    const pts = e.out ? [...e.pts, ...leg] : [...leg.reverse(), ...e.pts];
    const clean = pts.filter((q, k) => !k || q[0] !== pts[k - 1][0] || q[1] !== pts[k - 1][1]);
    s += `<path d="${pathD(clean)}" fill="none" stroke="var(--muted)" stroke-width="1.4" ${e.c.E.assoc ? ASSOC_DASH : ""} marker-end="url(#${e.c.E.assoc ? "oar" : "arr"})"/>`;
    marks += `<circle cx="${cx}" cy="${e.by}" r="${r}" fill="var(--surface)" stroke="var(--ink)" stroke-width="1.3"/><text x="${cx}" y="${e.by + 0.5}" text-anchor="middle" dominant-baseline="middle" font-size="10.5" font-weight="700" fill="var(--ink)">${e.c.letter}</text>`;
    marks += `<text x="${cx}" y="${e.by + r + 8}" text-anchor="middle" dominant-baseline="middle" font-size="8.5" fill="var(--muted)">${(e.out ? e.c.pt : e.c.ps) + 1}枚目${e.out ? "へ" : "から"}</text>`;
    // 条件ラベルは、ラベルの位置が入る枚にだけ描く（切れ目はラベルを横切らないので、どちらか一方に入る）
    const E = e.c.E;
    if (E.label && E.lp && E.lp[0] >= p.x0 && E.lp[0] <= p.x1) labels += `<g>${labelSvg(E, "var(--line-strong)")}</g>`;
  });
  s += marks + labels + `</g>`;
  // 全体の枠と、レーン名の列（一番手前）
  s += `<rect x="${lx}" y="${oy}" width="${cw}" height="${H}" fill="none" stroke="var(--line-strong)"/>`;
  s += `<g transform="translate(${lx} ${oy})">${laneHeadSvg(L, G.label, H, false)}</g>`;
  return resolveVars(s + `</svg>`);
}
// PNG の CRC32（pHYs を書き足すときに使う）
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++){ let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = u8 => { let c = ~0; for (const b of u8) c = CRC_T[(c ^ b) & 255] ^ (c >>> 8); return ~c >>> 0; };
// PNG に解像度（pHYs）を書き込み、PowerPoint などに貼ったときの大きさを「貼る幅」に合わせる
async function withDpi(blob, dpi){
  const src = new Uint8Array(await blob.arrayBuffer()), ppm = Math.round(dpi / 0.0254);
  const ch = new Uint8Array(21), dv = new DataView(ch.buffer);
  dv.setUint32(0, 9); ch.set([0x70, 0x48, 0x59, 0x73], 4); dv.setUint32(8, ppm); dv.setUint32(12, ppm); ch[16] = 1; dv.setUint32(17, crc32(ch.subarray(4, 17)));
  const parts = [src.subarray(0, 8)], view = new DataView(src.buffer, src.byteOffset, src.byteLength);
  for (let p = 8; p + 8 <= src.length;){
    const len = view.getUint32(p), type = String.fromCharCode(...src.subarray(p + 4, p + 8)), end = p + 12 + len;
    if (type !== "pHYs") parts.push(src.subarray(p, end));
    if (type === "IHDR") parts.push(ch);
    p = end;
  }
  return new Blob(parts, { type: "image/png" });
}
function svgToPng(svg, w, h, dpi){
  return new Promise((res, rej) => {
    const img = new Image(), url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    img.onload = () => {
      const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
      cv.getContext("2d").drawImage(img, 0, 0, w, h); URL.revokeObjectURL(url);
      cv.toBlob(b => b ? withDpi(b, dpi).then(res, rej) : rej(new Error("PNG にできませんでした")), "image/png");
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("図を読み込めませんでした")); };
    img.src = url;
  });
}

/* 出力画面。設定（貼る場所・文字の大きさ・見出し・凡例）はこの端末で覚えておく。課題の吹き出し・ツール・手段は、開いたときの「課題を表示」「ツール・手段を表示」に合わせる */
const IMG_KEY = "flowbook.imgExport";
let imgOpt = null, imgPlan = null, imgUrls = [], imgPngs = [];
function openImgDialog(){
  let o = {}; try { o = JSON.parse(lsGet(IMG_KEY) || "{}") || {}; } catch {}
  const hasIssue = S.flow.steps.some(s => s.issue && s.issue.trim()), hasIn = S.flow.steps.some(hasTool);
  imgOpt = { size: IMG_SIZES[o.size] ? o.size : "16:9", pt: [8, 10, 12].includes(o.pt) ? o.pt : 8, title: o.title !== false, legend: !!o.legend, issues: S.showIssues && hasIssue, info: S.showInfo && hasIn };
  const d = $("#imgDlg");
  d.querySelectorAll("[name=imgSize]").forEach(r => { r.checked = r.value === imgOpt.size; });
  d.querySelectorAll("[name=imgPt]").forEach(r => { r.checked = +r.value === imgOpt.pt; });
  d.querySelector("[name=imgTitle]").checked = imgOpt.title;
  d.querySelector("[name=imgLegend]").checked = imgOpt.legend;
  const iss = d.querySelector("[name=imgIssues]"); iss.checked = imgOpt.issues; iss.disabled = !hasIssue;
  iss.closest("label").title = hasIssue ? "" : "課題の書かれたステップがありません";
  const inf = d.querySelector("[name=imgInfo]"); inf.checked = imgOpt.info; inf.disabled = !hasIn;
  inf.closest("label").title = hasIn ? `${TOOL_NAME}を、ステップの中に入れます` : `${TOOL_NAME}の書かれたステップがありません`;
  renderImgDialog();
  d.showModal();
}
function renderImgDialog(){
  imgUrls.forEach(u => URL.revokeObjectURL(u)); imgUrls = []; imgPngs = [];
  const L = diagramLayout(S.flow, imgOpt.issues), P = paginate(L, imgOpt, S.flow.name), sum = $("#imgSum"), list = $("#imgPages");
  if (!P){ imgPlan = null; sum.textContent = "このフローは画像にできませんでした。"; list.innerHTML = ""; $("#imgSave").disabled = true; return; }
  const links = crossLinks(L, P), svgs = P.pages.map((_, i) => pageSvg(S.flow, L, P, links, i, imgOpt));
  imgPlan = { P, svgs };
  const n = svgs.length, pt = Math.round(P.s * NODE_FONT * 10) / 10, small = pt < imgOpt.pt - 0.05;
  let t = imgOpt.size === "fit" ? `図全体を 1 枚にします（${P.pxW} × ${P.pxH} px）。` : n > 1 ? `${n} 枚に分けます。` : "1 枚に収まります。";
  t += `貼ったときのステップの文字は約 ${pt}pt です`;
  t += small ? "（レーンが多いため、選んだ大きさより小さくなります）。" : "。";
  if (links.cross.length) t += `枚をまたぐ矢印は、両側に同じ文字の結合子（${links.cross[0].letter}${links.cross.length > 1 ? "〜" + links.cross[links.cross.length - 1].letter : ""}）を付けてつなぎます。`;
  sum.textContent = t; sum.classList.toggle("warn", small);
  list.classList.toggle("one", n === 1);
  list.innerHTML = svgs.map((svg, i) => {
    const u = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })); imgUrls.push(u);
    return `<li><img src="${u}" alt="${esc(S.flow.name)}（${i + 1}枚目）"><div class="cap"><span>${n > 1 ? `${i + 1} / ${n} 枚目` : "1 枚"}</span><button class="btn sm" data-imgcopy="${i}">コピー</button></div></li>`;
  }).join("");
  const b = $("#imgSave"); b.disabled = false; b.textContent = n > 1 ? `すべて保存（${n} 枚）` : "保存";
}
// PNG はコピー・保存のときに作り、同じ設定の間は使い回す（失敗したら次は作り直す）
function imgPng(i){
  if (!imgPngs[i]){ const P = imgPlan.P; imgPngs[i] = svgToPng(imgPlan.svgs[i], P.pxW, P.pxH, P.dpi).catch(e => { imgPngs[i] = null; throw e; }); }
  return imgPngs[i];
}
async function copyImg(i){
  try {
    if (!window.ClipboardItem || !navigator.clipboard || !navigator.clipboard.write) throw new Error("clipboard");
    await navigator.clipboard.write([new ClipboardItem({ "image/png": imgPng(i) })]);
    toast(`${imgPlan.svgs.length > 1 ? `${i + 1} 枚目` : "画像"}をコピーしました。PowerPoint などに Ctrl+V で貼れます`);
  } catch { toast("コピーできませんでした。「保存」をご利用ください"); }
}
async function saveImgs(){
  const n = imgPlan.svgs.length, base = safeName(S.flow.name), b = $("#imgSave");
  // 保存できたら出力画面を閉じる（取りやめ・失敗のときは開いたまま）
  const done = msg => { $("#imgDlg").close(); toast(msg); };
  b.disabled = true;
  try {
    if (n === 1){ if (await saveFile(base + ".png", await imgPng(0))) done("画像を保存しました"); return; }
    // 複数枚は、保存先のフォルダを 1 回だけ選んでもらう。選べないブラウザは順にダウンロードする
    if (window.showDirectoryPicker){
      let dh = null;
      try { dh = await window.showDirectoryPicker({ id: "gyomu-flow-image", mode: "readwrite" }); }
      catch (e){ if (e && e.name === "AbortError") return; }
      if (dh){
        for (let i = 0; i < n; i++){ const fh = await dh.getFileHandle(`${base}_${i + 1}.png`, { create: true }), w = await fh.createWritable(); await w.write(await imgPng(i)); await w.close(); }
        done(`${n} 枚の画像を「${dh.name}」に保存しました`); return;
      }
    }
    for (let i = 0; i < n; i++){ downloadFile(`${base}_${i + 1}.png`, await imgPng(i)); await new Promise(r => setTimeout(r, 300)); }
    done(`${n} 枚の画像を保存しました`);
  } catch { toast("画像を保存できませんでした"); }
  finally { b.disabled = false; }
}
{
  const d = $("#imgDlg");
  d.addEventListener("change", ev => {
    const t = ev.target;
    if (t.name === "imgSize") imgOpt.size = t.value;
    else if (t.name === "imgPt") imgOpt.pt = +t.value;
    else if (t.name === "imgTitle") imgOpt.title = t.checked;
    else if (t.name === "imgLegend") imgOpt.legend = t.checked;
    else if (t.name === "imgIssues") imgOpt.issues = t.checked;
    else if (t.name === "imgInfo") imgOpt.info = t.checked;
    else return;
    lsSet(IMG_KEY, JSON.stringify({ size: imgOpt.size, pt: imgOpt.pt, title: imgOpt.title, legend: imgOpt.legend }));
    renderImgDialog();
  });
  d.addEventListener("click", ev => {
    if (ev.target === d) { d.close(); return; } // 外側（背景）をクリック
    const c = ev.target.closest("[data-imgcopy]"); if (c) copyImg(+c.dataset.imgcopy);
  });
  $("#imgClose").onclick = () => d.close();
  $("#imgSave").onclick = () => { if (imgPlan) saveImgs(); };
  // 閉じたら、サムネイルと作った PNG を手放す
  d.addEventListener("close", () => { imgUrls.forEach(u => URL.revokeObjectURL(u)); imgUrls = []; imgPngs = []; imgPlan = null; });
}

document.addEventListener("keydown", e => {
  if ((e.metaKey || e.ctrlKey) && e.key === "s"){
    e.preventDefault(); if (!S.flow) return;
    // memory ではブラウザに保存しないので、YAML ファイルとして保存する
    if (S.store === "memory") exportFlow(safeName(S.flow.name) + ".yaml", S.yamlSrc.replace(/\n?$/, "\n")); else saveNow();
  }
  if (e.key === "Escape" && !e.target.closest("dialog")){ closeMenus(); closeSide(); if (!e.target.closest("input, textarea, select")) deselect(); }
});
// ファイルへの書き込みは非同期で、閉じる間際には終わる保証がない。保存しきれていない変更があれば確認する
window.addEventListener("beforeunload", e => {
  if (S.store === "folder" && S.dirty) saveNow();
  const risky = S.store === "memory" ? S.unexported.size > 0 || S.dirty : S.dirty || S.saving || !!S.conflictId;
  if (risky){ e.preventDefault(); e.returnValue = ""; }
});

/* ---------- column resize ---------- */
{
  const body = $(".body");
  const MIN_STAGE = 320;
  const cols = [
    { el: $("#splitSide"),  v: "--side-w",  key: "flowbook.sideW",  min: 160, max: 480, dir: 1 },
    { el: $("#splitPanel"), v: "--panel-w", key: "flowbook.panelW", min: 300, max: 900, dir: -1 },
  ];
  const curW = c => c.el.offsetParent ? parseFloat(getComputedStyle(body).getPropertyValue(c.v)) : 0;
  const setW = (c, w) => {
    const other = cols.find(o => o !== c);
    const room = body.clientWidth - curW(other) - MIN_STAGE;
    w = Math.round(Math.max(c.min, Math.min(c.max, room, w)));
    body.style.setProperty(c.v, w + "px");
  };
  const save = c => lsSet(c.key, String(curW(c)));
  for (const c of cols){
    const saved = parseFloat(lsGet(c.key));
    if (saved >= c.min && saved <= c.max) body.style.setProperty(c.v, saved + "px");
    c.el.addEventListener("pointerdown", e => {
      if (e.button !== 0) return;
      e.preventDefault();
      c.el.setPointerCapture(e.pointerId);
      c.el.classList.add("drag"); document.body.classList.add("resizing");
      const rect = body.getBoundingClientRect();
      const move = ev => setW(c, c.dir > 0 ? ev.clientX - rect.left : rect.right - ev.clientX);
      const up = () => {
        c.el.removeEventListener("pointermove", move); c.el.removeEventListener("pointerup", up); c.el.removeEventListener("pointercancel", up);
        c.el.classList.remove("drag"); document.body.classList.remove("resizing");
        save(c);
      };
      c.el.addEventListener("pointermove", move); c.el.addEventListener("pointerup", up); c.el.addEventListener("pointercancel", up);
    });
    c.el.addEventListener("dblclick", () => { body.style.removeProperty(c.v); lsSet(c.key, ""); });
    c.el.addEventListener("keydown", e => {
      const d = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
      if (!d) return;
      e.preventDefault();
      setW(c, curW(c) + d * c.dir * (e.shiftKey ? 40 : 10)); save(c);
    });
  }
}

/* ---------- boot ---------- */
setStatus("loading");
renderList();
$("#canvas").innerHTML = `<div class="empty"><p>フローを読み込んでいます…</p></div>`;
if (!window.jsyaml){ $("#canvas").innerHTML = `<div class="empty"><h2>部品を読み込めませんでした</h2><p>ネットワークをご確認のうえ、ページを再読み込みしてください。</p></div>`; return; }
initStore();
})();

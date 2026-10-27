/* フローのチェック（「チェック」タブに出す問題の一覧）。
   core/ のファイルは画面（DOM）に触らない。Node のテスト（tests/）からも読み込む */
(() => {
"use strict";
const { isArtifact } = globalThis.Flowbook; // model.js
/* ctx.base：比較元（AsIs）の今の版。渡すと、写しの後に ToBe と比較元の両方で別々に足した同じ ID を知らせる */
function validate(f, ctx = {}){
  const out = [], push = (level, msg, step) => out.push({ level, msg, step });
  const ids = new Map(); f.steps.forEach(s => ids.set(s.id, (ids.get(s.id) || 0) + 1));
  const laneIds = new Map(); f.lanes.forEach(l => laneIds.set(l.id, (laneIds.get(l.id) || 0) + 1));
  laneIds.forEach((c, id) => { if (c > 1) push("bad", `担当ID「${id}」が重複しています。`); });
  ids.forEach((c, id) => { if (c > 1) push("bad", `ステップID「${id}」が重複しています。`, id); });
  if (!f.steps.length) push("warn", "ステップがまだありません。");
  const starts = f.steps.filter(s => s.type === "start");
  if (f.steps.length && !starts.length) push("warn", "開始ステップがありません。最初のステップの種類を「開始」にしてください。");
  if (f.steps.length && !f.steps.some(s => s.type === "end")) push("warn", "終了ステップがありません。");
  f.steps.forEach(s => {
    const nm = s.label || s.id;
    if (!s.label.trim()) push("warn", `「${s.id}」に内容が書かれていません。`, s.id);
    if (!laneIds.has(s.lane)) push("bad", `「${nm}」の担当「${s.lane || "未設定"}」が担当一覧にありません。`, s.id);
    s.next.forEach(e => { if (!ids.has(e.to)) push("bad", `「${nm}」の次「${e.to}」というステップはありません。`, s.id); });
    (s.related || []).forEach(to => {
      if (!ids.has(to)) push("bad", `「${nm}」の関連「${to}」というステップはありません。`, s.id);
      else if (to === s.id) push("info", `「${nm}」の関連に自分自身が入っています。`, s.id);
    });
    // 帳票・データは流れに入らない（関連で結ぶだけ）ので、次がなくても行き止まりとしない
    if (s.type !== "end" && !isArtifact(s) && !s.next.length) push("info", `「${nm}」の次のステップが決まっていません（行き止まり）。`, s.id);
    // 図を見ればわかること（終了の後の矢印・条件のない分岐・ステップのない担当など）は知らせない
    if (s.type === "decision" && s.next.length < 2) push("warn", `判断「${nm}」の分岐が${s.next.length}本です。2本以上にしてください。`, s.id);
  });
  if (starts.length){
    const seen = new Set(), stack = starts.map(s => s.id), byId = new Map(f.steps.map(s => [s.id, s]));
    /* 関連（点線）は、向きを問わず帳票・データへだけたどる（流れの中で作る・使う帳票を、たどり着けないとしない）。
       帳票・データ以外のステップへは、流れの矢印でたどり着けなければならない */
    const rel = new Map(); f.steps.forEach(s => (s.related || []).forEach(to => { [[s.id, to], [to, s.id]].forEach(([a, b]) => { if (!rel.has(a)) rel.set(a, []); rel.get(a).push(b); }); }));
    while (stack.length){ const id = stack.pop(); if (seen.has(id)) continue; seen.add(id); (byId.get(id)?.next || []).forEach(e => stack.push(e.to)); (rel.get(id) || []).forEach(to => { if (isArtifact(byId.get(to))) stack.push(to); }); }
    f.steps.forEach(s => { if (!seen.has(s.id)) push("warn", `「${s.label || s.id}」は開始からたどり着けません。`, s.id); });
  }
  // AsIs／ToBe の比較（compare・from・removed）
  const snapIds = f.compare ? new Set(f.compare.snapshot.steps.map(s => s.id)) : null;
  f.steps.forEach(s => (s.from || []).forEach(id => {
    if (!snapIds) push("info", `「${s.label || s.id}」に AsIs の対応（from）がありますが、比較元が決まっていないので使われません。`, s.id);
    else if (!snapIds.has(id)) push("warn", `「${s.label || s.id}」の AsIs の対応「${id}」は、比較元の写しにありません。`, s.id);
  }));
  (f.removed || []).forEach(r => {
    if (ids.has(r.id)) push("info", `削除の理由に書いた「${r.id}」が、このフローにあります（削除していないなら、理由は使われません）。`, r.id);
    else if (snapIds && !snapIds.has(r.id)) push("info", `削除の理由に書いた「${r.id}」は、比較元の写しにありません。`);
  });
  if (snapIds && ctx.base){
    const cur = new Set(ctx.base.steps.map(s => s.id));
    f.steps.forEach(s => { if (!snapIds.has(s.id) && cur.has(s.id)) push("bad", `ステップID「${s.id}」が、比較元でも別に足されています。別のステップを同じものとして比べてしまうので、どちらかの ID を変えてください。`, s.id); });
  }
  const rank = { bad: 0, warn: 1, info: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}

Object.assign(globalThis.Flowbook ??= {}, { validate });
})();

/* フローのチェック（「チェック」タブに出す問題の一覧）。
   core/ のファイルは画面（DOM）に触らない。Node のテスト（tests/）からも読み込む */
(() => {
"use strict";
function validate(f){
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
    if (s.type !== "end" && !s.next.length) push("info", `「${nm}」の次のステップが決まっていません（行き止まり）。`, s.id);
    if (s.type === "end" && s.next.length) push("info", `終了「${nm}」の後にもステップがつながっています。`, s.id);
    if (s.type === "decision"){
      if (s.next.length < 2) push("warn", `判断「${nm}」の分岐が${s.next.length}本です。2本以上にしてください。`, s.id);
      else if (s.next.some(e => !e.when)) push("info", `判断「${nm}」に条件の書かれていない分岐があります。`, s.id);
    }
  });
  if (starts.length){
    const seen = new Set(), stack = starts.map(s => s.id), byId = new Map(f.steps.map(s => [s.id, s]));
    while (stack.length){ const id = stack.pop(); if (seen.has(id)) continue; seen.add(id); (byId.get(id)?.next || []).forEach(e => stack.push(e.to)); }
    f.steps.forEach(s => { if (!seen.has(s.id)) push("warn", `「${s.label || s.id}」は開始からたどり着けません。`, s.id); });
  }
  const used = new Set(f.steps.map(s => s.lane));
  f.lanes.forEach(l => { if (!used.has(l.id)) push("info", `担当「${l.name}」にはステップがありません。`); });
  const rank = { bad: 0, warn: 1, info: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}

Object.assign(globalThis.Flowbook ??= {}, { validate });
})();

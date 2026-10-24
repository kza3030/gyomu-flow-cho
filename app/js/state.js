/* 画面全体で共有する状態（開いているフロー・選択・保存先・保存と元に戻すの記録・表示の設定）。
   読むのは state.〇〇 でそのまま読んでよい。変えるのは必ずここの関数を通す（state.〇〇 = … と書くとエラーになる）。
   フィールド x を差し替える関数は setX。Map・Set・配列の中身を変えるものは個別の関数（setRecord など）にしてある。
   開いているフロー（state.flow）の中身の編集だけは例外で、その場で書き換えてから app.js の commit() を呼ぶ。
   ドラッグ中・その場の入力欄・マウスを乗せたところなど、その操作の間だけ使う値はここに置かず、使う所のそばに置く。
   作業フォルダの参照（FileSystemDirectoryHandle）を持つので core/ ではない。画面（DOM）には触らない */
(() => {
"use strict";
const s = {
  /* 保存先 */
  store: "pending",     // db＝アーティファクトのDB / folder＝作業フォルダの .yaml ファイル / memory＝このタブのメモリだけ / pending＝決める前
  db: null,             // store が db のときの接続
  dir: null,            // 作業フォルダ
  histDir: null,        // 作業フォルダの中の版の履歴のフォルダ（.flowbook-history）
  lastDir: null,        // 前回開いた作業フォルダ（IndexedDB に覚えておいたもの）
  records: new Map(),   // フローの一覧：ID（folder ではファイル名） -> { name, owner, yaml, updatedAt, steps, history }
  fileMeta: new Map(),  // ファイル名 -> { mod: 最後に読み書きしたときの更新日時, hist: 書き出した履歴の印 }
  unexported: new Set(),// memory：ファイルに保存していない変更があるフロー
  pendingCreate: null,  // 作ったばかりで、まだ保存し終えていないフロー（一覧の読み直しで消さない）
  firstRecords: true,   // 次に一覧を読み込んだら、最初のフローを開く
  conflictId: null,     // ほかのアプリでファイルが変わったため、保存を止めているフロー
  broken: false,        // 開いたフローの YAML が読み取れない（直すまで保存しない）
  legacy: null,         // 以前のバージョンが localStorage に保存したフロー（移行するまで残す）
  scanning: false,      // 画面に戻ったときの作業フォルダの読み直しの最中
  /* 開いているフロー */
  currentId: null,
  flow: null,           // 読み込んだフロー（model.js の normalize の形）
  yamlSrc: "",          // flow の YAML（保存するのはこちら）
  issues: [],           // flow のチェックの結果（validate）
  selected: null,       // 選んだステップの ID
  selEdge: null,        // 図の上で選んだ矢印 { sid: つなぎ元のステップ, k: next の何番目か }。ステップの選択とは同時に持たない
  /* 保存 */
  dirty: false,         // 保存していない変更がある
  saving: false,        // 保存の最中
  again: false,         // 保存の最中にもう一度保存を頼まれた
  saveTimer: 0,         // 少し待ってから保存するためのタイマー
  /* 元に戻す（Ctrl+Z）/ やり直す。変更前の YAML と選択を積んでおく */
  undoSt: [], redoSt: [], undoAt: 0, undoKind: "",
  /* 表示 */
  zoom: 1,
  tab: "edit",          // 右の編集エリアで開いているタブ
  lastL: null,          // 最後に描いた図の配置（図の上でのドラッグ操作で使う）
  showIssues: false,    // 課題を吹き出しで常に表示する（この端末で覚えておく）
  showInfo: false,      // 使用システム・ツール・手段をステップの箱の中に表示する（この端末で覚えておく）
};

// 読むための窓口。どのフィールドにも書き込み口を付けないので、代入すると（"use strict" のもとでは）エラーになる
const state = Object.freeze(Object.defineProperties({}, Object.fromEntries(Object.keys(s).map(k => [k, { get: () => s[k], enumerable: true }]))));

/* フィールドを差し替える */
const setStore = v => { s.store = v; };
const setDb = v => { s.db = v; };
const setDir = v => { s.dir = v; };
const setHistDir = v => { s.histDir = v; };
const setLastDir = v => { s.lastDir = v; };
const setPendingCreate = v => { s.pendingCreate = v; };
const setFirstRecords = v => { s.firstRecords = v; };
const setConflictId = v => { s.conflictId = v; };
const setBroken = v => { s.broken = v; };
const setLegacy = v => { s.legacy = v; };
const setScanning = v => { s.scanning = v; };
const setCurrentId = v => { s.currentId = v; };
const setFlow = v => { s.flow = v; };
const setYamlSrc = v => { s.yamlSrc = v; };
const setIssues = v => { s.issues = v; };
const setSelected = v => { s.selected = v; };
const setSelEdge = v => { s.selEdge = v; };
const setDirty = v => { s.dirty = v; };
const setSaving = v => { s.saving = v; };
const setAgain = v => { s.again = v; };
const setSaveTimer = v => { s.saveTimer = v; };
const setZoom = v => { s.zoom = v; };
const setTab = v => { s.tab = v; };
const setLastL = v => { s.lastL = v; };
const setShowIssues = v => { s.showIssues = v; };
const setShowInfo = v => { s.showInfo = v; };

/* フローの一覧（records）。ここで変えるのはメモリの上だけ。ファイルや DB から消すのは app.js の removeRecord */
const setRecord = (id, rec) => { s.records.set(id, rec); };
const forgetRecord = id => { s.records.delete(id); };
const clearRecords = () => { s.records.clear(); };
/* ファイルの読み書きの記録（fileMeta） */
const setFileMeta = (name, m) => { s.fileMeta.set(name, m); };
const forgetFileMeta = name => { s.fileMeta.delete(name); };
const clearFileMeta = () => { s.fileMeta.clear(); };
/* memory：ファイルに保存していない変更があるフロー（unexported） */
const markUnexported = id => { s.unexported.add(id); };
const markExported = id => { s.unexported.delete(id); };
const clearUnexported = () => { s.unexported.clear(); };
/* 以前のバージョンのデータ（legacy）から 1 件を除く */
const forgetLegacy = k => { delete s.legacy[k]; };

/* 元に戻す。文字入力（kind が op 以外）は、同じ種類の 1.5 秒以内の続きをまとめて 1 回分にする */
function pushUndo(kind){
  const now = Date.now();
  if (kind !== "op" && kind === s.undoKind && now - s.undoAt < 1500){ s.undoAt = now; return; }
  s.undoSt.push({ yaml: s.yamlSrc, sel: s.selected }); if (s.undoSt.length > 100) s.undoSt.shift();
  s.redoSt = []; s.undoAt = now; s.undoKind = kind;
}
function resetUndo(){ s.undoSt = []; s.redoSt = []; s.undoKind = ""; }
// 元に戻す（redo ならやり直す）1 回分を取り出し、今の内容を反対側に積む。なければ null
function takeUndo(redo){
  const e = (redo ? s.redoSt : s.undoSt).pop();
  if (!e) return null;
  (redo ? s.undoSt : s.redoSt).push({ yaml: s.yamlSrc, sel: s.selected }); s.undoKind = "";
  return e;
}

Object.assign(globalThis.Flowbook ??= {}, {
  state,
  setStore, setDb, setDir, setHistDir, setLastDir, setPendingCreate, setFirstRecords, setConflictId, setBroken, setLegacy, setScanning,
  setCurrentId, setFlow, setYamlSrc, setIssues, setSelected, setSelEdge,
  setDirty, setSaving, setAgain, setSaveTimer, setZoom, setTab, setLastL, setShowIssues, setShowInfo,
  setRecord, forgetRecord, clearRecords, setFileMeta, forgetFileMeta, clearFileMeta, markUnexported, markExported, clearUnexported, forgetLegacy,
  pushUndo, resetUndo, takeUndo
});
})();

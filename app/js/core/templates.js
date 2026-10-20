/* ひな形（「新規」「ひな形から作成」で使う YAML）。
   core/ のファイルは画面（DOM）に触らない。Node のテスト（tests/）からも読み込む */
(() => {
"use strict";
const TEMPLATES = {
  blank: `name: 新しい業務フロー
owner: ""
lanes:
  - id: lane1
    name: 担当者
  - id: lane2
    name: 承認者
steps:
  - id: s1
    type: start
    lane: lane1
    label: 依頼を受ける
    next: s2
  - id: s2
    type: task
    lane: lane1
    label: 作業を行う
    next: s3
  - id: s3
    type: end
    lane: lane2
    label: 完了
`,
  expense: `# 経費精算フロー（ひな形）
name: 経費精算フロー
owner: 経理部
description: 立替経費の申請から振込までの標準手順
lanes:
  - id: applicant
    name: 申請者
  - id: manager
    name: 上長
  - id: accounting
    name: 経理
  - id: erp
    name: 会計システム
steps:
  - id: s1
    type: start
    lane: applicant
    label: 経費が発生
    next: s2
  - id: s2
    type: task
    lane: applicant
    label: 精算申請を作成
    note: 領収書の画像を添付する
    next: s3
  - id: s3
    type: decision
    lane: manager
    label: 申請内容は妥当か
    next:
      - to: s4
        when: 承認
      - to: s2
        when: 差戻し
  - id: s4
    type: task
    lane: accounting
    label: 領収書と金額を照合
    issue: 紙の領収書を目視で照合しており、月末に作業が集中する
    next: s5
  - id: s5
    type: decision
    lane: accounting
    label: 経費規程に適合するか
    next:
      - to: s6
        when: 適合
      - to: s2
        when: 不備あり
  - id: s6
    type: system
    lane: erp
    label: 仕訳を登録
    next: s7
  - id: s7
    type: document
    lane: accounting
    label: 振込データを作成
    note: 毎月25日締め・翌月10日払い
    next: s8
  - id: s8
    type: end
    lane: applicant
    label: 指定口座へ入金
`,
  order: `# 受注〜出荷・請求フロー（ひな形）
name: 受注〜出荷・請求フロー
owner: 営業管理部
lanes:
  - id: customer
    name: 顧客
  - id: sales
    name: 営業
  - id: warehouse
    name: 倉庫
  - id: billing
    name: 経理
steps:
  - id: c1
    type: start
    lane: customer
    label: 注文書を送付
    next: c2
  - id: c2
    type: task
    lane: sales
    label: 受注内容を確認
    next: c3
  - id: c3
    type: decision
    lane: sales
    label: 在庫はあるか
    next:
      - to: c5
        when: あり
      - to: c4
        when: なし
  - id: c4
    type: task
    lane: sales
    label: 納期を顧客へ回答
    next:
      - to: c5
        when: 入荷後
  - id: c5
    type: system
    lane: sales
    label: 受注を登録
    next: c6
  - id: c6
    type: document
    lane: warehouse
    label: 出荷指示書を発行
    next: c7
  - id: c7
    type: task
    lane: warehouse
    label: ピッキング・梱包・出荷
    next: [c8, c9]
  - id: c8
    type: end
    lane: customer
    label: 商品を受領
  - id: c9
    type: document
    lane: billing
    label: 請求書を発行
    next: c10
  - id: c10
    type: end
    lane: billing
    label: 入金を消込
`
};

Object.assign(globalThis.Flowbook ??= {}, { TEMPLATES });
})();

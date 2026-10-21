# Design

## Context

- 今のゲームは、ナンが渡した 1 つの HTML（`index.html`）で、ロジックも画面も 1 つのファイルに入っている。テストは無い（判断 df3b）。
- 記録は localStorage の `nekopatch-history-v1`（`{at, n, d, t, h}` の配列。保存のたびに新しい 500 件だけ残す）、遊びかけの盤面と「クリア ○ 問」の数は `nekopatch-v1` にある。
- ナンの今までの記録は、ナンのスマホの Chrome の中にだけある。
- ナンのスマホは VM に届かない見込み。確かめ用の版は、スマホから開ける場所に置く。

## Goals / Non-Goals

**Goals:**

- 記録の上限をなくし、何年分でも残す。
- 今までの記録を、移す処理なしで読む。
- 記録を扱う処理を、シナリオごとのテストで守る。
- 遊び方と見た目を変えない。

**Non-Goals:**

- 記録をネットに送ること、ほかの機械と合わせること。
- 書き出しの自動化。

## Decisions

1. **作りを 798a の形に組み直す**（判断 ecf8）。元のスクリプトを、次のように分けて写す。処理の中身は変えない。
   - `src/core/grid.ts`、`solver.ts`、`puzzle.ts`: 問題作りと理詰めの解き方（元の `<script id="core">`）。乱数と時刻は引数で受け取り、テストで決まった値にする。
   - `src/core/play.ts`: 猫どうしのぶつかり、クリアの判定、ヒント（元の画面のスクリプトにあったもの）。
   - `src/core/records.ts`: 記録の読み書き、成績のまとめ、書き出しと読み込み。
   - `src/core/saved-game.ts`: 遊びかけの盤面と設定の読み書き。
   - `src/ui/web/app.ts`: 画面の動き。ブラウザの機能は `AppEnv` を通して使う。
   - `src/ui/web/style.css`、`index.html`: 元の CSS と部品をそのまま写す。CSP で `style` 属性が使えないので、絵の部品の置き場の `style="position:absolute"` だけ CSS のクラスに移す。
2. **保存のキーと形を変えない**（判断 ff86）。`parseStoredHistory` と `parseSavedGame` は、作り直す前の形を読み、読めない部分があれば知らせる。保存は `serializeHistory` と `serializeGame` で、元と同じ JSON の形にする。
3. **読めない保存データは、別のキーに残してから書き直す**（`SaveStore`）。残せなかったときは、そのキーに書かない。
4. **成績のまとめは、1 回の走査で数える**。元の `Math.min(...配列)` は、数十万件で止まるおそれがある（引数の数の上限）。最近の記録の「前回比」も、表示する 30 件だけについて探す。
5. **消さないよう頼む処理**（`persistence.ts`）は、`persisted()` が true なら頼み直さない。false なら `persist()` を呼ぶ。起動したときと、「記録」を押したとき（操作の中で頼むと通りやすい）に呼ぶ。
6. **Web App Manifest** は Vite のプラグインで作る（`vite.config.ts`）。アイコンは `assets/icon.svg` から作った PNG（192px、512px）を `public/` に置く。確かめ用は名前を「ねこパッチ（確かめ用）」にする。
7. **書き出しのファイル**は JSON。`format`、`version`、`exportedAt`、`solvedCount`、`records`（1 件 1 行）。`parseExport` は、印と版と全部の記録の形を確かめ、1 か所でも違えば null を返す。
8. **読み込み**（`importRecords`）は、今の記録の鍵の集まりに無い記録だけを足し、日時の順に並べる。「クリア ○ 問」は `max(今の数, ファイルの数 + 今の記録のうちファイルに無い件数)`。同じファイルを何回読み込んでも同じ結果になる。
9. **確かめ用のページ**は、`vite build --mode trial` で作る。`trialStorage` が、`nekopatch-preview-` で始まらないキーへの書き込みを止め、確かめ用のキーが空なら本物の値を写す。
10. **問題作りの Worker** は、別のファイル（`src/ui/web/worker.ts`）にする（元は `blob:` の URL で作っていた）。CSP を `worker-src 'self'` にでき、`blob:` を許さずに済む。Worker が読み込めなかったときは、待っている分もページの中で作る（「問題を作っています…」のまま止まらないように）。

## Risks / Trade-offs

- 組み直しで、遊び方が少し変わるおそれ → 元の処理を、名前と順番を保ったまま写した。問題作りとヒントの決まりは `puzzle` の仕様とテストで確かめる。見た目は、VM の Chromium で元の版と並べて確かめ、ナンにもスマホで確かめてもらう。
- 確かめ用のページが本物の記録を壊すおそれ → キーを分け、書き込みを止める仕組みとテストを置く。
- `main` に取り込んだ後の `just deploy` を忘れるおそれ → CLAUDE.md の手順に書く。

## Migration Plan

1. `gh-pages` ブランチを作り、今の `index.html` と `.nojekyll` をそのまま置く。
2. GitHub Pages の公開元を `main` から `gh-pages` に切り替える（本物の中身は同じ）。
3. `just deploy-trial` で、確かめ用の版を `preview/` に置く。ナンに確かめてもらう。
4. 了承を得たらアーカイブし、`main` に取り込み、`just deploy` で本物を置き直す（`preview/` は消える）。
5. 戻すとき: `gh-pages` を 1 つ前のコミットに戻して送る。作り直す前の版は 500 件を超えた記録を消すので、先に書き出しておく（判断 ff86）。

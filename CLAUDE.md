# ねこパッチ（nekopatch）

猫を置くパズルのゲーム。ナンが Android のスマホの Chrome で遊ぶ。クリアの記録を、スマホの Chrome の中だけに何年分も残す。

## どこに何があるか

- 遊ぶ場所: https://yu-cha.github.io/nekopatch/ （公開。GitHub `yu-cha/nekopatch` も公開）
- ナンと合意した要件: `docs/requirements-agreement-*.md`（合意した時点のまま残す）
- 要件・仕様: `openspec/specs/`（進行中の変更提案は `openspec/changes/`）
- 技術判断の理由: `decisions/`（一覧は `decisions/INDEX.md`）。全アプリ共通の標準は `~/git/knowledge/decisions/`
- ロジック: `src/core/`。UI からの入口は `src/core/index.ts` だけ。
- UI: `src/ui/web/` と `index.html`。別の UI を足すときは `src/ui/<種類>/` に置く。
- ホーム画面のアイコン: `assets/icon.svg` から `just icons` で `public/icon-*.png` を作る。

## 進め方

- 全体の流れは `~/git/knowledge/decisions/` の adb8（OpenSpec）、f92f（検査）、dc29（git、worktree）、902a（ロジックと UI）に従う。
- 編集は、このリポジトリのメインの作業ツリーではなく、`wt start nekopatch <ブランチ>` で作った worktree で行い、`wt land` で取り込む（`~/git/knowledge/howto/worktree.md`）。worktree では、最初に `nix develop -c npm ci` で依存を入れる。
- Claude Code の Bash では devShell が自動で有効にならないので、道具は `nix develop -c` を付けて実行する（例: `nix develop -c just check`）。
- セッションをこのフォルダの外で始めた場合（ナンのセッションはホームで始まる）、SessionStart フックは動かない。作業を始める前に `nix develop -c openspec list` で、進行中の変更提案を確かめる。
- 検査の入口は `just check`。コミット前と push 前のフックでも実行される。
- コミットのたびに、共有フォルダの bare リポジトリ `~/git/repos/nekopatch.git` へ自動でバックアップされる（`git-backup`）。

## 配信（判断 ecf8）

- GitHub Pages は `gh-pages` ブランチの最上位を配信する。`main` は配信されない。GitHub Actions は使わない（f92f）。
- `main` に取り込んだら、必ず `nix develop -c just deploy` を実行する（`origin/main` をビルドして `gh-pages` に積んで送る）。数分で反映される。
  - 実行するのは、依存を入れた worktree の中（`wt start nekopatch chore/deploy-<名前>` のあと `nix develop -c npm ci`。終わったら `wt drop`）。送る前のフックが、実行した場所で `just check` を動かすため。メインの作業ツリーには `node_modules` が無く、2026-10-25 に検査が止まって送れなかった。
- ナンに確かめてもらう版は、worktree で `nix develop -c just deploy-trial` を実行して置く（https://yu-cha.github.io/nekopatch/preview/ ）。ナンのスマホは VM（192.168.56.10）に届かないので、`just preview` では確かめてもらえない。
- 戻すときは、`gh-pages` を 1 つ前のコミットに戻して送る。

## 保存データ（判断 ff86、490d、c995、73b0）

- 保存のキーは `nekopatch-` で始める（`yu-cha.github.io` の下のページは、ブラウザの保存領域を共有する）。
- 本物のキー `nekopatch-v1`（遊びかけの盤面、設定、「クリア ○ 問」）と `nekopatch-history-v1`（クリアの記録）は、名前も形も変えない。ナンの何年分の記録がそこにある。形を変えるときは、古い形を読む処理とテストを先に作る。
  - 例外: `nekopatch-v1` には、前の版が読み飛ばしても困らない欄だけを足してよい。今あるのは `autoXUsed`（その問題で「自動×」を使ったか。使ったときだけ書く。判断 c995）と `received`（送られてきたリンクから始めた問題の、送った人のタイム・ヒント・自動×。そのときだけ書く。判断 73b0）。
- 遊んだ盤面の形は、別のキー `nekopatch-boards-v1`（記録の鍵 `at|n|d|t|h` → 盤面の符号）に置く（判断 490d）。記録に欄を足すと、今の版のタブや戻した版が保存し直すときに消えるため。記録に情報を足すときも、同じく別のキーにする。
- 記録の備考（ひと言 `memo`、「難」の印 `hard`）と「自動×」の印（`autoX`）は、別のキー `nekopatch-notes-v1`（記録の鍵 → `{memo, hard, autoX}`）に置く（判断 c995）。ナンが書いた文は、画面に出すとき HTML の文字列に混ぜず、`textContent` か `value` で入れる。
- もらった盤面の印（送ってくれた人のタイム `senderTime`、ヒント `senderHints`、自動× `senderAutoX`）は、別のキー `nekopatch-received-v1`（記録の鍵 → `{senderTime, senderHints, senderAutoX}`。タイムの無いリンクなら `{}`）に置く（判断 73b0）。
- 確かめ用のページは `nekopatch-preview-` で始まるキーだけに書く（`trialStorage` が止める）。
- 読めない値は `<キー>-unreadable-<日時>` に残してある。ナンから「読めない記録がありました」と言われたら、ナンのスマホの Chrome でその値を書き出してもらう方法を考える。

## 仕組みで守っていること

- 仕様の各シナリオには、名前が完全に一致するテスト（`it("<シナリオ名>", ...)`）が要る。`scripts/check-scenarios.ts` が検査する。作業中の変更提案では警告、`tasks.md` がすべて完了したら失敗になる。
- 依存の向き（ロジックは UI にも外部の部品にも依存しない、UI はロジックの入口だけを使う、UI どうしは依存しない）は、`just deps` と `tsconfig.core.json` の型検査が確かめる。
- ページの決まり（CSP）は `index.html` にあり、通信を禁止している（`src/ui/web/csp.test.ts`）。CSP があるので、HTML に `style` 属性やインラインのスクリプトを書かない。

## 盤面を送るリンク（判断 73b0）

- 形は `<ページのアドレス>?openExternalBrowser=1#n=<大きさ>&d=<難しさ>&b=<盤面の符号>&t=<秒>&h=<ヒント>&x=1`（`t`・`h` は遊んでいる途中に送るときは無い。`x=1` は自動×を使ったときだけ）。作るのも読むのも `src/core/share.ts`。
- 送ったリンクは LINE に何年も残る。欄の名前と意味は変えない。変えるときは新しい名前の欄を足し、前の欄も読めるようにする。
- `?openExternalBrowser=1` は、LINE でタップしたときに Chrome で開くための LINE の決まり。盤面は `#` の後ろに入れて、サーバーに送らない。

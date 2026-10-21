# 検査と開発の入口。devShell の中で実行する（外からは `nix develop -c just <レシピ>`）。

# レシピの一覧を表示する
default:
    @just --list

# すべての検査（コミット前と push 前のフックでも実行される）
check: fmt-check lint typecheck deps test spec decisions

# 整形する
fmt:
    npx biome format --write .

# 整形済みかを確かめる
fmt-check:
    npx biome format .

# リンター（整形の確認も含む）
lint:
    npx biome check .

# 型検査（全体と、DOM・Node.js の型を外したロジックだけ）
typecheck:
    npx tsc --noEmit
    npx tsc --noEmit -p tsconfig.core.json

# 依存の向きの検査（ロジックは UI に依存しない、など）
deps:
    npx depcruise src --config .dependency-cruiser.cjs --output-type err

# 自動テスト
test:
    npx vitest run

# 仕様の検証と、シナリオとテストの対応の確認
spec:
    openspec validate --all --strict --no-interactive
    node scripts/check-scenarios.ts

# 判断の記録（decisions/）の形式、ID の重複、一覧が最新かの確認（~/git/knowledge/howto/decision-records.md）
decisions:
    adr check

# 配信するファイルを dist/ に作る（判断 ecf8。1 つの HTML にはまとめない）
build:
    npx vite build

# 配信するファイルを作り、確認用のサーバーで配信する（VM の中や Windows から http://192.168.56.10:4173 。ナンのスマホからは届かない）
# 開発用サーバー（vite dev）は、CSP を入れたページでは動かないので使わない（~/git/knowledge/howto/new-ts-web-app.md）
preview: build
    npx vite preview --host 0.0.0.0 --port 4173 --strictPort

# 本物を配信する。origin/main をビルドして gh-pages の最上位に置く（main に取り込んだ後に実行する。確かめ用の preview/ は消える）
deploy:
    node scripts/deploy.ts main

# 確かめ用の版を配信する。今のコミットを --mode trial でビルドして gh-pages の preview/ に置く（https://yu-cha.github.io/nekopatch/preview/ ）
deploy-trial:
    node scripts/deploy.ts trial

# ホーム画面のアイコン（public/icon-*.png）を assets/icon.svg から作り直す
icons:
    nix shell nixpkgs#librsvg -c bash -c 'for s in 192 512; do rsvg-convert -w $s -h $s assets/icon.svg -o public/icon-$s.png; done'

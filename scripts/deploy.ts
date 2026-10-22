// ビルドしたものを gh-pages ブランチに積んで送る。GitHub Pages は gh-pages の最上位を配信する（判断 ecf8）。
// GitHub Actions は使わない（~/git/knowledge/decisions の f92f）。
//
// 使い方:
//   node scripts/deploy.ts main    本物。origin/main をビルドし、gh-pages の最上位に置く（preview/ は消える）
//   node scripts/deploy.ts trial   確かめ用。今のコミット（HEAD）を --mode trial でビルドし、gh-pages の preview/ だけを置き換える
//
// 作業ツリーには触れない。ソースは git archive で一時的な場所に取り出し、そこでビルドする。
// gh-pages の木は、一時的な索引（GIT_INDEX_FILE）で組み立てる。
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const PAGES_BRANCH = "gh-pages";
export const TRIAL_DIR = "preview";

export type Git = (args: string[], options?: { index?: string; input?: Buffer }) => string;

/**
 * git の場所や索引を指す環境変数（GIT_DIR、GIT_WORK_TREE、GIT_INDEX_FILE など）を除いた環境。
 * git のフック（コミット前の検査）の中では、git がこれらを設定して渡してくる。そのまま受け継ぐと、
 * cwd ではなくフックのリポジトリを操作してしまう（2026-10-22、テストの git init が本物のリポジトリを
 * 作業ツリーの無い設定 core.bare = true に書き換えた）
 */
export function cleanGitEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !name.startsWith("GIT_")));
}

export function gitIn(cwd: string): Git {
  return (args, options = {}) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      input: options.input,
      env: {
        ...cleanGitEnv(process.env),
        ...(options.index === undefined ? {} : { GIT_INDEX_FILE: options.index }),
      },
      stdio: ["pipe", "pipe", "inherit"],
    }).trim();
}

/** dir の中身（隠しファイルも含む）を木にする */
export function treeFromDir(git: Git, dir: string, scratch: string): string {
  const index = join(scratch, "index-dist");
  git(["read-tree", "--empty"], { index });
  git(["--work-tree", dir, "add", "--all", "--force", "."], { index });
  return git(["write-tree"], { index });
}

/** base の木の prefix/ を、tree に置き換えた木（ほかの場所はそのまま） */
export function replaceDir(
  git: Git,
  base: string,
  prefix: string,
  tree: string,
  scratch: string,
): string {
  const index = join(scratch, "index-pages");
  git(["read-tree", base], { index });
  git(["rm", "-r", "-q", "--cached", "--ignore-unmatch", "--", prefix], { index });
  git(["read-tree", `--prefix=${prefix}/`, tree], { index });
  return git(["write-tree"], { index });
}

function build(git: Git, commit: string, mode: "main" | "trial", scratch: string): string {
  const src = join(scratch, "src");
  execFileSync("mkdir", ["-p", src]);
  const archive = execFileSync("git", ["archive", "--format=tar", commit], {
    env: cleanGitEnv(process.env),
    cwd: git(["rev-parse", "--show-toplevel"]),
    maxBuffer: 1 << 30,
  });
  execFileSync("tar", ["-x", "-C", src], { input: archive });
  const run = (cmd: string, args: string[]) =>
    execFileSync(cmd, args, { cwd: src, stdio: ["ignore", "inherit", "inherit"] });
  run("npm", ["ci", "--prefer-offline", "--no-audit", "--no-fund"]);
  run("npx", ["vite", "build", ...(mode === "trial" ? ["--mode", "trial"] : [])]);
  return join(src, "dist");
}

function main(): void {
  const mode = process.argv[2];
  if (mode !== "main" && mode !== "trial")
    throw new Error("使い方: node scripts/deploy.ts main | trial");
  const git = gitIn(process.cwd());
  git(["fetch", "--quiet", "origin", "main", PAGES_BRANCH]);
  const remotePages = `origin/${PAGES_BRANCH}`;
  const parent = git(["rev-parse", "--verify", remotePages]);
  const commit = git(["rev-parse", "--verify", mode === "main" ? "origin/main" : "HEAD"]);
  if (mode === "trial" && git(["status", "--porcelain"]) !== "")
    console.warn("注意: コミットしていない変更は、確かめ用の版に入りません");

  const scratch = mkdtempSync(join(tmpdir(), "nekopatch-deploy-"));
  try {
    const dist = build(git, commit, mode, scratch);
    const distTree = treeFromDir(git, dist, scratch);
    const tree =
      mode === "main"
        ? distTree
        : replaceDir(git, `${remotePages}^{tree}`, TRIAL_DIR, distTree, scratch);
    if (tree === git(["rev-parse", `${remotePages}^{tree}`])) {
      console.log("配信の中身は変わりません。送りませんでした");
      return;
    }
    const what = mode === "main" ? "本物" : `確かめ用（${TRIAL_DIR}/）`;
    const message = [
      `配信: ${what} ${commit.slice(0, 7)}`,
      "",
      `${mode === "main" ? "origin/main" : "作業ブランチ"} の ${commit} をビルドしたもの（scripts/deploy.ts ${mode}）。`,
      "",
      "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>",
    ].join("\n");
    const pagesCommit = git(["commit-tree", tree, "-p", parent, "-F", "-"], {
      input: Buffer.from(message),
    });
    git(["update-ref", `refs/heads/${PAGES_BRANCH}`, pagesCommit]);
    execFileSync("git", ["push", "origin", `${PAGES_BRANCH}:${PAGES_BRANCH}`], {
      env: cleanGitEnv(process.env),
      stdio: ["ignore", "inherit", "inherit"],
    });
    console.log(
      `${what}を ${PAGES_BRANCH} に送りました（${pagesCommit.slice(0, 7)}）。数分で反映されます`,
    );
    console.log(
      mode === "main"
        ? "https://yu-cha.github.io/nekopatch/"
        : `https://yu-cha.github.io/nekopatch/${TRIAL_DIR}/`,
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (import.meta.main) main();

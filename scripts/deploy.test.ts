import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Git, gitIn, replaceDir, TRIAL_DIR, treeFromDir } from "./deploy.ts";

let dir: string;
let git: Git;

function write(path: string, content: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
}

/** 木の中のファイルと中身の一覧 */
function files(tree: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of git(["ls-tree", "-r", "--name-only", tree]).split("\n").filter(Boolean))
    out[line] = git(["cat-file", "blob", `${tree}:${line}`]);
  return out;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nekopatch-deploy-test-"));
  git = gitIn(dir);
  git(["init", "--quiet"]);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("配信の木", () => {
  it("ビルドした場所の中身を、隠しファイルも含めて木にする", () => {
    const dist = join(dir, "work", "dist");
    write(join(dist, "index.html"), "本物");
    write(join(dist, ".nojekyll"), "");
    write(join(dist, "assets", "index-1.js"), "js");
    const tree = treeFromDir(git, dist, dir);
    expect(files(tree)).toEqual({
      ".nojekyll": "",
      "assets/index-1.js": "js",
      "index.html": "本物",
    });
  });

  it("確かめ用の版は preview/ だけを置き換え、本物の部分はそのまま残す", () => {
    const live = join(dir, "live");
    write(join(live, "index.html"), "本物");
    write(join(live, ".nojekyll"), "");
    write(join(live, TRIAL_DIR, "old.js"), "古い確かめ用");
    const base = treeFromDir(git, live, dir);

    const trial = join(dir, "trial");
    write(join(trial, "index.html"), "確かめ用");
    write(join(trial, "assets", "index-2.js"), "js2");
    const trialTree = treeFromDir(git, trial, dir);

    expect(files(replaceDir(git, base, TRIAL_DIR, trialTree, dir))).toEqual({
      ".nojekyll": "",
      "index.html": "本物",
      "preview/assets/index-2.js": "js2",
      "preview/index.html": "確かめ用",
    });
  });
});

describe("git の呼び方", () => {
  it("git のフックの中（GIT_DIR が設定されている）でも、ほかのリポジトリを書き換えない", () => {
    // フックのリポジトリの役
    const hookRepo = mkdtempSync(join(tmpdir(), "nekopatch-hook-repo-"));
    const saved = { GIT_DIR: process.env.GIT_DIR, GIT_INDEX_FILE: process.env.GIT_INDEX_FILE };
    try {
      gitIn(hookRepo)(["init", "--quiet"]);
      process.env.GIT_DIR = join(hookRepo, ".git");
      process.env.GIT_INDEX_FILE = join(hookRepo, ".git", "index");

      const other = mkdtempSync(join(dir, "other-"));
      gitIn(other)(["init", "--quiet"]);
      expect(gitIn(other)(["rev-parse", "--absolute-git-dir"])).toBe(join(other, ".git"));
    } finally {
      for (const [name, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
    expect(gitIn(hookRepo)(["config", "--get", "core.bare"])).toBe("false");
    rmSync(hookRepo, { recursive: true, force: true });
  });
});

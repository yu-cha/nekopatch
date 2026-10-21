import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const html = readFileSync(join(import.meta.dirname, "../../../index.html"), "utf8");

function csp(): Map<string, string[]> {
  const content = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]*)"/)?.[1];
  const directives = new Map<string, string[]>();
  for (const part of (content ?? "").split(";")) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name) directives.set(name, values);
  }
  return directives;
}

describe("ページの決まり（CSP）", () => {
  it("ページの決まりで通信を禁止している", () => {
    const d = csp();
    expect(d.get("connect-src")).toEqual(["'none'"]);
    expect(d.get("form-action")).toEqual(["'none'"]);
    expect(d.get("default-src")).toEqual(["'none'"]);
    expect(d.get("script-src")).toEqual(["'self'"]);
  });

  it("文字の形（Google Fonts）と、問題作りの Worker だけを、外のものとして許す", () => {
    const d = csp();
    expect(d.get("style-src")).toEqual(["'self'", "https://fonts.googleapis.com"]);
    expect(d.get("font-src")).toEqual(["https://fonts.gstatic.com"]);
    expect(d.get("worker-src")).toEqual(["'self'"]);
  });

  it("ページの中に style 属性やインラインのスクリプトを書かない（CSP で止まるため）", () => {
    expect(html).not.toMatch(/\sstyle="/);
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
  });
});

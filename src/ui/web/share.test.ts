import { describe, expect, it } from "vitest";
import { type LocationApi, type ShareApi, shareOrCopy, takeLink } from "./share.ts";

/** 偽の navigator。share が投げる例外の名前を決められる。写した文を覚える */
function fakeNav(options: { share?: "ok" | "AbortError" | "NotAllowedError"; copy?: boolean }): {
  nav: ShareApi;
  shared: string[];
  copied: string[];
} {
  const shared: string[] = [];
  const copied: string[] = [];
  const nav: ShareApi = {
    ...(options.share === undefined
      ? {}
      : {
          share: async ({ text }: { text: string }) => {
            if (options.share !== "ok") throw new DOMException("失敗", options.share);
            shared.push(text);
          },
        }),
    ...(options.copy === false
      ? {}
      : {
          clipboard: {
            writeText: async (text: string) => {
              copied.push(text);
            },
          },
        }),
  };
  return { nav, shared, copied };
}

describe("共有の画面に渡す", () => {
  it("共有の画面に渡せたら、文を写さない", async () => {
    const f = fakeNav({ share: "ok" });
    expect(await shareOrCopy(f.nav, "文")).toBe("shared");
    expect(f.shared).toEqual(["文"]);
    expect(f.copied).toEqual([]);
  });

  it("共有の画面が無ければ、文を写す", async () => {
    const f = fakeNav({});
    expect(await shareOrCopy(f.nav, "文")).toBe("copied");
    expect(f.copied).toEqual(["文"]);
  });

  it("共有の画面を閉じたら、文を写さない", async () => {
    const f = fakeNav({ share: "AbortError" });
    expect(await shareOrCopy(f.nav, "文")).toBe("cancelled");
    expect(f.copied).toEqual([]);
  });

  it("共有の画面が出せなければ、文を写す", async () => {
    const f = fakeNav({ share: "NotAllowedError" });
    expect(await shareOrCopy(f.nav, "文")).toBe("copied");
    expect(f.copied).toEqual(["文"]);
  });

  it("共有の画面も写すこともできなければ、送れなかったとする", async () => {
    expect(await shareOrCopy(fakeNav({ copy: false }).nav, "文")).toBe("failed");
    const broken: ShareApi = {
      clipboard: {
        writeText: async () => {
          throw new DOMException("失敗", "NotAllowedError");
        },
      },
    };
    expect(await shareOrCopy(broken, "文")).toBe("failed");
  });
});

/** 偽のアドレス。replaceState で書き換えた先を覚える */
function fakeLocation(search: string, hash: string): LocationApi & { replaced: string[] } {
  const replaced: string[] = [];
  return {
    location: { pathname: "/nekopatch/", search, hash },
    history: {
      replaceState: (_data, _unused, url) => {
        replaced.push(url ?? "");
      },
    },
    replaced,
  };
}

describe("アドレスのリンクを読む", () => {
  it("リンクを読んだら、アドレスから盤面を消す", () => {
    const w = fakeLocation("?openExternalBrowser=1", "#n=8&d=2&b=AAAA");
    expect(takeLink(w)).toBe("n=8&d=2&b=AAAA");
    // replaceState なので、開き直しの履歴は増えない
    expect(w.replaced).toEqual(["/nekopatch/"]);
  });

  it("リンクでないアドレスは、そのままにする", () => {
    const w = fakeLocation("", "");
    expect(takeLink(w)).toBeNull();
    expect(w.replaced).toEqual([]);
  });

  it("LINE が # の後ろを落としたリンクは、空のリンクとして読む", () => {
    const w = fakeLocation("?openExternalBrowser=1", "");
    expect(takeLink(w)).toBe("");
    expect(w.replaced).toEqual(["/nekopatch/"]);
  });

  it("ほかの ? の後ろだけのアドレスは、リンクとしないが、アドレスからは消す", () => {
    const w = fakeLocation("?utm_source=x", "");
    expect(takeLink(w)).toBeNull();
    expect(w.replaced).toEqual(["/nekopatch/"]);
  });
});

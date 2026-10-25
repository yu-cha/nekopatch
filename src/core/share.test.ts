import { describe, expect, it } from "vitest";
import { boardId, encodeBoard } from "./board.ts";
import { LEVELS, SIZES } from "./play.ts";
import { generate } from "./puzzle.ts";
import {
  mergeReceived,
  parseShareFragment,
  parseStoredReceived,
  readReceived,
  serializeReceived,
  shareFragment,
  shareLink,
  shareText,
  versusSender,
} from "./share.ts";
import { seededRandom } from "./test-support.ts";

const PAGE = "https://yu-cha.github.io/nekopatch/";

/** 選べる大きさ・難しさの組ごとに、決まった問題を 1 問ずつ */
const made = SIZES.flatMap((N) =>
  LEVELS.map((diff) => ({ diff, p: generate(N, diff, 0, seededRandom(N * 100 + diff)) })),
);

const p8 = generate(8, 2, 0, seededRandom(802));
const code8 = encodeBoard(8, p8.reg);

describe("送るリンクと文", () => {
  it("リンクの中身から、送った盤面を作り直せる", () => {
    for (const { diff, p } of made) {
      const code = encodeBoard(p.N, p.reg);
      const fragment = shareFragment({
        n: p.N,
        d: diff,
        code,
        sender: { time: 205800, hints: 2, autoX: true },
      });
      expect(fragment.endsWith("&t=205&h=2&x=1")).toBe(true);
      const back = parseShareFragment(fragment);
      expect(back?.board).toEqual({
        n: p.N,
        d: diff,
        code,
        sender: { time: 205000, hints: 2, autoX: true },
      });
      expect(back?.puzzle.reg).toEqual(p.reg);
      expect(back?.puzzle.cats).toEqual(p.cats);
    }
  });

  it("タイムの無い盤面も、作り直せる", () => {
    const fragment = shareFragment({ n: 8, d: 2, code: code8, sender: null });
    expect(fragment).toBe(`n=8&d=2&b=${code8}`);
    expect(parseShareFragment(fragment)?.board).toEqual({
      n: 8,
      d: 2,
      code: code8,
      sender: null,
    });
  });

  it("読めないリンクの中身は、盤面として使わない", () => {
    // 行ごとに色のエリアを分けた盤面は、答えが 2 つ以上ある
    const rows = Array.from({ length: 36 }, (_, i) => Math.floor(i / 6));
    const ok = `n=8&d=2&b=${code8}&t=205&h=0`;
    expect(parseShareFragment(ok)).not.toBeNull();
    const broken = [
      `n=11&d=2&b=${code8}&t=205&h=0`,
      `n=8&d=4&b=${code8}&t=205&h=0`,
      `n=8&d=2&b=${code8.slice(1)}&t=205&h=0`,
      `n=6&d=2&b=${encodeBoard(6, rows)}`,
      `n=8&d=2&b=${code8}&t=205`,
      `n=8&d=2&b=${code8}&t=-1&h=0`,
      `n=8&d=2&b=${code8}&t=1.5&h=0`,
      `n=8&d=2&b=${code8}&t=205&h=10000`,
      `n=8&d=2&b=${code8}&t=205&h=0&x=2`,
      `n=8&d=2&b=${code8}&x=1`,
      `n=8&d=2&b=${code8}&t=205&h=0&h=1`,
      `n=8&d=2&b=${code8}&t=205&h`,
    ];
    for (const f of broken) expect(parseShareFragment(f)).toBeNull();
    expect(parseShareFragment(`${ok}&y=1`)?.board.sender).toEqual({
      time: 205000,
      hints: 0,
      autoX: false,
    });
  });

  it("空や、盤面の無いリンクの中身は読まない", () => {
    expect(parseShareFragment("")).toBeNull();
    expect(parseShareFragment("n=8&d=2")).toBeNull();
    expect(parseShareFragment("%E0%A4%A")).toBeNull();
  });

  it("アプリが = と & を % で書き換えていても読める", () => {
    const f = encodeURIComponent(`n=8&d=2&b=${code8}&t=205&h=0`);
    expect(f).toContain("%3D");
    expect(parseShareFragment(f)?.board.code).toBe(code8);
  });

  it("送る文は 3 行で、盤面 ID、大きさ・難しさ、タイムとヒント、リンクだけを入れる", () => {
    const b = { n: 8, d: 2, code: code8, sender: { time: 205800, hints: 0, autoX: false } };
    expect(shareText(PAGE, b).split("\n")).toEqual([
      `ねこパッチの盤面 ${boardId(8, code8)}（8×8・ふつう）`,
      "3:25・ヒント 0 回でクリア。挑戦してみて！",
      `${PAGE}?openExternalBrowser=1#n=8&d=2&b=${code8}&t=205&h=0`,
    ]);
    expect(shareText(PAGE, { ...b, sender: null }).split("\n")[1]).toBe("これ解ける？");
    const withAutoX = shareText(PAGE, { ...b, sender: { time: 205800, hints: 0, autoX: true } });
    expect(withAutoX.split("\n").slice(1)).toEqual([
      "3:25・ヒント 0 回・自動×でクリア。挑戦してみて！",
      `${PAGE}?openExternalBrowser=1#n=8&d=2&b=${code8}&t=205&h=0&x=1`,
    ]);
    expect(shareLink(PAGE, { ...b, sender: null })).toBe(
      `${PAGE}?openExternalBrowser=1#n=8&d=2&b=${code8}`,
    );
  });

  it("とても長いタイムやヒントの回数は、読める値までにして送る", () => {
    const f = shareFragment({
      n: 8,
      d: 2,
      code: code8,
      sender: { time: 4e8, hints: 12345, autoX: false },
    });
    expect(f).toBe(`n=8&d=2&b=${code8}&t=359999&h=9999`);
    expect(parseShareFragment(f)).not.toBeNull();
  });
});

describe("送った人との比べ", () => {
  it("画面に出る秒どうしの差で比べる", () => {
    const s = { time: 205000, hints: 0, autoX: false };
    expect(versusSender(175400, s)).toBe(-30000);
    expect(versusSender(240000, s)).toBe(35000);
    expect(versusSender(205900, s)).toBe(0);
  });
});

describe("もらった盤面の印の保存", () => {
  const key = "1761100000000|8|2|175000|0";

  it("自動×の印も、読み書きできる", () => {
    const m = new Map([[key, { sender: { time: 205000, hints: 0, autoX: true } }]]);
    const raw = serializeReceived(m);
    expect(raw).toBe(`{"${key}":{"senderTime":205000,"senderHints":0,"senderAutoX":true}}`);
    expect(parseStoredReceived(raw)).toEqual({ received: m, intact: true });
    expect(readReceived({ senderTime: 1000, senderHints: 0, senderAutoX: false })).toEqual({
      sender: { time: 1000, hints: 0, autoX: false },
    });
    for (const bad of [
      { senderTime: 1000, senderHints: 0, senderAutoX: "yes" },
      { senderAutoX: true },
    ])
      expect(readReceived(bad)).toBeNull();
  });

  it("送った人のタイムがある印と無い印を、読み書きできる", () => {
    const m = new Map([
      [key, { sender: { time: 205000, hints: 0, autoX: false } }],
      ["1761100600000|8|2|90000|1", { sender: null }],
    ]);
    const raw = serializeReceived(m);
    expect(raw).toBe(
      `{"${key}":{"senderTime":205000,"senderHints":0},"1761100600000|8|2|90000|1":{}}`,
    );
    expect(parseStoredReceived(raw)).toEqual({ received: m, intact: true });
  });

  it("読めない部分があれば、読めた分だけを返して、そう知らせる", () => {
    expect(parseStoredReceived(null)).toEqual({ received: new Map(), intact: true });
    expect(parseStoredReceived('{"1":').intact).toBe(false);
    expect(parseStoredReceived("[]").intact).toBe(false);
    const { received, intact } = parseStoredReceived(
      JSON.stringify({
        [key]: { senderTime: 205000, senderHints: 0 },
        "not-a-key": {},
        "1761100600000|8|2|90000|1": { senderTime: -1, senderHints: 0 },
        "1761100700000|8|2|90000|1": { senderTime: 1000 },
      }),
    );
    expect(intact).toBe(false);
    expect([...received.keys()]).toEqual([key]);
  });

  it("印の形を確かめる", () => {
    expect(readReceived({})).toEqual({ sender: null });
    expect(readReceived({ senderTime: 1000, senderHints: 2, other: 1 })).toEqual({
      sender: { time: 1000, hints: 2, autoX: false },
    });
    for (const bad of [null, [], "x", { senderTime: 1.5, senderHints: 0 }, { senderHints: 0 }])
      expect(readReceived(bad)).toBeNull();
  });

  it("読み込みでは、今のスマホの印があれば今のまま、無ければファイルの方を使う", () => {
    const current = new Map([[key, { sender: { time: 1000, hints: 0, autoX: false } }]]);
    const file = new Map([
      [key, { sender: { time: 9000, hints: 9, autoX: false } }],
      ["1761100600000|8|2|90000|1", { sender: null }],
    ]);
    expect(mergeReceived(current, file)).toEqual(
      new Map([
        [key, { sender: { time: 1000, hints: 0, autoX: false } }],
        ["1761100600000|8|2|90000|1", { sender: null }],
      ]),
    );
  });
});

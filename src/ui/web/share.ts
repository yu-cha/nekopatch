// 盤面を送る文を、スマホの共有の画面（LINE などを選べる）に渡す。共有の画面が無いか出せなければ、文を写す（判断 73b0）。
// 送られてきた盤面のリンク（アドレスの # の後ろ）を読み、読んだらアドレスから消す。

/**
 * 送った結果。shared は共有の画面に渡せた、cancelled は使う人が共有の画面を閉じた、
 * copied は文を写した、failed は渡すことも写すこともできなかった
 */
export type ShareResult = "shared" | "cancelled" | "copied" | "failed";

/** navigator のうち、使う部分 */
export interface ShareApi {
  readonly share?: (data: { text: string }) => Promise<void>;
  readonly clipboard?: { writeText(text: string): Promise<void> };
}

/** 文を共有の画面に渡す。共有の画面が無いか、閉じた以外の理由で出せなければ、文を写す */
export async function shareOrCopy(nav: ShareApi, text: string): Promise<ShareResult> {
  if (typeof nav.share === "function") {
    try {
      // URL を別に渡すと、アプリによって並べ方が違うので、リンクも文の中に入れて渡す
      await nav.share({ text });
      return "shared";
    } catch (e) {
      if ((e as { name?: unknown } | null)?.name === "AbortError") return "cancelled";
    }
  }
  try {
    if (nav.clipboard === undefined) return "failed";
    await nav.clipboard.writeText(text);
    return "copied";
  } catch {
    return "failed";
  }
}

/** window のうち、アドレスを読んで書き換える部分 */
export interface LocationApi {
  readonly location: { readonly pathname: string; readonly search: string; readonly hash: string };
  readonly history: { replaceState(data: unknown, unused: string, url?: string): void };
}

/**
 * 開いたアドレスの # の後ろ（# を除く）を返す。送られてきた盤面のリンクでなければ null。
 * # の後ろがあるか、LINE の外のブラウザで開く印（openExternalBrowser）があれば、リンクとみなす
 * （LINE が # の後ろを落としたときに、何も出ないのではなく、開けなかったと出すため）。
 * アドレスに ? か # の後ろがあれば、開き直しでまた案内を出さないよう、履歴を増やさずに消す
 */
export function takeLink(win: LocationApi): string | null {
  const { pathname, search, hash } = win.location;
  const fragment = hash.replace(/^#/, "");
  const isLink = fragment !== "" || /[?&]openExternalBrowser=/.test(search);
  if (search !== "" || hash !== "") {
    try {
      win.history.replaceState(null, "", pathname);
    } catch {
      // アドレスを消せなくても、盤面は読める
    }
  }
  return isLink ? fragment : null;
}

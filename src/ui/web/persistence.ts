// ブラウザに、このサイトの保存領域を消さないよう頼む（navigator.storage.persist()）。
// Chrome は、スマホの空きが少ないとき、しばらく開いていないサイトのデータ（localStorage を含む）から消す。
// 頼みが通ると、ユーザーが自分で消さない限り残る（ナンとの合意 2026-10-21 の 3、4）。
// Chrome は確認の画面を出さず、よく使うサイトか、ホーム画面に追加（インストール）したか、などで決める。

/** navigator.storage のうち、使う部分 */
export interface PersistApi {
  persisted(): Promise<boolean>;
  persist(): Promise<boolean>;
}

/** persisted: 頼みが通っている。refused: 通らなかった。unsupported: 頼む機能が無い */
export type PersistState = "persisted" | "refused" | "unsupported";

/** 通っていなければ頼む。一度通れば、次からは頼まずに通っていることを確かめるだけ */
export async function requestPersist(api: PersistApi | undefined): Promise<PersistState> {
  if (api === undefined) return "unsupported";
  try {
    if (await api.persisted()) return "persisted";
    return (await api.persist()) ? "persisted" : "refused";
  } catch {
    return "unsupported";
  }
}

export function persistMessage(state: PersistState | null): string {
  switch (state) {
    case null:
      return "確かめています…";
    case "persisted":
      return "この Chrome に、記録を消さないよう頼んであります。";
    case "refused":
      return "Chrome は、スマホの空きが少なくなると、記録を消すことがあります。Chrome のメニュー（︙）から「ホーム画面に追加」をして、このゲームをホーム画面に置くと、記録が消えにくくなります。";
    case "unsupported":
      return "このブラウザには、記録を消さないよう頼めません。";
  }
}

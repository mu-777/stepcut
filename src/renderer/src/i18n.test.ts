import { afterEach, describe, expect, it } from "vitest";
import { parseProject, parseProjectText } from "../../core/validate";
import { AppError, encodeError, msg } from "../../shared/messages";
import { errorText, msgText, setLanguage } from "./i18n";

afterEach(() => setLanguage("en"));

describe("メインプロセス・検証の文言を画面の言語にする", () => {
  it("日本語と英語で訳し分け、入れ子の Msg も同じ言語にする", () => {
    const m = msg("engineFallback", { reason: msg("voicevoxDisabled") });
    setLanguage("en");
    expect(msgText(m)).toBe("VOICEVOX is not enabled in the app settings. Used the OS voice instead");
    setLanguage("ja");
    expect(msgText(m)).toBe("VOICEVOX はアプリの設定で有効にしていません。OS 標準の声で代わりに読みました");
  });

  it("IPC で受けたエラーを訳す", () => {
    const received = new Error(
      `Error invoking remote method 'x': Error: ${(encodeError(new AppError("pathDenied", { path: "p" })) as Error).message}`,
    );
    setLanguage("ja");
    expect(errorText(received)).toBe("許可されていないパスです: p");
  });

  it("検証の問題はコードで返り、画面の言語で文になる。Zod の文も言語に従う", () => {
    const r = parseProjectText("{");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]?.code).toBe("invalidJson");

    const bad = { format: "stepcut.project", version: 1, sources: "x", steps: [] };
    setLanguage("en");
    const en = parseProject(bad);
    setLanguage("ja");
    const ja = parseProject(bad);
    if (en.ok || ja.ok) throw new Error("should fail");
    expect(en.errors[0]?.code).toBe("schema");
    expect(msgText(ja.errors[0] as never)).not.toBe(msgText(en.errors[0] as never));
    expect(msgText(ja.errors[0] as never)).toMatch(/[ぁ-ん]/);
  });
});

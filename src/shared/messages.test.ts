import { describe, expect, it } from "vitest";
import { AppError, decodeError, encodeError, errorTextEn, formatEn, msg } from "./messages";

describe("メッセージ(コードと値)", () => {
  it("値を埋め、値が Msg なら同じ言語の文にする", () => {
    expect(formatEn(msg("pathDenied", { path: "C:/a" }))).toBe("Path not allowed: C:/a");
    expect(formatEn(msg("engineFallback", { reason: msg("voicevoxDisabled") }))).toBe(
      "VOICEVOX is not enabled in the app settings. Used the OS voice instead",
    );
  });

  it("AppError の message は英語。IPC を通しても(message だけになっても)コードと値に戻せる", () => {
    const e = new AppError("nameExists", { path: "x.json" });
    expect(e.message).toBe("A file with the same name already exists: x.json");
    const sent = encodeError(e) as Error;
    // Electron は invoke の失敗に前置きを付けて message だけを渡す
    const received = new Error(`Error invoking remote method 'project:rename': Error: ${sent.message}`);
    expect(decodeError(received)).toEqual({ code: "nameExists", params: { path: "x.json" } });
    expect(errorTextEn(received)).toBe("A file with the same name already exists: x.json");
  });

  it("AppError 以外はそのまま通し、Electron の前置きだけ外す", () => {
    const e = new Error("ENOENT: no such file");
    expect(encodeError(e)).toBe(e);
    expect(decodeError(new Error("Error invoking remote method 'file:size': Error: ENOENT: x"))).toBe(
      "ENOENT: x",
    );
  });
});

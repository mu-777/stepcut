import { describe, expect, it } from "vitest";
import { checkForUpdate, compareVersions, parseRelease, RELEASES_PAGE } from "./update-check";

describe("compareVersions", () => {
  it("番号で比べる(文字の順ではない)", () => {
    expect(compareVersions("0.10.0", "0.9.0")).toBeGreaterThan(0);
    expect(compareVersions("v1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.0", "1.0.1")).toBeLessThan(0);
  });
  it("同じ番号ならプレリリースのほうが古い", () => {
    expect(compareVersions("1.0.0-beta.1", "1.0.0")).toBeLessThan(0);
    expect(compareVersions("1.0.0", "1.0.0-beta.1")).toBeGreaterThan(0);
  });
});

describe("parseRelease", () => {
  it("tag_name の v を外し、github.com 以外のページは一覧のページにする", () => {
    expect(
      parseRelease({ tag_name: "v0.2.0", html_url: "https://github.com/a/b/releases/tag/v0.2.0" }),
    ).toEqual({
      version: "0.2.0",
      url: "https://github.com/a/b/releases/tag/v0.2.0",
    });
    expect(parseRelease({ tag_name: "v0.2.0", html_url: "http://evil.example/" })?.url).toBe(RELEASES_PAGE);
    expect(parseRelease({})).toBeNull();
  });
});

describe("checkForUpdate", () => {
  const respond = (status: number, body: unknown) => async () =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  it("新しい版があれば available", async () => {
    const r = await checkForUpdate(
      "0.1.0",
      respond(200, { tag_name: "v0.2.0", html_url: "https://github.com/x" }),
    );
    expect(r).toEqual({
      status: "available",
      current: "0.1.0",
      version: "0.2.0",
      url: "https://github.com/x",
    });
  });
  it("同じか古ければ latest。リリースがなければ(404)も latest", async () => {
    expect((await checkForUpdate("0.2.0", respond(200, { tag_name: "v0.2.0" }))).status).toBe("latest");
    expect((await checkForUpdate("0.1.0", respond(404, {}))).status).toBe("latest");
  });
  it("つながらない・制限(403)は error", async () => {
    expect((await checkForUpdate("0.1.0", respond(403, {}))).status).toBe("error");
    const offline = async () => {
      throw new Error("net::ERR_INTERNET_DISCONNECTED");
    };
    expect(await checkForUpdate("0.1.0", offline)).toMatchObject({ status: "error" });
  });
});

import { describe, expect, it } from "vitest";
import { renameWithRetry } from "./project-files";

const err = (code: string) => Object.assign(new Error(code), { code });

describe("renameWithRetry", () => {
  it("EPERM / EBUSY / EACCES は間隔を空けてやり直す", async () => {
    const codes = ["EPERM", "EBUSY", "EACCES"];
    const delays: number[] = [];
    let calls = 0;
    await renameWithRetry("a", "b", {
      rename: async () => {
        if (calls < codes.length) throw err(codes[calls++] as string);
        calls++;
      },
      sleep: async (ms) => {
        delays.push(ms);
      },
    });
    expect(calls).toBe(4);
    expect(delays).toEqual([50, 100, 200]);
  });

  it("5 回やり直しても失敗したら最後のエラーを投げる", async () => {
    const delays: number[] = [];
    let calls = 0;
    await expect(
      renameWithRetry("a", "b", {
        rename: async () => {
          calls++;
          throw err("EBUSY");
        },
        sleep: async (ms) => {
          delays.push(ms);
        },
      }),
    ).rejects.toMatchObject({ code: "EBUSY" });
    expect(calls).toBe(6);
    expect(delays).toEqual([50, 100, 200, 400, 800]);
  });

  it("それ以外のエラーはやり直さない", async () => {
    let calls = 0;
    await expect(
      renameWithRetry("a", "b", {
        rename: async () => {
          calls++;
          throw err("ENOENT");
        },
        sleep: async () => {},
      }),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(calls).toBe(1);
  });
});

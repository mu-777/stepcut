// 書き出しの出力ファイル。書き出し先の隣の一時ファイルに書き、成功したときだけ置き換える
// (失敗・中止で、すでにある書き出し済みのファイルを壊さない)。
import { randomBytes } from "node:crypto";
import { type FileHandle, open, rm } from "node:fs/promises";
import { renameWithRetry } from "./project-files";

interface Output {
  fh: FileHandle;
  tmp: string;
  final: string;
  /** 開いたウィンドウ(webContents の id)。閉じられたら後始末する */
  owner: number;
}

export class OutputFiles {
  private outputs = new Map<number, Output>();
  private next = 1;

  async open(final: string, owner: number): Promise<number> {
    const tmp = `${final}.${randomBytes(6).toString("hex")}.part`;
    const fh = await open(tmp, "w");
    const handle = this.next++;
    this.outputs.set(handle, { fh, tmp, final, owner });
    return handle;
  }

  async write(handle: number, position: number, data: Uint8Array): Promise<void> {
    const o = this.outputs.get(handle);
    if (!o) throw new Error("output handle is closed");
    await o.fh.write(data, 0, data.byteLength, position);
  }

  /** commit なら書き出し先へ置き換え、そうでなければ一時ファイルを消す。知らないハンドルは何もしない */
  async close(handle: number, commit: boolean): Promise<void> {
    const o = this.outputs.get(handle);
    if (!o) return;
    this.outputs.delete(handle);
    try {
      await o.fh.close();
    } catch (err) {
      await rm(o.tmp, { force: true }).catch(() => {});
      throw err;
    }
    if (!commit) {
      await rm(o.tmp, { force: true });
      return;
    }
    try {
      await renameWithRetry(o.tmp, o.final);
    } catch (err) {
      await rm(o.tmp, { force: true }).catch(() => {});
      throw err;
    }
  }

  /** ウィンドウが閉じた・レンダラーが落ちたとき、そのウィンドウの出力を捨てる */
  async closeOwner(owner: number): Promise<void> {
    for (const [handle, o] of [...this.outputs]) {
      if (o.owner === owner) await this.close(handle, false).catch(() => {});
    }
  }

  get openCount(): number {
    return this.outputs.size;
  }
}

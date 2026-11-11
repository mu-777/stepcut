// レンダラーから受け取るパスの許可リスト(docs/decisions/20261111-ipc-restrictions.md)。
// レンダラーが任意のファイルを読み書きできないよう、メインプロセスが渡した・選ばせたパスだけを許す。
import path from "node:path";

export const denied = (p: string) => new Error(`許可されていないパスです / Path not allowed: ${p}`);

/** プロジェクトの名前の変更に使える名前か(フォルダーを抜けられない・使えない文字がない) */
export function isValidProjectName(name: unknown): name is string {
  return (
    typeof name === "string" &&
    name !== "" &&
    name !== "." &&
    name !== ".." &&
    path.basename(name) === name &&
    path.win32.basename(name) === name &&
    !/[\\/:*?"<>|]/.test(name)
  );
}

export class AccessList {
  private readSet = new Set<string>();
  private writeSet = new Set<string>();
  private projectSet = new Set<string>();
  private exeSet = new Set<string>();
  private api: typeof path.posix;

  constructor(private platform: string = process.platform) {
    this.api = platform === "win32" ? path.win32 : path.posix;
  }

  private norm(p: string): string {
    const r = this.api.resolve(p);
    return this.platform === "win32" ? r.toLowerCase() : r;
  }

  /** 読んでよいファイル(選んだ素材・ドロップしたファイル) */
  allowRead(p: string): void {
    this.readSet.add(this.norm(p));
  }

  /** 書いてよいファイル(読んでもよい) */
  allowWrite(p: string): void {
    this.writeSet.add(this.norm(p));
  }

  /** 書き出し先と、同じ名前の .srt */
  allowExport(outPath: string): void {
    this.allowWrite(outPath);
    this.allowWrite(srtPathOf(outPath));
  }

  /** プロジェクトファイル(開いた・保存した・名前を変えた・起動で渡された) */
  allowProject(p: string): void {
    this.projectSet.add(this.norm(p));
  }

  allowExe(p: string): void {
    this.exeSet.add(this.norm(p));
  }

  canRead(p: unknown): boolean {
    if (typeof p !== "string" || !p) return false;
    const n = this.norm(p);
    return this.readSet.has(n) || this.writeSet.has(n);
  }

  canWrite(p: unknown): boolean {
    return typeof p === "string" && !!p && this.writeSet.has(this.norm(p));
  }

  isProject(p: unknown): boolean {
    return typeof p === "string" && !!p && this.projectSet.has(this.norm(p));
  }

  assertRead(p: unknown): string {
    if (!this.canRead(p)) throw denied(String(p));
    return p as string;
  }

  assertWrite(p: unknown): string {
    if (!this.canWrite(p)) throw denied(String(p));
    return p as string;
  }

  assertProject(p: unknown): string {
    if (!this.isProject(p)) throw denied(String(p));
    return p as string;
  }

  assertReveal(p: unknown): string {
    if (!this.canWrite(p) && !this.isProject(p)) throw denied(String(p));
    return p as string;
  }

  /** 実行ファイルの設定: 選んだものか、今の設定と同じものだけ */
  assertExe(value: string | null | undefined, current: string | null): void {
    if (value === undefined || value === null || value === current) return;
    if (!this.exeSet.has(this.norm(value))) throw denied(value);
  }

  /** 素材のパスの解決結果を読めるようにする。プロジェクトが分かっているときだけ(null なら何も許さない) */
  allowResolved(projectPath: string | null, resolved: string): void {
    if (projectPath !== null && this.isProject(projectPath)) this.allowRead(resolved);
  }
}

/** 書き出し先の .srt(書き出しと同じ規則) */
export function srtPathOf(outPath: string): string {
  return `${outPath.replace(/\.mp4$/i, "")}.srt`;
}

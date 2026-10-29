// 素材パスの保存形式(PRJ-05): プロジェクトと同じフォルダかその下なら相対パス、それ以外は絶対パス。
import nodePath from "node:path";

type PathApi = typeof nodePath.posix;

/** 保存用のパス。区切りは常に "/"(OS をまたいで同じファイルを使えるように) */
export function toStoredPath(projectDir: string, absPath: string, p: PathApi = nodePath): string {
  const rel = p.relative(projectDir, absPath);
  if (rel === "" || rel.startsWith("..") || p.isAbsolute(rel)) return absPath;
  return rel.split(p.sep).join("/");
}

export function resolveStoredPath(projectDir: string, stored: string, p: PathApi = nodePath): string {
  if (p.isAbsolute(stored) || /^[A-Za-z]:[\\/]/.test(stored)) return stored;
  return p.resolve(projectDir, stored.split("/").join(p.sep));
}

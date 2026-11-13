// 新しい版の確認。GitHub Releases の最新(下書き・プレリリースを除く)を読み、今の版より新しければ知らせる。
// 入れ替えはしない(ダウンロードページを開くだけ)。docs/decisions/20261113-update-check.md
import type { UpdateCheckResult } from "../shared/api";

export const RELEASES_API = "https://api.github.com/repos/mu-777/screen-annotator/releases/latest";
export const RELEASES_PAGE = "https://github.com/mu-777/screen-annotator/releases";
const TIMEOUT_MS = 10_000;

/** "v1.2.3" / "1.2.3-beta.1" を比べる。a が新しければ正、同じなら 0。読めない部分は 0 とみなす */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [core = "", pre = ""] = v.trim().replace(/^v/i, "").split("-", 2);
    const nums = core.split(".").map((n) => Number.parseInt(n, 10) || 0);
    return { nums: [nums[0] ?? 0, nums[1] ?? 0, nums[2] ?? 0], pre };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
    if (d !== 0) return d;
  }
  // 同じ番号なら、プレリリースの付かないほうが新しい
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre < y.pre ? -1 : 1;
}

/** GitHub の API の結果から版とページを取り出す。ページは github.com の https だけ(ほかなら一覧のページ) */
export function parseRelease(json: unknown): { version: string; url: string } | null {
  if (!json || typeof json !== "object") return null;
  const r = json as Record<string, unknown>;
  if (typeof r.tag_name !== "string" || !r.tag_name.trim()) return null;
  const url =
    typeof r.html_url === "string" && r.html_url.startsWith("https://github.com/")
      ? r.html_url
      : RELEASES_PAGE;
  return { version: r.tag_name.trim().replace(/^v/i, ""), url };
}

export async function checkForUpdate(
  current: string,
  fetchFn: (url: string, init: RequestInit) => Promise<Response>,
  apiUrl: string = RELEASES_API,
): Promise<UpdateCheckResult> {
  try {
    const res = await fetchFn(apiUrl, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "StepCut-update-check" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // リリースがまだ 1 つもない
    if (res.status === 404) return { status: "latest", current };
    if (!res.ok) return { status: "error", current, message: `HTTP ${res.status}` };
    const rel = parseRelease(await res.json());
    if (!rel) return { status: "error", current, message: "unexpected response" };
    return compareVersions(rel.version, current) > 0
      ? { status: "available", current, version: rel.version, url: rel.url }
      : { status: "latest", current };
  } catch (e) {
    return { status: "error", current, message: (e as Error).message };
  }
}

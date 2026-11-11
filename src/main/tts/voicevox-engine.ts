// VOICEVOX 互換エンジン(TTS-12)。ユーザーが自分で入れて起動したエンジンの HTTP API につなぐ。エンジン・声は同梱しない。
// アプリの設定で有効にしたとき(規約の確認に同意したとき)だけ使う。つながらなければ、指定があればエンジンを起動して待つ。
import { spawn } from "node:child_process";
import type { Voice, VoicevoxSettings } from "../../shared/api";
import type { SynthesizeInput, TtsEngine } from "./engine";

export const VOICEVOX_NOTICE =
  "VOICEVOX を使った音声は、VOICEVOX の利用規約と、使った声(キャラクター)ごとの利用規約に従って使ってください(クレジットの表記などはそれぞれの規約を確認してください)。/ Follow the VOICEVOX terms and each character's terms when using VOICEVOX voices.";

/** 起動を待つ長さ(秒) */
const START_WAIT_S = 60;

interface Speaker {
  name: string;
  styles: { name: string; id: number }[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 起動できたら解決し、起動できなければ(パスが違うなど)拒否する。'error' を拾わないとメインプロセスが落ちる */
function startProcess(exe: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, [], { detached: true, stdio: "ignore", windowsHide: true });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

export function createVoicevoxEngine(
  getSettings: () => Promise<VoicevoxSettings>,
  fetchFn: typeof fetch = fetch,
  start: (exe: string) => Promise<void> = startProcess,
): TtsEngine {
  let version = "voicevox";
  let learned = false;
  const base = (s: VoicevoxSettings) => s.url.replace(/\/+$/, "");

  async function reachable(s: VoicevoxSettings): Promise<boolean> {
    try {
      const r = await fetchFn(`${base(s)}/version`, { signal: AbortSignal.timeout(2000) });
      if (!r.ok) return false;
      version = `voicevox-${String(await r.json())}`;
      learned = true;
      return true;
    } catch {
      return false;
    }
  }

  /** つながるまで待つ。つながらず、起動の指定があればエンジンを起動する */
  async function waitReady(): Promise<string> {
    const s = await getSettings();
    if (await reachable(s)) return base(s);
    if (!s.autoStart || !s.exePath)
      throw new Error(
        `VOICEVOX のエンジンにつながりません(${s.url})。エンジンを起動するか、アプリの設定で場所と自動起動を指定してください / Cannot reach the VOICEVOX engine`,
      );
    try {
      await start(s.exePath);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(
        `VOICEVOX のエンジンを起動できません(${s.exePath}): ${reason} / Cannot start the VOICEVOX engine`,
      );
    }
    for (let i = 0; i < START_WAIT_S * 2; i++) {
      await sleep(500);
      if (await reachable(s)) return base(s);
    }
    throw new Error(
      `VOICEVOX のエンジンが起動しません(${START_WAIT_S} 秒待ちました)/ The VOICEVOX engine did not start`,
    );
  }

  // 同時の呼び出し(声の一覧と複数の読み上げ)で起動と待ちを 1 回にする
  let pending: Promise<string> | null = null;
  function ready(): Promise<string> {
    pending ??= waitReady().finally(() => {
      pending = null;
    });
    return pending;
  }

  async function speakers(url: string, signal?: AbortSignal): Promise<Speaker[]> {
    const r = await fetchFn(`${url}/speakers`, { signal });
    if (!r.ok) throw new Error(`VOICEVOX: 声の一覧を取れません(${r.status})`);
    return (await r.json()) as Speaker[];
  }

  return {
    name: "voicevox",
    // 起動した 1 つのエンジンに同時に頼まない
    concurrency: 1,
    get version() {
      return version;
    },
    notice: VOICEVOX_NOTICE,
    // 版が分かっていればそれ。分からなければ 1 回だけ確かめる(起動はしない)。つながらなければ未確認のまま
    async cacheVersion() {
      if (!learned) await reachable(await getSettings());
      return version;
    },
    async unavailable() {
      const s = await getSettings();
      return s.enabled
        ? null
        : "VOICEVOX はアプリの設定で有効にしていません / VOICEVOX is not enabled in the app settings";
    },
    async voices(): Promise<Voice[]> {
      const url = await ready();
      return (await speakers(url)).flatMap((sp) =>
        sp.styles.map((st) => ({ id: String(st.id), name: `${sp.name}(${st.name})`, language: "ja-JP" })),
      );
    },
    async synthesize(input: SynthesizeInput, signal: AbortSignal): Promise<Uint8Array> {
      const url = await ready();
      // 声の指定がなければ、エンジンの最初の声
      const id = input.voice ?? String((await speakers(url, signal))[0]?.styles[0]?.id ?? "");
      if (!/^\d+$/.test(id)) throw new Error(`VOICEVOX: この声はありません / Unknown voice: ${id}`);
      const q = await fetchFn(`${url}/audio_query?text=${encodeURIComponent(input.text)}&speaker=${id}`, {
        method: "POST",
        signal,
      });
      if (!q.ok) throw new Error(`VOICEVOX: 読みを作れません(${q.status})`);
      const query = (await q.json()) as Record<string, unknown>;
      const rate = input.params.rate;
      if (typeof rate === "number" && Number.isFinite(rate)) query.speedScale = rate;
      const w = await fetchFn(`${url}/synthesis?speaker=${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(query),
        signal,
      });
      if (!w.ok) throw new Error(`VOICEVOX: 音声を作れません(${w.status})`);
      return new Uint8Array(await w.arrayBuffer());
    },
  };
}

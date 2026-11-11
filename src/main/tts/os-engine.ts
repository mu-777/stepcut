// OS 標準の音声合成(TTS-01)。Windows は WinRT の SpeechSynthesizer を PowerShell 経由で、Mac は say コマンドで呼ぶ。
// どちらも使えない環境(開発用の Linux など)では、文字数に応じた長さの無音を返す。
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Voice } from "../../shared/api";
import type { SynthesizeInput, TtsEngine } from "./engine";
import { silentWav } from "./wav";

const COMMERCIAL_NOTICE =
  "OS 標準の音声を商用で使う場合の条件は、OS の提供元の規約を確認してください。/ Check the OS vendor's terms before using OS voices commercially.";

// ASCII のみで書く(PowerShell 5.1 は BOM なしの UTF-8 スクリプトを正しく読まないため)
const WINDOWS_SCRIPT = String.raw`
param([string]$Mode, [string]$TextFile, [string]$OutFile, [string]$VoiceId, [double]$Rate = 1.0, [double]$Pitch = 1.0)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime]
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation${"`"}1' })[0]
function Await($op, [Type]$type) {
  $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
  $null = $task.Wait(-1)
  $task.Result
}
if ($Mode -eq 'voices') {
  @([Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | ForEach-Object { [pscustomobject]@{ id = $_.Id; name = $_.DisplayName; language = $_.Language } }) | ConvertTo-Json -Compress
  exit 0
}
$synth = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
if ($VoiceId) {
  $v = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | Where-Object { $_.Id -eq $VoiceId } | Select-Object -First 1
  if ($v) { $synth.Voice = $v }
}
$synth.Options.SpeakingRate = $Rate
$synth.Options.AudioPitch = $Pitch
$text = [System.IO.File]::ReadAllText($TextFile, [System.Text.Encoding]::UTF8)
$stream = Await ($synth.SynthesizeTextToStreamAsync($text)) ([Windows.Media.SpeechSynthesis.SpeechSynthesisStream])
$size = [uint32]$stream.Size
$reader = New-Object Windows.Storage.Streams.DataReader($stream.GetInputStreamAt(0))
$null = Await ($reader.LoadAsync($size)) ([uint32])
$bytes = New-Object byte[] $size
$reader.ReadBytes($bytes)
[System.IO.File]::WriteAllBytes($OutFile, $bytes)
`;

function run(cmd: string, args: string[], signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true, signal });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => {
      out += d;
    });
    child.stderr.on("data", (d) => {
      err += d;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`${path.basename(cmd)} が失敗しました(${code}): ${err.trim()}`));
    });
  });
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "stepcut-tts-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

function windowsEngine(): TtsEngine {
  const powershell = (dir: string, args: string[], signal?: AbortSignal) =>
    writeFile(path.join(dir, "tts.ps1"), WINDOWS_SCRIPT, "utf8").then(() =>
      run(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          path.join(dir, "tts.ps1"),
          ...args,
        ],
        signal,
      ),
    );
  return {
    name: "os",
    version: `win32-${os.release()}`,
    notice: COMMERCIAL_NOTICE,
    voices: () =>
      withTempDir(async (dir) => {
        const out = (await powershell(dir, ["voices"])).trim();
        return out ? (JSON.parse(out) as Voice[]) : [];
      }),
    synthesize: (input: SynthesizeInput, signal: AbortSignal) =>
      withTempDir(async (dir) => {
        const textFile = path.join(dir, "text.txt");
        const outFile = path.join(dir, "out.wav");
        await writeFile(textFile, input.text, "utf8");
        await powershell(
          dir,
          [
            "speak",
            textFile,
            outFile,
            input.voice ?? "",
            String(num(input.params.rate, 1)),
            String(num(input.params.pitch, 1)),
          ],
          signal,
        );
        return new Uint8Array(await readFile(outFile));
      }),
  };
}

function macEngine(): TtsEngine {
  return {
    name: "os",
    version: `darwin-${os.release()}`,
    notice: COMMERCIAL_NOTICE,
    voices: async () => {
      const out = await run("say", ["-v", "?"]);
      return out
        .split("\n")
        .map((line) => line.match(/^(.+?)\s+([a-z]{2,3}[_-][A-Za-z0-9]+)\s+#/))
        .filter((m): m is RegExpMatchArray => m !== null)
        .map((m) => ({ id: (m[1] ?? "").trim(), name: (m[1] ?? "").trim(), language: m[2] ?? "" }));
    },
    synthesize: (input, signal) =>
      withTempDir(async (dir) => {
        const textFile = path.join(dir, "text.txt");
        const outFile = path.join(dir, "out.wav");
        await writeFile(textFile, input.text, "utf8");
        const args = ["-o", outFile, "--data-format=LEI16@22050", "-f", textFile];
        if (input.voice) args.push("-v", input.voice);
        args.push("-r", String(Math.round(175 * num(input.params.rate, 1))));
        await run("say", args, signal);
        return new Uint8Array(await readFile(outFile));
      }),
  };
}

/** OS の読み上げがない環境用。1 文字 0.15 秒の無音 */
function silentEngine(): TtsEngine {
  return {
    name: "os",
    version: "silent-1",
    notice:
      "この OS では読み上げに対応していないため、無音で代替しています。/ Speech is not supported on this OS; using silence.",
    voices: async () => [],
    synthesize: async (input) => silentWav(Math.max(0.5, [...input.text].length * 0.15)),
  };
}

export function createOsEngine(platform = process.platform): TtsEngine {
  if (platform === "win32") return windowsEngine();
  if (platform === "darwin") return macEngine();
  return silentEngine();
}

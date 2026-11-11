// メインプロセスとレンダラーの間の API(preload で window.api として公開する)。

export interface Voice {
  id: string;
  name: string;
  language: string;
}

export interface TtsRequest {
  engine: string;
  voice: string | null;
  params: Record<string, number | string | boolean>;
  /** 辞書を適用した後の文章 */
  text: string;
}

export interface TtsResult {
  wav: Uint8Array;
  duration: number;
  /** 利用者への案内(OS 標準音声の商用利用など、TTS-11) */
  notice?: string;
}

/**
 * ウィンドウの最小幅の内訳(px)。左のサムネイル列と右の設定パネルの最小幅と、プレビューの列の最小幅
 * (再生操作の帯: 真ん中のボタン 244 を中央に置いたまま、左の時刻 94・右の速度と消音 136 が重ならない幅 + 余白)
 */
export const RAIL_MIN_W = 56;
export const PANEL_MIN_W = 160;
export const CENTER_MIN_W = 560;
/** 境目のつまみ 2 本 */
export const MIN_WINDOW_W = RAIL_MIN_W + PANEL_MIN_W + CENTER_MIN_W + 10;

/** アプリの設定(プロジェクトによらない) */
export interface AppSettings {
  /** 画面の言語。auto なら OS の言語 */
  language: "auto" | "ja" | "en";
  /** 新しいプロジェクトの保存先と、開くときに最初に出すフォルダー。null なら OS の既定 */
  projectDir: string | null;
  /** キー操作の割り当てのうち、既定から変えたもの(操作の名前 → "Ctrl+Shift+S" の形。空文字は割り当てなし) */
  shortcuts: Record<string, string>;
}

export const DEFAULT_APP_SETTINGS: AppSettings = { language: "auto", projectDir: null, shortcuts: {} };

export interface OpenedProject {
  filePath: string;
  text: string;
}

/** CLI の frame の指定。step(1 始まりの番号か id)と time(ステップ内の出力時刻)か、at(全体の時刻) */
export interface FrameRequest {
  step?: string;
  time?: number;
  at?: number;
  /** 素材のフレームをそのまま(ズーム・テロップなし、素材の大きさ)で出す */
  source?: boolean;
}

/** CLI から非表示のウィンドウに渡す仕事(export・frame・inspect) */
export interface ExportJob {
  kind: "export" | "frame" | "inspect";
  projectPath: string;
  projectText: string;
  outPath: string;
  frame?: FrameRequest;
}

/** frame・inspect の結果(中身はコマンドごと。README の CLI 節) */
export interface CliJobResult {
  ok: boolean;
  warnings: string[];
  error?: string;
  [key: string]: unknown;
}

export interface ExportResult {
  ok: boolean;
  outPath?: string;
  srtPath?: string;
  duration?: number;
  frames?: number;
  videoCodec?: string;
  audioCodec?: string | null;
  warnings: string[];
  error?: string;
}

export interface Api {
  platform: string;
  // プロジェクト
  openProjectDialog(): Promise<OpenedProject | null>;
  readProject(filePath: string): Promise<OpenedProject>;
  /** 起動時の引数で渡されたプロジェクト */
  initialProject(): Promise<OpenedProject | null>;
  /** 保存。素材パスを保存先基準で書き換えた JSON を返す。filePath が null なら保存先を尋ねる */
  /** name は新しいプロジェクトのファイル名(拡張子なし)。アプリの設定の保存先があれば尋ねずにそこへ保存する */
  saveProject(
    filePath: string | null,
    text: string,
    prevPath: string | null,
    name?: string,
  ): Promise<OpenedProject | null>;
  /** プロジェクトのファイル名を変える(同じフォルダー)。新しいパスを返す */
  renameProject(filePath: string, name: string): Promise<string>;
  pickSources(): Promise<string[]>;
  // アプリの設定
  getSettings(): Promise<AppSettings>;
  setSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  /** フォルダーを選ぶ(絶対パス) */
  pickDirectory(defaultPath: string | null): Promise<string | null>;
  /** ドラッグ&ドロップされたファイルの絶対パス */
  pathForFile(file: File): string;
  /** 背景の画像を選ぶ(絶対パス) */
  pickImage(): Promise<string | null>;
  /** ファイルのあるフォルダーを開き、そのファイルを選んだ状態にする */
  revealFile(absPath: string): Promise<void>;
  pickExportPath(defaultPath: string): Promise<string | null>;
  resolveSource(projectPath: string | null, stored: string): Promise<string>;
  setDirty(dirty: boolean): void;
  onExternalChange(cb: (p: OpenedProject) => void): () => void;
  onMenu(cb: (command: string) => void): () => void;
  // 素材の読み込み
  fileSize(absPath: string): Promise<number>;
  readRange(absPath: string, start: number, end: number): Promise<Uint8Array>;
  // 書き出し
  openOutput(absPath: string): Promise<number>;
  writeOutput(handle: number, position: number, data: Uint8Array): Promise<void>;
  closeOutput(handle: number): Promise<void>;
  writeText(absPath: string, text: string): Promise<void>;
  // 読み上げ
  ttsVoices(engine: string): Promise<Voice[]>;
  ttsSynthesize(req: TtsRequest): Promise<TtsResult>;
  // CLI からの書き出し(非表示ウィンドウ)
  getExportJob(): Promise<ExportJob | null>;
  reportExportProgress(done: number, total: number): void;
  finishExport(result: ExportResult | CliJobResult): void;
}

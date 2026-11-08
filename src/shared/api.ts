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

/** アプリの設定(プロジェクトによらない) */
export interface AppSettings {
  /** 画面の言語。auto なら OS の言語 */
  language: "auto" | "ja" | "en";
  /** 新しいプロジェクトの保存先と、開くときに最初に出すフォルダー。null なら OS の既定 */
  projectDir: string | null;
}

export const DEFAULT_APP_SETTINGS: AppSettings = { language: "auto", projectDir: null };

export interface OpenedProject {
  filePath: string;
  text: string;
}

export interface ExportJob {
  projectPath: string;
  projectText: string;
  outPath: string;
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
  saveProject(filePath: string | null, text: string, prevPath: string | null): Promise<OpenedProject | null>;
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
  finishExport(result: ExportResult): void;
}

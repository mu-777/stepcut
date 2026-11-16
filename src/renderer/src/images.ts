// 図形の画像・ポインターの画像。ファイルを 1 度だけ読んで使い回す(パスとプロジェクトの場所ごと)。
import { api } from "./api";
import { errorText } from "./i18n";

type Img = CanvasImageSource & { width: number; height: number };

/** 持っておく画像の数の上限(古いものから捨てる) */
const MAX_IMAGES = 64;

export class ImageStore {
  private cache = new Map<string, Img | null>();
  private loading = new Map<string, Promise<Img | null>>();
  private errors = new Map<string, string>();

  constructor(private onLoad: () => void = () => {}) {}

  private key(path: string, projectPath: string | null) {
    return `${path}|${projectPath ?? ""}`;
  }

  /** 読み込み済みなら画像、まだなら読み込みを始めて null */
  get(path: string, projectPath: string | null): Img | null {
    const k = this.key(path, projectPath);
    if (this.cache.has(k)) return this.cache.get(k) ?? null;
    void this.load(path, projectPath);
    return null;
  }

  error(path: string, projectPath: string | null): string | null {
    return this.errors.get(this.key(path, projectPath)) ?? null;
  }

  /** 画像の縦横の大きさ。読めていなければ null */
  size(path: string, projectPath: string | null): { w: number; h: number } | null {
    const img = this.get(path, projectPath);
    return img ? { w: img.width, h: img.height } : null;
  }

  load(path: string, projectPath: string | null): Promise<Img | null> {
    const k = this.key(path, projectPath);
    if (this.cache.has(k)) return Promise.resolve(this.cache.get(k) ?? null);
    let p = this.loading.get(k);
    if (!p) {
      p = (async () => {
        const abs = await api.resolveSource(projectPath, path);
        const size = await api.fileSize(abs);
        const bytes = await api.readRange(abs, 0, size);
        return (await createImageBitmap(new Blob([bytes as BlobPart]))) as Img;
      })()
        .catch((e) => {
          this.errors.set(k, errorText(e));
          return null;
        })
        .then((img) => {
          while (this.cache.size >= MAX_IMAGES) {
            const old = this.cache.keys().next().value as string;
            const v = this.cache.get(old);
            if (v instanceof ImageBitmap) v.close();
            this.cache.delete(old);
          }
          this.cache.set(k, img);
          this.loading.delete(k);
          this.onLoad();
          return img;
        });
      this.loading.set(k, p);
    }
    return p;
  }
}

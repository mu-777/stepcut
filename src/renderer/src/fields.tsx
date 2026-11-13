// フォームの部品。数値は入力途中(空・"1." など)を許し、数として読めたときだけ反映する。
import { type ReactNode, useEffect, useRef, useState } from "react";

/** title は見出しにマウスを重ねたときの説明(単位など、見出しに入れると長くなるもの) */
export function Field({ label, children, title }: { label: string; children: ReactNode; title?: string }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: 入力欄は children として label の中に入る
    <label className="field" title={title}>
      <span className="field-title">{label}</span>
      {children}
    </label>
  );
}

export function NumField(props: {
  label: string;
  value: number | undefined | null;
  onChange: (v: number | undefined) => void;
  step?: number;
  min?: number;
  max?: number;
  placeholder?: string;
  title?: string;
}) {
  const { value, onChange } = props;
  // 既定値(数として読める placeholder)は、書いていないときも値として出す。消して離れると既定値に戻る
  const fallback =
    props.placeholder !== undefined &&
    props.placeholder.trim() !== "" &&
    Number.isFinite(Number(props.placeholder))
      ? props.placeholder
      : "";
  const shown = value == null ? fallback : String(value);
  const [text, setText] = useState(shown);
  // 入力中(フォーカスがある間)は打った文字を書き換えない。消して空にしたところや、丸めた値(偶数・最小値)で
  // 打ちかけの数字が置き換わると、続けて打った数字がずれるため。欄を離れたら実際の値を出す
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(shown);
  }, [shown]);
  return (
    <Field label={props.label} title={props.title}>
      <input
        type="number"
        value={text}
        step={props.step ?? 0.1}
        min={props.min}
        max={props.max}
        placeholder={fallback ? undefined : props.placeholder}
        onFocus={() => {
          focused.current = true;
        }}
        onBlur={() => {
          focused.current = false;
          setText(shown);
        }}
        onChange={(e) => {
          setText(e.target.value);
          if (e.target.value.trim() === "") onChange(undefined);
          else {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onChange(n);
          }
        }}
      />
    </Field>
  );
}

export function TextField(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <Field label={props.label}>
      {props.multiline ? (
        <textarea
          value={props.value}
          rows={3}
          disabled={props.disabled}
          placeholder={props.placeholder}
          onChange={(e) => props.onChange(e.target.value)}
        />
      ) : (
        <input
          type="text"
          disabled={props.disabled}
          value={props.value}
          placeholder={props.placeholder}
          onChange={(e) => props.onChange(e.target.value)}
        />
      )}
    </Field>
  );
}

export function CheckField(props: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="check">
      <input type="checkbox" checked={props.value} onChange={(e) => props.onChange(e.target.checked)} />
      {props.label}
    </label>
  );
}

export function SelectField<T extends string>(props: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <Field label={props.label}>
      <select value={props.value} onChange={(e) => props.onChange(e.target.value as T)}>
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

/**
 * 少ない選択肢を横に並べたボタンで選ぶ(どれがあるか一目で分かる)。icon があればアイコンだけを出し、名前はツールチップにする
 */
export function SegField<T extends string>(props: {
  label: string;
  value: T;
  /** title はボタンに重ねたときの説明(icon のときは label がツールチップになる) */
  options: { value: T; label: string; icon?: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  title?: string;
}) {
  return (
    <div className="field" title={props.title}>
      <span className="field-title">{props.label}</span>
      <div className="seg seg-field">
        {props.options.map((o) => (
          <button
            key={o.value}
            type="button"
            className={`small ${o.value === props.value ? "on" : ""}`}
            aria-pressed={o.value === props.value}
            title={o.title ?? (o.icon ? o.label : undefined)}
            aria-label={o.icon ? o.label : undefined}
            onClick={() => props.onChange(o.value)}
          >
            {o.icon ?? o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** undefined の項目を消す(保存する JSON に空の項目を残さない) */
export function prune<T extends object>(obj: T): T | undefined {
  const out = Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
  return Object.keys(out).length ? out : undefined;
}

type Params = Record<string, number | string | boolean>;

/** 読み上げのパラメータを 1 つ変える。undefined なら消す */
export function withParam(
  params: Params | undefined,
  key: string,
  value: number | undefined,
): Params | undefined {
  const next: Params = { ...params };
  if (value === undefined) delete next[key];
  else next[key] = value;
  return Object.keys(next).length ? next : undefined;
}

/**
 * よく使う日本語フォントの日本語の名前。Local Font Access API はファミリー名を英語で返すので、
 * 日本語でも探せるようにする(一覧に載っていないフォントは英語の名前だけで探す)
 */
const JA_FONT_NAMES: Record<string, string> = {
  "Yu Gothic": "游ゴシック",
  "Yu Gothic UI": "游ゴシック UI",
  "Yu Mincho": "游明朝",
  Meiryo: "メイリオ",
  "Meiryo UI": "メイリオ UI",
  "MS Gothic": "ＭＳ ゴシック",
  "MS PGothic": "ＭＳ Ｐゴシック",
  "MS UI Gothic": "ＭＳ UI ゴシック",
  "MS Mincho": "ＭＳ 明朝",
  "MS PMincho": "ＭＳ Ｐ明朝",
  "BIZ UDGothic": "BIZ UDゴシック",
  "BIZ UDPGothic": "BIZ UDPゴシック",
  "BIZ UDMincho": "BIZ UD明朝",
  "BIZ UDPMincho": "BIZ UDP明朝",
  "UD Digi Kyokasho N-R": "UD デジタル 教科書体 N-R",
  "UD Digi Kyokasho N-B": "UD デジタル 教科書体 N-B",
  "UD Digi Kyokasho NK-R": "UD デジタル 教科書体 NK-R",
  "UD Digi Kyokasho NK-B": "UD デジタル 教科書体 NK-B",
  "UD Digi Kyokasho NP-R": "UD デジタル 教科書体 NP-R",
  "UD Digi Kyokasho NP-B": "UD デジタル 教科書体 NP-B",
  "Hiragino Sans": "ヒラギノ角ゴシック",
  "Hiragino Kaku Gothic ProN": "ヒラギノ角ゴ ProN",
  "Hiragino Kaku Gothic StdN": "ヒラギノ角ゴ StdN",
  "Hiragino Maru Gothic ProN": "ヒラギノ丸ゴ ProN",
  "Hiragino Mincho ProN": "ヒラギノ明朝 ProN",
  "Toppan Bunkyu Gothic": "凸版文久ゴシック",
  "Toppan Bunkyu Midashi Gothic": "凸版文久見出しゴシック",
  "Toppan Bunkyu Mincho": "凸版文久明朝",
  "Toppan Bunkyu Midashi Mincho": "凸版文久見出し明朝",
  "Tsukushi A Round Gothic": "筑紫A丸ゴシック",
  "Tsukushi B Round Gothic": "筑紫B丸ゴシック",
  Klee: "クレー",
  "Source Han Sans": "源ノ角ゴシック",
  "Source Han Serif": "源ノ明朝",
};

/** フォントの候補。family は CSS に書く名前、label は一覧に出す名前、keys は探すときに見る名前 */
interface FontEntry {
  family: string;
  label: string;
  keys: string[];
}

/** 探すときの表記ゆれ(全角・半角、大文字・小文字)をそろえる */
const fold = (x: string) => x.normalize("NFKC").toLowerCase();

/** OS に入っているフォント(Local Font Access API)。読めなければ null。1 回だけ問い合わせる */
let fontEntries: Promise<FontEntry[] | null> | null = null;
function loadFontEntries(): Promise<FontEntry[] | null> {
  fontEntries ??= (async () => {
    const query = (window as { queryLocalFonts?: () => Promise<{ family: string; fullName: string }[]> })
      .queryLocalFonts;
    if (!query) return null;
    try {
      const fonts = await query();
      const byFamily = new Map<string, Set<string>>();
      for (const f of fonts) {
        const names = byFamily.get(f.family) ?? new Set([f.family]);
        // 地域の名前(日本語など)が入っていることがあるので、フルネームでも探せるようにする
        if (f.fullName) names.add(f.fullName);
        byFamily.set(f.family, names);
      }
      return [...byFamily.entries()]
        .map(([family, names]) => {
          const ja = JA_FONT_NAMES[family];
          return {
            family,
            label: ja ? `${ja} (${family})` : family,
            keys: [...names, ...(ja ? [ja] : [])].map(fold),
          };
        })
        .sort((a, b) => a.family.localeCompare(b.family));
    } catch {
      return null;
    }
  })();
  return fontEntries;
}

/**
 * フォントの選択。名前を打ち込め、打っている間は OS のフォントを絞り込んで下に並べる(↑↓ で選び Enter で決める)。
 * 英語・日本語のどちらの名前でも探せ、前方一致するものを先に、名前の途中に含むものを後に並べる。空なら既定のフォント
 */
export function FontField(props: {
  label: string;
  value: string | undefined;
  placeholder?: string;
  onChange: (v: string | undefined) => void;
}) {
  const [families, setFamilies] = useState<FontEntry[] | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  useEffect(() => {
    let alive = true;
    void loadFontEntries().then((f) => {
      if (alive) setFamilies(f);
    });
    return () => {
      alive = false;
    };
  }, []);
  const text = props.value ?? "";
  const q = fold(text.trim());
  const all = families ?? [];
  const matches = q
    ? [
        ...all.filter((f) => f.keys.some((k) => k.startsWith(q))),
        ...all.filter((f) => !f.keys.some((k) => k.startsWith(q)) && f.keys.some((k) => k.includes(q))),
      ].slice(0, 300)
    : all.slice(0, 300);
  const shown = open && matches.length > 0 && !(matches.length === 1 && matches[0]?.family === text);
  const pick = (f: string) => {
    props.onChange(f);
    setOpen(false);
  };
  return (
    <Field label={props.label}>
      <span className="combo">
        <input
          type="text"
          value={text}
          placeholder={props.placeholder}
          style={props.value ? { fontFamily: `"${props.value}"` } : undefined}
          role="combobox"
          aria-expanded={shown}
          aria-autocomplete="list"
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onChange={(e) => {
            props.onChange(e.target.value || undefined);
            setOpen(true);
            setActive(0);
          }}
          onKeyDown={(e) => {
            // 日本語の入力の変換中のキー(Enter で確定など)は入力欄に任せる
            if (e.nativeEvent.isComposing) return;
            if (!shown) {
              if (e.key === "ArrowDown") setOpen(true);
              return;
            }
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              const d = e.key === "ArrowDown" ? 1 : -1;
              setActive((a) => Math.min(matches.length - 1, Math.max(0, a + d)));
            } else if (e.key === "Enter") {
              e.preventDefault();
              const f = matches[active];
              if (f) pick(f.family);
            } else if (e.key === "Escape") {
              e.stopPropagation();
              setOpen(false);
            }
          }}
        />
        {shown && (
          <div className="combo-list" role="listbox">
            {matches.map((f, i) => (
              // biome-ignore lint/a11y/useKeyWithClickEvents: キーは入力欄の ↑↓・Enter で選ぶ
              <div
                key={f.family}
                role="option"
                tabIndex={-1}
                aria-selected={i === active}
                className={i === active ? "active" : ""}
                style={{ fontFamily: `"${f.family}"` }}
                ref={i === active ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}
                // 入力欄のフォーカスを保ったまま選ぶ
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(f.family)}
              >
                {f.label}
              </div>
            ))}
          </div>
        )}
      </span>
    </Field>
  );
}

/**
 * 選択肢が多い選択(声など)。打った文字を名前の途中に含むもの(部分一致)だけを下に並べる(↑↓ で選び Enter で決める)。
 * 打っていないときは選んでいるものの名前を出す。選択肢にない値はそのまま出す
 */
export function SearchSelectField(props: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  // null は打っていない(候補を閉じている)
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const current = props.options.find((o) => o.value === props.value)?.label ?? props.value;
  const q = fold((query ?? "").trim());
  const matches = query === null ? [] : props.options.filter((o) => !q || fold(o.label).includes(q));
  const shown = matches.length > 0;
  const open = () => {
    setQuery("");
    setActive(
      Math.max(
        0,
        props.options.findIndex((o) => o.value === props.value),
      ),
    );
  };
  const pick = (v: string) => {
    props.onChange(v);
    setQuery(null);
  };
  return (
    <Field label={props.label}>
      <span className="combo">
        <input
          type="text"
          value={query ?? current}
          placeholder={current}
          title={current}
          role="combobox"
          aria-expanded={shown}
          aria-autocomplete="list"
          onFocus={open}
          onBlur={() => setQuery(null)}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            // 日本語の入力の変換中のキー(Enter で確定など)は入力欄に任せる
            if (e.nativeEvent.isComposing) return;
            if (query === null) {
              if (e.key === "ArrowDown") open();
              return;
            }
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              const d = e.key === "ArrowDown" ? 1 : -1;
              setActive((a) => Math.min(matches.length - 1, Math.max(0, a + d)));
            } else if (e.key === "Enter") {
              e.preventDefault();
              const o = matches[active];
              if (o) pick(o.value);
            } else if (e.key === "Escape") {
              e.stopPropagation();
              setQuery(null);
            }
          }}
        />
        {shown && (
          <div className="combo-list" role="listbox">
            {matches.map((o, i) => (
              // biome-ignore lint/a11y/useKeyWithClickEvents: キーは入力欄の ↑↓・Enter で選ぶ
              <div
                key={o.value}
                role="option"
                tabIndex={-1}
                aria-selected={i === active}
                className={`${i === active ? "active" : ""} ${o.value === props.value ? "current" : ""}`}
                title={o.label}
                ref={i === active ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}
                // 入力欄のフォーカスを保ったまま選ぶ
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(o.value)}
              >
                {o.label}
              </div>
            ))}
          </div>
        )}
      </span>
    </Field>
  );
}

// フォームの部品。数値は入力途中(空・"1." など)を許し、数として読めたときだけ反映する。
import { type ReactNode, useEffect, useState } from "react";

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: 入力欄は children として label の中に入る
    <label className="field">
      <span>{label}</span>
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
}) {
  const { value, onChange } = props;
  const [text, setText] = useState(value == null ? "" : String(value));
  useEffect(() => {
    setText((prev) => (Number(prev) === value && prev !== "" ? prev : value == null ? "" : String(value)));
  }, [value]);
  return (
    <Field label={props.label}>
      <input
        type="number"
        value={text}
        step={props.step ?? 0.1}
        min={props.min}
        max={props.max}
        placeholder={props.placeholder}
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

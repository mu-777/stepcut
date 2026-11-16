// CHANGELOG.md(リリースノートの正)を扱う。依存なし。手順は .claude/skills/release/SKILL.md
//
//   node scripts/changelog.mjs stamp
//     npm の version フックから呼ばれる。package.json の新しい版で `## [Unreleased]` を
//     `## [x.y.z] - YYYY-MM-DD` に置き換え、空の `## [Unreleased]` を上に作り、末尾のリンクを直す
//   node scripts/changelog.mjs extract <version>
//     その版の節の本文を標準出力に出す(Release の本文)。節が無いか空なら終了コード 1。
//     release.yml がタグを作る前の確認にも使う(空のリリースを出さない)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = "https://github.com/mu-777/stepcut";

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const sectionHeading = (version) => new RegExp(`^## \\[${escapeRe(version)}\\]`, "m");

/** [Unreleased] を version の節にする。失敗したら Error を投げる */
export function stamp(text, version, date) {
  const unreleased = /^## \[Unreleased\][^\n]*$/m;
  if (!unreleased.test(text)) throw new Error('"## [Unreleased]" の見出しがない');
  if (sectionHeading(version).test(text)) throw new Error(`${version} の節がすでにある`);
  return text
    .replace(unreleased, `## [Unreleased]\n\n## [${version}] - ${date}`)
    .replace(
      /^\[Unreleased\]:[^\n]*$/m,
      `[Unreleased]: ${REPO}/compare/v${version}...HEAD\n[${version}]: ${REPO}/releases/tag/v${version}`,
    );
}

/** version の節の本文(リンク定義と HTML コメントを除く)。節が無いか空なら Error を投げる */
export function extract(text, version) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => sectionHeading(version).test(l));
  if (start === -1) throw new Error(`"## [${version}]" の節がない`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^## /.test(l));
  const body = (end === -1 ? rest : rest.slice(0, end))
    .filter((l) => !/^\[[^\]]+\]:\s/.test(l))
    .join("\n")
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim();
  if (!body) throw new Error(`"## [${version}]" の節が空`);
  return `${body}\n`;
}

function main(args) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const file = path.join(root, "CHANGELOG.md");
  const text = fs.readFileSync(file, "utf8");
  const [command, arg] = args;
  if (command === "stamp") {
    const { version } = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    const date = new Date().toISOString().slice(0, 10);
    fs.writeFileSync(file, stamp(text, version, date));
    console.log(`changelog: [Unreleased] → [${version}] - ${date}`);
  } else if (command === "extract" && arg) {
    process.stdout.write(extract(text, arg));
  } else {
    throw new Error("usage: node scripts/changelog.mjs stamp | extract <version>");
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(`changelog: ${e.message}`);
    process.exit(1);
  }
}

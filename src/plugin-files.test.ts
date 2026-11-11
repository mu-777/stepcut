// Claude Code のプラグイン(plugins/screen-annotator)のスキルに同梱する仕様の写しが、docs と一致していることを確かめる。
// スキルはプラグインのフォルダだけが配られるので、docs を参照できず写しを置いている。
// 更新するときは UPDATE_PLUGIN=1 npx vitest run src/plugin-files.test.ts
import { readFileSync, writeFileSync } from "node:fs";
import { expect, it } from "vitest";

const root = new URL("../", import.meta.url);
const skill = new URL("plugins/screen-annotator/skills/edit-project/", root);

const HEADER =
  "<!-- docs/project-format.md の写し(npm run check で一致を確かめる。直すのは docs 側)。相対リンクの先はリポジトリ https://github.com/mu-777/screen-annotator の docs/ にある -->\n\n";

const copies: [string, (src: string) => string][] = [
  ["project-format.md", (src) => HEADER + src],
  ["project.schema.json", (src) => src],
];

for (const [name, make] of copies) {
  it(`スキルの ${name} が docs と同じ`, () => {
    const text = make(readFileSync(new URL(`docs/${name}`, root), "utf8"));
    const target = new URL(name, skill);
    if (process.env.UPDATE_PLUGIN) writeFileSync(target, text);
    expect(readFileSync(target, "utf8")).toBe(text);
  });
}

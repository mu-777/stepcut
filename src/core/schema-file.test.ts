// docs/project.schema.json(公開する JSON Schema、AI-01)が schema.ts と一致していることを確かめる。
// 更新するときは UPDATE_SCHEMA=1 npx vitest run src/core/schema-file.test.ts
import { readFileSync, writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { z } from "zod";
import { projectSchema } from "./schema";

const file = new URL("../../docs/project.schema.json", import.meta.url);

it("docs/project.schema.json が最新", () => {
  const schema = {
    ...z.toJSONSchema(projectSchema),
    title: "stepcut project (version 1)",
    description: "仕様: docs/project-format.md",
  };
  const text = `${JSON.stringify(schema, null, 2)}\n`;
  if (process.env.UPDATE_SCHEMA) writeFileSync(file, text);
  expect(readFileSync(file, "utf8")).toBe(text);
});

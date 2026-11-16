// CI(.github/workflows/lp-media.yml)で、StepCut の設定に Azure AI Speech の鍵とリージョンを入れる。
//   AZURE_SPEECH_KEY=... AZURE_SPEECH_REGION=japaneast npx electron scripts/ci-azure-settings.cjs
// 鍵はアプリと同じく safeStorage で暗号化する。暗号化の鍵はそのパソコンのそのユーザーに結び付くので、
// 暗号化したものを持ち込まず、CI のマシンの上でこのスクリプトが暗号化する。
// 書き込む先は、CLI(`electron .`)が読むのと同じ設定フォルダー(%APPDATA%/<productName>)。
// 形は src/main/settings.ts の loadSettings が読むもの(エンジンは同意の日時がないと有効にならない)。
const { app, safeStorage } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { productName } = require("../package.json");

const key = (process.env.AZURE_SPEECH_KEY || "").trim();
const region = (process.env.AZURE_SPEECH_REGION || "").trim();

// ready の前に決める。Chromium の暗号化の鍵(Local State)も同じフォルダーに置かれ、CLI と共有される
app.setPath("userData", path.join(app.getPath("appData"), productName));

app.whenReady().then(() => {
  try {
    if (!key || !region) throw new Error("AZURE_SPEECH_KEY と AZURE_SPEECH_REGION を渡してください");
    if (!safeStorage.isEncryptionAvailable()) throw new Error("safeStorage が使えません");
    const file = path.join(app.getPath("userData"), "settings.json");
    let cur = {};
    try {
      cur = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {}
    const engines = cur.engines || {};
    const next = {
      ...cur,
      engines: {
        ...engines,
        azure: { ...engines.azure, enabled: true, agreedAt: new Date().toISOString(), region },
      },
      secrets: { azureKey: safeStorage.encryptString(key).toString("base64") },
    };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
    // 鍵の値は出さない
    console.log(`Azure AI Speech を有効にしました(リージョン ${region}): ${file}`);
    app.exit(0);
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    app.exit(1);
  }
});

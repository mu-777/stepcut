// CI(.github/workflows/lp-media.yml)で、StepCut の設定に Azure AI Speech の鍵とリージョンを入れる。
//   AZURE_SPEECH_KEY=... AZURE_SPEECH_REGION=japaneast npx electron scripts/ci-azure-settings.cjs
//   確かめる(別のプロセスで鍵を解けるか): npx electron scripts/ci-azure-settings.cjs --check
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

const check = process.argv.includes("--check");

// 成功したら app.quit() で終える。app.exit() で即座に終えると、暗号化の鍵(Local State)が書かれる前に閉じ、
// 次に起動したプロセス(CLI)が鍵を解けない。失敗したら書くものはないので、終了コードを返せる app.exit(1)
function done(code) {
  if (code === 0) app.quit();
  else app.exit(code);
}

app.whenReady().then(() => {
  if (check) {
    try {
      const file = path.join(app.getPath("userData"), "settings.json");
      const cur = JSON.parse(fs.readFileSync(file, "utf8"));
      const k = safeStorage.decryptString(Buffer.from(cur.secrets?.azureKey ?? "", "base64"));
      if (!k || !cur.engines?.azure?.region || !cur.engines?.azure?.enabled) throw new Error("設定が足りません");
      console.log("Azure AI Speech の鍵を解けました");
      done(0);
    } catch (e) {
      console.error(`Azure AI Speech の鍵を解けません: ${e instanceof Error ? e.message : e}`);
      done(1);
    }
    return;
  }
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
    done(0);
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    done(1);
  }
});

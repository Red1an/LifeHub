#!/usr/bin/env node
/*
 * Сборка приложения LifeHub для Android без Gradle: aapt2 → javac → d8 → zipalign → apksigner.
 *
 *   node phone/android/build.mjs [--install]
 *
 * Инструменты — в %LOCALAPPDATA%\LifeHubAndroid (или LIFEHUB_ANDROID): jdk/<jdk-17…>, bt/<build-tools>, pf/<android-35>.
 * Ключ подписи создаётся там же один раз (lifehub.keystore): с ним обновления ставятся поверх старой версии.
 * Готовый APK — build/lifehub.apk и build/version.json; хаб отдаёт их телефону (server/mobile.ts).
 * Номер версии — VERSION/VERSION_CODE ниже: подними, и приложение само предложит обновиться.
 * --install — поставить на телефон по USB (adb).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const VERSION = "1.2.3";
const VERSION_CODE = 6;

const here = import.meta.dirname;
const out = path.join(here, "build");
const tools = process.env.LIFEHUB_ANDROID ?? path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"), "LifeHubAndroid");
const only = (dir) => {
  const d = fs.readdirSync(dir).find((x) => fs.statSync(path.join(dir, x)).isDirectory());
  if (!d) throw new Error(`Пусто: ${dir}`);
  return path.join(dir, d);
};
const jdk = only(path.join(tools, "jdk"));
const bt = only(path.join(tools, "bt"));
const androidJar = path.join(only(path.join(tools, "pf")), "android.jar");
const keystore = path.join(tools, "lifehub.keystore");
const exe = (dir, name) => path.join(dir, process.platform === "win32" ? name : name.replace(/\.(exe|bat)$/, ""));
const env = { ...process.env, JAVA_HOME: jdk, PATH: `${path.join(jdk, "bin")}${path.delimiter}${process.env.PATH}` };

function run(cmd, args) {
  // .bat на Windows запускаются только через оболочку.
  const shell = cmd.endsWith(".bat");
  const quote = (a) => (shell && /[\s&()]/.test(a) ? `"${a}"` : a);
  execFileSync(shell ? `"${cmd}"` : cmd, shell ? args.map(quote) : args, { stdio: "inherit", env, shell });
}

function files(dir, ext, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) files(p, ext, acc);
    else if (p.endsWith(ext)) acc.push(p);
  }
  return acc;
}

fs.rmSync(out, { recursive: true, force: true });
for (const d of ["gen", "classes", "dex"]) fs.mkdirSync(path.join(out, d), { recursive: true });

console.log("▸ ресурсы");
run(exe(bt, "aapt2.exe"), ["compile", "--dir", path.join(here, "res"), "-o", path.join(out, "res.zip")]);
run(exe(bt, "aapt2.exe"), [
  "link", "-o", path.join(out, "base.apk"), "-I", androidJar,
  "--manifest", path.join(here, "AndroidManifest.xml"), "--java", path.join(out, "gen"),
  "--min-sdk-version", "26", "--target-sdk-version", "34",
  "--version-code", String(VERSION_CODE), "--version-name", VERSION,
  path.join(out, "res.zip"),
]);

// Версия — в коде приложения (проверка обновлений) и рядом с APK (её читает хаб).
fs.mkdirSync(path.join(out, "gen", "ru", "lifehub", "app"), { recursive: true });
fs.writeFileSync(
  path.join(out, "gen", "ru", "lifehub", "app", "BuildInfo.java"),
  `package ru.lifehub.app;

public final class BuildInfo {
    public static final String VERSION = "${VERSION}";
    public static final int CODE = ${VERSION_CODE};
}
`,
);

console.log("▸ java");
run(exe(path.join(jdk, "bin"), "javac.exe"), [
  "--release", "11", "-encoding", "UTF-8", "-nowarn", "-classpath", androidJar, "-d", path.join(out, "classes"),
  ...files(path.join(here, "src"), ".java"), ...files(path.join(out, "gen"), ".java"),
]);

console.log("▸ dex");
run(exe(bt, "d8.bat"), ["--release", "--min-api", "26", "--lib", androidJar, "--output", path.join(out, "dex"), ...files(path.join(out, "classes"), ".class")]);
fs.copyFileSync(path.join(out, "dex", "classes.dex"), path.join(out, "classes.dex"));
// aapt add кладёт файл по пути, как он передан, — поэтому из папки build.
execFileSync(exe(bt, "aapt.exe"), ["add", "base.apk", "classes.dex"], { cwd: out, stdio: "inherit" });

console.log("▸ подпись");
run(exe(bt, "zipalign.exe"), ["-p", "-f", "4", path.join(out, "base.apk"), path.join(out, "aligned.apk")]);
if (!fs.existsSync(keystore)) {
  run(exe(path.join(jdk, "bin"), "keytool.exe"), [
    "-genkeypair", "-keystore", keystore, "-storepass", "lifehub", "-keypass", "lifehub", "-alias", "lifehub",
    "-keyalg", "RSA", "-keysize", "2048", "-validity", "36500", "-dname", "CN=LifeHub",
  ]);
}
const apk = path.join(out, "lifehub.apk");
run(exe(bt, "apksigner.bat"), ["sign", "--ks", keystore, "--ks-pass", "pass:lifehub", "--ks-key-alias", "lifehub", "--out", apk, path.join(out, "aligned.apk")]);
fs.writeFileSync(path.join(out, "version.json"), JSON.stringify({ versionName: VERSION, versionCode: VERSION_CODE }));
console.log(`✓ ${apk} (${Math.round(fs.statSync(apk).size / 1024)} КБ)`);

if (process.argv.includes("--install")) {
  console.log("▸ установка по USB");
  execFileSync("adb", ["install", "-r", apk], { stdio: "inherit" });
}

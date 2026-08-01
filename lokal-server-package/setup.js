/**
 * FaceHub Lokal Server — sozlash ustasi (setup wizard).
 *
 * Bu skript orqali kompyuter ekranidagi savollarga javob berib, kodga
 * umuman tegmasdan qurilma(lar)ni qo'shish va serverni doimiy ishlaydigan
 * qilib ishga tushirish mumkin. install.bat shu faylni avtomatik chaqiradi.
 */

const readline = require("node:readline");
const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");
const { testConnection } = require("./isapi-client");

const DEVICES_PATH = path.join(__dirname, "devices.json");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question, defaultValue) {
  const suffix = defaultValue ? ` (${defaultValue})` : "";
  return new Promise((resolve) => {
    rl.question(`${question}${suffix}: `, (answer) => {
      const trimmed = answer.trim();
      resolve(trimmed || defaultValue || "");
    });
  });
}

function loadDevices() {
  try {
    return JSON.parse(fs.readFileSync(DEVICES_PATH, "utf8"));
  } catch {
    return [];
  }
}

function saveDevices(devices) {
  fs.writeFileSync(DEVICES_PATH, JSON.stringify(devices, null, 2));
}

function commandExists(cmd) {
  try {
    execSync(`${cmd} -v`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function addDeviceFlow(devices) {
  console.log("\n--- Yangi qurilma qo'shish ---");
  const name = await ask("Qurilma nomi (masalan: 1-Kirish)", `Qurilma-${devices.length + 1}`);
  const ipAddress = await ask("Qurilmaning IP manzili (masalan: 172.17.0.110)");
  if (!ipAddress) {
    console.log("IP manzil kiritilmadi, bu qurilma qo'shilmadi.");
    return devices;
  }
  const portStr = await ask("Port", "80");
  const isapiUsername = await ask("Qurilma admin foydalanuvchi nomi", "admin");
  const isapiPassword = await ask("Qurilma admin paroli");

  const device = {
    name,
    ipAddress,
    port: Number(portStr) || 80,
    isapiUsername,
    isapiPassword,
  };

  console.log("Ulanish tekshirilmoqda...");
  try {
    const ok = await testConnection(device);
    if (ok) {
      console.log("✅ Qurilmaga muvaffaqiyatli ulanildi.");
    } else {
      console.log("⚠️  Qurilmadan javob keldi, lekin login/parol noto'g'ri bo'lishi mumkin.");
      const proceed = await ask("Baribir saqlaymizmi? (ha/yoq)", "ha");
      if (proceed.toLowerCase().startsWith("yo")) return devices;
    }
  } catch (error) {
    console.log(`⚠️  Qurilmaga ulanib bo'lmadi: ${error.message}`);
    console.log("   (IP manzil, tarmoq yoki parol xato bo'lishi mumkin)");
    const proceed = await ask("Baribir saqlaymizmi? (ha/yoq)", "yo'q");
    if (!proceed.toLowerCase().startsWith("ha")) return devices;
  }

  const next = [...devices.filter((d) => d.ipAddress !== device.ipAddress), device];
  saveDevices(next);
  console.log(`"${name}" qurilmasi devices.json ga saqlandi.`);
  return next;
}

function startWithPm2() {
  console.log("\n--- Serverni ishga tushirish ---");
  if (!commandExists("pm2")) {
    console.log("⚠️  pm2 topilmadi. Avval quyidagini bajaring:");
    console.log("    npm install -g pm2");
    console.log("so'ng shu setup.js ni qayta ishga tushiring.");
    return;
  }
  try {
    execSync("pm2 delete facehub-lokal-server", { stdio: "ignore" });
  } catch {
    // birinchi marta ishga tushayotgan bo'lsa, o'chiradigan narsa yo'q — bu normal holat.
  }
  execSync("pm2 start index.js --name facehub-lokal-server", { stdio: "inherit", cwd: __dirname });
  execSync("pm2 save", { stdio: "inherit" });
  console.log("\n✅ Server ishga tushdi va kompyuter qayta yoqilganda ham avtomatik ishlaydi.");
  console.log("   Holatini ko'rish uchun:  pm2 status");
  console.log("   Loglarni ko'rish uchun:  pm2 logs facehub-lokal-server");
}

async function main() {
  console.log("=================================================");
  console.log(" FaceHub Lokal Server — sozlash ustasi");
  console.log("=================================================");

  let devices = loadDevices();
  if (devices.length > 0) {
    console.log(`\nHozircha qo'shilgan qurilmalar (${devices.length}):`);
    for (const d of devices) console.log(`  - ${d.name} (${d.ipAddress}:${d.port})`);
  } else {
    console.log("\nHozircha hech qanday qurilma qo'shilmagan.");
  }

  let addMore = await ask("\nYangi qurilma qo'shasizmi? (ha/yo'q)", devices.length === 0 ? "ha" : "yo'q");
  while (addMore.toLowerCase().startsWith("ha")) {
    devices = await addDeviceFlow(devices);
    addMore = await ask("Yana bitta qurilma qo'shasizmi? (ha/yo'q)", "yo'q");
  }

  startWithPm2();

  console.log("\nTayyor! Ushbu oynani yopsangiz ham server ishlashda davom etadi.");
  rl.close();
}

main().catch((error) => {
  console.error("Xato:", error);
  rl.close();
  process.exitCode = 1;
});

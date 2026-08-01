/**
 * Hikvision lokal relay — Tayloqdagi (yoki istalgan boshqa) lokal tarmoqdagi
 * kompyuterda ishga tushiriladi. Qurilmaning HTTP Listening (webhook) sozlamasi
 * to'g'ridan-to'g'ri INTERNETGA emas, balki shu kompyuterning LOKAL IP
 * manziliga yo'naltiriladi (masalan http://192.168.1.50:5050/event) — bu hech
 * qanday port-forward yoki maxsus tarmoq sozlamasini talab qilmaydi, chunki
 * bir xil lokal Wi-Fi ichidagi ulanish.
 *
 * Bu kompyuter esa qabul qilgan har bir hodisani DARHOL Samarqanddagi haqiqiy
 * serverga (tyutorkpi.sies.uz) CHIQUVCHI (outbound) so'rov bilan uzatib
 * yuboradi — chiquvchi so'rovlar provayder/CGNAT tomonidan bloklanmaydi,
 * shuning uchun bu yechim internet turi qanday bo'lishidan qat'i nazar ishlaydi.
 *
 * Ishga tushirish:
 *   npm install
 *   TARGET_URL="https://tyutorkpi.sies.uz/faysid/api/hikvision/event" node relay.js
 * Yoki config.json fayl orqali (pastga qarang).
 *
 * pm2 bilan doimiy ishlatish uchun README.md fayliga qarang.
 */

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

function loadConfig() {
  const configPath = path.join(__dirname, "config.json");
  let fileConfig = {};
  if (fs.existsSync(configPath)) {
    try {
      fileConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
    } catch (error) {
      console.error(`config.json o'qishda xato: ${error.message}`);
    }
  }
  return {
    targetUrl: process.env.TARGET_URL || fileConfig.targetUrl || "https://tyutorkpi.sies.uz/faysid/api/hikvision/event",
    listenPort: Number(process.env.LISTEN_PORT || fileConfig.listenPort || 5050),
  };
}

const { targetUrl, listenPort } = loadConfig();

function logLine(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
  try {
    fs.appendFileSync(path.join(__dirname, "relay.log"), line + "\n");
  } catch {
    // Log fayliga yozib bo'lmasa ham davom etamiz — konsolga chiqishi yetarli.
  }
}

const server = http.createServer((req, res) => {
  if (req.method !== "POST") {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: false, message: "Faqat POST so'rovlari qabul qilinadi" }));
    return;
  }

  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    const body = Buffer.concat(chunks);

    // Qurilmaga darhol javob beramiz — u tez javobni kutadi, aks holda
    // qayta-qayta urinishni (retry storm) boshlashi yoki HTTP Listening'ni
    // o'chirib qo'yishi mumkin.
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true }));

    const contentType = req.headers["content-type"] || "application/json";
    fetch(targetUrl, { method: "POST", headers: { "Content-Type": contentType }, body })
      .then((response) => {
        logLine(`Hodisa uzatildi -> ${targetUrl} (status: ${response.status})`);
      })
      .catch((error) => {
        logLine(`XATO: uzatib bo'lmadi -> ${targetUrl}: ${error.message}`);
      });
  });
});

server.listen(listenPort, () => {
  logLine(`Lokal relay ishga tushdi: port ${listenPort}, manzil -> ${targetUrl}`);
  logLine(`Qurilmangizning HTTP Listening sozlamasida shu kompyuterning lokal IP:${listenPort} manzilini ko'rsating.`);
});

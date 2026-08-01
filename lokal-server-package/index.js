/**
 * FaceHub Lokal Server — Tayloqdagi (yoki istalgan lokal tarmoqdagi) doim
 * yoqilgan kompyuterda ishlaydi. Ikki xil yo'l bilan davomatni oladi:
 *
 *  1) FAOL (polling) — devices.json'da ko'rsatilgan har bir qurilmaga
 *     to'g'ridan-to'g'ri ISAPI orqali (IP + login + parol bilan) ulanib,
 *     har 20 soniyada uning voqealar jurnalini so'rab turadi. Bu asosiy,
 *     ishonchli yo'l — qurilmaning HTTP Listening sozlamasi to'g'ri
 *     ishlashiga bog'liq emas.
 *  2) PASSIV (relay) — agar qurilmaning o'zi HTTP Listening orqali shu
 *     kompyuterning lokal IP:portiga voqea yuborsa, uni ham qabul qilib,
 *     xuddi shunday uzatib yuboradi (qo'shimcha, zarar keltirmaydigan yo'l).
 *
 * Ikkala yo'ldan topilgan har bir hodisa Samarqanddagi haqiqiy FaceHub
 * serveriga (config.json'dagi targetUrl) CHIQUVCHI so'rov bilan uzatiladi —
 * chiquvchi so'rovlar CGNAT/provayder tomonidan bloklanmaydi.
 *
 * Ishga tushirish: pm2 start index.js --name facehub-lokal-server
 */

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { searchAcsEvents } = require("./isapi-client");

const CONFIG_PATH = path.join(__dirname, "config.json");
const DEVICES_PATH = path.join(__dirname, "devices.json");
const STATE_PATH = path.join(__dirname, "state.json");
const LOG_PATH = path.join(__dirname, "relay.log");

const POLL_INTERVAL_MS = 20_000;
const INITIAL_LOOKBACK_MS = 5 * 60_000;

function loadJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function saveJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function logLine(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_PATH, line + "\n");
  } catch {
    // Log fayliga yozib bo'lmasa ham davom etamiz.
  }
}

const config = loadJson(CONFIG_PATH, {});
const targetUrl = process.env.TARGET_URL || config.targetUrl || "https://tyutorkpi.sies.uz/faysid/api/hikvision/event";
const listenPort = Number(process.env.LISTEN_PORT || config.listenPort || 5050);

async function forwardEvent(body, contentType) {
  const response = await fetch(targetUrl, {
    method: "POST",
    headers: { "Content-Type": contentType || "application/json" },
    body,
  });
  return response.status;
}

// ---------- 1) FAOL: ISAPI polling ----------

async function pollDevices() {
  const devices = loadJson(DEVICES_PATH, []);
  if (devices.length === 0) return;

  const state = loadJson(STATE_PATH, {});

  for (const device of devices) {
    const endTime = new Date();
    const startTime = state[device.name] ? new Date(state[device.name]) : new Date(endTime.getTime() - INITIAL_LOOKBACK_MS);

    try {
      const events = await searchAcsEvents(device, startTime, endTime);

      // Bitta jismoniy skanerlash bir nechta bir xil vaqtli yozuv qoldirishi
      // mumkin — takrorlarni saytga yubormasdan oldin ajratib tashlaymiz.
      const seen = new Set();
      const deduped = events.filter((e) => {
        const key = `${e.employeeNo}|${e.time}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      for (const event of deduped) {
        const body = JSON.stringify({
          employeeNoString: event.employeeNo,
          attendanceStatus: event.attendanceStatus,
          dateTime: event.time,
          ipAddress: device.ipAddress,
        });
        try {
          const status = await forwardEvent(body, "application/json");
          logLine(`[${device.name}] hodisa uzatildi (xodim ${event.employeeNo}) -> status ${status}`);
        } catch (error) {
          logLine(`[${device.name}] XATO: hodisani uzatib bo'lmadi: ${error.message}`);
        }
      }

      state[device.name] = endTime.toISOString();
      saveJson(STATE_PATH, state);
    } catch (error) {
      logLine(`[${device.name}] qurilmadan so'rashda xato: ${error.message}`);
    }
  }
}

// ---------- 2) PASSIV: webhook relay ----------

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

    // Qurilmaga darhol javob beramiz.
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true }));

    const contentType = req.headers["content-type"] || "application/json";
    forwardEvent(body, contentType)
      .then((status) => logLine(`[passiv relay] hodisa uzatildi -> status ${status}`))
      .catch((error) => logLine(`[passiv relay] XATO: uzatib bo'lmadi: ${error.message}`));
  });
});

// ---------- Ishga tushirish ----------

server.listen(listenPort, () => {
  logLine(`Lokal server ishga tushdi.`);
  logLine(`  Passiv relay porti: ${listenPort} (qurilmaning HTTP Listening'i shu yerga yo'naltirilishi mumkin)`);
  logLine(`  Maqsad manzil: ${targetUrl}`);
  const devices = loadJson(DEVICES_PATH, []);
  logLine(`  Faol polling: ${devices.length} ta qurilma, har ${POLL_INTERVAL_MS / 1000}s (devices.json)`);
});

pollDevices().catch((error) => logLine(`Polling xatosi: ${error.message}`));
setInterval(() => {
  pollDevices().catch((error) => logLine(`Polling xatosi: ${error.message}`));
}, POLL_INTERVAL_MS);

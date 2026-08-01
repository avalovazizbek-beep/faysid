# FaceHub Lokal Server

Bu kichik dastur — internet provayder portlarni bloklagan (CGNAT) joylardagi
Hikvision qurilmalar uchun. U qurilma bilan bir xil lokal tarmoqdagi (Wi-Fi/LAN)
har doim yonib turadigan kompyuterda ishlaydi, qurilmadan davomat
ma'lumotlarini o'zi so'rab oladi va uni FaceHub saytiga (tyutorkpi.sies.uz)
yuboradi. Saytda yoki backendda hech qanday qo'shimcha sozlash kerak emas —
bu server saytning allaqachon ishlab turgan qabul qilish nuqtasiga ulanadi.

## 0 dan ishga tushirish (kod bilishingiz shart emas)

1. **Zip faylni yuklab oling.** FaceHub saytida, "Xavfsizlik" (Security) sahifasida
   "Lokal server" bo'limidan "Yuklab olish" tugmasini bosing.
2. Yuklangan `facehub-lokal-server.zip` faylni **qurilma bilan bir xil tarmoqdagi**
   (masalan, Tayloqdagi) kompyuterga ko'chiring va papka qilib oching (extract).
3. Ochilgan papka ichidagi **`install.bat`** faylini ikki marta bosing (double-click).
   - Agar kompyuterda Node.js o'rnatilmagan bo'lsa, dastur sizga
     [nodejs.org](https://nodejs.org) dan yuklab olishni so'raydi ("LTS" tugmasi,
     o'rnatishda hammasini "Next" bilan o'tkazavering), so'ng `install.bat` ni
     qayta ishga tushiring.
4. Ochilgan qora oynada (cmd) sizdan so'raladi:
   - **Qurilma nomi** — masalan `1-Kirish`
   - **IP manzili** — qurilmaning lokal IP manzili (masalan `172.17.0.110`) —
     buni qurilmaning o'zidan yoki uni sozlagan odamdan bilib oling
   - **Port** — odatda `80` (shunchaki Enter bosavering)
   - **Foydalanuvchi nomi** — odatda `admin`
   - **Parol** — qurilmaning admin paroli
5. Dastur avtomatik ravishda qurilmaga ulanishni tekshiradi va serverni
   ishga tushiradi. Tayyor! Bu oynani yopib qo'ysangiz ham server ishlashda
   davom etadi va kompyuter qayta yoqilganda ham o'zi qayta ishga tushadi.

Davomat endi FaceHub saytidagi "Davomat" bo'limida avtomatik ko'rinib turadi.

## Telegram orqali real vaqtli xabar (ixtiyoriy)

`install.bat` (yoki `node setup.js`) ishga tushganda, qurilma(lar)ni qo'shib
bo'lgach, sizdan Telegram orqali xabar yuborishni xohlaysizmi deb so'raladi.
Xohlasangiz:

1. Bot tokenini kiriting (@BotFather orqali oldingiz).
2. Botni Telegram guruhingizga a'zo qiling, guruhda bir xabar yozing, so'ng
   brauzerda `https://api.telegram.org/bot<TOKEN>/getUpdates` ni oching —
   javobdagi `"chat":{"id":...}` qiymati sizning Chat ID'ingiz.
3. Shu Chat ID'ni kiriting.

Shundan keyin, xodim yuz ko'rsatganda, lokal serverning o'zi darhol shu
guruhga xabar yuboradi (xodim kodi + vaqt — ism/rasm bilmaydi, chunki bu
ma'lumot faqat asosiy sayt bazasida bor). Buni keyinroq `node setup.js` ni
qayta ishga tushirib ham sozlash/o'zgartirish mumkin.

## Yana bitta qurilma qo'shish

`install.bat` faylini xohlagan vaqtingizda qayta ishga tushirsangiz bo'ladi —
u avval qo'shilgan qurilmalarni ko'rsatadi va yana biror qurilma qo'shishni
so'raydi, so'ng serverni qayta ishga tushiradi.

## Foydali buyruqlar (agar cmd bilan ishlashni istasangiz)

Ushbu papka ichida cmd oynasini oching (`cd` bilan shu papkaga o'ting), so'ng:

| Buyruq | Nima qiladi |
|---|---|
| `pm2 status` | Server ishlab turganini tekshirish |
| `pm2 logs facehub-lokal-server` | Jonli loglarni ko'rish (nima yuborilyapti) |
| `pm2 restart facehub-lokal-server` | Serverni qayta ishga tushirish |
| `pm2 stop facehub-lokal-server` | Serverni to'xtatish |
| `node setup.js` | Yangi qurilma qo'shish / serverni qayta yoqish |

## Ichida qanday ishlaydi (ma'lumot uchun)

- `devices.json` — qo'shilgan qurilmalar ro'yxati (IP, port, login, parol).
  Buni qo'lda tahrirlashning hojati yo'q — `setup.js` (yoki `install.bat`) buni
  siz uchun to'ldiradi.
- `index.js` — har 20 soniyada har bir qurilmadan yangi hodisalarni so'rab
  oladi (ISAPI orqali, to'g'ridan-to'g'ri IP+login+parol bilan) va topilgan
  har bir hodisani chiquvchi (outbound) so'rov bilan FaceHub serveriga
  uzatadi — chiquvchi so'rovlar hech qanday farvol/CGNAT tomonidan
  bloklanmaydi.
- `config.json` — qayerga yuborish (`targetUrl`) sozlamasi, oldindan to'g'ri
  qiymat bilan kelgan, o'zgartirish shart emas.
- Qurilma qo'shimcha ravishda o'zining HTTP Listening orqali ham shu
  kompyuterning `5050`-portiga hodisa yuborsa (ixtiyoriy, majburiy emas),
  server buni ham qabul qilib, xuddi shunday uzatib yuboradi — ikkala yo'l
  ham bir vaqtda ishlaydi va bir-biriga xalaqit bermaydi.

## Muammo bo'lsa

- `pm2 logs facehub-lokal-server` ni ishga tushirib, so'nggi qatorlarni
  ko'ring — odatda xato sababi shu yerda yozilgan bo'ladi (masalan, noto'g'ri
  parol yoki qurilmaga tarmoq orqali yeta olmayotgani).
- Qurilmaning IP manzili o'zgargan bo'lsa, `node setup.js` ni qayta ishga
  tushirib, o'sha qurilmani qaytadan qo'shing (eski yozuv IP bo'yicha
  avtomatik yangilanadi).

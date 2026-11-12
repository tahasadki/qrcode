const http = require("http");
const https = require("https");
const fs   = require("fs");
const path = require("path");
const WebSocket = require("ws");

/* ─── عبارات ترحيبية مباشرة عالية الجودة ─── */
const directPhrases = {
  "السلام عليكم": {
    en: "Hello and welcome to our riad!",
    fr: "Bonjour et bienvenue dans notre riad !",
    es: "¡Hola y bienvenido a nuestro riad!",
    de: "Hallo und herzlich willkommen in unserem Riad!",
    it: "Ciao e benvenuto nel nostro riad!",
    ru: "Здравствуйте и добро пожаловать в наш риiad!",
    zh: "您好，欢迎光临我们的庭院旅馆！",
    ja: "こんにちは、当リアドへようこそ！",
    pt: "Olá e seja bem-vindo ao nosso riad!",
    nl: "Hallo en welkom in onze riad!",
    tr: "Merhaba, riadımıza hoş geldiniz!"
  },
  "مرحبا بيك": {
    en: "You are very welcome!",
    fr: "Soyez le bienvenu !",
    es: "¡Muy bienvenido!"
  },
  "مرحبا": {
    en: "Hello and welcome!",
    fr: "Bonjour et bienvenue !",
    es: "¡Hola y bienvenido!"
  },
  "شكرا بزاف": {
    en: "Thank you very much!",
    fr: "Merci beaucoup !",
    es: "¡Muchas gracias!"
  },
  "بسلامة": {
    en: "Goodbye, have a great day!",
    fr: "Au revoir et bonne journée !",
    es: "¡Adiós, que tenga un buen día!"
  }
};

/* ─── قاموس الدارجة المغربية وتحويلها لفصحى مترجمة ─── */
const darijaMap = [
  // تحييات
  [/مرحبا\s+بيك(وم)?/gi, 'أهلاً وسهلاً بكم'],
  [/مرحبا/gi, 'مرحباً'],
  [/كي\s*داير(ة)?/gi, 'كيف حالك'],
  [/كيدايرين/gi, 'كيف حالكم'],
  [/لا\s*باس(\s+عليك)?/gi, 'هل أنت بخير والحمد لله'],
  [/بخير\s+الحمد\s*لله/gi, 'بخير والحمد لله'],
  [/كولشي\s+مزيان|كلشي\s+مزيان/gi, 'كل شيء على ما يرام'],
  [/صباح\s+الخير/gi, 'صباح الخير'],
  [/مساء\s+الخير/gi, 'مساء الخير'],
  [/تصبح\s+على\s+خير/gi, 'تصبح على خير'],
  [/بسلامة/gi, 'إلى لقاء مع السلامة'],
  [/شكرا\s+بزاف/gi, 'شكراً جزيلاً لك'],
  [/بزاف/gi, 'كثيراً'],
  [/عفاك/gi, 'من فضلك'],
  [/الله\s+يعطيك\s+الصحة/gi, 'شكراً جزيلاً لك'],
  [/سمح\s+ليا|سمحي\s+ليا/gi, 'عذراً المعذرة'],
  [/واخا|صافي/gi, 'حسناً بكل سرور'],
  [/مكاين\s*(حتى\s*)?مشكل|ماكاين\s*مشكل/gi, 'لا توجد أي مشكلة'],
  [/دابا/gi, 'الآن'],
  [/مزيان(ة)?/gi, 'جيد وممتاز'],
  [/زوين(ة)?/gi, 'جميل ورائع'],
  [/فاش\s+نقدر\s+نعاونك/gi, 'كيف يمكنني مساعدتك'],
  [/شحال\s+الثمن|شحال\s+كيدير/gi, 'كم يبلغ السعر والتكاليف'],
  [/شحال/gi, 'كم'],
  [/واش\s+كاين(\s+شي)?/gi, 'هل يوجد متوفر'],
  [/ما\s*كاينش/gi, 'غير متوفر حالياً'],
  [/fin\s+كاين(ة)?/gi, 'أين يقع مكان'],
  [/شنو\s+كاين/gi, 'ماذا يوجد'],
  [/شنو\s+بغيتي/gi, 'ماذاwant'],
  [/شنو/gi, 'ماذا'],
  [/علش/gi, 'لماذا'],
  [/فوقاش|إمتى/gi, 'متى في أي وقت'],
  [/البيت|بيوت|شمبرة/gi, 'غرفة فندقية'],
  [/خاوي(ة)?/gi, 'شاغرة ومتاحة للحجز'],
  [/عامر(ة)?/gi, 'محجزة بالكامل'],
  [/الفطور/gi, 'وجبة الإفطار'],
  [/الغدا/gi, 'وجبة الغداء'],
  [/العشا/gi, 'وجبة العشاء'],
  [/أتاي/gi, 'الشاي المغربي والنعناع'],
  [/الساروت/gi, 'مفتاح الغرفة'],
  [/الدوش/gi, 'الحمام'],
  [/المسبح/gi, 'حوض السباحة'],
  [/السطاح/gi, 'شرفة السطح البانورامية'],
  [/طاكسي/gi, 'سيارة الأجرة'],
  [/عيط\s+ليا/gi, 'اتصل بي'],
  [/كنهدر/gi, 'أتكلم معك'],
  [/هادا|هاد/gi, 'هذا'],
  [/هادي/gi, 'هذه'],
  [/ديالنا/gi, 'الخاص بنا'],
  [/ديالك/gi, 'الخاص بك'],
  [/ديال/gi, 'خاص بـ']
];

function normalizeDarija(text) {
  if (!text) return "";
  let s = text;
  darijaMap.forEach(([re, rep]) => {
    s = s.replace(re, rep);
  });
  return s;
}

function fetchTranslation(text, from, to, callback) {
  if (!text || from === to) return callback(text);

  const trimmed = text.trim();
  if (directPhrases[trimmed] && directPhrases[trimmed][to]) {
    return callback(directPhrases[trimmed][to]);
  }

  /* معالجة خاصة لـ السلام عليكم وما بعدها */
  if (/^السلام\s+عليكم/i.test(trimmed)) {
    const greeting = (directPhrases["السلام عليكم"] && directPhrases["السلام عليكم"][to]) || "Hello and welcome!";
    const rest = trimmed.replace(/^السلام\s+عليكم(\s+ورحمة\s+الله(\s+وبركاته)?)?/i, "").trim();
    if (!rest) return callback(greeting);
    const normRest = normalizeDarija(rest);
    return fetchTranslation(normRest, from, to, function (sub) {
      callback(greeting + " " + sub);
    });
  }

  /* إذا كانت اللغة المغربية (Darija)، استخدم Tkalam أولاً */
  if (from === "ar-MA" && TKALAM_API_KEY) {
    return translateViaTkalam(text, to, function (translated) {
      if (translated) return callback(translated);
      /* إذا فشل Tkalam، جرب MyMemory */
      translateViaMyMemory(text, from, to, callback);
    });
  }

  /* للغات الأخرى، استخدم MyMemory */
  translateViaMyMemory(text, from, to, callback);
}

/* ─── إعدادات APIs الترجمة ─── */
// Tkalam Localize - ترجمة الدارجة المغربية الطبيعية
// سجل مجاناً على https://tkalam.com للحصول على API key
const TKALAM_API_KEY = process.env.TKALAM_API_KEY || "";
const TKALAM_URL = "https://api.tkalam.com/v1/translate";

// MyMemory API - ترجمة عامة ( copie)
const MYMEMORY_URL = "https://api.mymemory.translated.net/get";

/* ─── ترجمة بالدارجة المغربية عبر Tkalam ─── */
function translateViaTkalam(text, targetLang, callback) {
  if (!TKALAM_API_KEY) {
    console.log("⚠️ Tkalam API key not set, using fallback");
    return callback(null);
  }

  const postData = JSON.stringify({
    text: text,
    target_dialect: "darija",
    style: "informal"
  });

  const url = new URL(TKALAM_URL);
  const options = {
    hostname: url.hostname,
    path: url.pathname,
    method: "POST",
    headers: {
      "Authorization": "Bearer " + TKALAM_API_KEY,
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(postData)
    },
    timeout: 5000
  };

  const req = https.request(options, function (res) {
    let raw = "";
    res.on("data", c => (raw += c));
    res.on("end", function () {
      try {
        const json = JSON.parse(raw);
        const translated = json?.data?.output_text || json?.output_text || null;
        callback(translated);
      } catch (e) {
        console.error("Tkalam parse error:", e);
        callback(null);
      }
    });
  });

  req.on("error", function (e) {
    console.error("Tkalam request error:", e.message);
    callback(null);
  });

  req.on("timeout", function () {
    req.destroy();
    callback(null);
  });

  req.write(postData);
  req.end();
}

/* ─── ترجمة افتراضية عبر MyMemory ─── */
function translateViaMyMemory(text, from, to, callback) {
  const q = encodeURIComponent(text);
  const url = `${MYMEMORY_URL}?q=${q}&langpair=${from}|${to}`;

  https.get(url, function (res) {
    let raw = "";
    res.on("data", c => (raw += c));
    res.on("end", function () {
      try {
        const json = JSON.parse(raw);
        const translated = json?.responseData?.translatedText || text;
        callback(translated);
      } catch (_) {
        callback(text);
      }
    });
  }).on("error", function () {
    callback(text);
  });
}

/* ─── خادم HTTP لملفات ثابتة و API الترجمة ─── */
const server = http.createServer(function (req, res) {
  if (req.url.startsWith("/api/translate")) {
    const u = new URL(req.url, "http://localhost:3000");
    const rawText = u.searchParams.get("text") || "";
    const from = u.searchParams.get("from") || "ar";
    const to = u.searchParams.get("to") || "en";

    // إذا كانت اللغة الدارجة المغربية (ar-MA)، أرسل النص مباشرة دون تحويل للفصحى
    // لكي تبقى الترجمة بالدارجة المغربية الطبيعية
    const textToTranslate = (from === "ar-MA") ? rawText : normalizeDarija(rawText);
    fetchTranslation(textToTranslate, from, to, function (translated) {
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*"
      });
      res.end(JSON.stringify({ original: rawText, translated }));
    });
    return;
  }

  let filePath = path.join(__dirname, req.url === "/" ? "/qr.html" : req.url);
  filePath = filePath.split("?")[0];

  const ext = path.extname(filePath);
  const mime = {
    ".html": "text/html; charset=utf-8",
    ".css":  "text/css",
    ".js":   "application/javascript",
    ".png":  "image/png",
    ".jpg":  "image/jpeg",
    ".svg":  "image/svg+xml",
  };

  fs.readFile(filePath, function (err, data) {
    if (err) {
      res.writeHead(404);
      res.end("404 – not found");
      return;
    }
    res.writeHead(200, { "Content-Type": mime[ext] || "text/plain" });
    res.end(data);
  });
});

/* ─── خادم WebSocket للإشارات (Signaling) ─── */
const wss = new WebSocket.Server({ server });
const clients = new Map();

wss.on("connection", function (socket) {
  clients.set(socket, { role: null, room: "riad-room" });

  socket.on("message", function (raw) {
    let data;
    try { data = JSON.parse(raw.toString()); } catch { return; }

    const me = clients.get(socket);
    console.log("[WS] Message:", data.type, "| role:", me?.role, "| room:", me?.room, "| clients:", clients.size);

    if (data.type === "register") {
      me.role = data.role;
      me.room = data.room || "riad-room";
      console.log("[WS] Registered:", data.role, "-> room:", me.room);
      broadcastToRole("host", { type: "tourist-online", room: me.room });
      return;
    }

    console.log("[WS] Broadcasting:", data.type, "to room:", me?.room);
    broadcast(socket, data);
  });

  socket.on("close", function () {
    const me = clients.get(socket);
    clients.delete(socket);
    if (me && me.role === "tourist") {
      clients.forEach(function (info, client) {
        if (info.room === me.room && client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ type: "tourist-left", senderRole: "tourist" }));
        }
      });
    }
  });
});

function broadcast(sender, data) {
  const senderInfo = clients.get(sender);
  if (!senderInfo) {
    console.log("[WS] broadcast: no senderInfo");
    return;
  }
  let sent = 0;
  clients.forEach(function (info, client) {
    if (
      client !== sender &&
      info.room === senderInfo.room &&
      client.readyState === WebSocket.OPEN
    ) {
      client.send(JSON.stringify({ ...data, senderRole: senderInfo.role }));
      sent++;
    }
  });
  console.log("[WS] broadcast:", data.type, "-> sent to", sent, "client(s) in room", senderInfo.room);
}

function broadcastToRole(role, data) {
  clients.forEach(function (info, client) {
    if (info.role === role && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

server.listen(3000, "0.0.0.0", function () {
  console.log("✅  الخادم يعمل على http://localhost:3000");
  console.log("   صفحة السائح : http://localhost:3000/qr.html");
  console.log("   لوحة المضيف : http://localhost:3000/host.html");
});
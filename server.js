const http = require("http");
const https = require("https");
const fs   = require("fs");
const path = require("path");
const WebSocket = require("ws");

/* ─── Translation dictionaries (for hotel) ─── */
const directPhrases = {
  "السلام عليكم": {
    en: "Hello and welcome to our riad!",
    fr: "Bonjour et bienvenue dans notre riad !",
    es: "¡Hola y bienvenido a nuestro riad!",
    de: "Hallo und herzlich willkommen in unserem Riad!",
    it: "Ciao e benvenuto nel nostro riad!",
    ru: "Здравствуйте и добро пожаловать в наш риад!",
    zh: "您好，欢迎光临我们的庭院旅馆！",
    ja: "こんにちは、当リアドへようこそ！",
    pt: "Olá e seja bem-vindo ao nosso riad!",
    nl: "Hallo en welkom in onze riad!",
    tr: "Merhaba, riadımıza hoş geldiniz!"
  },
  "مرحبا بيك": { en: "You are very welcome!", fr: "Soyez le bienvenu !", es: "¡Muy bienvenido!" },
  "مرحبا": { en: "Hello and welcome!", fr: "Bonjour et bienvenue !", es: "¡Hola y bienvenido!" },
  "شكرا بزاف": { en: "Thank you very much!", fr: "Merci beaucoup !", es: "¡Muchas gracias!" },
  "بسلامة": { en: "Goodbye, have a great day!", fr: "Au revoir et bonne journée !", es: "¡Adiós, que tenga un buen día!" }
};

const darijaMap = [
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
  [/شنو\s+بغيتي/gi, 'ماذا تريد'],
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
  darijaMap.forEach(([re, rep]) => { s = s.replace(re, rep); });
  return s;
}

function fetchTranslation(text, from, to, callback) {
  if (!text || from === to) return callback(text);
  const trimmed = text.trim();
  if (directPhrases[trimmed] && directPhrases[trimmed][to]) {
    return callback(directPhrases[trimmed][to]);
  }
  if (/^السلام\s+عليكم/i.test(trimmed)) {
    const greeting = (directPhrases["السلام عليكم"] && directPhrases["السلام عليكم"][to]) || "Hello and welcome!";
    const rest = trimmed.replace(/^السلام\s+عليكم(\s+ورحمة\s+الله(\s+وبركاته)?)?/i, "").trim();
    if (!rest) return callback(greeting);
    const normRest = normalizeDarija(rest);
    return fetchTranslation(normRest, from, to, function (sub) {
      callback(greeting + " " + sub);
    });
  }
  if (from === "ar-MA" && TKALAM_API_KEY) {
    return translateViaTkalam(text, to, function (translated) {
      if (translated) return callback(translated);
      translateViaMyMemory(text, from, to, callback);
    });
  }
  translateViaMyMemory(text, from, to, callback);
}

const TKALAM_API_KEY = process.env.TKALAM_API_KEY || "";
const TKALAM_URL = "https://api.tkalam.com/v1/translate";
const MYMEMORY_URL = "https://api.mymemory.translated.net/get";

function translateViaTkalam(text, targetLang, callback) {
  if (!TKALAM_API_KEY) { return callback(null); }
  const postData = JSON.stringify({ text, target_dialect: "darija", style: "informal" });
  const url = new URL(TKALAM_URL);
  const options = {
    hostname: url.hostname, path: url.pathname, method: "POST",
    headers: { "Authorization": "Bearer " + TKALAM_API_KEY, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(postData) },
    timeout: 5000
  };
  const req = https.request(options, function (res) {
    let raw = "";
    res.on("data", c => (raw += c));
    res.on("end", function () {
      try {
        const json = JSON.parse(raw);
        callback(json?.data?.output_text || json?.output_text || null);
      } catch (e) { callback(null); }
    });
  });
  req.on("error", () => callback(null));
  req.on("timeout", () => { req.destroy(); callback(null); });
  req.write(postData); req.end();
}

function translateViaMyMemory(text, from, to, callback) {
  const q = encodeURIComponent(text);
  const url = `${MYMEMORY_URL}?q=${q}&langpair=${from}|${to}`;
  https.get(url, function (res) {
    let raw = "";
    res.on("data", c => (raw += c));
    res.on("end", function () {
      try { callback(JSON.parse(raw)?.responseData?.translatedText || text); }
      catch (_) { callback(text); }
    });
  }).on("error", () => callback(text));
}

/* ─── Translator Call Management ─── */
const translatorCalls = new Map(); // callId -> { visitor, host, status, lang, createdAt }
const waitingVisitors = []; // queue of waiting visitors
const availableHosts = new Map(); // hostId -> { socket, name, status }
const clients = new Map(); // WebSocket clients for hotel protocol

function createCall(visitorSocket, lang) {
  const callId = 'call-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
  const call = {
    id: callId,
    visitor: visitorSocket,
    host: null,
    visitorLang: lang,
    hostLang: 'ar-MA',
    status: 'waiting',
    createdAt: Date.now()
  };
  translatorCalls.set(callId, call);
  waitingVisitors.push(callId);
  tryMatchHost(callId);
  return callId;
}

function registerHost(socket, hostId, hostName) {
  availableHosts.set(hostId, { socket, name: hostName, status: 'available' });
  socket.hostId = hostId;
  // Send current waiting calls to this host
  sendHostList(socket);
}

function tryMatchHost(callId) {
  const call = translatorCalls.get(callId);
  if (!call || call.status !== 'waiting') return;
  
  // Find available host
  for (const [hostId, host] of availableHosts) {
    if (host.status === 'available') {
      call.host = hostId;
      call.status = 'matched';
      host.status = 'busy';
      
      // Notify visitor
      if (call.visitor.readyState === WebSocket.OPEN) {
        call.visitor.send(JSON.stringify({ type: 'call-matched', callId }));
      }
      // Notify host
      if (host.socket.readyState === WebSocket.OPEN) {
        host.socket.send(JSON.stringify({ 
          type: 'new-call', 
          callId, 
          visitorName: 'زائر', // Will be updated with real name
          visitorLang: call.visitorLang,
          hostLang: call.hostLang
        }));
      }
      break;
    }
  }
}

function acceptCall(callId, hostId) {
  const call = translatorCalls.get(callId);
  if (!call || call.host !== hostId) return false;
  
  call.status = 'active';
  call.acceptedAt = Date.now();
  
  // Notify visitor
  if (call.visitor.readyState === WebSocket.OPEN) {
    call.visitor.send(JSON.stringify({ type: 'call-accepted', callId }));
  }
  // Notify host
  const host = availableHosts.get(hostId);
  if (host && host.socket.readyState === WebSocket.OPEN) {
    host.socket.send(JSON.stringify({ type: 'call-accepted', callId }));
  }
  
  // Broadcast updated list to all hosts
  broadcastHostList();
  return true;
}

function endCall(callId) {
  const call = translatorCalls.get(callId);
  if (!call) return;
  
  // Notify visitor
  if (call.visitor && call.visitor.readyState === WebSocket.OPEN) {
    call.visitor.send(JSON.stringify({ type: 'call-ended', callId }));
  }
  // Notify host
  if (call.host) {
    const host = availableHosts.get(call.host);
    if (host && host.socket.readyState === WebSocket.OPEN) {
      host.socket.send(JSON.stringify({ type: 'call-ended', callId }));
    }
    if (host) host.status = 'available';
  }
  
  call.status = 'ended';
  call.endedAt = Date.now();
  
  // Remove from waiting if there
  const idx = waitingVisitors.indexOf(callId);
  if (idx > -1) waitingVisitors.splice(idx, 1);
  
  broadcastHostList();
}

function handleVisitorSpeech(callId, text, lang) {
  const call = translatorCalls.get(callId);
  if (!call || call.status !== 'active') return;
  
  // In a real app, translate here using OpenRouter or other API
  // For now, just forward to host
  const host = availableHosts.get(call.host);
  if (host && host.socket.readyState === WebSocket.OPEN) {
    host.socket.send(JSON.stringify({ 
      type: 'visitor-speech', 
      callId, 
      text, 
      translated: text // Would be translated in production
    }));
  }
}

function handleHostSpeech(callId, text, translated) {
  const call = translatorCalls.get(callId);
  if (!call || call.status !== 'active') return;
  
  if (call.visitor && call.visitor.readyState === WebSocket.OPEN) {
    call.visitor.send(JSON.stringify({ 
      type: 'host-speech', 
      callId, 
      text, 
      translated 
    }));
  }
}

function sendHostList(socket) {
  const calls = [];
  for (const [id, call] of translatorCalls) {
    calls.push({
      id: call.id,
      visitorName: 'زائر',
      lang: call.visitorLang,
      status: call.status,
      time: new Date(call.createdAt).toLocaleTimeString('ar-MA', { hour: '2-digit', minute: '2-digit' }),
      duration: call.acceptedAt ? Math.floor((Date.now() - call.acceptedAt) / 60000) : 0
    });
  }
  socket.send(JSON.stringify({ type: 'host-list', calls }));
}

function broadcastHostList() {
  const calls = [];
  for (const [id, call] of translatorCalls) {
    calls.push({
      id: call.id,
      visitorName: 'زائر',
      lang: call.visitorLang,
      status: call.status,
      time: new Date(call.createdAt).toLocaleTimeString('ar-MA', { hour: '2-digit', minute: '2-digit' }),
      duration: call.acceptedAt ? Math.floor((call.endedAt || Date.now()) - call.acceptedAt) / 60000 : 0
    });
  }
  for (const [hostId, host] of availableHosts) {
    if (host.socket.readyState === WebSocket.OPEN) {
      host.socket.send(JSON.stringify({ type: 'host-list', calls }));
    }
  }
}

/* ─── HTTP Server ─── */
const server = http.createServer(function (req, res) {
  // Translation API (for hotel)
  if (req.url.startsWith("/api/translate")) {
    const u = new URL(req.url, "http://localhost:3000");
    const rawText = u.searchParams.get("text") || "";
    const from = u.searchParams.get("from") || "ar";
    const to = u.searchParams.get("to") || "en";
    const textToTranslate = (from === "ar-MA") ? rawText : normalizeDarija(rawText);
    fetchTranslation(textToTranslate, from, to, function (translated) {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify({ original: rawText, translated }));
    });
    return;
  }

  // Translator pages
  if (req.url === "/translator" || req.url === "/translator/") {
    req.url = "/translator.html";
  }
  if (req.url === "/translator-host" || req.url === "/translator-host/") {
    req.url = "/translator-host.html";
  }

  let filePath = path.join(__dirname, req.url === "/" ? "/index.html" : req.url);
  filePath = filePath.split("?")[0];

  const ext = path.extname(filePath);
  const mime = {
    ".html": "text/html; charset=utf-8",
    ".css":  "text/css",
    ".js":   "application/javascript",
    ".png":  "image/png",
    ".jpg":  "image/jpeg",
    ".svg":  "image/svg+xml",
    ".ico":  "image/x-icon"
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

/* ─── WebSocket Server ─── */
const wss = new WebSocket.Server({ server });

wss.on("connection", function (socket) {
  clients.set(socket, { role: null, room: "riad-room" });

  socket.on("message", function (raw) {
    let data;
    try { data = JSON.parse(raw.toString()); } catch { return; }

    const me = clients.get(socket);

    // ─── Translator Protocol ───
    if (data.type === 'create-call') {
      const callId = createCall(socket, data.lang);
      socket.callId = callId;
      me.role = 'visitor';
      return;
    }

    if (data.type === 'register-host') {
      registerHost(socket, data.hostId, data.hostName);
      me.role = 'host';
      return;
    }

    if (data.type === 'accept-call') {
      acceptCall(data.callId, data.hostId);
      return;
    }

    if (data.type === 'end-call') {
      endCall(data.callId);
      return;
    }

    if (data.type === 'visitor-speech' || data.type === 'visitor-speech-final') {
      handleVisitorSpeech(data.callId, data.text, data.lang);
      return;
    }

    if (data.type === 'host-speech') {
      handleHostSpeech(data.callId, data.text, data.translated);
      return;
    }

    // ─── Hotel Protocol (existing) ───
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
    
    // Handle translator cleanup
    if (me?.role === 'visitor' && socket.callId) {
      endCall(socket.callId);
    }
    if (me?.role === 'host' && socket.hostId) {
      const host = availableHosts.get(socket.hostId);
      if (host) { host.status = 'available'; }
      availableHosts.delete(socket.hostId);
      broadcastHostList();
    }
    
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
  if (!senderInfo) return;
  let sent = 0;
  clients.forEach(function (info, client) {
    if (client !== sender && info.room === senderInfo.room && client.readyState === WebSocket.OPEN) {
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
  console.log("   موقع الفندق    : http://localhost:3000/");
  console.log("   لوحة الفندق    : http://localhost:3000/host.html");
  console.log("   المترجم (زائر) : http://localhost:3000/translator");
  console.log("   لوحة المترجم   : http://localhost:3000/translator-host");
});
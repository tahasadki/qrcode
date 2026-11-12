# 🚀 دليل النشر الكامل - مترجم فوري مع Google OAuth

## 📋 المتطلبات المسبقة

1. **حساب GitHub** - لربط المستودع مع Vercel
2. **حساب Vercel** - للنشر المجاني (vercel.com)
3. **مشروع Firebase** - للمصادقة (console.firebase.google.com)
4. **Google Cloud Console** - لإعداد OAuth (console.cloud.google.com)

---

## 🔥 الخطوة 1: إعداد Firebase Project

### 1.1 إنشاء مشروع Firebase
```
1. اذهب إلى https://console.firebase.google.com
2. اضغط "Add project" > أدخل اسم المشروع > Continue
3. أوقف Google Analytics (اختياري) > Create project
```

### 1.2 تفعيل Authentication
```
1. في القائمة اليسرى: Authentication > Get started
2. تبويب "Sign-in method" > Google > Enable
3. أدخل "Project support email" > Save
```

### 1.3 إنشاء Web App
```
1. Project Settings (⚙️) > General > "Your apps" > </> Web
2. أدخل اسم التطبيق > Register app
3. **انسخ إعدادات firebaseConfig** - ستحتاجها لاحقاً
```

### 1.4 إنشاء Service Account (للخادم)
```
1. Project Settings > Service Accounts > Generate New Private Key
2. احفظ الملف كـ `serviceAccountKey.json` (لا ترفعه لـ GitHub!)
3. انسخ القيم الثلاث:
   - project_id
   - client_email  
   - private_key
```

### 1.5 إضافة نطاقات مسموحة لـ OAuth
```
1. Authentication > Settings > Authorized domains
2. أضف: `localhost` و `your-project.vercel.app`
```

---

## ☁️ الخطوة 2: إعداد Google Cloud Console

```
1. اذهب إلى https://console.cloud.google.com
2. اختر مشروع Firebase نفسه (أو أنشئ جديد)
3. APIs & Services > Credentials > Create Credentials > OAuth Client ID
4. Application type: Web Application
5. Name: "Translator Web Client"
6. Authorized JavaScript Origins:
   - http://localhost:3000
   - https://your-project.vercel.app
7. Authorized Redirect URIs:
   - http://localhost:3000/__/auth/handler
   - https://your-project.vercel.app/__/auth/handler
8. Create > **انسخ Client ID و Client Secret**
```

---

## 📁 الخطوة 3: تحديث الملفات المحلية

### 3.1 تحديث `index.html` - استبدل firebaseConfig:
```javascript
const firebaseConfig = {
  apiKey: "YOUR_ACTUAL_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};
```

### 3.2 إنشاء `.env.local` (للاختبار المحلي):
```bash
# انسخ من .env.example وأضف قيمك الحقيقية
NEXT_PUBLIC_FIREBASE_API_KEY=your_key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your_project_id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
NEXT_PUBLIC_FIREBASE_APP_ID=your_app_id
```

---

## 🌐 الخطوة 4: النشر على Vercel

### 4.1 رفع الكود لـ GitHub
```bash
cd C:\Users\dell\Desktop\qrcode
git init
git add .
git commit -m "Initial commit: Translator with Google OAuth"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/qrcode.git
git push -u origin main
```

### 4.2 ربط Vercel مع GitHub
```
1. اذهب إلى https://vercel.com > Add New Project
2. Import Git Repository > اختر مستودعك
3. Framework Preset: Other
4. Build Command: (اتركه فارغاً)
5. Output Directory: (اتركه فارغاً)
6. Install Command: npm install
```

### 4.3 إضافة متغيرات البيئة في Vercel
```
في Vercel Dashboard > Settings > Environment Variables، أضف:

# Firebase Client (مطلوبة للفرونت)
NEXT_PUBLIC_FIREBASE_API_KEY = your_api_key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN = your_project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID = your_project_id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET = your_project.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID = your_sender_id
NEXT_PUBLIC_FIREBASE_APP_ID = your_app_id

# Firebase Admin (مطلوبة للباكند)
FIREBASE_PROJECT_ID = your_project_id
FIREBASE_CLIENT_EMAIL = firebase-adminsdk-xxxxx@your_project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY = "-----BEGIN PRIVATE KEY-----\nYOUR_KEY\n-----END PRIVATE KEY-----\n"

⚠️ مهم: لـ FIREBASE_PRIVATE_KEY، انسخ المفتاح كاملاً مع \n كحروف حقيقية
```

### 4.4 النشر
```
اضغط Deploy > انتظر الانتهاء > ستحصل على رابط مثل:
https://qrcode-xxxxx.vercel.app
```

---

## 🧪 الخطوة 5: الاختبار

### 5.1 اختبار محلي
```bash
npm install
vercel dev
# يفتح على http://localhost:3000
```

### 5.2 اختبار الإنتاج
```
1. افتح رابط Vercel: https://your-project.vercel.app
2. اضغط "لوحة المضيف" في الأعلى
3. اضغط "تسجيل الدخول بـ Google"
4. يجب أن يعمل تسجيل الدخول وتظهر لوحة المضيف
```

---

## 🔗 الروابط النهائية

بعد النشر ستحصل على:
- **صفحة المترجم**: `https://your-project.vercel.app/`
- **لوحة المضيف**: `https://your-project.vercel.app/host`
- **API Health**: `https://your-project.vercel.app/api/health`

---

## ⚠️ ملاحظات مهمة

1. **HTTPS مطلوب**: الميكروفون و Google OAuth يعملان فقط على HTTPS (أو localhost)
2. **النطاقات المسموحة**: تأكد من إضافة نطاق Vercel في Firebase و Google Cloud
3. **مفتاح OpenRouter**: يعمل من جانب العميل، لا حاجة لإضافته في متغيرات البيئة
4. **WebSocket**: للخادم الحالي يستخدم `ws://localhost:3000` - للإنتاج ستحتاج لخادم WebSocket منفصل أو استخدام Firebase Realtime Database / Ably / Pusher

---

## 🆘 استكشاف الأخطاء

| المشكلة | الحل |
|-----------|-------|
| "Firebase: Error (auth/unauthorized-domain)" | أضف النطاق في Firebase Auth > Settings > Authorized domains |
| "Google OAuth: redirect_uri_mismatch" | أضف URI التوجيه في Google Cloud Console Credentials |
| "CORS error" | تحقق من headers في `api/index.js` |
| "Microphone not working" | تأكد من استخدام HTTPS، وأذن للمتصفح بالوصول للميكروفون |
| "Function timeout" | Vercel Hobby plan: 10s max، قلل تعقيد العمليات |

---

## 📞 الدعم

إذا واجهت مشاكل:
1. تحقق من Vercel Function Logs في Dashboard
2. تحقق من Browser Console (F12)
3. راجع Firebase Auth logs في Console

**رابط مشروعك النهائي**: `https://your-project-name.vercel.app`
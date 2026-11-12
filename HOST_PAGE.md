# حيث تجد صفحة المضيف

## الرابط (بعد النشر على Vercel):
```
https://qrcode-xsgd.vercel.app/host-login.html
```

## ما تفعله هذه الصفحة:
- تحتوي على حقل "معرف الغرفة" (Room ID)
- الزائر ينشئ غرفة من `contact.html` → يحصل على رابط مثل `call.html?room=call-xxx`
- المضيف يفتح `host-login.html` → يسجل معرف الغرفة → ينضم لنفس المكالمة

## مشكلة النشر الحالية:
الإصلاحات التي قمنا بها (firebase-config.js, call.js, call.html) **محلية فقط**. Vercel لا يزال يستخدم النسخة القديمة.

**يجب الدفع إلى GitHub أولاً:**
```bash
git add firebase-config.js call.js call.html
git commit -m "Fix Firebase config and symmetric call flow"
git push
```

ثم انتظر 1-2 دقيقة حتى ينشر Vercel تلقائياً.

## بعد النشر:
1. **حاسوب:** افتح `contact.html` → اضغط "بدء مكالمة" → انسخ الرابط
2. **هاتف:** افتح `host-login.html` → الصق معرف الغرفة → ادخل

## ملاحظة تقنية:
- الكاميرا/الميكروفون تتطلب **HTTPS** (يعمل على Vercel تلقائياً)
- يجب منح إذن المتصفح عند ظهور نافذة الإذن
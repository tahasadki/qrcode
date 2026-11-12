"use strict";

/* ══════════════════════════════════════════
  contact.js – إعدادات ومساعدات لصفحة للتواصل
   المكالمة (Audio/Video + ترجمة) مدمجة في
   contact.html مباشرة. هذا الملف يُحافظ على
   الت-compatible مع package.json main.
   ══════════════════════════════════════════ */

document.addEventListener("DOMContentLoaded", function () {
  /* فتح نافذة المكالمة عند النقر على زر "Start a Call" */
  const openCallModalBtn = document.getElementById("openCallModalBtn");
  const callModalOverlay = document.getElementById("callModalOverlay");

  if (openCallModalBtn && callModalOverlay) {
    openCallModalBtn.addEventListener("click", function () {
      callModalOverlay.classList.add("open");
    });
  }

  /* إغلاق النافذة بالنقر خارجها */
  if (callModalOverlay) {
    callModalOverlay.addEventListener("click", function (e) {
      if (e.target === callModalOverlay) {
        callModalOverlay.classList.remove("open");
      }
    });
  }

  /* ══════════════════════════════════════════
     نموذج للتواصل التقليدي (إذا وُجد)
     ══════════════════════════════════════════ */
  const contactForm = document.getElementById("contactForm");
  if (contactForm) {
    const formMessage = document.getElementById("formMessage");
    const nameInput    = document.getElementById("name");
    const emailInput   = document.getElementById("email");
    const subjectInput = document.getElementById("subject");
    const messageInput = document.getElementById("message");
    const submitButton = contactForm.querySelector(".contact-submit-button");

    contactForm.addEventListener("submit", function (event) {
      event.preventDefault();

      const name    = nameInput.value.trim();
      const email   = emailInput.value.trim();
      const subject = subjectInput.value.trim();
      const message = messageInput.value.trim();

      formMessage.textContent = "";
      formMessage.style.color = "";

      if (name === "") {
        showError("يرجى كتابة الاسم الكامل.");
        nameInput.focus();
        return;
      }

      if (email === "") {
        showError("يرجى كتابة البريد الإلكتروني.");
        emailInput.focus();
        return;
      }

      if (!isValidEmail(email)) {
        showError("يرجى إدخال بريد إلكتروني صحيح.");
        emailInput.focus();
        return;
      }

      if (subject === "") {
        showError("يرجى كتابة موضوع الرسالة.");
        subjectInput.focus();
        return;
      }

      if (message === "") {
        showError("يرجى كتابة الرسالة.");
        messageInput.focus();
        return;
      }

      const formData = {
        name: name,
        email: email,
        subject: subject,
        message: message,
        date: new Date().toISOString()
      };

      console.log("بيانات نموذم التواصل:", formData);

      submitButton.disabled = true;
      submitButton.textContent = "جارٍ إرسال الرسالة...";

      setTimeout(function () {
        showSuccess("تم إرسال رسالتك بنجاح.");
        contactForm.reset();
        submitButton.disabled = false;
        submitButton.textContent = "رسل الرسالة";
      }, 1200);
    });

    function isValidEmail(email) {
      const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      return emailPattern.test(email);
    }

    function showError(message) {
      formMessage.textContent = message;
      formMessage.style.color = "#dc2626";
    }

    function showSuccess(message) {
      formMessage.textContent = message;
      formMessage.style.color = "#16a34a";
    }
  }
});
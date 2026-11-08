"use strict";

document.addEventListener("DOMContentLoaded", function () {
  const cards = document.querySelectorAll(
    ".service-card, .gallery-item, .qr-card, .about-image, .advertisement"
  );

  const hero = document.querySelector(".hero-section, .hero-content");
  const permissionButton = document.querySelector("#motionPermission");

  let phoneMotionEnabled = false;

  /*
   * تأثير ثلاثي الأبعاد للماوس على الحاسوب
   */

  cards.forEach(function (card) {
    card.addEventListener("pointermove", function (event) {
      if (window.innerWidth <= 800) {
        return;
      }

      const rect = card.getBoundingClientRect();

      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;

      const centerX = rect.width / 2;
      const centerY = rect.height / 2;

      const rotateY = ((x - centerX) / centerX) * 7;
      const rotateX = ((centerY - y) / centerY) * 7;

      card.style.transform =
        "perspective(900px) " +
        "rotateX(" + rotateX + "deg) " +
        "rotateY(" + rotateY + "deg) " +
        "translateY(-6px) " +
        "scale(1.02)";
    });

    card.addEventListener("pointerleave", function () {
      if (phoneMotionEnabled) {
        return;
      }

      card.style.transform =
        "perspective(900px) " +
        "rotateX(0deg) " +
        "rotateY(0deg) " +
        "translateY(0) " +
        "scale(1)";
    });
  });

  /*
   * تفعيل صلاحية حركة الهاتف
   */

  if (
    typeof DeviceOrientationEvent !== "undefined" &&
    typeof DeviceOrientationEvent.requestPermission === "function"
  ) {
    if (permissionButton) {
      permissionButton.hidden = false;

      permissionButton.addEventListener("click", async function () {
        try {
          const permission =
            await DeviceOrientationEvent.requestPermission();

          if (permission === "granted") {
            startDeviceOrientation();
            permissionButton.textContent =
              "تم تفعيل الحركة";
            permissionButton.disabled = true;
          } else {
            permissionButton.textContent =
              "لم يتم السماح بالحركة";
          }
        } catch (error) {
          console.error(
            "تعذر طلب صلاحية حركة الهاتف:",
            error
          );
        }
      });
    }
  } else {
    startDeviceOrientation();
  }

  /*
   * بدء قراءة حركة الهاتف
   */

  function startDeviceOrientation() {
    if (phoneMotionEnabled) {
      return;
    }

    phoneMotionEnabled = true;

    window.addEventListener(
      "deviceorientation",
      handleDeviceOrientation,
      true
    );
  }

  /*
   * تطبيق الميلان على البطاقات والخلفية
   */

  function handleDeviceOrientation(event) {
    const gamma = Number(event.gamma) || 0;
    const beta = Number(event.beta) || 0;

    const limitedGamma = clamp(gamma, -25, 25);
    const limitedBeta = clamp(beta, -25, 25);

    const rotateY = limitedGamma * 0.28;
    const rotateX = limitedBeta * -0.18;

    cards.forEach(function (card, index) {
      const strength = index % 2 === 0 ? 1 : 0.7;

      card.style.transform =
        "perspective(900px) " +
        "rotateX(" + rotateX * strength + "deg) " +
        "rotateY(" + rotateY * strength + "deg) " +
        "translateY(-4px) " +
        "scale(1.01)";
    });

    if (hero) {
      const moveX = limitedGamma * 0.7;
      const moveY = limitedBeta * 0.25;

      hero.style.setProperty(
        "--phone-move-x",
        moveX + "px"
      );

      hero.style.setProperty(
        "--phone-move-y",
        moveY + "px"
      );
    }
  }

  /*
   * ظهور العناصر أثناء النزول
   */

  const revealElements = document.querySelectorAll(
    ".section, .service-card, .gallery-item, .contact-info-card, .contact-form-card"
  );

  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(
      function (entries, observerInstance) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("motion-visible");
            observerInstance.unobserve(entry.target);
          }
        });
      },
      {
        threshold: 0.15
      }
    );

    revealElements.forEach(function (element) {
      element.classList.add("motion-hidden");
      observer.observe(element);
    });
  } else {
    revealElements.forEach(function (element) {
      element.classList.add("motion-visible");
    });
  }

  /*
   * حماية القيم من الخروج عن النطاق
   */

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }
});
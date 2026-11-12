"use strict";

const statusText = document.getElementById("status");
const incomingCall = document.getElementById("incomingCall");
const acceptButton = document.getElementById("acceptButton");
const rejectButton = document.getElementById("rejectButton");

const socket = new WebSocket(
  "ws://" + window.location.hostname + ":3000"
);

socket.addEventListener("open", function () {
  statusText.textContent =
    "المضيف متصل وينتظر المكالمات.";
});

socket.addEventListener("error", function () {
  statusText.textContent =
    "تعذر الاتصال بالخادم. تأكد من تشغيل server-legacy.js.";
});

socket.addEventListener("close", function () {
  statusText.textContent =
    "انقطع الاتصال بالخادم.";
});

socket.addEventListener("message", function (event) {
  const data = JSON.parse(event.data);

  if (data.type === "incoming-call") {
    incomingCall.classList.add("visible");

    if (data.callMode === "video") {
      statusText.textContent =
        "مكالمة فيديو واردة.";
    } else {
      statusText.textContent =
        "مكالمة هاتفية واردة.";
    }
  }
});

acceptButton.addEventListener("click", function () {
  socket.send(JSON.stringify({
    type: "call-accepted"
  }));

  incomingCall.classList.remove("visible");
  statusText.textContent = "تم قبول المكالمة.";
});

rejectButton.addEventListener("click", function () {
  socket.send(JSON.stringify({
    type: "call-rejected"
  }));

  incomingCall.classList.remove("visible");
  statusText.textContent = "تم رفض المكالمة.";
});
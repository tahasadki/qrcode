// owner.js — Owner page logic (auth + call answering)
// Works together with call.js shared signaling and owner-config.js

import { app } from './firebase-config.js';
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  getFirestore, doc, onSnapshot, updateDoc, collection, query, where, addDoc, deleteDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { OWNER_UID } from './owner-config.js';

let db = getFirestore(app);
let auth = null;
let currentRoomId = null;
let unsubRooms = null;
let unsubRoom = null;
let unsubCandidates = null;

// ── DOM elements ────────────────────────────────────────────────
const loginForm = document.getElementById('loginForm');
const loginEmail = document.getElementById('loginEmail');
const loginPassword = document.getElementById('loginPassword');
const loginBtn = document.getElementById('loginBtn');
const loginError = document.getElementById('loginError');
const authSection = document.getElementById('authSection');
const dashboardSection = document.getElementById('dashboardSection');
const roomsList = document.getElementById('roomsList');
const noCallsMsg = document.getElementById('noCallsMsg');
const ownerVideoPanel = document.getElementById('ownerVideoPanel');
const ownerStatus = document.getElementById('ownerStatus');
const ownerStatusText = document.getElementById('ownerStatusText');
const ownerLocalVideo = document.getElementById('ownerLocalVideo');
const ownerRemoteVideo = document.getElementById('ownerRemoteVideo');
const ownerRemoteWaiting = document.getElementById('ownerRemoteWaiting');
const ownerMuteBtn = document.getElementById('ownerMuteBtn');
const ownerCameraBtn = document.getElementById('ownerCameraBtn');
const ownerEndBtn = document.getElementById('ownerEndBtn');

// ── WebRTC state ───────────────────────────────────────────────
let ownerPc = null;
let ownerLocalStream = null;
let ownerRemoteStream = null;
let ownerRemoteDescriptionSet = false;
let ownerCandidateQueue = [];
let ownerHasSentAnswer = false;
let ownerStuckTimer = null;

// ── Init ───────────────────────────────────────────────────────
async function initOwner() {
  try {
    auth = getAuth(app);
    db = getFirestore(app);

    window.__FIREBASE_AUTH__ = auth;
    window.__FIREBASE_DB__ = db;

    onAuthStateChanged(auth, (user) => {
      if (user) {
        handleAuthState(user);
      } else {
        showAuthSection();
      }
    });

    loginBtn.addEventListener('click', handleLogin);
  } catch (err) {
    console.error('[owner] Init error:', err);
    loginError.textContent = 'فشل في تهيئة النظام';
  }
}

function handleAuthState(user) {
  if (!user) return;

  if (user.uid !== OWNER_UID) {
    signOut(auth).then(() => {
      showAuthSection();
      loginError.textContent = 'غير مسموح';
    });
    return;
  }

  showDashboard();
  startWaitingRoomsListener();
}

function showAuthSection() {
  authSection.style.display = 'block';
  dashboardSection.style.display = 'none';
  ownerVideoPanel.style.display = 'none';
  loginError.textContent = '';
}

function showDashboard() {
  authSection.style.display = 'none';
  dashboardSection.style.display = 'block';
  ownerVideoPanel.style.display = 'none';
  roomsList.innerHTML = '';
  noCallsMsg.style.display = 'block';
  noCallsMsg.textContent = 'ما كاين حتى مكالمة دابا';
}

async function handleLogin(e) {
  e.preventDefault();
  const email = loginEmail.value.trim();
  const password = loginPassword.value.trim();
  loginError.textContent = '';

  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    console.error('[owner] Login error:', err);
    if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-email' || err.code === 'auth/user-not-found') {
      loginError.textContent = 'البريد الإلكتروني أو كلمة المرور غير صحيحة';
    } else if (err.code === 'auth/too-many-requests') {
      loginError.textContent = 'محاولات كثيرة جداً. جرب لاحقاً';
    } else {
      loginError.textContent = 'فشل تسجيل الدخول: ' + err.message;
    }
  }
}

// ── Waiting rooms listener ─────────────────────────────────────
function startWaitingRoomsListener() {
  const roomsRef = collection(db, 'rooms');
  const q = query(roomsRef, where('status', '==', 'waiting'));

  unsubRooms = onSnapshot(q, (snapshot) => {
    console.log('[owner] Waiting rooms snapshot received:', snapshot.size, 'rooms');
    roomsList.innerHTML = '';

    if (snapshot.empty) {
      noCallsMsg.style.display = 'block';
      noCallsMsg.textContent = 'ما كاين حتى مكالمة دابا';
      return;
    }

    noCallsMsg.style.display = 'none';
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      const roomId = docSnap.id;
      const createdAt = data.createdAt ? new Date(data.createdAt.toDate ? data.createdAt.toDate() : data.createdAt).toLocaleTimeString('ar-MA') : '';

      const item = document.createElement('div');
      item.className = 'room-item';
      item.innerHTML = `
        <div class="room-info">
          <div class="room-id">${roomId}</div>
          <div class="room-time">أنشئت: ${createdAt}</div>
        </div>
        <button class="accept-btn" data-room="${roomId}">قبول المكالمة</button>
      `;
      roomsList.appendChild(item);
    });

    document.querySelectorAll('.accept-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const roomId = e.currentTarget.dataset.room;
        acceptCall(roomId);
      });
    });

    // Visual alert when new room appears
    showNewCallToast();
  });
}

function showNewCallToast() {
  const existing = document.querySelector('.owner-new-call-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'owner-new-call-toast';
  toast.textContent = '🔔 مكالمة واردة جديدة';
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 5000);
}

// ── Accept call ────────────────────────────────────────────────
async function acceptCall(roomId) {
  currentRoomId = roomId;
  ownerHasSentAnswer = false;

  // Mark room as being answered by owner (guestJoined=true, status=connecting)
  const roomRef = doc(db, 'rooms', roomId);
  await updateDoc(roomRef, {
    guestJoined: true,
    status: 'connecting',
    updatedAt: serverTimestamp()
  });
  console.log('[owner] Marked room', roomId, 'as connecting, guestJoined=true');

  // Hide list, show video
  dashboardSection.style.display = 'none';
  ownerVideoPanel.style.display = 'block';
  ownerRemoteWaiting.style.display = 'block';
  ownerRemoteVideo.style.display = 'none';
  updateOwnerStatus('waiting', 'جاري الرد على المكالمة…');

  try {
    ownerLocalStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    ownerLocalVideo.srcObject = ownerLocalStream;
    ownerLocalVideo.style.display = 'block';
    document.getElementById('ownerLocalWaiting').style.display = 'none';
  } catch (err) {
    console.error('[owner] Media error:', err);
    updateOwnerStatus('failed', 'تعذر الوصول للكاميرا/الميكروفون');
    return;
  }

  createOwnerPeerConnection();
  startOwnerRoomListener();
  startOwnerCandidateListener();
}

async function createOwnerPeerConnection() {
  if (ownerPc) {
    ownerPc.close();
    ownerPc = null;
  }

  ownerRemoteDescriptionSet = false;
  ownerCandidateQueue = [];

  const servers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ];

  // Try to get TURN from /api/turn
  try {
    const res = await fetch('/api/turn', { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      const servers = data.iceServers || [];
      const turnServer = servers.find(s => s.urls && s.urls.toString().startsWith('turn'));
      if (turnServer) {
        servers.push({
          urls: turnServer.urls,
          username: turnServer.username,
          credential: turnServer.credential
        });
      }
    }
  } catch (err) {
    // Fall back to STUN only
  }

  ownerPc = new RTCPeerConnection({ iceServers });

  if (ownerLocalStream) {
    ownerLocalStream.getTracks().forEach(track => ownerPc.addTrack(track, ownerLocalStream));
  }

  ownerPc.ontrack = (event) => {
    if (event.streams && event.streams[0]) {
      ownerRemoteStream = event.streams[0];
      ownerRemoteVideo.srcObject = ownerRemoteStream;
      ownerRemoteVideo.style.display = 'block';
      ownerRemoteWaiting.style.display = 'none';
    }
  };

  ownerPc.onicecandidate = (event) => {
    if (event.candidate) {
      sendOwnerIceCandidate(event.candidate);
    }
  };

  ownerPc.oniceconnectionstatechange = () => {
    const state = ownerPc.iceConnectionState;
    if (state === 'connected' || state === 'completed') {
      updateOwnerStatus('connected', '🟢 متصل');
    } else if (state === 'failed') {
      updateOwnerStatus('failed', '❌ فشل الاتصال');
    }
  };
}

function startOwnerRoomListener() {
  const roomRef = doc(db, 'rooms', currentRoomId);

  unsubRoom = onSnapshot(roomRef, async (snap) => {
    if (!snap.exists()) return;
    const data = snap.data();

    if (data.status === 'ended') {
      endOwnerCall(false);
      return;
    }

    // Owner: offer exists, no answer yet → create answer
    if (data.offer && !data.answer && !ownerHasSentAnswer && !ownerRemoteDescriptionSet) {
      await handleOwnerOffer(data.offer);
    }
  });
}

async function handleOwnerOffer(offer) {
  if (ownerHasSentAnswer) return;
  ownerHasSentAnswer = true;

  updateOwnerStatus('connecting', 'جاري إنشاء الاتصال…');

  await ownerPc.setRemoteDescription(new RTCSessionDescription(offer));
  ownerRemoteDescriptionSet = true;

  flushOwnerCandidateQueue();

  const answer = await ownerPc.createAnswer();
  await ownerPc.setLocalDescription(answer);

  const roomRef = doc(db, 'rooms', currentRoomId);
  await updateDoc(roomRef, {
    answer: answer.toJSON(),
    status: 'connected',
    updatedAt: serverTimestamp()
  });

  updateOwnerStatus('connected', '🟢 متصل');
}

function startOwnerCandidateListener() {
  const candidatesRef = collection(db, 'rooms', currentRoomId, 'candidates');

  unsubCandidates = onSnapshot(candidatesRef, (snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === 'added') {
        handleOwnerRemoteCandidate(change.doc.data());
      }
    });
  });
}

function handleOwnerRemoteCandidate(candidateData) {
  // Ignore our own candidates (owner)
  if (candidateData.from === 'owner') return;

  const candidate = new RTCIceCandidate(candidateData.candidate);

  if (ownerRemoteDescriptionSet && ownerPc) {
    ownerPc.addIceCandidate(candidate).catch(err => {
      console.warn('[owner] Failed to add ICE candidate:', err);
    });
  } else {
    ownerCandidateQueue.push(candidate);
  }
}

function flushOwnerCandidateQueue() {
  if (!ownerPc || ownerCandidateQueue.length === 0) return;
  for (const candidate of ownerCandidateQueue) {
    ownerPc.addIceCandidate(candidate).catch(err => {
      console.warn('[owner] Failed to add queued ICE candidate:', err);
    });
  }
  ownerCandidateQueue = [];
}

async function sendOwnerIceCandidate(candidate) {
  const candidatesRef = collection(db, 'rooms', currentRoomId, 'candidates');
  await addDoc(candidatesRef, {
    from: 'owner',
    candidate: candidate.toJSON(),
    createdAt: serverTimestamp()
  });
}

function updateOwnerStatus(state, text) {
  ownerStatus.className = 'status-row ' + state;
  ownerStatusText.textContent = text;
}

async function endOwnerCall(notifyServer = true) {
  if (ownerStuckTimer) { clearTimeout(ownerStuckTimer); ownerStuckTimer = null; }

  if (notifyServer && currentRoomId && db) {
    const roomRef = doc(db, 'rooms', currentRoomId);
    await updateDoc(roomRef, {
      status: 'ended',
      updatedAt: serverTimestamp()
    }).catch(() => {});
  }

  if (ownerPc) { ownerPc.close(); ownerPc = null; }
  if (ownerLocalStream) { ownerLocalStream.getTracks().forEach(t => t.stop()); ownerLocalStream = null; }
  if (ownerRemoteStream) { ownerRemoteStream.getTracks().forEach(t => t.stop()); ownerRemoteStream = null; }

  ownerLocalVideo.srcObject = null;
  ownerRemoteVideo.srcObject = null;
  ownerRemoteVideo.style.display = 'none';
  ownerRemoteWaiting.style.display = 'block';
  ownerLocalVideo.style.display = 'none';
  document.getElementById('ownerLocalWaiting').style.display = 'block';

  unsubRoom?.(); unsubRoom = null;
  unsubCandidates?.(); unsubCandidates = null;

  ownerVideoPanel.style.display = 'none';
  dashboardSection.style.display = 'block';
  startWaitingRoomsListener();
}

// ── Cleanup on unload ──────────────────────────────────────────
window.addEventListener('beforeunload', () => {
  endOwnerCall(false);
});

// ── Start ─────────────────────────────────────────────────────
initOwner();
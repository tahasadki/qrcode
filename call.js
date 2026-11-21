// ============================================================
// call.js — WebRTC Video Call with Firestore Signaling
//
// Signaling flow:
//   1. joinRoom() — atomically claim role (host=create offer, guest=answer)
//   2. Host creates offer OUTSIDE transaction, writes to Firestore
//   3. Guest reads offer, creates answer, writes to Firestore
//   4. Host reads answer, sets remote description
//   5. ICE candidates exchanged via rooms/{id}/candidates subcollection
//      - Each doc: { role, candidate, createdAt }
//      - Own candidates ignored; remote candidates queued until
//        setRemoteDescription completes, then flushed.
//   6. ICE connected → call connected
//
// State machine: IDLE → WAITING → CONNECTING → CONNECTED / FAILED / ENDED
// ============================================================

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getFirestore, doc, setDoc, getDoc, onSnapshot, updateDoc,
  collection, addDoc, deleteDoc, serverTimestamp, getDocs, runTransaction
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// ── Firebase config (single source: firebase-config.js) ─────────
const firebaseConfig = window.__FIREBASE_CONFIG__;

if (!firebaseConfig) {
  console.error('[call.js] Firebase config not found — load firebase-config.js before call.js');
}

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// ── TURN credentials ────────────────────────────────────────────
// Fetched from Vercel serverless endpoint (/api/turn) before creating the PC.
// Falls back to <meta> tags or window.__TURN_*__ globals.
let turnCredentials = null;
let stuckTimer = null;

async function fetchTurnCredentials() {
  try {
    const res = await fetch('/api/turn', { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      const servers = data.iceServers || [];
      const turnServer = servers.find(s => s.urls && s.urls.toString().startsWith('turn'));
      if (turnServer) {
        turnCredentials = {
          url: turnServer.urls,
          username: turnServer.username,
          credential: turnServer.credential
        };
        log('TURN credentials fetched from /api/turn');
        return;
      }
    }
  } catch (err) {
    log('TURN endpoint unavailable:', err.message);
  }

  // Fallback: meta tags or globals
  const turnUrl = getMeta('turn-url') || window.__TURN_URL__;
  const turnUser = getMeta('turn-username') || window.__TURN_USERNAME__;
  const turnCred = getMeta('turn-credential') || window.__TURN_CREDENTIAL__;

  if (turnUrl && turnUser && turnCred) {
    turnCredentials = { url: turnUrl, username: turnUser, credential: turnCred };
    log('TURN credentials from meta tags / globals');
    return;
  }

  log('No TURN credentials available — STUN only');
  turnCredentials = null;
}

function getMeta(name) {
  const el = document.querySelector(`meta[name="${name}"]`);
  return el ? el.getAttribute('content') : null;
}

function buildIceServers() {
  const servers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ];

  if (turnCredentials) {
    servers.push({
      urls: turnCredentials.url,
      username: turnCredentials.username,
      credential: turnCredentials.credential
    });
    log('TURN server configured');
  } else {
    log('No TURN server — STUN only (may fail on 4G/strict NAT)');
  }

  return servers;
}

// ── DOM Elements ────────────────────────────────────────────────
const roomBadge = document.getElementById('roomBadge');
const roomIdDisplay = document.getElementById('roomIdDisplay');
const connStateDisplay = document.getElementById('connStateDisplay');
const remoteVideo = document.getElementById('remoteVideo');
const remoteWaiting = document.getElementById('remoteWaiting');
const localVideo = document.getElementById('localVideo');
const localWaiting = document.getElementById('localWaiting');
const statusRow = document.getElementById('statusRow');
const statusText = document.getElementById('statusText');
const callControls = document.getElementById('callControls');
const preCallControls = document.getElementById('preCallControls');
const muteBtn = document.getElementById('muteBtn');
const cameraBtn = document.getElementById('cameraBtn');
const endBtn = document.getElementById('endBtn');
const copyLinkBtn = document.getElementById('copyLinkBtn');
const captionArea = document.getElementById('captionArea');
const retryBtn = document.getElementById('retryBtn');

// ── State ───────────────────────────────────────────────────────
let roomId = null;
let myRole = null;           // "host" | "guest"
let pc = null;
let localStream = null;
let remoteStream = null;
let unsubRoom = null;
let unsubCandidates = null;
let muted = false;
let cameraOff = false;

let remoteDescriptionSet = false;
let candidateQueue = [];

const State = {
  IDLE: 'idle',
  WAITING: 'waiting',
  PEER_JOINED: 'peer-joined',
  CONNECTING: 'connecting',
  ICE_CHECKING: 'ice-checking',
  CONNECTED: 'connected',
  FAILED: 'failed',
  ENDED: 'ended'
};
let callState = State.IDLE;

// ── Logging ─────────────────────────────────────────────────────
function log(...args) {
  console.log('[call.js]', ...args);
}

// ── Room ID ─────────────────────────────────────────────────────
function getRoomIdFromUrl() {
  return new URLSearchParams(window.location.search).get('room');
}

function generateRoomId() {
  return 'call-' + Date.now().toString(36) + '-' + Math.random().toString(36).substr(2, 9);
}

// ── Init ────────────────────────────────────────────────────────
async function init() {
  roomId = getRoomIdFromUrl();
  if (!roomId) {
    roomId = generateRoomId();
    window.history.replaceState({}, '', `${window.location.pathname}?room=${roomId}`);
  }

  roomBadge.textContent = `الغرفة: ${roomId}`;
  roomIdDisplay.textContent = roomId;

  // Fetch TURN credentials before anything else
  turnCredentials = await fetchTurnCredentials();

  await setupLocalStream();
  await joinRoom();

  // Stuck-state timeout: if still waiting after 60s, show message and end room
  stuckTimer = setTimeout(() => {
    if (callState === State.WAITING || callState === State.PEER_JOINED) {
      log('Stuck timeout: no peer joined within 60s');
      updateStatus('failed', '❌ تأخر الاتصال — لم ينضم طرف ثاني');
      showRetryButton();
    }
  }, 60000);

  muteBtn.addEventListener('click', toggleMute);
  cameraBtn.addEventListener('click', toggleCamera);
  endBtn.addEventListener('click', () => endCall(true));
  copyLinkBtn.addEventListener('click', copyRoomLink);
  if (retryBtn) retryBtn.addEventListener('click', retryCall);

  window.addEventListener('beforeunload', cleanup);
}

// ── Local media ─────────────────────────────────────────────────
async function setupLocalStream() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: true
    });
    localVideo.srcObject = localStream;
    localVideo.style.display = 'block';
    localWaiting.style.display = 'none';
    showToast('تم الوصول للكاميرا والميكروفون');
    log('Local media acquired');
  } catch (err) {
    console.error('Media access error:', err);
    localWaiting.innerHTML = '<div class="icon">⚠️</div><span>تعذر الوصول للكاميرا/الميكروفون</span>';
    showToast('تعذر الوصول للكاميرا أو الميكروفون: ' + err.message);
  }
}

// ── Join room (role claiming) ───────────────────────────────────
async function joinRoom() {
  const roomRef = doc(db, 'rooms', roomId);
  let existingData = null;

  try {
    await runTransaction(db, async (transaction) => {
      const roomSnap = await transaction.get(roomRef);

      if (!roomSnap.exists()) {
        // First participant — create room, become host
        myRole = 'host';
        transaction.set(roomRef, {
          status: 'waiting',
          hostJoined: true,
          guestJoined: false,
          offer: null,
          answer: null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        log('Created room as HOST');
      } else {
        existingData = roomSnap.data();
        const { status, hostJoined, guestJoined } = existingData;

        if (status === 'ended' || (!hostJoined && !guestJoined)) {
          // Room ended or empty — reclaim as host
          myRole = 'host';
          transaction.update(roomRef, {
            status: 'waiting',
            hostJoined: true,
            guestJoined: false,
            offer: null,
            answer: null,
            updatedAt: serverTimestamp()
          });
          log('Reclaimed ended/empty room as HOST');
        } else if (hostJoined && !guestJoined) {
          // Host present, guest slot free — become guest
          myRole = 'guest';
          transaction.update(roomRef, {
            guestJoined: true,
            updatedAt: serverTimestamp()
          });
          log('Joined room as GUEST');
        } else if (!hostJoined && guestJoined) {
          // Guest present, host slot free — become host
          myRole = 'host';
          transaction.update(roomRef, {
            hostJoined: true,
            updatedAt: serverTimestamp()
          });
          log('Joined room as HOST (guest was waiting)');
        } else {
          // Both slots taken — refresh mid-call scenario.
          // Don't reset offer/answer; try to infer role from signaling state.
          if (existingData.offer && !existingData.answer) {
            myRole = 'host';
            transaction.update(roomRef, {
              hostJoined: true,
              updatedAt: serverTimestamp()
            });
            log('Rejoined as HOST (offer present, no answer)');
          } else {
            myRole = 'guest';
            transaction.update(roomRef, {
              guestJoined: true,
              updatedAt: serverTimestamp()
            });
            log('Rejoined as GUEST (both slots taken)');
          }
        }
      }
    });
  } catch (err) {
    console.error('Failed to join room:', err);
    showToast('فشل الانضمام للغرفة');
    return;
  }

  log('My role:', myRole, '| existing offer:', !!existingData?.offer, '| existing answer:', !!existingData?.answer);
  setCallState(State.WAITING);

  // Clear stale candidates from previous sessions
  await clearCandidates();

  // Host: create offer outside the transaction
  if (myRole === 'host') {
    await createAndSendOffer();
  } else if (existingData?.offer && !remoteDescriptionSet) {
    // Guest rejoining mid-call with an existing offer — handle it
    await handleOffer(existingData.offer);
  }

  startRoomListener();
  startCandidateListener();
}

// ── Clear old ICE candidates ────────────────────────────────────
async function clearCandidates() {
  try {
    const candidatesRef = collection(db, 'rooms', roomId, 'candidates');
    const snap = await getDocs(candidatesRef);
    const deletes = snap.docs.map(d => deleteDoc(d.ref));
    await Promise.all(deletes);
    log('Cleared', snap.size, 'stale candidates');
  } catch (err) {
    console.warn('Failed to clear candidates:', err);
  }
}

// ── Peer Connection ─────────────────────────────────────────────
function createPeerConnection() {
  if (pc) {
    log('Closing previous RTCPeerConnection');
    pc.close();
    pc = null;
  }

  remoteDescriptionSet = false;
  candidateQueue = [];

  const iceServers = buildIceServers();
  pc = new RTCPeerConnection({ iceServers });
  log('Created new RTCPeerConnection');

  if (localStream) {
    localStream.getTracks().forEach(track => {
      pc.addTrack(track, localStream);
    });
  }

  pc.ontrack = (event) => {
    if (event.streams && event.streams[0]) {
      remoteStream = event.streams[0];
      remoteVideo.srcObject = remoteStream;
      remoteVideo.style.display = 'block';
      remoteWaiting.style.display = 'none';
      log('Remote track received');
    }
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      sendIceCandidate(event.candidate);
    }
  };

  pc.oniceconnectionstatechange = () => {
    const state = pc.iceConnectionState;
    log('ICE connection state:', state);
    connStateDisplay.textContent = state;

    if (state === 'checking') {
      setCallState(State.ICE_CHECKING);
    } else if (state === 'connected' || state === 'completed') {
      setCallState(State.CONNECTED);
    } else if (state === 'disconnected') {
      setCallState(State.CONNECTING);
      updateStatus('connecting', '🔄 إعادة الاتصال…');
    } else if (state === 'failed') {
      setCallState(State.FAILED);
    }
  };

  pc.onconnectionstatechange = () => {
    log('Connection state:', pc.connectionState);
    if (pc.connectionState === 'failed') {
      setCallState(State.FAILED);
    }
  };

  return pc;
}

// ── Create Offer (host) ─────────────────────────────────────────
async function createAndSendOffer() {
  log('Creating offer...');
  setCallState(State.WAITING);

  createPeerConnection();
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  log('Local description set (offer)');

  const roomRef = doc(db, 'rooms', roomId);
  await updateDoc(roomRef, {
    offer: offer.toJSON(),
    answer: null,
    status: 'waiting',
    updatedAt: serverTimestamp()
  });

  updateStatus('waiting', 'في انتظار الطرف الآخر…');
  log('Offer sent to Firestore');
}

// ── Handle Offer (guest) ────────────────────────────────────────
async function handleOffer(offer) {
  log('Handling offer...');
  setCallState(State.CONNECTING);
  updateStatus('connecting', 'جاري الاتصال…');

  createPeerConnection();
  await pc.setRemoteDescription(new RTCSessionDescription(offer));
  remoteDescriptionSet = true;
  log('Remote description set (offer)');

  flushCandidateQueue();

  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  log('Local description set (answer)');

  const roomRef = doc(db, 'rooms', roomId);
  await updateDoc(roomRef, {
    answer: answer.toJSON(),
    status: 'connected',
    updatedAt: serverTimestamp()
  });

  log('Answer sent to Firestore');
}

// ── Handle Answer (host) ────────────────────────────────────────
async function handleAnswer(answer) {
  if (!pc || pc.signalingState !== 'have-local-offer') {
    log('Ignoring answer — wrong signaling state:', pc?.signalingState);
    return;
  }

  log('Handling answer...');
  setCallState(State.CONNECTING);
  updateStatus('connecting', 'جاري الاتصال…');

  await pc.setRemoteDescription(new RTCSessionDescription(answer));
  remoteDescriptionSet = true;
  log('Remote description set (answer)');

  flushCandidateQueue();
}

// ── ICE Candidates ──────────────────────────────────────────────
async function sendIceCandidate(candidate) {
  const candidatesRef = collection(db, 'rooms', roomId, 'candidates');
  await addDoc(candidatesRef, {
    role: myRole,
    candidate: candidate.toJSON(),
    createdAt: serverTimestamp()
  });
}

function handleRemoteCandidate(candidateData) {
  // Ignore our own candidates
  if (candidateData.role === myRole) {
    return;
  }

  const candidate = new RTCIceCandidate(candidateData.candidate);

  if (remoteDescriptionSet && pc) {
    pc.addIceCandidate(candidate).catch(err => {
      console.warn('Failed to add ICE candidate:', err);
    });
  } else {
    candidateQueue.push(candidate);
    log('Queued ICE candidate (remote desc not set yet). Queue size:', candidateQueue.length);
  }
}

function flushCandidateQueue() {
  if (!pc || candidateQueue.length === 0) return;
  log('Flushing', candidateQueue.length, 'queued ICE candidates');
  for (const candidate of candidateQueue) {
    pc.addIceCandidate(candidate).catch(err => {
      console.warn('Failed to add queued ICE candidate:', err);
    });
  }
  candidateQueue = [];
}

// ── Room Listener ───────────────────────────────────────────────
function startRoomListener() {
  const roomRef = doc(db, 'rooms', roomId);

  unsubRoom = onSnapshot(roomRef, async (snap) => {
    if (!snap.exists()) {
      log('Room deleted');
      return;
    }
    const data = snap.data();
    log('Room snapshot — status:', data.status, 'hasOffer:', !!data.offer, 'hasAnswer:', !!data.answer);

    if (data.status === 'ended') {
      if (callState === State.CONNECTED || callState === State.CONNECTING) {
        showToast('أنهى الطرف الآخر المكالمة');
        endCall(false);
      }
      return;
    }

    // Guest: handle offer if not yet processed
    if (myRole === 'guest' && data.offer && !remoteDescriptionSet && callState !== State.CONNECTING) {
      await handleOffer(data.offer);
      return;
    }

    // Host: handle answer if waiting for it
    if (myRole === 'host' && data.answer && pc && pc.signalingState === 'have-local-offer') {
      await handleAnswer(data.answer);
      return;
    }

    // Peer joined (room went from waiting to having both participants)
    if (data.hostJoined && data.guestJoined && callState === State.WAITING) {
      setCallState(State.PEER_JOINED);
      updateStatus('peer-joined', 'انضم الطرف الآخر…');
      log('Peer joined');
    }

    // Other party left (room reset to waiting while we're connected)
    if (data.status === 'waiting' && callState === State.CONNECTED) {
      log('Other party left — resetting for new connection');
      resetForNewCall();
      if (myRole === 'host') {
        await clearCandidates();
        await createAndSendOffer();
      }
    }
  });
}

// ── Candidate Listener ──────────────────────────────────────────
function startCandidateListener() {
  const candidatesRef = collection(db, 'rooms', roomId, 'candidates');

  unsubCandidates = onSnapshot(candidatesRef, (snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === 'added') {
        handleRemoteCandidate(change.doc.data());
      }
    });
  });
}

// ── State Machine ───────────────────────────────────────────────
function setCallState(newState) {
  log('State:', callState, '→', newState);
  callState = newState;

  switch (newState) {
    case State.WAITING:
      updateStatus('waiting', 'في انتظار الطرف الآخر…');
      callControls.style.display = 'none';
      preCallControls.style.display = 'flex';
      hideRetryButton();
      break;

    case State.PEER_JOINED:
      updateStatus('peer-joined', 'انضم الطرف الآخر — جاري إنشاء الاتصال…');
      hideRetryButton();
      break;

    case State.CONNECTING:
      updateStatus('connecting', 'جاري الاتصال…');
      hideRetryButton();
      break;

    case State.ICE_CHECKING:
      updateStatus('ice-checking', 'جاري فحص المسار…');
      hideRetryButton();
      break;

    case State.CONNECTED:
      if (stuckTimer) { clearTimeout(stuckTimer); stuckTimer = null; }
      updateStatus('connected', '🟢 متصل');
      callControls.style.display = 'flex';
      preCallControls.style.display = 'none';
      captionArea?.classList.add('visible');
      hideRetryButton();
      break;

    case State.FAILED:
      if (stuckTimer) { clearTimeout(stuckTimer); stuckTimer = null; }
      updateStatus('failed', '❌ فشل الاتصال، جرب مرة أخرى');
      showRetryButton();
      break;

    case State.ENDED:
      if (stuckTimer) { clearTimeout(stuckTimer); stuckTimer = null; }
      updateStatus('ended', 'انتهت المكالمة');
      callControls.style.display = 'none';
      preCallControls.style.display = 'flex';
      hideRetryButton();
      break;
  }
}

function showRetryButton() {
  if (retryBtn) retryBtn.style.display = 'inline-flex';
}

function hideRetryButton() {
  if (retryBtn) retryBtn.style.display = 'none';
}

// ── Retry ───────────────────────────────────────────────────────
async function retryCall() {
  log('Retrying call...');
  resetForNewCall();
  await clearCandidates();

  const roomRef = doc(db, 'rooms', roomId);
  await updateDoc(roomRef, {
    offer: null,
    answer: null,
    status: 'waiting',
    updatedAt: serverTimestamp()
  });

  if (myRole === 'host') {
    await createAndSendOffer();
  } else {
    setCallState(State.WAITING);
  }
}

// ── Reset ───────────────────────────────────────────────────────
function resetForNewCall() {
  if (stuckTimer) { clearTimeout(stuckTimer); stuckTimer = null; }
  if (pc) { pc.close(); pc = null; }
  remoteDescriptionSet = false;
  candidateQueue = [];
  remoteVideo.style.display = 'none';
  remoteWaiting.style.display = 'block';
  captionArea?.classList.remove('visible');
  setCallState(State.WAITING);
}

// ── UI controls ─────────────────────────────────────────────────
function toggleMute() {
  if (!localStream) return;
  muted = !muted;
  localStream.getAudioTracks().forEach(track => track.enabled = !muted);
  muteBtn.textContent = muted ? '🔇 رفع الكتم' : '🎤 كتم';
  muteBtn.classList.toggle('active', muted);
}

function toggleCamera() {
  if (!localStream) return;
  cameraOff = !cameraOff;
  localStream.getVideoTracks().forEach(track => track.enabled = !cameraOff);
  cameraBtn.textContent = cameraOff ? '📷 تشغيل الكاميرا' : '📷 إيقاف الكاميرا';
  cameraBtn.classList.toggle('active', cameraOff);
  localVideo.style.display = cameraOff ? 'none' : 'block';
  localWaiting.style.display = cameraOff ? 'block' : 'none';
}

function copyRoomLink() {
  navigator.clipboard.writeText(window.location.href).then(() => {
    showToast('تم نسخ رابط الغرفة');
  }).catch(() => {
    showToast('فشل النسخ');
  });
}

// ── End Call ────────────────────────────────────────────────────
async function endCall(notifyServer = true) {
  log('Ending call. Notify server:', notifyServer);
  setCallState(State.ENDED);

  if (notifyServer && roomId) {
    const roomRef = doc(db, 'rooms', roomId);
    await updateDoc(roomRef, {
      status: 'ended',
      offer: null,
      answer: null,
      hostJoined: false,
      guestJoined: false,
      updatedAt: serverTimestamp()
    }).catch(() => {});

    await clearCandidates();
  }

  cleanup();
  showToast('انتهت المكالمة');
  setTimeout(() => { window.location.href = 'index.html'; }, 1500);
}

// ── Cleanup ─────────────────────────────────────────────────────
function cleanup() {
  if (unsubRoom) { unsubRoom(); unsubRoom = null; }
  if (unsubCandidates) { unsubCandidates(); unsubCandidates = null; }
  if (pc) { pc.close(); pc = null; }
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  if (remoteStream) { remoteStream.getTracks().forEach(t => t.stop()); remoteStream = null; }

  localVideo.srcObject = null;
  remoteVideo.srcObject = null;
  localVideo.style.display = 'none';
  remoteVideo.style.display = 'none';
  localWaiting.style.display = 'block';
  remoteWaiting.style.display = 'block';

  callControls.style.display = 'none';
  preCallControls.style.display = 'flex';
  captionArea?.classList.remove('visible');
}

// ── UI Helpers ──────────────────────────────────────────────────
function updateStatus(state, text) {
  statusRow.className = 'status-row ' + state;
  statusText.textContent = text;
}

function showToast(msg) {
  const existing = document.querySelector('.error-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'error-toast';
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// ── Start ───────────────────────────────────────────────────────
init();
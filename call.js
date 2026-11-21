// ============================================================
// call.js — WebRTC Video Call with Firestore Signaling (Tourist page)
//
// Role: tourist (creates room + offer, waits for answer, then ICE)
//
// Signaling flow:
//   1. Tourist creates room with status "waiting", guestJoined=false
//   2. Tourist creates offer, writes offer to rooms/{roomId}
//   3. Owner answers: setRemoteDescription(offer), createAnswer, writes answer
//   4. ICE candidates exchanged via rooms/{id}/candidates subcollection
//      - Each doc: { from, candidate, createdAt }
//      - Ignore own candidates; buffer until remoteDescription set.
//   5. ICE connected → call connected
//
// State machine: waiting -> connecting -> connected
// ============================================================

import { app } from './firebase-config.js';
import { hangup } from './signaling.js';
import {
  getFirestore, doc, setDoc, getDoc, onSnapshot, updateDoc,
  collection, addDoc, deleteDoc, serverTimestamp, getDocs, runTransaction
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// ── Page type (tourist | owner) ─────────────────────────────────
const PAGE_TYPE = window.__PAGE_TYPE__ || 'tourist';

// ── Firebase config (single source: firebase-config.js) ─────────
const db = getFirestore(app);

// ── TURN credentials ────────────────────────────────────────────
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
        log('[call] TURN credentials fetched from /api/turn');
        return;
      }
    }
  } catch (err) {
    log('[call] TURN endpoint unavailable:', err.message);
  }

  const turnUrl = getMeta('turn-url') || window.__TURN_URL__;
  const turnUser = getMeta('turn-username') || window.__TURN_USERNAME__;
  const turnCred = getMeta('turn-credential') || window.__TURN_CREDENTIAL__;

  if (turnUrl && turnUser && turnCred) {
    turnCredentials = { url: turnUrl, username: turnUser, credential: turnCred };
    log('[call] TURN credentials from meta tags / globals');
    return;
  }

  log('[call] No TURN credentials available — STUN only');
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
    log('[call] TURN server configured');
  } else {
    log('[call] No TURN server — STUN only (may fail on 4G/strict NAT)');
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
let myRole = PAGE_TYPE;           // "tourist" | "owner"
let pc = null;
let localStream = null;
let remoteStream = null;
let unsubRoom = null;
let unsubCandidates = null;
let muted = false;
let cameraOff = false;

let remoteDescriptionSet = false;
let candidateQueue = [];
let hasSentOffer = false;
let hasSentAnswer = false;

const State = {
  WAITING: 'waiting',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  FAILED: 'failed',
  ENDED: 'ended'
};
let callState = State.WAITING;

// ── Logging ─────────────────────────────────────────────────────
function log(...args) {
  console.log('[call]', ...args);
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

  // Attach room listener BEFORE claiming role
  startRoomListener();

  // Fetch TURN credentials before anything else
  turnCredentials = await fetchTurnCredentials();

  await setupLocalStream();
  await joinRoom();

  // Stuck-state timeout: if still waiting after 60s, show message and end room
  stuckTimer = setTimeout(() => {
    if (callState === State.WAITING) {
      log('[call] Stuck timeout: no peer joined within 60s');
      updateStatus('failed', '❌ تأخر الاتصال — لم ينضم طرف ثاني');
      showRetryButton();
    }
  }, 60000);

  // Shared teardown context: proxies this page's live call state so hangup
  // always reads the current pc / streams / unsubs / roomId.
  const ctx = {
    hungUp: false,
    db,
    get pc() { return pc; },
    set pc(v) { pc = v; },
    get localStream() { return localStream; },
    set localStream(v) { localStream = v; },
    get remoteStream() { return remoteStream; },
    set remoteStream(v) { remoteStream = v; },
    get unsubRoom() { return unsubRoom; },
    set unsubRoom(v) { unsubRoom = v; },
    get unsubCandidates() { return unsubCandidates; },
    set unsubCandidates(v) { unsubCandidates = v; },
    get roomId() { return roomId; },
    set roomId(v) { roomId = v; },
    localVideo,
    remoteVideo,
    statusText,
    onEnded(reason) { endTouristUI(reason); }
  };

  muteBtn.addEventListener('click', toggleMute);
  cameraBtn.addEventListener('click', toggleCamera);
  endBtn.addEventListener('click', () => hangup('user-ended', ctx));
  copyLinkBtn.addEventListener('click', copyRoomLink);
  if (retryBtn) retryBtn.addEventListener('click', retryCall);

  window.addEventListener('pagehide', () => hangup('page-closed', ctx));
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
    log('[call] Local media acquired');
  } catch (err) {
    console.error('[call] Media access error:', err);
    localWaiting.innerHTML = '<div class="icon">⚠️</div><span>تعذر الوصول للكاميرا/الميكروفون</span>';
    showToast('تعذر الوصول للكاميرا أو الميكروفون: ' + err.message);
  }
}

// ── Join room (tourist creates room) ────────────────────────────
async function joinRoom() {
  const roomRef = doc(db, 'rooms', roomId);

  try {
    await runTransaction(db, async (transaction) => {
      const roomSnap = await transaction.get(roomRef);

      if (!roomSnap.exists()) {
        // Tourist creates room with status "waiting", guestJoined=false
        myRole = 'tourist';
        transaction.set(roomRef, {
          status: 'waiting',
          hostJoined: true,
          guestJoined: false,
          offer: null,
          answer: null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        log('[call] Created room as TOURIST');
      } else {
        const data = roomSnap.data();
        const { status, hostJoined, guestJoined } = data;

        if (status === 'ended' || (!hostJoined && !guestJoined)) {
          // Room ended or empty — reclaim as tourist
          myRole = 'tourist';
          transaction.update(roomRef, {
            status: 'waiting',
            hostJoined: true,
            guestJoined: false,
            offer: null,
            answer: null,
            updatedAt: serverTimestamp()
          });
          log('[call] Reclaimed ended/empty room as TOURIST');
        } else if (hostJoined && !guestJoined) {
          // Tourist present, owner slot free — become owner
          myRole = 'owner';
          transaction.update(roomRef, {
            guestJoined: true,
            updatedAt: serverTimestamp()
          });
          log('[call] Joined room as OWNER');
        } else if (!hostJoined && guestJoined) {
          // Owner present, tourist slot free — become tourist
          myRole = 'tourist';
          transaction.update(roomRef, {
            hostJoined: true,
            updatedAt: serverTimestamp()
          });
          log('[call] Joined room as TOURIST (owner was waiting)');
        } else {
          // Both slots taken — refresh mid-call scenario
          myRole = 'owner';
          transaction.update(roomRef, {
            guestJoined: true,
            updatedAt: serverTimestamp()
          });
          log('[call] Rejoined as OWNER (both slots taken)');
        }
      }
    });
  } catch (err) {
    console.error('[call] Failed to join room:', err);
    showToast('فشل الانضمام للغرفة');
    return;
  }

  log('[call] My role:', myRole);

  // Clear stale candidates from previous sessions
  await clearCandidates();

  // Tourist: offer is created by the room listener when guestJoined becomes true.
  // Do NOT create the offer here — the owner must accept first.

  startCandidateListener();
}

// ── Clear old ICE candidates ────────────────────────────────────
async function clearCandidates() {
  try {
    const candidatesRef = collection(db, 'rooms', roomId, 'candidates');
    const snap = await getDocs(candidatesRef);
    const deletes = snap.docs.map(d => deleteDoc(d.ref));
    await Promise.all(deletes);
    log('[call] Cleared', snap.size, 'stale candidates');
  } catch (err) {
    console.warn('[call] Failed to clear candidates:', err);
  }
}

// ── Peer Connection ─────────────────────────────────────────────
function createPeerConnection() {
  if (pc) {
    log('[call] Closing previous RTCPeerConnection');
    pc.close();
    pc = null;
  }

  remoteDescriptionSet = false;
  candidateQueue = [];

  const iceServers = buildIceServers();
  pc = new RTCPeerConnection({ iceServers });
  log('[call] Created new RTCPeerConnection');

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
      log('[call] Remote track received');
    }
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      sendIceCandidate(event.candidate);
    }
  };

  pc.oniceconnectionstatechange = () => {
    const state = pc.iceConnectionState;
    log('[call] ICE connection state:', state);
    connStateDisplay.textContent = state;

    if (state === 'checking') {
      setCallState(State.CONNECTING);
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
    log('[call] Connection state:', pc.connectionState);
    if (pc.connectionState === 'failed') {
      setCallState(State.FAILED);
    }
  };

  return pc;
}

// ── Create Offer (tourist) ──────────────────────────────────────
async function createAndSendOffer() {
  if (hasSentOffer) return;
  hasSentOffer = true;

  log('[call] Creating offer...');
  setCallState(State.WAITING);

  createPeerConnection();
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  log('[call] Local description set (offer)');

  const roomRef = doc(db, 'rooms', roomId);
  await updateDoc(roomRef, {
    offer: offer.toJSON(),
    answer: null,
    status: 'connecting',
    updatedAt: serverTimestamp()
  });

  updateStatus('connecting', 'جاري الاتصال…');
  log('[call] Offer sent to Firestore, status=connecting');
}

// ── Handle Offer (owner) ────────────────────────────────────────
async function handleOffer(offer) {
  if (hasSentAnswer) return;

  log('[call] Handling offer...');
  setCallState(State.CONNECTING);
  updateStatus('connecting', 'جاري الاتصال…');

  createPeerConnection();
  await pc.setRemoteDescription(new RTCSessionDescription(offer));
  remoteDescriptionSet = true;
  log('[call] Remote description set (offer)');

  flushCandidateQueue();

  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  log('[call] Local description set (answer)');

  const roomRef = doc(db, 'rooms', roomId);
  await updateDoc(roomRef, {
    answer: answer.toJSON(),
    status: 'connected',
    updatedAt: serverTimestamp()
  });

  log('[call] Answer sent to Firestore, status=connected');
}

// ── Handle Answer (tourist) ─────────────────────────────────────
async function handleAnswer(answer) {
  if (!pc || pc.signalingState !== 'have-local-offer') {
    log('[call] Ignoring answer — wrong signaling state:', pc?.signalingState);
    return;
  }

  log('[call] Handling answer...');
  setCallState(State.CONNECTING);
  updateStatus('connecting', 'جاري الاتصال…');

  await pc.setRemoteDescription(new RTCSessionDescription(answer));
  remoteDescriptionSet = true;
  log('[call] Remote description set (answer)');

  flushCandidateQueue();
}

// ── ICE Candidates ──────────────────────────────────────────────
async function sendIceCandidate(candidate) {
  const candidatesRef = collection(db, 'rooms', roomId, 'candidates');
  await addDoc(candidatesRef, {
    from: myRole,
    candidate: candidate.toJSON(),
    createdAt: serverTimestamp()
  });
}

function handleRemoteCandidate(candidateData) {
  // Ignore our own candidates
  if (candidateData.from === myRole) {
    return;
  }

  const candidate = new RTCIceCandidate(candidateData.candidate);

  if (remoteDescriptionSet && pc) {
    pc.addIceCandidate(candidate).catch(err => {
      console.warn('[call] Failed to add ICE candidate:', err);
    });
  } else {
    candidateQueue.push(candidate);
    log('[call] Queued ICE candidate (remote desc not set yet). Queue size:', candidateQueue.length);
  }
}

function flushCandidateQueue() {
  if (!pc || candidateQueue.length === 0) return;
  log('[call] Flushing', candidateQueue.length, 'queued ICE candidates');
  for (const candidate of candidateQueue) {
    pc.addIceCandidate(candidate).catch(err => {
      console.warn('[call] Failed to add queued ICE candidate:', err);
    });
  }
  candidateQueue = [];
}

// ── Room Listener (drives the state machine) ────────────────────
function startRoomListener() {
  const roomRef = doc(db, 'rooms', roomId);

  unsubRoom = onSnapshot(roomRef, async (snap) => {
    if (!snap.exists()) {
      log('[call] Room deleted');
      return;
    }
    const data = snap.data();
    log('[call] Room snapshot — status:', data.status, 'hasOffer:', !!data.offer, 'hasAnswer:', !!data.answer, 'guestJoined:', !!data.guestJoined, 'hostJoined:', !!data.hostJoined);

    if (data.status === 'ended') {
      // Remote side (or a reload of this page) ended the room. Close fully on
      // this side too. ctx.hungUp makes this a no-op if we already hung up.
      hangup('remote-ended', ctx);
      return;
    }

    // Tourist: guest joined and no offer yet → create offer
    if (myRole === 'tourist' && data.guestJoined && !data.offer && !hasSentOffer) {
      await createAndSendOffer();
      return;
    }

    // Tourist: answer appeared and we're waiting for it
    if (myRole === 'tourist' && data.answer && !remoteDescriptionSet && pc && pc.signalingState === 'have-local-offer') {
      await handleAnswer(data.answer);
      return;
    }

    // Owner: offer appeared and no answer yet → create answer
    if (myRole === 'owner' && data.offer && !data.answer && !hasSentAnswer && !remoteDescriptionSet) {
      await handleOffer(data.offer);
      return;
    }

    // Other party left (room reset to waiting while we're connected)
    if (data.status === 'waiting' && callState === State.CONNECTED) {
      log('[call] Other party left — resetting for new connection');
      resetForNewCall();
      if (myRole === 'tourist') {
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
  log('[call] State:', callState, '→', newState);
  callState = newState;

  switch (newState) {
    case State.WAITING:
      updateStatus('waiting', 'في انتظار الطرف الآخر…');
      callControls.style.display = 'none';
      preCallControls.style.display = 'flex';
      hideRetryButton();
      break;

    case State.CONNECTING:
      updateStatus('connecting', 'جاري الاتصال…');
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
  log('[call] Retrying call...');
  resetForNewCall();
  await clearCandidates();

  const roomRef = doc(db, 'rooms', roomId);
  await updateDoc(roomRef, {
    offer: null,
    answer: null,
    status: 'waiting',
    updatedAt: serverTimestamp()
  });

  if (myRole === 'tourist') {
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
  hasSentOffer = false;
  hasSentAnswer = false;
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

// ── Ended UI (tourist) ──────────────────────────────────────────
function endTouristUI(reason) {
  log('[call] Ended UI. Reason:', reason);
  setCallState(State.ENDED);   // status 'انتهت المكالمة', hides call controls, shows pre-call controls
  showToast('انتهت المكالمة');
  // The back-link '← العودة للصفحة الرئيسية' → index.html is already on the page.
  // No auto-redirect so the user can see 'انتهت المكالمة'.
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
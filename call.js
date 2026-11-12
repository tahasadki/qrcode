import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getFirestore, doc, setDoc, getDoc, onSnapshot, updateDoc, collection, addDoc, deleteDoc, serverTimestamp, getDocs, runTransaction } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// Load Firebase config from firebase-config.js
const firebaseConfig = window.__FIREBASE_CONFIG__ || {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// DOM Elements
const roomBadge = document.getElementById('roomBadge');
const roomIdDisplay = document.getElementById('roomIdDisplay');
const connStateDisplay = document.getElementById('connStateDisplay');
const remoteArea = document.getElementById('remoteArea');
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
const captionText = document.getElementById('captionText');

// State
let roomId = null;
let pc = null;
let localStream = null;
let remoteStream = null;
let isConnected = false;
let unsubRoom = null;
let unsubCandidates = null;
let muted = false;
let cameraOff = false;
let hasSentOffer = false;
let hasReceivedOffer = false;

// ICE Servers
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
];

// Get room ID from URL
function getRoomIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get('room');
}

function generateRoomId() {
  return 'call-' + Date.now().toString(36) + '-' + Math.random().toString(36).substr(2, 9);
}

async function init() {
  // Get or create room ID
  roomId = getRoomIdFromUrl();
  if (!roomId) {
    roomId = generateRoomId();
    const newUrl = `${window.location.pathname}?room=${roomId}`;
    window.history.replaceState({}, '', newUrl);
  }

  roomBadge.textContent = `الغرفة: ${roomId}`;
  roomIdDisplay.textContent = roomId;

  // Initialize WebRTC
  await setupLocalStream();
  await setupFirestoreSignaling();
  await joinRoom();

  // Event listeners
  muteBtn.addEventListener('click', toggleMute);
  cameraBtn.addEventListener('click', toggleCamera);
  endBtn.addEventListener('click', endCall);
  copyLinkBtn.addEventListener('click', copyRoomLink);

  // Cleanup on page unload
  window.addEventListener('beforeunload', cleanup);
}

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
  } catch (err) {
    console.error('Media access error:', err);
    localWaiting.innerHTML = '<div class="icon">⚠️</div><span>تعذر الوصول للكاميرا/الميكروفون</span>';
    showToast('تعذر الوصول للكاميرا أو الميكروفون: ' + err.message);
  }
}

async function setupFirestoreSignaling() {
  // Firestore signaling will be handled in joinRoom()
}

async function joinRoom() {
  const roomRef = doc(db, 'rooms', roomId);
  const roomSnap = await getDoc(roomRef);

  if (!roomSnap.exists()) {
    // First participant - create room
    await setDoc(roomRef, {
      status: 'waiting',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    updateStatus('waiting', 'في انتظار الطرف الآخر…');
  } else {
    // Room exists
    const data = roomSnap.data();
    if (data.status === 'ended') {
      // Room was ended, reset it for new call
      await updateDoc(roomRef, {
        status: 'waiting',
        offer: null,
        answer: null,
        updatedAt: serverTimestamp()
      });
      // Clear old candidates
      const candidatesRef = collection(db, 'rooms', roomId, 'candidates');
      const candidatesSnap = await getDocs(candidatesRef);
      const deletePromises = candidatesSnap.docs.map(doc => deleteDoc(doc.ref));
      await Promise.all(deletePromises).catch(() => {});
    }
    // Check if there's an offer already
    if (data.offer && !hasReceivedOffer) {
      hasReceivedOffer = true;
      await handleOffer(data.offer);
    }
    // If room is waiting but no offer yet, we'll wait for it via snapshot
    if (data.status === 'waiting' && !data.offer) {
      updateStatus('waiting', 'في انتظار الطرف الآخر…');
    }
  }

  // Listen for room changes
  unsubRoom = onSnapshot(roomRef, async (snap) => {
    if (!snap.exists()) return;
    const data = snap.data();
    
    if (data.status === 'ended') {
      if (isConnected) {
        showToast('أنهى الطرف الآخر المكالمة');
        endCall(false);
      }
      return;
    }

    // Handle room reset to waiting (other party left)
    if (data.status === 'waiting' && isConnected) {
      // Other party left, reset our state to allow new connection
      isConnected = false;
      hasReceivedOffer = false;
      hasSentOffer = false;
      if (pc) {
        pc.close();
        pc = null;
      }
      remoteVideo.style.display = 'none';
      remoteWaiting.style.display = 'block';
      callControls.style.display = 'none';
      preCallControls.style.display = 'flex';
      captionArea.classList.remove('visible');
      updateStatus('waiting', 'في انتظار الطرف الآخر…');
      
      // Try to create new offer if none exists
      if (!data.offer && !hasSentOffer) {
        await createAndSendOfferAtomic();
      }
      return;
    }

    if (data.status === 'connected' && !isConnected) {
      isConnected = true;
      updateStatus('connected', '🟢 متصل');
      callControls.style.display = 'flex';
      preCallControls.style.display = 'none';
      captionArea.classList.add('visible');
    }

    // Handle offer - if we haven't received it yet
    if (data.offer && !hasReceivedOffer && !pc) {
      hasReceivedOffer = true;
      await handleOffer(data.offer);
    }

    // Handle answer - if we sent offer and got answer back
    if (data.answer && pc && pc.signalingState === 'have-local-offer') {
      await handleAnswer(data.answer);
    }
  });

  // Listen for ICE candidates
  const candidatesRef = collection(db, 'rooms', roomId, 'candidates');
  unsubCandidates = onSnapshot(candidatesRef, (snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === 'added') {
        const candidate = change.doc.data();
        // Accept candidates from the other party
        if (pc) {
          pc.addIceCandidate(new RTCIceCandidate(candidate.candidate)).catch(console.error);
        }
      }
    });
  });

  // If we're the first participant (no offer in room), create and send offer atomically
  const roomData = roomSnap.data();
  if (!roomData?.offer && !hasSentOffer) {
    await createAndSendOfferAtomic();
  }
}

function createPeerConnection() {
  pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

  // Add local tracks
  localStream.getTracks().forEach(track => {
    pc.addTrack(track, localStream);
  });

  // Handle remote track
  pc.ontrack = (event) => {
    if (event.streams && event.streams[0]) {
      remoteStream = event.streams[0];
      remoteVideo.srcObject = remoteStream;
      remoteVideo.style.display = 'block';
      remoteWaiting.style.display = 'none';
    }
  };

  // Handle ICE candidates
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      sendIceCandidate(event.candidate);
    }
  };

  pc.oniceconnectionstatechange = () => {
    console.log('ICE Connection State:', pc.iceConnectionState);
    connStateDisplay.textContent = pc.iceConnectionState;
    
    if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
      if (!isConnected) {
        isConnected = true;
        updateStatus('connected', '🟢 متصل');
        callControls.style.display = 'flex';
        preCallControls.style.display = 'none';
        captionArea.classList.add('visible');
      }
    } else if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
      if (isConnected) {
        updateStatus('connecting', '🔄 إعادة الاتصال…');
      }
    }
  };

  pc.onconnectionstatechange = () => {
    console.log('Connection State:', pc.connectionState);
    if (pc.connectionState === 'failed') {
      showToast('فشل الاتصال');
    }
  };

  return pc;
}

async function createAndSendOffer() {
  if (hasSentOffer) return;
  hasSentOffer = true;
  
  await createPeerConnection();
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  
  const roomRef = doc(db, 'rooms', roomId);
  await updateDoc(roomRef, {
    offer: offer.toJSON(),
    status: 'waiting',
    updatedAt: serverTimestamp()
  });
  
  updateStatus('waiting', 'في انتظار الطرف الآخر…');
}

async function createAndSendOfferAtomic() {
  const roomRef = doc(db, 'rooms', roomId);
  
  try {
    await runTransaction(db, async (transaction) => {
      const roomDoc = await transaction.get(roomRef);
      if (!roomDoc.exists()) {
        throw new Error('Room does not exist');
      }
      const data = roomDoc.data();
      // Only create offer if none exists
      if (data.offer) {
        return; // Another participant already created the offer
      }
      
      // Create peer connection and offer within transaction
      await createPeerConnection();
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      
      transaction.update(roomRef, {
        offer: offer.toJSON(),
        status: 'waiting',
        updatedAt: serverTimestamp()
      });
      
      hasSentOffer = true;
    });
    
    if (hasSentOffer) {
      updateStatus('waiting', 'في انتظار الطرف الآخر…');
    }
  } catch (err) {
    console.error('Atomic offer creation failed:', err);
    hasSentOffer = false;
  }
}

async function handleOffer(offer) {
  await createPeerConnection();
  await pc.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  
  const roomRef = doc(db, 'rooms', roomId);
  await updateDoc(roomRef, {
    answer: answer.toJSON(),
    status: 'connected',
    updatedAt: serverTimestamp()
  });
  
  isConnected = true;
  updateStatus('connected', '🟢 متصل');
  callControls.style.display = 'flex';
  preCallControls.style.display = 'none';
  captionArea.classList.add('visible');
}

async function handleAnswer(answer) {
  await pc.setRemoteDescription(new RTCSessionDescription(answer));
  const roomRef = doc(db, 'rooms', roomId);
  await updateDoc(roomRef, {
    status: 'connected',
    updatedAt: serverTimestamp()
  });
}

async function sendIceCandidate(candidate) {
  const candidatesRef = collection(db, 'rooms', roomId, 'candidates');
  await addDoc(candidatesRef, {
    candidate: candidate.toJSON(),
    timestamp: serverTimestamp()
  });
}

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
  const url = window.location.href;
  navigator.clipboard.writeText(url).then(() => {
    showToast('تم نسخ رابط الغرفة');
  }).catch(() => {
    showToast('فشل النسخ');
  });
}

async function endCall(notifyServer = true) {
  if (notifyServer && roomId) {
    const roomRef = doc(db, 'rooms', roomId);
    // Reset room to waiting state for a new participant instead of ending
    await updateDoc(roomRef, {
      status: 'waiting',
      offer: null,
      answer: null,
      updatedAt: serverTimestamp()
    }).catch(() => {});
    
    // Clear ICE candidates subcollection
    const candidatesRef = collection(db, 'rooms', roomId, 'candidates');
    const candidatesSnap = await getDocs(candidatesRef);
    const deletePromises = candidatesSnap.docs.map(doc => deleteDoc(doc.ref));
    await Promise.all(deletePromises).catch(() => {});
  }
  cleanup();
  showToast('انتهت المكالمة');
  setTimeout(() => { window.location.href = 'index.html'; }, 1500);
}

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
  captionArea.classList.remove('visible');
}

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

// Start
init();
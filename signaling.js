// signaling.js — Shared call teardown for both call pages (call.html tourist + owner.html).
// Exports a single hangup(reason, ctx). ctx is a mutable page-owned object that proxies the
// page's call state (pc, streams, unsubs, roomId) so hangup always reads current values.
//
//   ctx = {
//     hungUp: false,              // idempotency flag, owned by the page
//     db,                         // Firestore Db instance
//     get pc() / set pc(v),       // RTCPeerConnection
//     get localStream() / set localStream(v)
//     get remoteStream() / set remoteStream(v)
//     get unsubRoom() / set unsubRoom(v)        // room snapshot unsubscriber
//     get unsubCandidates() / set unsubCandidates(v)  // candidates snapshot unsubscriber
//     get roomId() / set roomId(v)
//     localVideo, remoteVideo,    // video elements
//     statusText,                 // element whose textContent becomes 'انتهت المكالمة'
//     onEnded(reason)             // page-specific UI after teardown (message + button)
//   }

import { doc, updateDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

export async function hangup(reason, ctx) {
  if (!ctx || ctx.hungUp) return;
  ctx.hungUp = true;

  console.log('[call] hangup:', reason);

  // a. Stop every track in localStream and remoteStream.
  for (const stream of [ctx.localStream, ctx.remoteStream]) {
    if (!stream) continue;
    for (const track of stream.getTracks()) {
      try {
        track.stop();
      } catch (err) {
        console.warn('[call] hangup: failed to stop track', err);
      }
    }
  }
  ctx.localStream = null;
  ctx.remoteStream = null;

  // b. Close RTCPeerConnection and set pc = null.
  if (ctx.pc) {
    try {
      ctx.pc.close();
    } catch (err) {
      console.warn('[call] hangup: failed to close peer connection', err);
    }
    ctx.pc = null;
  }

  // c. Call every unsubscribe function and set them to null.
  if (ctx.unsubRoom) {
    try {
      ctx.unsubRoom();
    } catch (err) {
      console.warn('[call] hangup: failed to unsubscribe room', err);
    }
    ctx.unsubRoom = null;
  }
  if (ctx.unsubCandidates) {
    try {
      ctx.unsubCandidates();
    } catch (err) {
      console.warn('[call] hangup: failed to unsubscribe candidates', err);
    }
    ctx.unsubCandidates = null;
  }

  // d. Update rooms/{roomId} with { status: "ended", endedAt: serverTimestamp() }.
  if (ctx.db && ctx.roomId) {
    try {
      await updateDoc(doc(ctx.db, 'rooms', ctx.roomId), {
        status: 'ended',
        endedAt: serverTimestamp()
      });
    } catch (err) {
      console.error('[call] hangup: failed to mark room ended', err);
    }
  }

  // e. Clear the video elements.
  if (ctx.localVideo) ctx.localVideo.srcObject = null;
  if (ctx.remoteVideo) ctx.remoteVideo.srcObject = null;

  // f. Show the Darija message and run page-specific ended UI (button).
  if (ctx.statusText) ctx.statusText.textContent = 'انتهت المكالمة';
  if (typeof ctx.onEnded === 'function') {
    try {
      ctx.onEnded(reason);
    } catch (err) {
      console.error('[call] hangup: onEnded failed', err);
    }
  }
}

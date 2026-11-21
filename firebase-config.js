// Firebase Client Configuration
// Single source of truth for the Firebase config (project: riad-265a5).
// All pages load this file. Do NOT duplicate this config elsewhere.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';

export const firebaseConfig = {
  apiKey: "AIzaSyA7vRgiNvVbn55o4A0nNNqPyr7UpGSQ39E",
  authDomain: "riad-265a5.firebaseapp.com",
  projectId: "riad-265a5",
  storageBucket: "riad-265a5.firebasestorage.app",
  messagingSenderId: "745898895809",
  appId: "1:745898895809:web:68f7dece8dad691187e740"
};

export const app = initializeApp(firebaseConfig);

// Make config available to classic scripts on the page.
if (typeof window !== 'undefined') {
  window.__FIREBASE_CONFIG__ = firebaseConfig;
  window.__FIREBASE_APP__ = app;
}
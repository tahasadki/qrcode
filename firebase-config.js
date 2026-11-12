// Firebase Client Configuration
// Real config from Firebase Console for project: riad-265a5

export const firebaseConfig = {
  apiKey: "AIzaSyA7vRgiNvVbn55o4A0nNNqPyr7UpGSQ39E",
  authDomain: "riad-265a5.firebaseapp.com",
  projectId: "riad-265a5",
  storageBucket: "riad-265a5.firebasestorage.app",
  messagingSenderId: "745898895809",
  appId: "1:745898895809:web:68f7dece8dad691187e740"
};

// For client-side use in browser
if (typeof window !== 'undefined') {
  window.__FIREBASE_CONFIG__ = firebaseConfig;
}
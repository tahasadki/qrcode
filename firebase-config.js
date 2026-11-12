// Firebase Client Configuration
// Replace with your actual Firebase project config from Firebase Console
// Get these from: Project Settings > General > Your apps > Web app (</>)

export const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// For client-side use in browser
if (typeof window !== 'undefined') {
  window.__FIREBASE_CONFIG__ = firebaseConfig;
}
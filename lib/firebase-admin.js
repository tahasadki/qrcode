// Firebase Admin SDK Configuration
// Replace with your actual Firebase project credentials
// Get these from: Firebase Console > Project Settings > Service Accounts > Generate New Private Key

const admin = require('firebase-admin');

// Initialize Firebase Admin only once
if (!admin.apps.length) {
  try {
    // Option 1: Using service account key (for local development)
    // const serviceAccount = require('./serviceAccountKey.json');
    // admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

    // Option 2: Using environment variables (for Vercel production)
    // Set these in Vercel Dashboard > Settings > Environment Variables
    if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        }),
      });
    } else {
      // Option 3: Default credentials (works on Google Cloud / Vercel with proper setup)
      admin.initializeApp();
    }
    console.log('✅ Firebase Admin initialized');
  } catch (error) {
    console.error('❌ Firebase Admin init error:', error.message);
  }
}

module.exports = admin;
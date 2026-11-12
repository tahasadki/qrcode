// Vercel API Entry Point
// This handles all API routes for the application

const admin = require('../lib/firebase-admin.js');

// Verify Firebase ID token middleware
async function verifyToken(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  
  const idToken = authHeader.split('Bearer ')[1];
  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    return decodedToken;
  } catch (error) {
    console.error('Token verification failed:', error.message);
    return null;
  }
}

// CORS headers
function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

module.exports = async function handler(req, res) {
  setCorsHeaders(res);
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  try {
    // Health check
    if (path === '/api/health') {
      return res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
    }

    // Verify auth for protected routes
    const user = await verifyToken(req);
    
    // Get user profile (protected)
    if (path === '/api/user' && req.method === 'GET') {
      if (!user) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      const userRecord = await admin.auth().getUser(user.uid);
      return res.status(200).json({
        uid: userRecord.uid,
        email: userRecord.email,
        displayName: userRecord.displayName,
        photoURL: userRecord.photoURL,
        emailVerified: userRecord.emailVerified,
        createdAt: userRecord.metadata.creationTime,
        lastSignIn: userRecord.metadata.lastSignInTime,
      });
    }

    // Verify token endpoint (for client to check auth status)
    if (path === '/api/auth/verify' && req.method === 'POST') {
      if (!user) {
        return res.status(401).json({ valid: false, error: 'Invalid token' });
      }
      return res.status(200).json({ valid: true, uid: user.uid, email: user.email });
    }

    // Create custom token (for server-side token generation if needed)
    if (path === '/api/auth/custom-token' && req.method === 'POST') {
      if (!user) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      const customToken = await admin.auth().createCustomToken(user.uid);
      return res.status(200).json({ customToken });
    }

    // Translation proxy (optional - for server-side translation)
    if (path === '/api/translate' && req.method === 'POST') {
      if (!user) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      const { text, from, to } = req.body;
      // You can add server-side translation logic here
      return res.status(200).json({ translated: text }); // Placeholder
    }

    return res.status(404).json({ error: 'Not found' });
  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
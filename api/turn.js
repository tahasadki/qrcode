/**
 * api/turn.js — Vercel serverless function
 *
 * Returns the ICE server list (STUN + optional TURN) for the WebRTC client.
 * TURN credentials are read from server-side environment variables and never
 * shipped to the client bundle.
 *
 * Required Vercel environment variables (optional):
 *   TURN_URL        e.g. turn:a.relay.metered.ca:443?transport=tcp
 *   TURN_USERNAME   e.g. abc123
 *   TURN_CREDENTIAL e.g. xyz789
 */
export default async function handler(req, res) {
  // CORS preflight
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const iceServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ];

  const turnUrl = process.env.TURN_URL;
  const turnUsername = process.env.TURN_USERNAME;
  const turnCredential = process.env.TURN_CREDENTIAL;

  if (turnUrl && turnUsername && turnCredential) {
    iceServers.push({
      urls: turnUrl,
      username: turnUsername,
      credential: turnCredential
    });
  }

  return res.status(200).json({ iceServers });
}
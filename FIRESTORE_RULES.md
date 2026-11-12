# Firestore Security Rules for Video Call Rooms

## Rules File: `firestore.rules`

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Video call rooms
    match /rooms/{roomId} {
      // Allow reading room if it exists and not ended
      allow read: if resource.data.status != 'ended';
      
      // Allow creating a new room (anyone can start a call)
      allow create: if request.auth == null || request.auth != null;
      
      // Allow updating room status, offer, answer
      allow update: if request.auth == null || request.auth != null;
      
      // Allow deleting room when call ends
      allow delete: if request.auth == null || request.auth != null;
    }
    
    // ICE candidates subcollection
    match /rooms/{roomId}/candidates/{candidateId} {
      // Allow reading candidates for active rooms
      allow read: if get(/databases/$(database)/documents/rooms/$(roomId)).data.status != 'ended';
      
      // Allow creating candidates during connection
      allow create: if get(/databases/$(database)/documents/rooms/$(roomId)).data.status != 'ended';
      
      // No update/delete needed for candidates
    }
  }
}
```

## Deployment

```bash
# Install Firebase CLI if not already installed
npm install -g firebase-tools

# Login to Firebase
firebase login

# Initialize Firestore in your project (if not done)
firebase init firestore

# Deploy rules
firebase deploy --only firestore:rules
```

## Rule Explanation

| Collection | Operation | Condition |
|------------|-----------|-----------|
| `rooms` | `read` | Room exists and status ≠ 'ended' |
| `rooms` | `create` | Anyone (anonymous or authenticated) |
| `rooms` | `update` | Anyone (for offer/answer/status) |
| `rooms` | `delete` | Anyone (to clean up ended calls) |
| `rooms/{roomId}/candidates` | `read` | Parent room not ended |
| `rooms/{roomId}/candidates` | `create` | Parent room not ended |

## Notes

1. **Anonymous access allowed**: Since this is a public hotel website, we allow unauthenticated users to create/join calls. The room ID acts as the access token.

2. **No sensitive data**: Rooms only contain WebRTC signaling data (SDP, ICE candidates), no personal information.

3. **Auto-cleanup**: Consider adding a Cloud Function to auto-delete rooms older than 24 hours with status 'ended'.

4. **Rate limiting**: For production, consider adding rate limiting via Firebase App Check or custom Cloud Functions.

## Alternative: Stricter Rules (if you add authentication)

```javascript
match /rooms/{roomId} {
  allow read: if request.auth != null && resource.data.status != 'ended';
  allow create: if request.auth != null;
  allow update: if request.auth != null && 
    (request.resource.data.diff(resource.data).affectedKeys().hasOnly(['status', 'offer', 'answer', 'updatedAt']));
  allow delete: if request.auth != null && resource.data.status == 'ended';
}
```
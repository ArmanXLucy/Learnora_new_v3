# Learnora Notification System

The notification system is now persistent and Firebase/Firestore-backed.

## Notification events

### Student notifications
- Course enrollment: confirms the new course/learning path.
- Admin Help Desk reply: appears immediately in the notification center and links to `/help`.

### Admin notifications
- Student course enrollment.
- Student Help Desk request.
- Student profile update.

## UI

- Bell is available in the global top bar for students and admins.
- Unread count appears on the bell.
- Popover shows recent notifications.
- Notifications can be marked individually or all at once.
- `/notifications` provides the full notification center.

## Firestore

Collection: `notifications`

Fields:
- `user_id`: Learnora user document ID for student notifications; `null` for admin notifications.
- `audience`: `user` or `admin`.
- `type`: event type.
- `title`: notification title.
- `message`: notification body.
- `link`: destination route.
- `icon`: UI icon name.
- `read`: boolean.
- `created_at`: ISO timestamp.
- `read_at`: ISO timestamp when read.

No Firestore client-side rules change is required because notification reads/writes are performed by the Node.js server through the Firebase Admin SDK.

# Learnora — JavaScript + Node.js + Firebase

This is the JavaScript/Firebase rebuild of the uploaded Learnora reference implementation. The original curriculum, knowledge base, visual design, learning flow, topic graph and page set are retained; Python/Flask/SQLite/Gemini are removed.

## Stack

- Node.js 22+ + Express
- Nunjucks server-rendered HTML + CSS + vanilla JavaScript
- Firebase Authentication + Firebase Admin SDK
- Cloud Firestore
- Supabase Storage
- Groq API (server-side)

The current Groq configuration uses `qwen/qwen3.8-27b`, which supports multimodal input and structured outputs. Keep the model configurable through `AI_MODEL`.

## Run

```powershell
npm install
copy .env.example .env
npm run dev
```

Open `http://localhost:5000`.

## Firebase

1. Create a Firebase project.
2. Enable Authentication -> Email/Password.
3. Create Firestore Database.
5. Create a Web App and fill the `FIREBASE_*` browser variables.
6. Create a Firebase Admin service account and provide either `FIREBASE_SERVICE_ACCOUNT_JSON` or `FIREBASE_SERVICE_ACCOUNT_PATH`.
7. Keep the Firebase Firestore rules; Supabase Storage is configured separately in `SUPABASE_SETUP.md`.

Never commit the Admin private key or `.env`.

## AI

Set `GROQ_API_KEY`. The AI service is isolated in `server/services/aiService.js` and validates generated JSON before persistence. Syllabus image analysis uses the configured multimodal model.

## Learning flow

Landing -> authentication -> dashboard -> skill -> syllabus -> AI curriculum mapping -> syllabus preview -> 7-question diagnostic (2 Basic / 3 Intermediate / 2 Advanced) -> learner level -> difficulty gate -> personalized roadmap -> topic learning -> progress.

## Firestore collections

`users`, `user_preferences`, `skills`, `syllabi`, `enrollments`, `assessments`, `roadmaps`, `topic_progress`, `activity_log`, `support_tickets`.

## Admin

Admin pages are protected server-side. A user document with `role: "admin"` or `is_admin: true` is treated as an admin. For the first admin, create the Firebase account normally, then set the Firestore user role to `admin` after the first successful session/profile creation.

## Security

Uploaded syllabus files are held in memory, validated, sent to Supabase Storage, and never persisted in a local `uploads/` directory. The server verifies Firebase session cookies for private routes. Firestore rules protect Firebase data; the private Supabase Storage bucket is accessed server-side only with the server secret key.

## File storage

Supabase Storage is used for syllabus uploads and profile avatars. See `SUPABASE_SETUP.md` for the required bucket and environment settings.


### Groq free-tier input limits
Syllabus analysis compacts uploaded text before sending it to Groq so large PDFs do not exceed the organization input-token-per-minute limit.

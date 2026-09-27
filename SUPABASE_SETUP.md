# Learnora — Supabase Storage setup

Learnora keeps **Firebase Authentication** and **Cloud Firestore**. Supabase is used only for uploaded files such as syllabuses and profile avatars.

## 1. Create a Supabase project

Create a free Supabase project and open the project dashboard.

## 2. Create the storage bucket

Open **Storage** → **New Bucket** and create:

`learnora-files`

Keep the bucket **private**. The Node.js server accesses the bucket with a server-side secret key, so uploaded syllabus files are not public.

## 3. Get the project URL and server secret

Open the project's **Connect** dialog / **API Keys** settings and copy:

- Project URL
- Secret key (recommended current key name)

For older projects that still show a `service_role` key, `SUPABASE_SERVICE_ROLE_KEY` is accepted as a fallback. Never put either server key in browser JavaScript or commit it to Git.

## 4. Add to `.env`

```env
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_SECRET_KEY=YOUR_SERVER_SECRET_KEY
SUPABASE_STORAGE_BUCKET=learnora-files
```

## 5. Run Learnora

```powershell
npm install
npm run dev
```

## File paths

- Syllabuses: `syllabi/<firebase_uid>/...`
- Profile avatars: `users/<firebase_uid>/avatars/...`

The application continues saving syllabus metadata and learning data in Firebase Firestore.

## Security

The browser never receives the Supabase server secret. The server checks the Learnora/Firebase session before reading or writing private files.

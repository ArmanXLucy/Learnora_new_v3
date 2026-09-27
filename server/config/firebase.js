import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

function loadCredential() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (raw) {
    const info = JSON.parse(raw);
    if (info.private_key) info.private_key = info.private_key.replace(/\\n/g, '\n');
    return cert(info);
  }
  const configured = process.env.FIREBASE_SERVICE_ACCOUNT_PATH?.trim();
  const file = configured ? path.resolve(root, configured) : path.join(root, 'serviceAccountKey.json');
  if (!fs.existsSync(file)) {
    throw new Error('Firebase Admin is not configured. Set FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_PATH.');
  }
  const info = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (info.private_key) info.private_key = info.private_key.replace(/\\n/g, '\n');
  return cert(info);
}

let app;
if (getApps().length) app = getApps()[0];
else app = initializeApp({
  credential: loadCredential(),
  projectId: process.env.FIREBASE_PROJECT_ID || undefined,
});

export const adminAuth = getAuth(app);
export const db = getFirestore(app);
export { FieldValue, Timestamp };
export const firebaseClientConfig = {
  apiKey: process.env.FIREBASE_API_KEY || '',
  authDomain: process.env.FIREBASE_AUTH_DOMAIN || '',
  projectId: process.env.FIREBASE_PROJECT_ID || '',
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '',
  appId: process.env.FIREBASE_APP_ID || '',
};

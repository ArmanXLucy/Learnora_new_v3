import { adminAuth } from '../config/firebase.js';
import { getUser, getUserByEmail, updateUser } from '../services/firebaseService.js';

const COOKIE = process.env.SESSION_COOKIE_NAME || 'learnora_session';

export async function optionalAuth(req, res, next) {
  try {
    const cookie = req.cookies?.[COOKIE];
    req.firebaseUser = null;
    req.user = null;

    if (!cookie) return next();

    const decoded = await adminAuth.verifySessionCookie(cookie, true);
    req.firebaseUser = decoded;

    // First try the Firebase UID, then fall back to the email. This keeps
    // older Learnora accounts (whose Firestore document id was not the UID)
    // working after the Firebase migration.
    req.user = await getUser(decoded.uid);

    if (!req.user && decoded.email) {
      req.user = await getUserByEmail(decoded.email);
      if (req.user && req.user.firebase_uid !== decoded.uid) {
        await updateUser(req.user.id, { firebase_uid: decoded.uid });
        req.user = await getUser(req.user.id);
      }
    }

    if (req.user) {
      const accountStatus = String(req.user.account_status || 'active').toLowerCase();
      if (req.user.role !== 'admin' && req.user.is_admin !== true && accountStatus !== 'active') {
        req.firebaseUser = null;
        req.user = null;
        res.clearCookie(COOKIE, { path: '/' });
        return next();
      }

      // Keep the Firebase UID on the actual Learnora user document.
      if (req.user.firebase_uid !== decoded.uid) {
        await updateUser(req.user.id, { firebase_uid: decoded.uid });
        req.user.firebase_uid = decoded.uid;
      }
    }

    console.log(`[auth] ${req.method} ${req.path} cookie=present firebaseUser=${Boolean(req.firebaseUser)} user=${req.user?.id || 'missing'}`);
  } catch (error) {
    console.error('[auth] Session cookie validation failed:', error.message);
    req.firebaseUser = null;
    req.user = null;
    res.clearCookie(COOKIE, { path: '/' });
  }
  next();
}

export function loginRequired(req, res, next) {
  if (!req.firebaseUser || !req.user) {
    console.warn(`[auth] Protected route blocked: ${req.method} ${req.path} firebaseUser=${Boolean(req.firebaseUser)} user=${req.user?.id || 'missing'}`);
    req.flash('warning', 'Please log in first.');
    return res.redirect('/login');
  }
  next();
}

export async function adminRequired(req, res, next) {
  if (!req.firebaseUser || !req.user) {
    req.flash('warning', 'Admin access required.');
    return res.redirect('/login');
  }
  const user = req.user;
  if (user.role !== 'admin' && user.is_admin !== true && req.firebaseUser.admin !== true) {
    req.flash('danger', 'Admin access required.');
    return res.redirect('/dashboard');
  }
  next();
}

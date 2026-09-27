/* Learnora Firebase REST client.
 * Uses Firebase Identity Toolkit directly so authentication does not depend
 * on loading Google's Firebase JavaScript SDK from a third-party CDN.
 */
(function () {
  'use strict';

  const BASE = 'https://identitytoolkit.googleapis.com/v1/accounts:';

  async function request(apiKey, operation, body) {
    if (!apiKey) throw new Error('Firebase Web API key is missing.');

    let response;
    try {
      response = await fetch(BASE + operation + '?key=' + encodeURIComponent(apiKey), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {})
      });
    } catch (error) {
      throw new Error('Could not reach Firebase Authentication. Check your internet connection.');
    }

    let data = {};
    try {
      data = await response.json();
    } catch (_) {
      throw new Error('Firebase returned an invalid response.');
    }

    if (!response.ok) {
      const code = data?.error?.message || 'UNKNOWN_ERROR';
      const error = new Error(code);
      error.firebaseCode = code;
      throw error;
    }

    return data;
  }

  function friendlyError(error, fallback) {
    const code = error?.firebaseCode || '';
    const messages = {
      EMAIL_EXISTS: 'This email is already registered. Please log in instead.',
      EMAIL_NOT_FOUND: 'No Firebase account was found for this email.',
      INVALID_PASSWORD: 'The email or password is incorrect.',
      INVALID_LOGIN_CREDENTIALS: 'The email or password is incorrect.',
      USER_DISABLED: 'This Firebase account has been disabled.',
      OPERATION_NOT_ALLOWED: 'Email/password authentication is disabled in Firebase. Enable Email/Password in Firebase Authentication.',
      TOO_MANY_ATTEMPTS_TRY_LATER: 'Too many attempts were made. Please wait a few minutes and try again.',
      WEAK_PASSWORD: 'Password must be at least 6 characters long.',
      INVALID_EMAIL: 'Please enter a valid email address.',
      INVALID_ID_TOKEN: 'Your Firebase session has expired. Please try again.'
    };
    return messages[code] || error?.message || fallback || 'Firebase authentication failed.';
  }

  window.learnoraFirebaseRest = {
    signUp(apiKey, email, password) {
      return request(apiKey, 'signUp', {
        email,
        password,
        returnSecureToken: true
      });
    },

    signIn(apiKey, email, password) {
      return request(apiKey, 'signInWithPassword', {
        email,
        password,
        returnSecureToken: true
      });
    },

    lookup(apiKey, idToken) {
      return request(apiKey, 'lookup', { idToken });
    },

    updateProfile(apiKey, idToken, displayName) {
      return request(apiKey, 'update', {
        idToken,
        displayName: String(displayName || '').trim(),
        returnSecureToken: true
      });
    },

    sendVerification(apiKey, idToken) {
      return request(apiKey, 'sendOobCode', {
        requestType: 'VERIFY_EMAIL',
        idToken
      });
    },

    friendlyError
  };
})();

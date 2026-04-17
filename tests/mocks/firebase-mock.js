/**
 * @fileoverview Mock for Firebase SDKs to allow Jest tests to run with remote imports.
 */

export const initializeApp = () => ({});
export const getAuth = () => ({});
export const onAuthStateChanged = (auth, cb) => {
  // Simulate an immediate unauthenticated state for tests
  if (cb) cb(null);
};
export const signInWithPopup = () => Promise.resolve({ user: { uid: 'mock-user' } });
export const signOut = () => Promise.resolve();
export const GoogleAuthProvider = class {};

export const getDatabase = () => ({});
export const ref = () => ({});
export const onValue = () => {};
export const set = () => Promise.resolve();
export const push = () => ({ key: 'mock-key' });

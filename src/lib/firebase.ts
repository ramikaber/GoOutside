import AsyncStorage from '@react-native-async-storage/async-storage';
import { type FirebaseApp, getApps, initializeApp } from 'firebase/app';
import { type Auth, getAuth, getReactNativePersistence, initializeAuth } from 'firebase/auth';
import { type Firestore, getFirestore } from 'firebase/firestore';
import { type FirebaseStorage, getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: 'AIzaSyCoeCTfCmR-AE7mC4mKQg0I5w_RPjFcZDs',
  authDomain: 'gooutside-d5f54.firebaseapp.com',
  projectId: 'gooutside-d5f54',
  storageBucket: 'gooutside-d5f54.firebasestorage.app',
  messagingSenderId: '505251286643',
  appId: '1:505251286643:web:7f1ef64813c1a350602406',
};

const app: FirebaseApp = getApps()[0] ?? initializeApp(firebaseConfig);

let auth: Auth;
try {
  auth = initializeAuth(app, {
    persistence: getReactNativePersistence(AsyncStorage),
  });
} catch {
  // initializeAuth throws if it already ran for this app (e.g. Fast Refresh) — reuse the existing instance.
  auth = getAuth(app);
}

const db: Firestore = getFirestore(app);
const storage: FirebaseStorage = getStorage(app);

export { app, auth, db, storage };

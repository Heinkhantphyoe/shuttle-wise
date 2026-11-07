import { initializeApp } from 'firebase/app'
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check'
import { connectAuthEmulator, getAuth } from 'firebase/auth'
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore'
import { firebaseConfig } from './config'

export const adminPage = location.pathname.replace(/\/$/, '') === '/admin'
export const useEmulators = import.meta.env.DEV
  && (import.meta.env.MODE === 'local-check-in' || import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true')
const config = useEmulators ? { projectId: 'demo-shuttlewise', apiKey: 'demo-key' } : firebaseConfig
export const app = Object.values(config).every(Boolean)
  ? initializeApp(config, adminPage ? 'shuttlewise-admin' : 'shuttlewise-student') : undefined
const siteKey = import.meta.env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY
export const appCheck = app && !useEmulators && siteKey ? initializeAppCheck(app, {
  provider: new ReCaptchaEnterpriseProvider(siteKey),
  isTokenAutoRefreshEnabled: true,
}) : undefined
export const auth = app && getAuth(app)
export const db = app && getFirestore(app)

if (useEmulators && auth && db) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099')
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
}

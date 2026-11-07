import { initializeApp } from 'firebase/app'
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { firebaseConfig } from './config'

export const adminPage = location.pathname.replace(/\/$/, '') === '/admin'
export const app = Object.values(firebaseConfig).every(Boolean)
  ? initializeApp(firebaseConfig, adminPage ? 'shuttlewise-admin' : 'shuttlewise-student') : undefined
const siteKey = import.meta.env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY
export const appCheck = app && siteKey ? initializeAppCheck(app, {
  provider: new ReCaptchaEnterpriseProvider(siteKey),
  isTokenAutoRefreshEnabled: true,
}) : undefined
export const auth = app && getAuth(app)
export const db = app && getFirestore(app)

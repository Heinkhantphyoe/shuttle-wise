import { pickupConfiguration } from './pickup-config'

const env = import.meta.env
export const { pickups, savedPickups, temporaryPickup, temporaryPickupScope } = pickupConfiguration(env)

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  appId: env.VITE_FIREBASE_APP_ID,
}

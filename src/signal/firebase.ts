import { initializeApp, type FirebaseApp } from 'firebase/app'
import { getDatabase, type Database } from 'firebase/database'

let app: FirebaseApp | null = null
let db: Database | null = null

export function getFirebaseConfig() {
  const apiKey = import.meta.env.VITE_FIREBASE_API_KEY as string | undefined
  const authDomain = import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined
  const databaseURL = import.meta.env.VITE_FIREBASE_DATABASE_URL as string | undefined
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined
  const storageBucket = import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined
  const messagingSenderId = import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined
  const appId = import.meta.env.VITE_FIREBASE_APP_ID as string | undefined

  if (!apiKey || !projectId || !databaseURL) return null
  return { apiKey, authDomain, databaseURL, projectId, storageBucket, messagingSenderId, appId }
}

export function isFirebaseEnabled() {
  return getFirebaseConfig() !== null
}

export function getFirebaseApp() {
  const cfg = getFirebaseConfig()
  if (!cfg) return null
  if (!app) app = initializeApp(cfg)
  return app
}

export function getFirebaseDatabase() {
  const app = getFirebaseApp()
  if (!app) return null
  if (!db) db = getDatabase(app)
  return db
}


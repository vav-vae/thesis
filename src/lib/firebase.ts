// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyB21eGDnXN8kYHmEXeG4K1Kocv4xYOCKPA",
  authDomain: "libot-790e6.firebaseapp.com",
  projectId: "libot-790e6",
  storageBucket: "libot-790e6.firebasestorage.app",
  messagingSenderId: "820466436902",
  appId: "1:820466436902:web:1badd3ee8e573d094d0fe7",
  measurementId: "G-N6Z7NVSH9M"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase Authentication and get a reference to the service
export const auth = getAuth(app);

// Initialize Firestore
export const db = getFirestore(app);

// Analytics is optional and browser-only. Keep it out of server rendering and
// the critical Firebase bundle used by authentication and Firestore.
if (typeof window !== "undefined") {
  void import("firebase/analytics").then(async ({ getAnalytics, isSupported }) => {
    if (await isSupported()) getAnalytics(app);
  }).catch(() => undefined);
}

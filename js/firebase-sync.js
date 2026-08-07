import { getTodayKey } from './utils.js';
import { getDB, saveDB, getPlannerDB, savePlannerDB } from './storage.js';
import { showToast } from './ui.js';

const FIREBASE_CONFIG = {
    apiKey: "AIzaSyCHvTipTo9yc19FOB-o31GfRu0El3SIqzc",
    authDomain: "jee-study-tracker-99.firebaseapp.com",
    projectId: "jee-study-tracker-99",
    storageBucket: "jee-study-tracker-99.firebasestorage.app",
    messagingSenderId: "221533539699",
    appId: "1:221533539699:web:5a68a74a33898627cb4906"
};

let fbApp = null, fbDb = null, fbAuth = null, fbReady = false;
let currentUser = null;

function firebaseConfigured() { return !FIREBASE_CONFIG.apiKey.includes("PASTE_"); }

function initFirebaseIfNeeded() {
    if (fbReady) return true;
    if (!firebaseConfigured()) {
        document.getElementById("sync-setup-note").innerText = "Cloud sync is not configured. To enable, add your Firebase keys in the code.";
        return false;
    }
    try {
        fbApp = firebase.initializeApp(FIREBASE_CONFIG);
        fbDb = firebase.firestore();
        fbAuth = firebase.auth();
        fbReady = true;
        fbAuth.onAuthStateChanged((user) => {
            currentUser = user;
            renderSyncUI();
            if (user) {
                showToast(`Signed in as ${user.displayName || user.email}`);
            }
        });
        return true;
    } catch (e) { showToast("Firebase init failed: " + e.message); return false; }
}

export function getCurrentUser() { return currentUser; }

export async function signInWithGoogle() {
    if (!initFirebaseIfNeeded()) return;
    try {
        let provider = new firebase.auth.GoogleAuthProvider();
        await fbAuth.signInWithPopup(provider);
    } catch (e) { alert("Sign-in failed: " + e.message); }
}

export function signOutOfGoogle() {
    if (fbAuth) fbAuth.signOut();
    renderSyncUI();
}

export async function pushToCloud(silent = false) {
    if (!initFirebaseIfNeeded()) return;
    if (!currentUser) { if(!silent) alert("Sign in first."); return; }
    try {
        await fbDb.collection("users").doc(currentUser.uid).set({
            studyDB: getDB(),
            plannerDB: getPlannerDB(),
            updatedAt: Date.now()
        });
        localStorage.setItem("jee_last_sync", Date.now().toString());
        renderSyncUI();
        if(!silent) showToast("Saved to the cloud.");
    } catch (e) { if(!silent) alert("Save failed: " + e.message); }
}

export async function pullFromCloud() {
    if (!initFirebaseIfNeeded()) return;
    if (!currentUser) { alert("Sign in first."); return; }
    if (!confirm("This will REPLACE all study logs and planner tasks on THIS device with your saved cloud data. Continue?")) return;
    try {
        let doc = await fbDb.collection("users").doc(currentUser.uid).get();
        if (!doc.exists) { alert("No cloud data saved yet — tap Save to Cloud first."); return; }
        let data = doc.data();
        saveDB(data.studyDB || {});
        savePlannerDB(data.plannerDB || {});
        localStorage.setItem("jee_last_sync", Date.now().toString());
        alert("Loaded! The page will reload.");
        location.reload();
    } catch (e) { alert("Load failed: " + e.message); }
}

export async function deleteCloudData() {
    if (!initFirebaseIfNeeded()) return;
    if (!currentUser) { alert("Sign in first."); return; }
    if (!confirm("This will permanently DELETE all your cloud data for this account. Local data on this device will remain. Continue?")) return;
    try {
        await fbDb.collection("users").doc(currentUser.uid).delete();
        localStorage.removeItem("jee_last_sync");
        showToast("Cloud data deleted.");
        renderSyncUI();
    } catch (e) { alert("Delete failed: " + e.message); }
}

export function renderSyncUI() {
    document.getElementById("sync-setup-note").innerText = firebaseConfigured() ? "" : "Cloud sync is not configured. To enable, add your Firebase keys in the code (search `FIREBASE_CONFIG`).";
    let signedOutBlock = document.getElementById("signed-out-block");
    let signedInBlock = document.getElementById("signed-in-block");
    if (!signedOutBlock) return;

    if (currentUser) {
        signedOutBlock.style.display = "none";
        signedInBlock.style.display = "block";
        document.getElementById("account-name").innerText = currentUser.displayName || currentUser.email;
        let avatar = document.getElementById("account-avatar");
        if (currentUser.photoURL) { avatar.src = currentUser.photoURL; avatar.style.display = "block"; }
        let last = localStorage.getItem("jee_last_sync");
        document.getElementById("sync-last").innerText = last ? `Last synced: ${new Date(parseInt(last)).toLocaleString()}` : "Not saved to the cloud yet.";
    } else {
        signedOutBlock.style.display = "block";
        signedInBlock.style.display = "none";
    }
}

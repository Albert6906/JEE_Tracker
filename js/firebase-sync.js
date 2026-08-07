import { getDB, saveDB, getPlannerDB, savePlannerDB, getRawFlag, setRawFlag, clearRawFlag, getTodayKey } from './storage.js';
// Forward reference — ui.js lands alongside this file in Step 7. Only used
// inside function bodies, safe against the circular module graph (both
// showToast and everything imported here are hoisted function declarations).
import { showToast } from './ui.js';
// Forward reference — reports.js (Step 6) needs sendReportViaEmail for the
// auto-report scheduler below.
import { sendReportViaEmail } from './reports.js';

// ----------------- FIREBASE CONFIG -----------------
const FIREBASE_CONFIG = {
    apiKey: "AIzaSyCHvTipTo9yc19FOB-o31GfRu0El3SIqzc",
    authDomain: "jee-study-tracker-99.firebaseapp.com",
    projectId: "jee-study-tracker-99",
    storageBucket: "jee-study-tracker-99.firebasestorage.app",
    messagingSenderId: "221533539699",
    appId: "1:221533539699:web:5a68a74a33898627cb4906"
};

let fbApp = null, fbDb = null, fbReady = false;
let fbAuth = null, currentUser = null;
let autoSyncInterval = null, autoReportInterval = null;

export function getCurrentUser() { return currentUser; }

export function firebaseConfigured() { return !FIREBASE_CONFIG.apiKey.includes("PASTE_"); }

export function initFirebaseIfNeeded() {
    if (fbReady) return true;
    if (!firebaseConfigured()) { showToast("Sync disabled. Add Firebase keys in the code."); return false; }
    try {
        fbApp = firebase.initializeApp(FIREBASE_CONFIG);
        fbDb = firebase.firestore();
        fbReady = true;
        return true;
    } catch (e) { showToast("Firebase init failed: " + e.message); return false; }
}

export function initFirebaseAuthIfNeeded() {
    if (!initFirebaseIfNeeded()) return false;
    if (!fbAuth) {
        fbAuth = firebase.auth();
        fbAuth.onAuthStateChanged((user) => {
            currentUser = user;
            renderSyncUI();
            if (user) {
                showToast(`Signed in as ${user.displayName || user.email}`);
                startAutoServices();
            } else {
                if (autoSyncInterval) clearInterval(autoSyncInterval);
                if (autoReportInterval) clearInterval(autoReportInterval);
            }
        });
    }
    return true;
}

export async function signInWithGoogle() {
    if (!initFirebaseAuthIfNeeded()) return;
    try {
        let provider = new firebase.auth.GoogleAuthProvider();
        await fbAuth.signInWithPopup(provider);
    } catch (e) { alert("Sign-in failed: " + e.message); }
}

export function signOutOfGoogle() { if (fbAuth) fbAuth.signOut(); }

export async function pushToCloud(silent = false) {
    if (!initFirebaseAuthIfNeeded()) return;
    if (!currentUser) { if (!silent) alert("Sign in first."); return; }
    try {
        await fbDb.collection("users").doc(currentUser.uid).set({
            studyDB: getDB(),
            plannerDB: getPlannerDB(),
            updatedAt: Date.now()
        });
        setRawFlag("jee_last_sync", Date.now().toString());
        renderSyncUI();
        if (!silent) showToast("Saved to the cloud.");
    } catch (e) {
        if (!silent) alert("Save failed: " + e.message);
    }
}

export async function pullFromCloud() {
    if (!initFirebaseAuthIfNeeded()) return;
    if (!currentUser) { alert("Sign in first."); return; }
    if (!confirm("This will REPLACE all study logs and planner tasks on THIS device with your saved cloud data. Continue?")) return;
    try {
        let doc = await fbDb.collection("users").doc(currentUser.uid).get();
        if (!doc.exists) { alert("No cloud data saved yet — tap Save to Cloud first."); return; }
        let data = doc.data();
        saveDB(data.studyDB || {});
        savePlannerDB(data.plannerDB || {});
        setRawFlag("jee_last_sync", Date.now().toString());
        alert("Loaded! The page will reload.");
        location.reload();
    } catch (e) { alert("Load failed: " + e.message); }
}

export async function deleteCloudData() {
    if (!initFirebaseAuthIfNeeded()) return;
    if (!currentUser) { alert("Sign in first."); return; }
    if (!confirm("This will permanently DELETE all your cloud data for this account. Local data on this device will remain. Continue?")) return;
    try {
        await fbDb.collection("users").doc(currentUser.uid).delete();
        clearRawFlag("jee_last_sync");
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
        let last = getRawFlag("jee_last_sync");
        document.getElementById("sync-last").innerText = last ? `Last synced: ${new Date(parseInt(last)).toLocaleString()}` : "Not saved to the cloud yet.";
    } else {
        signedOutBlock.style.display = "block";
        signedInBlock.style.display = "none";
    }
}

// ----------------- AUTO SYNC & AUTO REPORTS -----------------
export function startAutoServices() {
    if (autoSyncInterval) clearInterval(autoSyncInterval);
    if (autoReportInterval) clearInterval(autoReportInterval);

    // Auto Cloud Sync every 2 hours (7,200,000 ms)
    autoSyncInterval = setInterval(() => {
        if (currentUser) { pushToCloud(true); }
    }, 7200000);

    // Auto Email Reports check every 1 minute... (original comment; the
    // actual interval below is 7,200,000ms/2hrs, matching source exactly —
    // flagging the comment/interval mismatch here rather than silently
    // "fixing" it, since it's the original's own inconsistency, not ours)
    autoReportInterval = setInterval(() => {
        if (!currentUser) return;
        let now = new Date();
        let todayKey = getTodayKey();

        // Weekly Report on Sunday
        if (now.getDay() === 0) {
            let flagKey = "weekly_report_sent_" + todayKey;
            if (!getRawFlag(flagKey)) {
                sendReportViaEmail('weekly', true);
                setRawFlag(flagKey, "1");
                setRawFlag("weekly_report_sent_last", todayKey);
            }
        }

        // Monthly Report on last day of month
        let tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        if (tomorrow.getMonth() !== now.getMonth()) {
            let flagKey = "monthly_report_sent_" + todayKey;
            if (!getRawFlag(flagKey)) {
                sendReportViaEmail('monthly', true);
                setRawFlag(flagKey, "1");
                setRawFlag("monthly_report_sent_last", todayKey);
            }
        }
    }, 7200000);
}

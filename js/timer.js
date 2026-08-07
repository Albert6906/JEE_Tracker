import { formatHMS, formatReadable, dateKeyFromWall, getTodayKey } from './utils.js';
import { getDB, saveDB, blankDay, ensureDayShape, initToday, saveActiveSessionRaw, readActiveSessionRaw, clearActiveSessionRaw } from './storage.js';
// Forward references to modules landing in later steps — safe because these
// are only invoked inside function bodies, after the full module graph
// (wired together in main.js, Step 7) has loaded.
import { loadHistoryData } from './history.js';
import { renderGarden, renderHeatmap, renderTrendChart } from './charts.js';

// ----------------- TIMER ENGINE -----------------
let timerState = "IDLE";
window.addEventListener("beforeunload", (e) => {
    if (timerState === "STUDYING" || timerState === "BREAK") {
        e.preventDefault();
        e.returnValue = "A study session is still running. Are you sure you want to leave and stop it?";
        return e.returnValue;
    }
});
let segmentStartPerf = 0;
let segmentStartWallMs = 0;
let segmentElapsedMs = 0;
let sessionStudyMs = 0;
let animFrame = null;
let autosaveInterval = null;
let currentSegmentId = 0;
let openEntryRefs = {};
let currentDayKey = null;
let activeSubject = "Physics";
let activeBreakReason = "Break";

// currentDayKey is read here but written from ui.js (checkDayRollover) and
// main.js (window.onload) — both live in other modules, so they call this
// setter rather than reassigning an imported binding (ES module imports are
// read-only in the importing module).
export function setCurrentDayKey(key) { currentDayKey = key; }
export function getCurrentDayKey() { return currentDayKey; }
export function getTimerState() { return timerState; }
export function getActiveSubject() { return activeSubject; }
export function getSegmentElapsedMs() { return segmentElapsedMs; }
// history.js's per-entry delete functions clear this after splicing an
// array (matches original: `openEntryRefs = {};` inline). Exposed as a
// setter since openEntryRefs is private to this module.
export function resetOpenEntryRefs() { openEntryRefs = {}; }

export function startSegment() {
    segmentStartPerf = performance.now();
    segmentStartWallMs = Date.now();
    segmentElapsedMs = 0;
    persistActiveSession();
}

export function commitActiveSegment() {
    let nowPerf = performance.now();
    segmentElapsedMs = nowPerf - segmentStartPerf;
    if (segmentElapsedMs <= 0) return;
    let wallStart = segmentStartWallMs;
    let wallEnd = wallStart + segmentElapsedMs;
    let db = getDB();
    let cursor = wallStart;
    while (cursor < wallEnd) {
        let cd = new Date(cursor);
        let nextMidnight = new Date(cd.getFullYear(), cd.getMonth(), cd.getDate() + 1, 0, 0, 0, 0).getTime();
        let chunkEnd = Math.min(nextMidnight, wallEnd);
        let chunkMs = chunkEnd - cursor;
        let chunkSec = Math.floor(chunkMs / 1000);
        let dayKey = dateKeyFromWall(cursor);
        if (chunkSec > 0) {
            if (!db[dayKey]) db[dayKey] = blankDay();
            let day = ensureDayShape(db[dayKey]);
            let refKey = `${currentSegmentId}:${dayKey}:${timerState}`;
            let stamp = new Date(chunkEnd).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
            if (timerState === "STUDYING") {
                day.subjects[activeSubject] = (day.subjects[activeSubject] || 0) + chunkSec;
                day.totalStudy += chunkSec;
                let ref = openEntryRefs[refKey];
                if (ref && day.studySessions[ref.index] && day.studySessions[ref.index].subject === activeSubject) {
                    day.studySessions[ref.index].duration += chunkSec;
                    day.studySessions[ref.index].time = stamp;
                } else {
                    day.studySessions.push({ time: stamp, subject: activeSubject, duration: chunkSec });
                    openEntryRefs[refKey] = { index: day.studySessions.length - 1 };
                }
            } else if (timerState === "BREAK") {
                day.totalBreak += chunkSec;
                let ref = openEntryRefs[refKey];
                if (ref && day.breaks[ref.index]) {
                    day.breaks[ref.index].duration += chunkSec;
                    day.breaks[ref.index].time = stamp;
                } else {
                    day.breaks.push({ time: stamp, reason: activeBreakReason, duration: chunkSec });
                    openEntryRefs[refKey] = { index: day.breaks.length - 1 };
                }
            }
        }
        cursor = chunkEnd;
    }
    if (timerState === "STUDYING") sessionStudyMs += segmentElapsedMs;
    saveDB(db);
}

export function flushAndRestartSegment() {
    if (timerState !== "STUDYING" && timerState !== "BREAK") return;
    commitActiveSegment(); startSegment();
}

export function startAutosave() {
    if (autosaveInterval) clearInterval(autosaveInterval);
    autosaveInterval = setInterval(flushAndRestartSegment, 20000);
}

export function persistActiveSession() {
    if (timerState === "STUDYING" || timerState === "BREAK") {
        saveActiveSessionRaw({ state: timerState, activeSubject, activeBreakReason, segmentStartWallMs, sessionStudyMs, dayKey: currentDayKey });
    } else { clearActiveSessionRaw(); }
}

export function clearActiveSession() { clearActiveSessionRaw(); }

export function tryRestoreActiveSession() {
    let raw = readActiveSessionRaw(); if (!raw) return;
    let snap; try { snap = JSON.parse(raw); } catch(e) { clearActiveSessionRaw(); return; }
    if (snap.dayKey && snap.dayKey !== getTodayKey()) { clearActiveSessionRaw(); return; }
    let label = snap.state === "STUDYING" ? `studying ${snap.activeSubject}` : `on a break (${snap.activeBreakReason})`;
    if (confirm(`You had an unfinished session (${label}) running when this tab last closed.\n\nResume it now?`)) {
        timerState = snap.state; activeSubject = snap.activeSubject; activeBreakReason = snap.activeBreakReason; sessionStudyMs = snap.sessionStudyMs || 0; currentSegmentId++; startSegment(); updateUIState(); tick();
    } else { clearActiveSessionRaw(); }
}

export function openSubjectModal() {
    if (timerState === "PAUSED") { resumeStudy(); return; }
    if (timerState === "BREAK") { commitActiveSegment(); cancelAnimationFrame(animFrame); clearActiveSession(); }
    document.getElementById("modal-subject-select").value = activeSubject;
    document.getElementById("subject-modal").style.display = "flex";
}

// BUG FIX: the old inline onclick just hid the modal. If openSubjectModal()
// was entered from BREAK, it had already committed the segment, cancelled
// the tick loop, and cleared the persisted session — so hitting the old
// "Back" left timerState stuck on "BREAK" with no running tick and no
// active-session record: a frozen phantom break. This restarts the break
// segment/tick (mirroring resumeStudy's pattern) before closing the modal.
export function cancelSubjectModal() {
    document.getElementById("subject-modal").style.display = "none";
    if (timerState === "BREAK") {
        // NOT currentSegmentId++ — openSubjectModal()'s BREAK branch (above)
        // never incremented it either, so this is still the same real-world
        // break. Incrementing here would change the refKey commitActiveSegment()
        // uses to find the existing log entry, forking a duplicate break row
        // instead of extending the original one.
        startSegment(); updateUIState(); tick();
    }
}

export function confirmStartStudy() {
    activeSubject = document.getElementById("modal-subject-select").value;
    document.getElementById("subject-modal").style.display = "none";
    timerState = "STUDYING"; currentSegmentId++; startSegment();
    updateUIState(); tick();
}

export function pauseStudy() { commitActiveSegment(); cancelAnimationFrame(animFrame); timerState = "PAUSED"; clearActiveSession(); updateUIState(); }

export function resumeStudy() { timerState = "STUDYING"; currentSegmentId++; startSegment(); updateUIState(); tick(); }

export function takeBreak() {
    commitActiveSegment(); cancelAnimationFrame(animFrame);
    let reason = prompt("Break Reason (e.g. Lunch, Walk, Phone):");
    if (!reason || !reason.trim()) reason = "Short Break";
    activeBreakReason = reason;
    timerState = "BREAK"; currentSegmentId++; startSegment();
    updateUIState(); tick();
}

export function changeSubjectMidSession() { activeSubject = document.getElementById("switch-subject-select").value; updateLiveSummary(); }

export function endDay() {
    commitActiveSegment(); cancelAnimationFrame(animFrame);
    timerState = "IDLE"; segmentElapsedMs = 0; sessionStudyMs = 0; clearActiveSession();
    updateUIState();
    document.getElementById("session-timer").innerText = "00:00:00";
    updateLiveSummary(); loadHistoryData(); renderGarden(); renderHeatmap(); renderTrendChart();
}

export function tick() {
    segmentElapsedMs = performance.now() - segmentStartPerf;
    if (timerState === "STUDYING") document.getElementById("session-timer").innerText = formatHMS(sessionStudyMs + segmentElapsedMs);
    else if (timerState === "BREAK") document.getElementById("session-timer").innerText = formatHMS(segmentElapsedMs);
    updateLiveSummary();
    animFrame = requestAnimationFrame(tick);
}

export function updateUIState() {
    let badge = document.getElementById("status-badge");
    let btnStart = document.getElementById("btn-start");
    let btnPause = document.getElementById("btn-pause");
    let btnBreak = document.getElementById("btn-break");
    let btnStop = document.getElementById("btn-stop");
    let changeSub = document.getElementById("change-subject-box");
    let sessionLabel = document.getElementById("session-label");

    if (timerState === "STUDYING") {
        badge.className = "badge badge-studying"; badge.innerText = `STUDYING: ${activeSubject}`;
        sessionLabel.innerText = "CURRENT SESSION";
        btnStart.style.display = "none"; btnPause.style.display = "inline-block"; btnBreak.style.display = "inline-block"; btnStop.style.display = "inline-block"; changeSub.style.display = "none";
    } else if (timerState === "PAUSED") {
        badge.className = "badge badge-paused"; badge.innerText = `PAUSED (AT DESK)`;
        sessionLabel.innerText = "CURRENT SESSION (paused)";
        btnStart.innerText = "Resume"; btnStart.style.display = "inline-block"; btnPause.style.display = "none"; btnBreak.style.display = "inline-block"; btnStop.style.display = "inline-block"; changeSub.style.display = "block"; document.getElementById("switch-subject-select").value = activeSubject;
    } else if (timerState === "BREAK") {
        badge.className = "badge badge-break"; badge.innerText = `ON BREAK: ${activeBreakReason}`;
        sessionLabel.innerText = "BREAK DURATION";
        btnStart.innerText = "Resume Study"; btnStart.style.display = "inline-block"; btnPause.style.display = "none"; btnBreak.style.display = "none"; btnStop.style.display = "inline-block"; changeSub.style.display = "none";
    } else {
        badge.className = "badge badge-idle"; badge.innerText = `STATUS: IDLE`;
        sessionLabel.innerText = "CURRENT SESSION";
        btnStart.innerText = "Start"; btnStart.style.display = "inline-block"; btnPause.style.display = "none"; btnBreak.style.display = "none"; btnStop.style.display = "none"; changeSub.style.display = "none";
    }
}

export function updateLiveSummary() {
    let db = getDB();
    let day = db[getTodayKey()] || initToday();
    let liveStudySec = (timerState === "STUDYING") ? Math.floor(segmentElapsedMs / 1000) : 0;
    let liveBreakSec = (timerState === "BREAK") ? Math.floor(segmentElapsedMs / 1000) : 0;
    let studyTotal = day.totalStudy + liveStudySec;
    let breakTotal = day.totalBreak + liveBreakSec;
    document.getElementById("accumulated-today").innerText = formatHMS(studyTotal * 1000);
    document.getElementById("live-study-val").innerText = formatReadable(studyTotal);
    document.getElementById("live-break-val").innerText = formatReadable(breakTotal);
    let html = "";
    for (let [cat, sec] of Object.entries(day.subjects)) {
        let add = (timerState === "STUDYING" && activeSubject === cat) ? liveStudySec : 0;
        html += `<div class="stat-row"><span style="color:var(--muted);">${cat}:</span><strong>${formatReadable(sec + add)}</strong></div>`;
    }
    document.getElementById("live-subject-list").innerHTML = html;
}

document.addEventListener("visibilitychange", () => { if (document.hidden) flushAndRestartSegment(); });
window.addEventListener("pagehide", () => { commitActiveSegment(); });

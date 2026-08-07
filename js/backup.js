// backup.js
import { getTodayKey } from './utils.js';
import { downloadBlob } from './ui.js';
import { getDB, saveDB, getPlannerDB, savePlannerDB, getNotifSettings, saveNotifSettings, getAllMockTests, openMockDB, MOCK_STORE, getSleepLog, writeSleepLog, getSleepPending, setSleepPending, getSyllabusProgress, saveSyllabusProgress, markBackupDone } from './storage.js';
import { showToast } from './ui.js';
import { renderSidebarTools } from './planner.js';
import { renderPlannerCalendar } from './planner.js';
import { updateLiveSummary } from './timer.js';
import { loadHistoryData } from './history.js';
import { renderGarden, renderHeatmap, renderTrendChart } from './charts.js';
import { renderSleepLog } from './sleep.js';
import { renderSyllabusTracker } from './syllabus.js';
import { renderMockTestList } from './mocktest.js';
import { renderNotifSettingsUI } from './notifications.js';
import { initToday } from './storage.js';

const NOTIF_DEFAULTS = { enabled: false, breakOverrun: true, breakThresholdMin: 45, plannerReminder: true, examMilestones: true, idleNudge: true, idleThresholdMin: 30, revisionReminder: true, sleepReminder: true, parentLogReminder: true };

export async function exportDataJSON() {
    let mockTests = await getAllMockTests();
    let payload = {
        exportedAt: new Date().toISOString(),
        studyDB: getDB(),
        plannerDB: getPlannerDB(),
        notifSettings: getNotifSettings(),
        mockTests,
        sleepLog: getSleepLog(),
        sleepPending: getSleepPending(),
        syllabusProgress: getSyllabusProgress()
    };
    downloadBlob(JSON.stringify(payload, null, 2), `jee-tracker-backup-${getTodayKey()}.json`, "application/json");
    markBackupDone();
}

export function importDataJSON(file) {
    if (!file) return;
    let reader = new FileReader();
    reader.onload = async (e) => {
        let payload;
        try { payload = JSON.parse(e.target.result); } catch (err) { alert("Couldn't read that file."); return; }
        if (!payload || (!payload.studyDB && !payload.plannerDB && !payload.mockTests && !payload.sleepLog && !payload.syllabusProgress)) { alert("Invalid backup file."); return; }

        let dayCount = payload.studyDB ? Object.keys(payload.studyDB).length : 0;
        let taskDayCount = payload.plannerDB ? Object.keys(payload.plannerDB).length : 0;
        let mockCount = payload.mockTests ? payload.mockTests.length : 0;

        if (!confirm(`Import this backup?\n\n${dayCount} day(s) of study data, ${taskDayCount} day(s) of planner tasks, and ${mockCount} mock test entr${mockCount === 1 ? 'y' : 'ies'}. Continue?`)) return;

        if (payload.studyDB) { let db = getDB(); Object.assign(db, payload.studyDB); saveDB(db); }
        if (payload.plannerDB) { let pdb = getPlannerDB(); Object.assign(pdb, payload.plannerDB); savePlannerDB(pdb); }
        if (payload.notifSettings) { saveNotifSettings({ ...NOTIF_DEFAULTS, ...payload.notifSettings }); renderNotifSettingsUI(); }
        if (payload.mockTests && Array.isArray(payload.mockTests) && payload.mockTests.length) {
            let mdb = await openMockDB();
            let tx = mdb.transaction(MOCK_STORE, "readwrite");
            let store = tx.objectStore(MOCK_STORE);
            payload.mockTests.forEach(entry => store.put(entry));
            await new Promise((resolve) => { tx.oncomplete = resolve; tx.onerror = resolve; });
            renderMockTestList();
        }
        if (payload.sleepLog && typeof payload.sleepLog === "object") { let slog = getSleepLog(); Object.assign(slog, payload.sleepLog); writeSleepLog(slog); renderSleepLog(); }
        if (payload.sleepPending) { setSleepPending(payload.sleepPending); renderSleepLog(); }
        if (payload.syllabusProgress && typeof payload.syllabusProgress === "object") { let sprog = getSyllabusProgress(); Object.assign(sprog, payload.syllabusProgress); saveSyllabusProgress(sprog); renderSyllabusTracker(); }

        initToday(); renderSidebarTools(); renderPlannerCalendar(); updateLiveSummary(); loadHistoryData(); renderGarden(); renderHeatmap(); renderTrendChart();
        showToast(`Backup imported — ${dayCount} day(s), ${mockCount} mock test(s) restored.`);
    };
    reader.readAsText(file);
}
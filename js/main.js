// main.js – JEE Study Tracker v2.0
// Entry point. Imports every module, exposes every function the HTML's
// inline onclick/onchange handlers call onto `window` (ES module functions
// are not global by default), and replicates the original single-file
// version's window.onload initialization sequence exactly.

import { getTodayKey } from './utils.js';
import { getRawFlag, getLastBackupAt, markBackupDone, resetAllData, initToday } from './storage.js';
import {
    setCurrentDayKey, updateLiveSummary, tryRestoreActiveSession, startAutosave,
    openSubjectModal, cancelSubjectModal, confirmStartStudy, pauseStudy,
    takeBreak, endDay, changeSubjectMidSession
} from './timer.js';
import {
    closeSidebar, openSidebarPanel, tickCountdowns,
    renderQuoteOfDay, renderExamYearUI, setExamYear
} from './ui.js';
import { initPlannerCalendar, renderSidebarTools, addTodo, toggleTodo, deleteTodo, addPlannerTask, deletePlannerTask, togglePlannerTask, openPlannerModal, closePlannerModal, calShiftMonth, openDatePicker } from './planner.js';
import { loadHistoryData, deleteStudyLog, deleteBreakLog, deleteStudySessionEntry, deleteBreakEntry, deleteSubjectEntry } from './history.js';
import { saveSleepLog, renderSleepLog, toggleSleepHistory, deleteSleepLogEntry } from './sleep.js';
import { setSyllabusSubject, toggleSyllabusChapterExpand, toggleSyllabusTag } from './syllabus.js';
import { renderMistakeTagPicker, addMockTestEntry, deleteMockTestEntry, viewMockFile, closeMockFileModal, toggleMistakeTag } from './mocktest.js';
import { loadYoutubeLink, toggleYtHistory, ytTogglePlay, ytToggleLoop, ytSetVolume, loadFromYtHistory } from './youtube.js';
import { deleteYtHistoryEntry } from './storage.js';
import { renderHeatmap, renderTrendChart } from './charts.js';
import { downloadDayLog, shareDayLog, downloadReport, sendReportViaEmail } from './reports.js';
import { exportDataJSON, importDataJSON } from './backup.js';
import { renderNotifSettingsUI, enableNotifications, saveNotifSettingsFromUI, stopAlarmLoop } from './notifications.js';
import { firebaseConfigured, initFirebaseAuthIfNeeded, signInWithGoogle, signOutOfGoogle, pushToCloud, pullFromCloud, deleteCloudData, renderSyncUI } from './firebase-sync.js';

// ----------------- WINDOW EXPOSURES -----------------
// Every function referenced by an inline onclick/onchange/onkeypress/oninput
// in index.html (or generated dynamically inside a render function's
// template string) must be attached to window, since ES module scope is not
// global scope. Cross-checked against every handler in index.html plus every
// dynamically-generated handler across all 15 other modules — 59 total.

// timer.js
window.openSubjectModal = openSubjectModal;
window.cancelSubjectModal = cancelSubjectModal;
window.confirmStartStudy = confirmStartStudy;
window.pauseStudy = pauseStudy;
window.takeBreak = takeBreak;
window.endDay = endDay;
window.changeSubjectMidSession = changeSubjectMidSession;

// ui.js
window.closeSidebar = closeSidebar;
window.openSidebarPanel = openSidebarPanel;
window.setExamYear = setExamYear;

// planner.js
window.addTodo = addTodo;
window.toggleTodo = toggleTodo;
window.deleteTodo = deleteTodo;
window.addPlannerTask = addPlannerTask;
window.deletePlannerTask = deletePlannerTask;
window.togglePlannerTask = togglePlannerTask;
window.openPlannerModal = openPlannerModal;
window.closePlannerModal = closePlannerModal;
window.calShiftMonth = calShiftMonth;
window.openDatePicker = openDatePicker;

// history.js
window.loadHistoryData = loadHistoryData;
window.deleteStudyLog = deleteStudyLog;
window.deleteBreakLog = deleteBreakLog;
window.deleteStudySessionEntry = deleteStudySessionEntry;
window.deleteBreakEntry = deleteBreakEntry;
window.deleteSubjectEntry = deleteSubjectEntry;

// sleep.js
window.saveSleepLog = saveSleepLog;
window.toggleSleepHistory = toggleSleepHistory;
window.deleteSleepLogEntry = deleteSleepLogEntry;

// syllabus.js
window.setSyllabusSubject = setSyllabusSubject;
window.toggleSyllabusChapterExpand = toggleSyllabusChapterExpand;
window.toggleSyllabusTag = toggleSyllabusTag;

// mocktest.js
window.addMockTestEntry = addMockTestEntry;
window.deleteMockTestEntry = deleteMockTestEntry;
window.viewMockFile = viewMockFile;
window.closeMockFileModal = closeMockFileModal;
window.toggleMistakeTag = toggleMistakeTag;

// youtube.js
window.loadYoutubeLink = loadYoutubeLink;
window.toggleYtHistory = toggleYtHistory;
window.ytTogglePlay = ytTogglePlay;
window.ytToggleLoop = ytToggleLoop;
window.ytSetVolume = ytSetVolume;
window.loadFromYtHistory = loadFromYtHistory;
window.deleteYtHistoryEntry = deleteYtHistoryEntry;

// reports.js
window.downloadDayLog = downloadDayLog;
window.shareDayLog = shareDayLog;
window.downloadReport = downloadReport;
window.sendReportViaEmail = sendReportViaEmail;

// backup.js / storage.js
window.exportDataJSON = exportDataJSON;
window.importDataJSON = importDataJSON;
window.resetAllData = resetAllData;

// notifications.js
window.enableNotifications = enableNotifications;
window.saveNotifSettingsFromUI = saveNotifSettingsFromUI;
window.stopAlarmLoop = stopAlarmLoop;

// firebase-sync.js
window.signInWithGoogle = signInWithGoogle;
window.signOutOfGoogle = signOutOfGoogle;
window.pushToCloud = pushToCloud;
window.pullFromCloud = pullFromCloud;
window.deleteCloudData = deleteCloudData;

// Note: youtube.js's window.onYouTubeIframeAPIReady is set inside youtube.js
// itself (the external YouTube IFrame API calls it by that exact global
// name) — nothing to wire here.

// ----------------- INIT (matches the original window.onload exactly) -----------------
window.onload = function () {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then(function (registrations) {
            for (let registration of registrations) { registration.unregister(); }
        });
    }
    console.log("✅ App Initialized Successfully");

    let today = getTodayKey();
    setCurrentDayKey(today);

    let picker = document.getElementById("history-picker");
    picker.value = today;
    picker.setAttribute("max", today);

    initToday();
    updateLiveSummary();
    renderSidebarTools();
    loadHistoryData();

    renderQuoteOfDay();
    renderExamYearUI();
    tickCountdowns();
    setInterval(tickCountdowns, 1000);

    renderHeatmap();
    renderTrendChart();
    document.getElementById("mock-date-input").value = today;

    renderMistakeTagPicker();
    renderSleepLog();

    let lastYtLink = getRawFlag("jee_yt_last_link");
    if (lastYtLink) document.getElementById("yt-link-input").value = lastYtLink;

    if (!getLastBackupAt()) markBackupDone();

    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
        navigator.serviceWorker.register('sw.js').catch(() => {});
    }

    initPlannerCalendar();

    tryRestoreActiveSession();
    startAutosave();

    renderNotifSettingsUI();
    renderSyncUI();
    if (firebaseConfigured()) initFirebaseAuthIfNeeded();
};

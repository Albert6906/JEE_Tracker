/* ============================================================
   main.js — the single entry point for the entire app.
   Imports all functionality and binds every HTML-accessible
   function to `window`.
   ============================================================ */

import { initApp } from './ui.js';

// --- Utils & Storage ---
import { getTodayKey, dateKeyFromWall, formatHMS, formatReadable, formatTime12Hour, timeToMinutes, escapeHtml } from './utils.js';
import { initToday, resetAllData } from './storage.js';

// --- Timer ---
import { openSubjectModal, pauseStudy, takeBreak, endDay, changeSubjectMidSession, confirmStartStudy, cancelSubjectModal, updateLiveSummary, startAutosave, tryRestoreActiveSession, flushAndRestartSegment } from './timer.js';

// --- UI ---
import { closeSidebar, openSidebarPanel, setExamYear, showToast, renderQuoteOfDay, checkDayRollover, renderExamYearUI, tickCountdowns } from './ui.js';

// --- Planner ---
import { renderPlannerCalendar, calShiftMonth, openPlannerModal, closePlannerModal, addPlannerTask, togglePlannerTask, deletePlannerTask, renderSidebarTools, addTodo, toggleTodo, deleteTodo, openDatePicker } from './planner.js';

// --- History ---
import { loadHistoryData, deleteStudyLog, deleteBreakLog, deleteSubjectEntry, deleteStudySessionEntry, deleteBreakEntry } from './history.js';

// --- Reports ---
import { downloadDayLog, shareDayLog, downloadReport, sendReportViaEmail } from './reports.js';

// --- Backup ---
import { exportDataJSON, importDataJSON } from './backup.js';

// --- Notifications ---
import { enableNotifications, saveNotifSettingsFromUI, stopAlarmLoop, runNotificationChecks } from './notifications.js';

// --- Sleep ---
import { saveSleepLog, toggleSleepHistory, deleteSleepLogEntry } from './sleep.js';

// --- YouTube ---
// FIXED: Import deleteYtHistoryEntry from youtube.js (where it now lives)
import { loadYoutubeLink, toggleYtHistory, ytTogglePlay, ytToggleLoop, ytSetVolume, deleteYtHistoryEntry } from './youtube.js';

// --- Mock Tests ---
import { addMockTestEntry, deleteMockTestEntry, viewMockFile, closeMockFileModal, toggleMistakeTag } from './mocktest.js';

// --- Syllabus ---
import { toggleSyllabusChapterExpand, toggleSyllabusTag, setSyllabusSubject } from './syllabus.js';

// --- Firebase ---
import { signInWithGoogle, pushToCloud, pullFromCloud, deleteCloudData, signOutOfGoogle } from './firebase-sync.js';

// --- Charts ---
import { renderGarden, renderHeatmap, renderTrendChart } from './charts.js';


// -------------------------------------------------------------
// 1. Expose every function needed by HTML `onclick` attributes
//    as a global property on `window`.
// -------------------------------------------------------------

// Planner
window.addTodo = addTodo;
window.toggleTodo = toggleTodo;
window.deleteTodo = deleteTodo;
window.calShiftMonth = calShiftMonth;
window.openPlannerModal = openPlannerModal;
window.closePlannerModal = closePlannerModal;
window.addPlannerTask = addPlannerTask;
window.togglePlannerTask = togglePlannerTask;
window.deletePlannerTask = deletePlannerTask;
window.openDatePicker = openDatePicker;
window.renderPlannerCalendar = renderPlannerCalendar;
window.renderSidebarTools = renderSidebarTools;

// Timer
window.openSubjectModal = openSubjectModal;
window.pauseStudy = pauseStudy;
window.takeBreak = takeBreak;
window.endDay = endDay;
window.changeSubjectMidSession = changeSubjectMidSession;
window.confirmStartStudy = confirmStartStudy;
window.cancelSubjectModal = cancelSubjectModal;
window.flushAndRestartSegment = flushAndRestartSegment;

// UI
window.closeSidebar = closeSidebar;
window.openSidebarPanel = openSidebarPanel;
window.setExamYear = setExamYear;
window.showToast = showToast;
window.renderQuoteOfDay = renderQuoteOfDay;
window.checkDayRollover = checkDayRollover;
window.renderExamYearUI = renderExamYearUI;
window.tickCountdowns = tickCountdowns;

// History
window.loadHistoryData = loadHistoryData;
window.deleteStudyLog = deleteStudyLog;
window.deleteBreakLog = deleteBreakLog;
window.deleteSubjectEntry = deleteSubjectEntry;
window.deleteStudySessionEntry = deleteStudySessionEntry;
window.deleteBreakEntry = deleteBreakEntry;

// Reports
window.shareDayLog = shareDayLog;
window.downloadDayLog = downloadDayLog;
window.downloadReport = downloadReport;
window.sendReportViaEmail = sendReportViaEmail;

// Backup
window.exportDataJSON = exportDataJSON;
window.importDataJSON = importDataJSON;

// Notifications
window.enableNotifications = enableNotifications;
window.saveNotifSettingsFromUI = saveNotifSettingsFromUI;
window.stopAlarmLoop = stopAlarmLoop;

// Sleep
window.saveSleepLog = saveSleepLog;
window.toggleSleepHistory = toggleSleepHistory;
window.deleteSleepLogEntry = deleteSleepLogEntry;

// YouTube
window.loadYoutubeLink = loadYoutubeLink;
window.toggleYtHistory = toggleYtHistory;
window.ytTogglePlay = ytTogglePlay;
window.ytToggleLoop = ytToggleLoop;
window.ytSetVolume = ytSetVolume;
window.deleteYtHistoryEntry = deleteYtHistoryEntry;

// Mock Tests
window.addMockTestEntry = addMockTestEntry;
window.deleteMockTestEntry = deleteMockTestEntry;
window.viewMockFile = viewMockFile;
window.closeMockFileModal = closeMockFileModal;
window.toggleMistakeTag = toggleMistakeTag;

// Syllabus
window.toggleSyllabusChapterExpand = toggleSyllabusChapterExpand;
window.toggleSyllabusTag = toggleSyllabusTag;
window.setSyllabusSubject = setSyllabusSubject;

// Firebase
window.signInWithGoogle = signInWithGoogle;
window.pushToCloud = pushToCloud;
window.pullFromCloud = pullFromCloud;
window.deleteCloudData = deleteCloudData;
window.signOutOfGoogle = signOutOfGoogle;

// Charts (re-expose for completeness)
window.renderGarden = renderGarden;
window.renderHeatmap = renderHeatmap;
window.renderTrendChart = renderTrendChart;
window.updateLiveSummary = updateLiveSummary;

// Storage
window.resetAllData = resetAllData;

// -------------------------------------------------------------
// 2. Boot the app when the page loads
// -------------------------------------------------------------
window.onload = initApp;

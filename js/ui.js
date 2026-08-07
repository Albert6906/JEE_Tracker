// ui.js
import { shiftDateByYears } from './utils.js';
import { getExamYear, setStoredExamYear, BASE_EXAM_YEAR, BASE_EXAM_DATES } from './storage.js';
import { getCurrentDayKey, setCurrentDayKey, flushAndRestartSegment, updateLiveSummary } from './timer.js';
import { initToday } from './storage.js';
import { renderSidebarTools, renderPlannerCalendar } from './planner.js';
import { loadHistoryData } from './history.js';
import { renderGarden } from './charts.js';
import { runNotificationChecks } from './notifications.js';
import { renderMockTestList } from './mocktest.js';
import { renderSyllabusTracker } from './syllabus.js';

// ----------------- TOASTS -----------------
export function showToast(msg) {
    let stack = document.getElementById("toast-stack");
    let el = document.createElement("div");
    el.className = "toast";
    el.innerText = msg;
    stack.appendChild(el);
    setTimeout(() => el.remove(), 8000);
}

// ----------------- DOWNLOAD BLOB (moved from utils) -----------------
export function downloadBlob(content, filename, mime) {
    let blob = new Blob([content], { type: mime });
    let url = URL.createObjectURL(blob);
    let a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
    showToast(`Exported ${filename}`);
}

// ----------------- SIDEBAR -----------------
let activeSidebarPanel = null;

export function closeSidebar() {
    let sidebar = document.getElementById("sidebar");
    sidebar.classList.remove("expanded");
    document.body.classList.remove("panel-open");
    document.getElementById("panel-planner").style.display = "none";
    document.getElementById("panel-mocktest").style.display = "none";
    document.getElementById("panel-syllabus").style.display = "none";
    document.getElementById("rail-planner-btn").classList.remove("active");
    document.getElementById("rail-mocktest-btn").classList.remove("active");
    document.getElementById("rail-syllabus-btn").classList.remove("active");
    activeSidebarPanel = null;
}

export function openSidebarPanel(name) {
    let sidebar = document.getElementById("sidebar");
    let planner = document.getElementById("panel-planner");
    let mocktest = document.getElementById("panel-mocktest");
    let syllabus = document.getElementById("panel-syllabus");
    let plannerBtn = document.getElementById("rail-planner-btn");
    let mocktestBtn = document.getElementById("rail-mocktest-btn");
    let syllabusBtn = document.getElementById("rail-syllabus-btn");
    if (activeSidebarPanel === name) { closeSidebar(); return; }
    sidebar.classList.add("expanded"); document.body.classList.add("panel-open"); activeSidebarPanel = name;
    planner.style.display = (name === "planner") ? "flex" : "none";
    mocktest.style.display = (name === "mocktest") ? "flex" : "none";
    syllabus.style.display = (name === "syllabus") ? "flex" : "none";
    plannerBtn.classList.toggle("active", name === "planner");
    mocktestBtn.classList.toggle("active", name === "mocktest");
    syllabusBtn.classList.toggle("active", name === "syllabus");
    if (name === "mocktest") renderMockTestList();
    if (name === "syllabus") renderSyllabusTracker();
}

// ----------------- DAY ROLLOVER -----------------
export function checkDayRollover() {
    let nowKey = new Date().toISOString().split('T')[0];
    if (nowKey === getCurrentDayKey()) return;
    flushAndRestartSegment();
    setCurrentDayKey(nowKey);
    renderQuoteOfDay(); initToday(); renderSidebarTools(); updateLiveSummary(); renderPlannerCalendar();
    let picker = document.getElementById("history-picker");
    let maxAttr = picker.getAttribute("max");
    if (picker.value === maxAttr) { picker.value = nowKey; loadHistoryData(); }
    picker.setAttribute("max", nowKey);
}

// ----------------- QUOTE OF THE DAY -----------------
const JEE_QUOTES = [
    { text: "Success is the sum of small efforts repeated day in and day out.", author: "Robert Collier" },
    // ... (rest of quotes unchanged, all 40 entries) ...
    { text: "The rank you want is waiting for the effort you haven't given yet.", author: "Anonymous" }
];

let lastQuoteBucket = null;
export function renderQuoteOfDay() {
    let bucket = Math.floor((Date.now() + 5.5 * 3600000) / (6 * 60 * 60 * 1000));
    lastQuoteBucket = bucket;
    let q = JEE_QUOTES[bucket % JEE_QUOTES.length];
    document.getElementById("quote-of-day").innerHTML = `<span class="quote-text">"${q.text}"</span><span class="quote-author">— ${q.author}</span>`;
}

// ----------------- EXAM YEAR / COUNTDOWNS -----------------
function fmtExamDate(d) { return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); }

let JEE_MAINS_DATE, JEE_MAINS2_DATE, JEE_ADV_DATE;

export function rebuildExamDates() {
    let offset = getExamYear() - BASE_EXAM_YEAR;
    JEE_MAINS_DATE = shiftDateByYears(BASE_EXAM_DATES.mains1, offset);
    JEE_MAINS2_DATE = shiftDateByYears(BASE_EXAM_DATES.mains2, offset);
    JEE_ADV_DATE = shiftDateByYears(BASE_EXAM_DATES.adv, offset);
}
rebuildExamDates();

export function renderExamYearUI() {
    let year = getExamYear();
    document.title = `JEE ${year} Study Tracker & Planner`;
    document.getElementById("app-title-main").innerHTML = `JEE ${year} <span class="app-title-emoji">🎯</span>`;
    document.getElementById("chip-mains1").title = `JEE Main ${year} (Session 1) — ${fmtExamDate(JEE_MAINS_DATE)}`;
    document.getElementById("chip-mains2").title = `JEE Main ${year} (Session 2) — ${fmtExamDate(JEE_MAINS2_DATE)}`;
    document.getElementById("chip-adv").title = `JEE Advanced ${year} — ${fmtExamDate(JEE_ADV_DATE)}`;
    let sel = document.getElementById("exam-year-select");
    if (sel) {
        if (!sel.options.length) {
            for (let y = 2027; y <= 2031; y++) {
                let opt = document.createElement("option");
                opt.value = y; opt.innerText = `JEE ${y}`;
                sel.appendChild(opt);
            }
        }
        sel.value = String(year);
    }
}

export function setExamYear(year) {
    setStoredExamYear(year);
    rebuildExamDates();
    renderExamYearUI();
    tickCountdowns();
}

export function updateCountdown(targetDate, daysElId, subElId) {
    let now = new Date();
    let diffMs = targetDate - now;
    let daysEl = document.getElementById(daysElId);
    if (diffMs <= 0) {
        daysEl.classList.add("exam-today");
        daysEl.innerHTML = "Exam Day! 🎯";
        document.getElementById(subElId).innerText = "All the best!";
        return;
    }
    let totalSec = Math.floor(diffMs / 1000);
    let days = Math.floor(totalSec / 86400) + 1;
    let hrs = Math.floor((totalSec % 86400) / 3600);
    let mins = Math.floor((totalSec % 3600) / 60);
    let secs = totalSec % 60;
    daysEl.classList.remove("exam-today");
    daysEl.innerHTML = `${days}<span class="chip-days-unit">days</span>`;
    document.getElementById(subElId).innerText = `${hrs}h ${mins}m ${secs}s`;
}

export function tickCountdowns() {
    updateCountdown(JEE_MAINS_DATE, "cd-mains-days", "cd-mains-sub");
    updateCountdown(JEE_MAINS2_DATE, "cd-mains2-days", "cd-mains2-sub");
    updateCountdown(JEE_ADV_DATE, "cd-adv-days", "cd-adv-sub");
    checkDayRollover();
    let bucket = Math.floor((Date.now() + 5.5 * 3600000) / (6 * 60 * 60 * 1000));
    if (bucket !== lastQuoteBucket) { renderQuoteOfDay(); lastQuoteBucket = bucket; }
    runNotificationChecks();
    renderGarden();
}
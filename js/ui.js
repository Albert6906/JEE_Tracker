import { shiftDateByYears } from './utils.js';
import { getExamYear, setStoredExamYear, BASE_EXAM_YEAR, BASE_EXAM_DATES, initToday, markBackupDone } from './storage.js';
import { getCurrentDayKey, setCurrentDayKey, flushAndRestartSegment, updateLiveSummary, startAutosave, tryRestoreActiveSession } from './timer.js';
import { renderSidebarTools, renderPlannerCalendar } from './planner.js';
import { loadHistoryData } from './history.js';
import { renderGarden, renderHeatmap, renderTrendChart } from './charts.js';
import { runNotificationChecks, renderNotifSettingsUI } from './notifications.js';
import { renderMockTestList, renderMistakeTagPicker } from './mocktest.js';
import { renderSyllabusTracker } from './syllabus.js';
import { renderSleepLog } from './sleep.js';
import { renderSyncUI } from './firebase-sync.js';

// ----------------- TOASTS -----------------
export function showToast(msg) {
    let stack = document.getElementById("toast-stack");
    let el = document.createElement("div");
    el.className = "toast";
    el.innerText = msg;
    stack.appendChild(el);
    setTimeout(() => el.remove(), 8000);
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
    { text: "The expert in anything was once a beginner.", author: "Helen Hayes" },
    { text: "Don't watch the clock; do what it does. Keep going.", author: "Sam Levenson" },
    { text: "It always seems impossible until it's done.", author: "Nelson Mandela" },
    { text: "Discipline is the bridge between goals and accomplishment.", author: "Jim Rohn" },
    { text: "The pain of discipline weighs ounces, the pain of regret weighs tons.", author: "Jim Rohn" },
    { text: "Hard work beats talent when talent doesn't work hard.", author: "Tim Notke" },
    { text: "You don't have to be great to start, but you have to start to be great.", author: "Zig Ziglar" },
    { text: "The future depends on what you do today.", author: "Mahatma Gandhi" },
    { text: "Push yourself, because no one else is going to do it for you.", author: "Anonymous" },
    { text: "Great things never come from comfort zones.", author: "Anonymous" },
    { text: "Dream it. Wish it. Do it.", author: "Anonymous" },
    { text: "Success doesn't just find you. You have to go out and get it.", author: "Anonymous" },
    { text: "The harder you work for something, the greater you'll feel when you achieve it.", author: "Anonymous" },
    { text: "Don't stop when you're tired. Stop when you're done.", author: "Anonymous" },
    { text: "Wake up with determination. Go to bed with satisfaction.", author: "Anonymous" },
    { text: "Do something today that your future self will thank you for.", author: "Sean Patrick Flanery" },
    { text: "Little things make big days.", author: "Anonymous" },
    { text: "It's going to be hard, but hard does not mean impossible.", author: "Anonymous" },
    { text: "Don't wait for opportunity. Create it.", author: "Anonymous" },
    { text: "Sometimes we're tested not to show our weaknesses, but to discover our strengths.", author: "Anonymous" },
    { text: "The key to success is to focus on goals, not obstacles.", author: "Anonymous" },
    { text: "Dream bigger. Do bigger.", author: "Anonymous" },
    { text: "Don't limit your challenges. Challenge your limits.", author: "Anonymous" },
    { text: "Pressure is a privilege — it means you're in a position to achieve great things.", author: "Billie Jean King" },
    { text: "You were born with wings, don't crawl through life.", author: "Rumi" },
    { text: "To be a champion, you have to believe in yourself when nobody else will.", author: "Sugar Ray Robinson" },
    { text: "Believe in your infinite potential. Your only limitations are those you set upon yourself.", author: "Roy T. Bennett" },
    { text: "Great minds discuss ideas; average minds discuss events; small minds discuss people.", author: "Eleanor Roosevelt" },
    { text: "If your dreams don't scare you, they are too small.", author: "Richard Branson" },
    { text: "The only person you are destined to become is the person you decide to be.", author: "Ralph Waldo Emerson" },
    { text: "Rise above the average, push beyond your limits, and conquer the paper.", author: "Anonymous" },
    { text: "Confidence comes from discipline and training.", author: "Robert Holtz" },
    { text: "Small minds aim for comfort; great minds aim for mastery.", author: "Anonymous" },
    { text: "You have the power to write your own rank. Now go build it.", author: "Anonymous" },
    { text: "Think big, start small, act now.", author: "Robin Sharma" },
    { text: "A mental attitude that is centered on success will attract success.", author: "Anonymous" },
    { text: "Your capacity is infinitely greater than your current effort suggests.", author: "Anonymous" },
    { text: "Refuse to settle for anything less than your absolute best.", author: "Anonymous" },
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

// ----------------- INIT APP (NEWLY ADDED) -----------------
export function initApp() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then(function(registrations) {
            for(let registration of registrations) { registration.unregister(); }
        });
    }
    console.log("✅ App Initialized Successfully");
    let today = new Date().toISOString().split('T')[0];
    setCurrentDayKey(today);

    let picker = document.getElementById("history-picker");
    picker.value = today; picker.setAttribute("max", today);

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

    let lastYtLink = localStorage.getItem("jee_yt_last_link");
    if (lastYtLink) document.getElementById("yt-link-input").value = lastYtLink;
    if (!localStorage.getItem("jee_last_backup")) markBackupDone();
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
        navigator.serviceWorker.register('sw.js').catch(() => {});
    }
    renderPlannerCalendar();
    tryRestoreActiveSession();
    startAutosave();
    renderNotifSettingsUI();
    renderSyncUI();
}

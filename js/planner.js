import { getTodayKey, dateKey, escapeHtml } from './utils.js';
import { getPlannerDB, savePlannerDB } from './storage.js';

let calViewYear, calViewMonth;
let plannerActiveDateKey = null;

// Original inlined this in window.onload: `let now = new Date(); calViewYear
// = now.getFullYear(); calViewMonth = now.getMonth(); renderPlannerCalendar();`
// Exposed here so main.js (Step 7) can call it instead of reaching into this
// module's private state.
export function initPlannerCalendar() {
    let now = new Date();
    calViewYear = now.getFullYear();
    calViewMonth = now.getMonth();
    renderPlannerCalendar();
}

// ----------------- SIDEBAR TODO (today only) -----------------
export function addTodo() {
    let inp = document.getElementById("todo-input"); if (!inp.value.trim()) return;
    let todayKey = getTodayKey(); let db = getPlannerDB();
    if (!db[todayKey]) db[todayKey] = []; db[todayKey].push({ text: inp.value.trim(), done: false }); savePlannerDB(db); inp.value = ""; renderSidebarTools(); renderPlannerCalendar();
}

export function renderSidebarTools() {
    let todayKey = getTodayKey(); let db = getPlannerDB(); let tasks = db[todayKey] || [];
    let todoHtml = ""; if (tasks.length === 0) todoHtml = "<div style='color:var(--muted); font-size:12px; margin-top:8px;'>No tasks for today yet.</div>";
    tasks.forEach((t, i) => { todoHtml += `<div class="todo-item"><input type="checkbox" ${t.done?'checked':''} onchange="toggleTodo(${i})"><span style="flex:1; ${t.done?'text-decoration:line-through;color:var(--muted);':''}">${escapeHtml(t.text)}</span><button class="del" onclick="deleteTodo(${i})">✕</button></div>`; });
    document.getElementById("todo-list").innerHTML = todoHtml;
}

export function toggleTodo(idx) {
    let todayKey = getTodayKey(); let db = getPlannerDB();
    if (!db[todayKey] || !db[todayKey][idx]) return;
    db[todayKey][idx].done = !db[todayKey][idx].done; savePlannerDB(db); renderSidebarTools(); renderPlannerCalendar();
}

export function deleteTodo(idx) {
    let todayKey = getTodayKey(); let db = getPlannerDB();
    if (!db[todayKey]) return;
    db[todayKey].splice(idx, 1); savePlannerDB(db); renderSidebarTools(); renderPlannerCalendar();
}

// ----------------- CALENDAR + PER-DAY PLANNER MODAL -----------------
export function calShiftMonth(delta) {
    calViewMonth += delta;
    if (calViewMonth > 11) { calViewMonth = 0; calViewYear++; }
    if (calViewMonth < 0) { calViewMonth = 11; calViewYear--; }
    renderPlannerCalendar();
}

export function renderPlannerCalendar() {
    const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    document.getElementById("cal-month-label").innerText = `${monthNames[calViewMonth]} ${calViewYear}`;
    let dowRow = document.getElementById("cal-dow-row"); dowRow.innerHTML = ""; ["S","M","T","W","T","F","S"].forEach(d => { dowRow.innerHTML += `<div class="cal-dow">${d}</div>`; });
    let grid = document.getElementById("cal-grid"); grid.innerHTML = "";
    let firstDay = new Date(calViewYear, calViewMonth, 1).getDay(); let daysInMonth = new Date(calViewYear, calViewMonth + 1, 0).getDate();
    let today = new Date(); let todayKey = dateKey(today.getFullYear(), today.getMonth(), today.getDate()); let plannerDB = getPlannerDB();
    for (let i = 0; i < firstDay; i++) grid.innerHTML += `<div class="cal-day empty"></div>`;
    for (let d = 1; d <= daysInMonth; d++) { let key = dateKey(calViewYear, calViewMonth, d); let hasTasks = plannerDB[key] && plannerDB[key].length > 0; let isToday = key === todayKey; grid.innerHTML += `<div class="cal-day ${isToday ? 'today' : ''}" onclick="openPlannerModal('${key}')">${d}${hasTasks ? '<div class="dot"></div>' : ''}</div>`; }
}

export function openPlannerModal(key) {
    plannerActiveDateKey = key; let [y, m, d] = key.split('-'); document.getElementById("planner-modal-title").innerText = `Tasks — ${d}/${m}/${y}`;
    let input = document.getElementById("planner-task-input"); let addBtn = document.getElementById("planner-add-btn"); let note = document.getElementById("planner-past-note"); let isPast = key < getTodayKey();
    input.value = ""; input.disabled = isPast; addBtn.disabled = isPast; addBtn.style.opacity = isPast ? "0.4" : "1"; input.placeholder = isPast ? "Cannot add tasks for a past date" : "Add task for this day..."; note.style.display = isPast ? "block" : "none";
    renderPlannerTasks(); document.getElementById("planner-modal").style.display = "flex";
}

export function closePlannerModal() {
    document.getElementById("planner-modal").style.display = "none"; renderPlannerCalendar(); renderSidebarTools();
}

export function addPlannerTask() {
    if (plannerActiveDateKey < getTodayKey()) return;
    let inp = document.getElementById("planner-task-input"); if (!inp.value.trim()) return;
    let db = getPlannerDB(); if (!db[plannerActiveDateKey]) db[plannerActiveDateKey] = [];
    db[plannerActiveDateKey].push({ text: inp.value.trim(), done: false }); savePlannerDB(db); inp.value = ""; renderPlannerTasks();
}

export function togglePlannerTask(idx) {
    let db = getPlannerDB(); db[plannerActiveDateKey][idx].done = !db[plannerActiveDateKey][idx].done; savePlannerDB(db); renderPlannerTasks();
}

export function deletePlannerTask(idx) {
    let db = getPlannerDB(); db[plannerActiveDateKey].splice(idx, 1); savePlannerDB(db); renderPlannerTasks();
}

export function renderPlannerTasks() {
    let db = getPlannerDB(); let tasks = db[plannerActiveDateKey] || [];
    let html = ""; if (tasks.length === 0) html = "<div style='color:var(--muted); font-size:13px; margin-top:8px;'>No tasks yet.</div>";
    tasks.forEach((t, i) => { html += `<div class="task-item"><input type="checkbox" ${t.done ? 'checked' : ''} onchange="togglePlannerTask(${i})"><span class="task-text ${t.done ? 'done' : ''}">${escapeHtml(t.text)}</span><button class="del" onclick="deletePlannerTask(${i})">✕</button></div>`; });
    document.getElementById("planner-task-list").innerHTML = html;
}

// Also used by index.html directly (calendar date input picker button).
export function openDatePicker(id) {
    let el = document.getElementById(id);
    try { if (el.showPicker) { el.showPicker(); return; } } catch (e) {}
    el.focus();
}

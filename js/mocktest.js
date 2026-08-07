import { escapeHtml, fileToDataURL, getTodayKey } from './utils.js';
import { openMockDB, getAllMockTests, MOCK_STORE } from './storage.js';
// Forward reference — ui.js lands in Step 7. Only called inside function
// bodies, safe once the full module graph is wired in main.js.
import { showToast } from './ui.js';

export const MISTAKE_TAGS = ["Silly mistake", "Concept gap", "Time pressure", "Calculation error", "Misread question", "Not revised", "Panic/anxiety", "Guessed wrong", "Other"];
let selectedMistakeTags = [];

export function renderMistakeTagPicker() {
    let wrap = document.getElementById("mistake-tag-picker");
    if (!wrap) return;
    wrap.innerHTML = MISTAKE_TAGS.map(t => `<span class="mistake-tag-chip ${selectedMistakeTags.includes(t) ? 'selected' : ''}" onclick="toggleMistakeTag('${t.replace(/'/g, "\\'")}')">${t}</span>`).join('');
}

export function toggleMistakeTag(tag) {
    if (selectedMistakeTags.includes(tag)) selectedMistakeTags = selectedMistakeTags.filter(t => t !== tag);
    else selectedMistakeTags.push(tag);
    renderMistakeTagPicker();
}

export function renderMistakeSummary(entries) {
    let summaryEl = document.getElementById("mistake-tag-summary");
    if (!summaryEl) return;
    let counts = {};
    entries.forEach(e => (e.mistakeTags || []).forEach(t => { counts[t] = (counts[t] || 0) + 1; }));
    let tags = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
    if (tags.length === 0) { summaryEl.innerHTML = ""; return; }
    summaryEl.innerHTML = `<div class="small-note" style="margin-bottom:2px;">Mistake pattern frequency:</div><div class="mistake-summary">${tags.map(t => `<span class="ms-pill">${escapeHtml(t)}: ${counts[t]}</span>`).join('')}</div>`;
}

export async function addMockTestEntry() {
    let date = document.getElementById("mock-date-input").value || getTodayKey();
    let subject = document.getElementById("mock-subject-input").value.trim();
    let score = document.getElementById("mock-score-input").value.trim();
    let maxScore = document.getElementById("mock-maxscore-input").value.trim();
    let notes = document.getElementById("mock-notes-input").value.trim();
    let filesInput = document.getElementById("mock-files-input");

    if (!subject) { alert("Enter the exam/subject name first."); return; }
    if (score && maxScore) {
        let sNum = parseFloat(score), mNum = parseFloat(maxScore);
        if (!isNaN(sNum) && !isNaN(mNum) && sNum > mNum) { alert(`Score (${score}) can't be greater than Out of (${maxScore}) — please check the values.`); return; }
    }

    let files = []; for (let f of filesInput.files) files.push(await fileToDataURL(f));
    let entry = { id: Date.now(), date, subject, score, maxScore, notes, files, mistakeTags: [...selectedMistakeTags] };
    let db = await openMockDB();
    let tx = db.transaction(MOCK_STORE, "readwrite");
    tx.objectStore(MOCK_STORE).add(entry);
    tx.oncomplete = () => {
        showToast("Mock test entry saved.");
        document.getElementById("mock-subject-input").value = "";
        document.getElementById("mock-score-input").value = "";
        document.getElementById("mock-maxscore-input").value = "";
        document.getElementById("mock-notes-input").value = "";
        filesInput.value = "";
        selectedMistakeTags = [];
        renderMistakeTagPicker();
        renderMockTestList();
    };
}

export async function deleteMockTestEntry(id) {
    if (!confirm("Delete this mock test entry and its attachments?")) return;
    let db = await openMockDB();
    let tx = db.transaction(MOCK_STORE, "readwrite");
    tx.objectStore(MOCK_STORE).delete(id);
    tx.oncomplete = () => renderMockTestList();
}

export async function renderMockTestList() {
    let list = document.getElementById("mock-test-list");
    let entries = await getAllMockTests();
    renderMistakeSummary(entries);
    if (entries.length === 0) { list.innerHTML = "<div class='small-note' style='margin-top:10px;'>No mock tests logged yet.</div>"; return; }

    let avg = 0, count = 0;
    entries.forEach(e => {
        if (e.score && e.maxScore && parseFloat(e.maxScore) > 0) {
            let pct = (parseFloat(e.score) / parseFloat(e.maxScore)) * 100;
            avg += pct; count++;
        }
    });
    document.getElementById("mock-avg-score").innerText = count > 0 ? Math.round(avg/count) + "%" : "0%";
    document.getElementById("mock-total-count").innerText = entries.length;

    let html = "";
    entries.forEach(e => {
        html += `<div class="mock-entry"><div class="mock-top"><div><strong>${escapeHtml(e.subject)}</strong><div class="small-note" style="margin:0;">${e.date}</div></div><div style="display:flex; align-items:center; gap:8px;"><span class="mock-score">${e.score || '—'}${e.maxScore ? ' / ' + e.maxScore : ''}</span><button class="del" onclick="deleteMockTestEntry(${e.id})">✕</button></div></div>${e.notes ? `<div style="font-size:13px; margin-top:8px; white-space:pre-wrap;">${escapeHtml(e.notes)}</div>` : ''}${(e.mistakeTags && e.mistakeTags.length) ? `<div class="entry-tags">${e.mistakeTags.map(t => `<span>${escapeHtml(t)}</span>`).join('')}</div>` : ''}<div class="mock-files">${(e.files||[]).map((f, i) => f.type.startsWith('image/') ? `<img src="${f.dataUrl}" onclick="viewMockFile(${e.id},${i})">` : `<a class="pdf-chip" href="${f.dataUrl}" download="${f.name}">📄 ${escapeHtml(f.name)}</a>`).join('')}</div></div>`;
    });
    list.innerHTML = html + `<div style="height:40px;"></div>`; // Add bottom padding
}

export async function viewMockFile(entryId, fileIdx) {
    let entries = await getAllMockTests();
    let entry = entries.find(e => e.id === entryId);
    if (!entry) return;
    let f = entry.files[fileIdx];
    document.getElementById("mock-file-modal-body").innerHTML = `<img src="${f.dataUrl}" style="max-width:100%; border-radius:8px;">`;
    document.getElementById("mock-file-modal").style.display = "flex";
}

export function closeMockFileModal() {
    document.getElementById("mock-file-modal").style.display = "none";
}

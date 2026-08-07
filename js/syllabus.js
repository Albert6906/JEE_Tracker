import { escapeHtml } from './utils.js';
import { getSyllabusProgress, saveSyllabusProgress } from './storage.js';

// ----------------- SYLLABUS DATA -----------------
export const SYLLABUS_TAGS = ["Lectures", "Notes", "Revision", "HW", "DPP", "PYQ", "Question Practice", "Tests", "Mistakes"];

export const SYLLABUS_SUBJECTS = {
    "Physics": {
        11: ["Units & Dimensions","Vectors","Kinematics 1D","Kinematics 2D","Laws of Motion (NLM)","Circular Motion","Work Power & Energy","Centre of Mass (COM)","Thermal Properties of Matter","MP of Solids","Rotational Motion","KTG & Thermodynamics","Oscillations","Waves","MP of Fluids","Gravitation"],
        12: ["Electrostatics","Current Electricity","Capacitance","Moving Charges & Magnetism","Magnetism & Matter","EMI","Alternating Current","EM Waves","Ray Optics","Wave Optics","Dual Nature of Radiation & Matter","Atoms","Nuclei","Semiconductors"]
    },
    "Maths": {
        11: ["Basic Maths","Sets","Trig Functions","Trig Equations","Quadratic Equations","Sequences & Series","Relations & Functions","P&C","Binomial Theorem","Limits & Derivatives","Linear Inequalities","Straight Lines","Circles","Parabola","Ellipse","Hyperbola","Probability(XI)","Intro to 3D","Complex Numbers","Statistics","Solution of Triangles"],
        12: ["Determinants","Matrices","Relations & Functions","Inverse Trig Functions","Limits/Continuity/Differentiability","Method of Differentiation","Application of Derivatives","Indefinite/Definite Integration","Application of Integrals","Differential Equations","Vector Algebra","3D Geometry","Probability","Linear Programming"]
    },
    "OC": {
        11: ["IUPAC Nomenclature","GOC","Isomerism","Purification & Analysis"],
        12: ["Optical Isomerism","Hydrocarbon","Haloalkanes & Haloarenes","Alcohols/Phenols/Ethers","Aldehydes/Ketones/Carboxylic Acids","Amines","Biomolecules","Polymers","Chemistry in Everyday Life","Environmental Chemistry"]
    },
    "IOC": {
        11: ["Periodic Table","Chemical Bonding","P Block (11th)","S Block","Hydrogen"],
        12: ["Coordination Compounds","P Block (12th)","D & F Block","Salt Analysis","Metallurgy"]
    },
    "PC": {
        11: ["Mole Concept","Structure of an Atom","States of Matter","Thermodynamics","Redox Reactions","Chemical Equilibrium","Ionic Equilibrium"],
        12: ["Solutions","Chemical Kinetics","Electrochemistry","Solid State","Surface Chemistry"]
    }
};

let activeSyllabusSubject = "Physics";
let expandedSyllabusChapters = {};

export function chapterProgressCount(progress, subject, chapter) {
    let entry = progress[subject + "|" + chapter] || {};
    return SYLLABUS_TAGS.filter(t => entry[t]).length;
}

export function toggleSyllabusChapterExpand(subject, chapter) {
    let key = subject + "|" + chapter;
    expandedSyllabusChapters[key] = !expandedSyllabusChapters[key];
    renderSyllabusTracker();
}

export function toggleSyllabusTag(subject, chapter, tag) {
    let progress = getSyllabusProgress();
    let key = subject + "|" + chapter;
    if (!progress[key]) progress[key] = {};
    progress[key][tag] = !progress[key][tag];
    saveSyllabusProgress(progress);
    renderSyllabusTracker();
}

export function setSyllabusSubject(subject) {
    activeSyllabusSubject = subject;
    renderSyllabusTracker();
}

export function renderSyllabusTracker() {
    let progress = getSyllabusProgress();
    let subjects = Object.keys(SYLLABUS_SUBJECTS);

    document.getElementById("syllabus-subject-tabs").innerHTML = subjects.map(s =>
        `<button class="${s === activeSyllabusSubject ? 'active' : ''}" onclick="setSyllabusSubject('${s.replace(/'/g,"\\'")}')">${escapeHtml(s)}</button>`
    ).join('');

    let totalTasks = 0, doneTasks = 0;
    subjects.forEach(s => {
        [11, 12].forEach(cls => {
            (SYLLABUS_SUBJECTS[s][cls] || []).forEach(ch => {
                totalTasks += SYLLABUS_TAGS.length;
                doneTasks += chapterProgressCount(progress, s, ch);
            });
        });
    });
    let overallPct = totalTasks ? Math.round((doneTasks / totalTasks) * 100) : 0;
    document.getElementById("syllabus-overall").innerHTML = `<div>Overall: <span class="highlight-text">${doneTasks}</span>/${totalTasks} tasks (<span class="highlight-text">${overallPct}%</span>)</div><div class="so-bar-track"><div class="so-bar-fill" style="width:${overallPct}%;"></div></div>`;

    let html = "";
    [11, 12].forEach(cls => {
        let chapters = SYLLABUS_SUBJECTS[activeSyllabusSubject][cls] || [];
        if (chapters.length === 0) return;
        html += `<div class="syllabus-class-header">Class ${cls}</div>`;
        chapters.forEach(ch => {
            let key = activeSyllabusSubject + "|" + ch;
            let done = chapterProgressCount(progress, activeSyllabusSubject, ch);
            let pct = Math.round((done / SYLLABUS_TAGS.length) * 100);
            let isExpanded = !!expandedSyllabusChapters[key];
            let entry = progress[key] || {};
            html += `<div class="syllabus-chapter-card ${isExpanded ? 'expanded' : ''}"><div class="sc-top" onclick="toggleSyllabusChapterExpand('${activeSyllabusSubject.replace(/'/g,"\\'")}','${ch.replace(/'/g,"\\'")}')"><span class="sc-name">${escapeHtml(ch)}</span><span class="sc-badge">${done}/${SYLLABUS_TAGS.length} · ${pct}%</span></div><div class="sc-bar-track"><div class="sc-bar-fill" style="width:${pct}%;"></div></div><div class="syllabus-tag-grid">${SYLLABUS_TAGS.map(t => `<span class="syllabus-tag-chip ${entry[t] ? 'done' : ''}" onclick="event.stopPropagation(); toggleSyllabusTag('${activeSyllabusSubject.replace(/'/g,"\\'")}','${ch.replace(/'/g,"\\'")}','${t}')">${t}</span>`).join('')}</div></div>`;
        });
    });
    document.getElementById("syllabus-chapter-list").innerHTML = html;
}

"""
Laya Demo — Backend
===================
SPDX-License-Identifier: 0BSD
Author : Michael Amador <me@almodover.fr> · github.com/almodover
Repo   : https://github.com/almodover/laya-demo
Model  : Laya by convaiinnovations (https://huggingface.co/convaiinnovations/laya)

Flask service wrapping the Laya decision model (convaiinnovations/laya) that
categorises uploaded TEXT / PDF / EPUB content into 79+ calibrated dimensions
(genre, emotion, theme, style), rendered as blue percentage bars in the UI.

Long documents are split into model-sized chunks; every question is evaluated
on every chunk in ONE parallel forward pass per chunk, and calibrated
probabilities are averaged across the whole document.

Analysis runs as a background job with progress reporting:
    POST /api/analyze          -> {job_id}
    GET  /api/job/<id>         -> {status, progress, result | error}

Run:  python server.py

Questions, bugs, ideas: Michael Amador <me@almodover.fr>
"""

__author__ = "Michael Amador"
__email__ = "me@almodover.fr"

import os
import re
import time
import html
import json
import uuid
import base64
import tempfile
import threading
import traceback

# Avoid the transformers/TensorFlow import deadlock that can hang laya.load().
os.environ.setdefault("USE_TF", "0")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

from flask import Flask, request, jsonify, Response, send_from_directory

import laya
import torch

# --------------------------------------------------------------------------- #
# Device / speed tuning
#   LAYA_DEVICE  : cuda (default when a GPU is visible — ROCm reports as cuda) | cpu
#   LAYA_COMPILE : 1 (default on GPU) torch.compile the encoder, dynamic shapes
#   LAYA_PRELOAD : comma list of checkpoints loaded + compiled at startup
#   LAYA_THREADS : torch intra-op threads for the CPU path
#   LAYA_DTYPE   : bf16 (default, fast) | fp32 (max fidelity) — CPU path only;
#                  on GPU laya itself autocasts to the checkpoint's amp dtype.
#
# Measured 2026-09-22 on one 81-question chunk (27.7k tokens), gfx1151:
#   CPU bf16, 16 threads 26-28 s | 32 threads 26 s
#   GPU eager 1.65 s | GPU compiled 1.03 s (english) / 0.43 s (multilingual)
# Compiling costs 24-28 s once per checkpoint, which is why it happens at
# startup (LAYA_PRELOAD) instead of on somebody's first upload. dynamic=True
# means a different chunk length does not recompile (checked 60-1500 chars).
# --------------------------------------------------------------------------- #
LAYA_THREADS = int(os.environ.get("LAYA_THREADS",
                                os.environ.get("OMP_NUM_THREADS",
                                              str(os.cpu_count() or 12))))
LAYA_DTYPE = os.environ.get("LAYA_DTYPE", "bf16").lower()
torch.set_num_threads(LAYA_THREADS)
LAYA_DEVICE = os.environ.get("LAYA_DEVICE") or ("cuda" if torch.cuda.is_available() else "cpu")
LAYA_COMPILE = os.environ.get("LAYA_COMPILE", "1" if LAYA_DEVICE == "cuda" else "0") == "1"
LAYA_PRELOAD = [m for m in os.environ.get("LAYA_PRELOAD", "").split(",") if m.strip()]

# --------------------------------------------------------------------------- #
# Thermal governor. Written after, on the author's machine, back-to-back
# GPU benchmarks of this very service tripped acpitz critical (101 C) and the
# kernel did a HARDWARE PROTECTION shutdown. Measured afterwards: the english
# checkpoint compiled pulls ~145 W and acpitz climbs ~2.5 C per 1 s chunk, so an
# 8-chunk document from 77 C would end near 97 C; it also sheds ~5 C/s once the
# GPU idles. So: before every chunk (and before every load/compile), if acpitz
# is at or above SOFT, sleep until it is back to RESUME. Costs a few seconds on
# a long document, never a reboot.
# --------------------------------------------------------------------------- #
THERMAL_ZONE = os.environ.get("LAYA_THERMAL_ZONE", "/sys/class/thermal/thermal_zone0/temp")
THERMAL_SOFT = float(os.environ.get("LAYA_THERMAL_SOFT", "78"))
THERMAL_RESUME = float(os.environ.get("LAYA_THERMAL_RESUME", "72"))
THERMAL_MAX_WAIT = float(os.environ.get("LAYA_THERMAL_MAX_WAIT", "120"))


def acpi_temp():
    try:
        with open(THERMAL_ZONE) as fh:
            return int(fh.read()) / 1000.0
    except Exception:
        return None


def thermal_gate(job_id=None):
    """Block while the box is too hot. Returns seconds spent cooling."""
    t = acpi_temp()
    if t is None or t < THERMAL_SOFT:
        return 0.0
    t0 = time.time()
    print(f"[laya] thermal: acpitz {t:.0f} C >= {THERMAL_SOFT:.0f}, cooling to "
          f"{THERMAL_RESUME:.0f}", flush=True)
    while True:
        if job_id:
            _job_update(job_id, cooling=True, temp=t)
        time.sleep(0.5)
        t = acpi_temp()
        if t is None or t <= THERMAL_RESUME:
            break
        if time.time() - t0 > THERMAL_MAX_WAIT:
            # Something else is heating the box (a build, another tenant).
            # Refuse to add GPU load on top of it rather than wait forever.
            raise RuntimeError(f"box too hot to continue (acpitz {t:.0f} C "
                               f"after {THERMAL_MAX_WAIT:.0f} s of cooling)")
    if job_id:
        _job_update(job_id, cooling=False, temp=t)
    waited = time.time() - t0
    print(f"[laya] thermal: resumed at {t:.0f} C after {waited:.1f}s", flush=True)
    return waited


class _AutoCastModel:
    """Wraps the laya backbone so every op runs under CPU bf16 autocast."""

    def __init__(self, model, dtype):
        object.__setattr__(self, "_m", model)
        object.__setattr__(self, "_d", dtype)

    def __call__(self, *a, **k):
        with torch.autocast(device_type="cpu", dtype=self._d):
            return self._m(*a, **k)

    def __getattr__(self, n):
        return getattr(object.__getattribute__(self, "_m"), n)

    def __setattr__(self, n, v):
        setattr(object.__getattribute__(self, "_m"), n, v)

# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #
PORT = int(os.environ.get("LAYA_PORT", "5001"))
HOST = os.environ.get("LAYA_HOST", "0.0.0.0")  # LAN-reachable by convention on the Z2; boundary is the firewall
DEFAULT_MODEL = os.environ.get("LAYA_MODEL", "english")  # english | multilingual

# Chunking: the model sees ~max_len tokens; ~1500 chars is a safe window.
CHUNK_CHARS = 1500
CHUNK_OVERLAP = 150
MAX_CHUNKS = int(os.environ.get("LAYA_MAX_CHUNKS", "8"))  # evenly sampled across the document (cap latency)

app = Flask(__name__, static_folder=None)
app.config["MAX_CONTENT_LENGTH"] = 256 * 1024 * 1024  # 256 MB cap

STATE_KEY = "text"

# --------------------------------------------------------------------------- #
# Dimension catalogue — 79 noul stats + 2 choice verdicts.
# Each noul question returns a calibrated probability (0..1).
# --------------------------------------------------------------------------- #
DIMENSIONS = [
    ("Genre Signals", [
        ("Fiction", "Is the content imagined / narrative fiction rather than fact?"),
        ("Non-fiction", "Is the content factual, expository or documentary?"),
        ("Poetry", "Does it use verse, meter, line breaks or poetic devices?"),
        ("Prose Narrative", "Is it written as continuous prose storytelling?"),
        ("Memoir / Biography", "Is it a true-life account of a person's life?"),
        ("Sci-Fi", "Does it feature science, technology or future concepts?"),
        ("Fantasy", "Does it involve magic, mythic creatures or imagined worlds?"),
        ("Horror", "Does it aim to disturb, dread or unsettle the reader?"),
        ("Mystery", "Does it centre on an enigma to be solved?"),
        ("Thriller", "Is it high-stakes, fast and tension-driven?"),
        ("Romance", "Are love and relationships a central force?"),
        ("Historical Fiction", "Is the setting convincingly rooted in a real past era?"),
        ("Adventure", "Does it follow perilous, action-forward quests?"),
        ("Dystopian", "Does it depict a degraded, controlled society?"),
        ("Satire / Comedy", "Does it use humour, irony or ridicule?"),
        ("Detective / Crime", "Does it follow investigations and criminal matters?"),
        ("Fairy Tale / Myth", "Does it draw on folklore, fables or origin myths?"),
        ("Graphic / Visual Narrative", "Is it structured as sequential art or script?"),
    ]),
    ("Emotions & Mood", [
        ("Romance", "Is there romantic affection or relationship tension?"),
        ("Anger", "Is there hostility, rage or frustration?"),
        ("Dread / Terror", "Is there mounting fear or horror?"),
        ("Happiness / Joy", "Is the tone upbeat, joyful and light?"),
        ("Sadness / Melancholy", "Does it evoke grief, loss or wistfulness?"),
        ("Fear", "Is there immediate threat or anxiety?"),
        ("Suspense / Tension", "Is there sustained anticipation and unease?"),
        ("Hope", "Does it carry optimism and forward light?"),
        ("Nostalgia", "Does it wistfully recall the past?"),
        ("Wonder / Awe", "Does it inspire astonishment or the sublime?"),
        ("Serenity", "Is it calm, peaceful and composed?"),
        ("Excitement", "Is it energetic, thrilling and stimulating?"),
        ("Irony", "Does it employ irony, wit or sarcasm?"),
        ("Angst", "Does it convey inner turmoil and unease?"),
        ("Whimsy", "Is it playfully fanciful and light?"),
        ("Triumph", "Does it celebrate victory or overcoming?"),
        ("Guilt", "Is there remorse or culpability?"),
        ("Disgust", "Does it evoke revulsion?"),
        ("Compassion", "Does it evoke empathy and tenderness?"),
        ("Bittersweet", "Does it blend pleasure and sorrow?"),
        ("Curiosity", "Does it provoke questioning and intrigue?"),
        ("Nostalgic Longing", "Does it yearn for what is gone?"),
        ("Catharsis", "Does it deliver emotional release?"),
        ("Determination", "Is there resolute purpose and will?"),
    ]),
    ("Themes", [
        ("Love", "Is love a driving theme?"),
        ("War", "Does it depict or reflect conflict and battle?"),
        ("Revenge", "Does it pursue payback or justice through retribution?"),
        ("Redemption", "Does it pursue forgiveness or salvation?"),
        ("Betrayal", "Does it feature treachery or broken trust?"),
        ("Survival", "Does it centre on staying alive / overcoming odds?"),
        ("Identity", "Does it explore selfhood and belonging?"),
        ("Freedom", "Does it champion liberty or oppression?"),
        ("Justice", "Does it weigh right, law and fairness?"),
        ("Power & Corruption", "Does it explore authority and its abuse?"),
        ("Family", "Does it centre familial bonds and duty?"),
        ("Coming-of-age", "Does it track growth from youth to adulthood?"),
        ("Isolation", "Does it portray solitude or alienation?"),
        ("Nature vs Technology", "Does it contrast the natural and the machine?"),
        ("Time", "Does it meditate on time, memory or change?"),
        ("Adventure", "Does it pursue bold expeditions?"),
        ("Friendship", "Does it emphasise bonds between peers?"),
        ("Sacrifice", "Does it demand costly giving?"),
        ("Destiny / Fate", "Does it hinge on predestination?"),
        ("Discovery", "Does it follow new revelations or lands?"),
        ("Greed", "Does it depict ambition for more?"),
        ("Courage", "Does it require bravery against fear?"),
        ("Good vs Evil", "Does it frame a clear moral conflict?"),
    ]),
    ("Style & Craft", [
        ("Descriptive", "Is it rich in sensory detail and imagery?"),
        ("Dialogue-driven", "Is it carried largely by conversation?"),
        ("Fast-paced", "Does it move quickly with short beats?"),
        ("Lyrical", "Is the language musical and expressive?"),
        ("Technical / Dense", "Is it information-heavy and precise?"),
        ("Journalistic", "Is it objective, report-style?"),
        ("Informative", "Does it aim to instruct or explain?"),
        ("Persuasive", "Does it seek to convince or argue?"),
        ("Archaic Language", "Does it use older, formal diction?"),
        ("Modern Colloquial", "Does it sound contemporary and casual?"),
        ("Dark Tone", "Is it gloomy, grim or somber?"),
        ("Minimalist", "Is it spare, terse and understated?"),
        ("Ornate", "Is it elaborate and richly decorated?"),
        ("First-Person POV", "Is it narrated from an 'I' perspective?"),
        ("Cinematic", "Does it read like visible, staged scenes?"),
    ]),
]

_CHOICE_QUESTIONS = {
    "primary_genre": {
        "type": "choice",
        "instructions": "Which single genre most strongly describes this text?",
        "criteria": {
            "fiction": "imagined narrative",
            "nonfiction": "factual writing",
            "poetry": "verse / poetry",
            "sci-fi": "science & future",
            "fantasy": "magic & myth",
            "horror": "dread & fear",
            "mystery": "puzzle to solve",
            "thriller": "tension & stakes",
            "romance": "love stories",
            "historical": "past settings",
            "adventure": "perilous quests",
            "biography": "true life accounts",
        },
    },
    "dominant_mood": {
        "type": "choice",
        "instructions": "Which single mood is dominant in this text?",
        "criteria": {
            "happy": "upbeat and joyful",
            "tense": "suspenseful and anxious",
            "sad": "griefful and melancholy",
            "hopeful": "optimistic and bright",
            "dark": "gloomy and grim",
            "calm": "peaceful and serene",
            "angry": "hostile and fierce",
            "whimsical": "playful and fanciful",
        },
    },
}

# Flat question map used by the model (one parallel pass per chunk).
_QUESTIONS = {}
_DIM_ORDER = []


def _qkey(cat, name):
    c = re.sub(r"[^a-z0-9]+", "_", cat.lower()).strip("_")
    n = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")
    return f"{c}__{n}"


for _cat, _items in DIMENSIONS:
    for _name, _desc in _items:
        _k = _qkey(_cat, _name)
        _DIM_ORDER.append((_cat, _name, _k))
        _QUESTIONS[_k] = {
            "type": "noul",
            "instructions": (
                f"Look at the whole text. Does it exhibit {(_name.lower())} "
                f"({_desc}) Answer with a probability: high if prominent, "
                f"low if absent or marginal."
            ),
        }
_QUESTIONS.update(_CHOICE_QUESTIONS)


# --------------------------------------------------------------------------- #
# Text extraction helpers
# --------------------------------------------------------------------------- #
_TAG_RE = re.compile(r"(?s)<[^>]+>")
_BR_RE = re.compile(r"(?s)\s*<br\s*/?>\s*")
_MULTI_WS = re.compile(r"[ \t\f\v]+")
_EXTRA_BLANKS = re.compile(r"(?s)[ ]*\n[ ]*\n[ ]*\n+")


def _strip_html(text: str) -> str:
    text = _BR_RE.sub("\n", text)
    text = _TAG_RE.sub("", text)
    text = html.unescape(text)
    return text


def extract_from_epub(path: str) -> str:
    try:
        from lxml import etree
    except ImportError:
        return ""

    def _text_from_html(raw: bytes) -> list:
        out = []
        try:
            tree = etree.fromstring(raw, parser=etree.HTMLParser(recover=True))
        except Exception:
            return out
        for tag in ("p", "h1", "h2", "h3", "h4", "li", "figcaption", "blockquote"):
            for el in tree.iter(tag):
                t = _strip_html(etree.tostring(el, encoding="unicode")).strip()
                if t:
                    out.append(t)
        return out

    # Preferred path: ebooklib (respects spine order).
    items_content = []
    try:
        import ebooklib
        from ebooklib import epub
        book = epub.read_epub(path)
        for item in book.get_items_of_type(ebooklib.ITEM_DOCUMENT):
            try:
                items_content.append(item.get_content())
            except Exception:
                continue
    except Exception:
        items_content = []

    # Fallback: read the zip directly (tolerates broken spine / missing ncx).
    if not items_content:
        try:
            import zipfile
            with zipfile.ZipFile(path) as zf:
                names = sorted(n for n in zf.namelist()
                              if n.lower().endswith((".xhtml", ".html", ".htm")))
                for n in names:
                    try:
                        items_content.append(zf.read(n))
                    except Exception:
                        continue
        except Exception:
            return ""

    out = []
    for raw in items_content:
        try:
            raw = raw if isinstance(raw, bytes) else str(raw).encode("utf-8", "ignore")
            out.extend(_text_from_html(raw))
        except Exception:
            continue

    text = "\n\n".join(out)
    text = _MULTI_WS.sub(" ", text)
    text = _EXTRA_BLANKS.sub("\n\n", text)
    return text.strip()


def extract_from_pdf(path: str) -> str:
    try:
        from pypdf import PdfReader
    except ImportError:
        return ""
    try:
        reader = PdfReader(path)
        pages = []
        for page in reader.pages:
            try:
                pages.append(page.extract_text() or "")
            except Exception:
                pages.append("")
        return ("\n\n".join(pages)).strip()
    except Exception:
        return ""


def read_plain_text(path: str) -> str:
    for enc in ("utf-8-sig", "utf-8", "latin-1", "cp1252"):
        try:
            with open(path, "r", encoding=enc, errors="ignore") as fh:
                return fh.read()
        except Exception:
            continue
    return ""


def detect_non_latin(text: str) -> bool:
    letters = re.findall(r"[^\W\d_]", text, flags=re.UNICODE)
    if not letters:
        return False
    non_latin = sum(1 for ch in letters if ord(ch) > 0x2131)
    return (non_latin / len(letters)) > 0.10


# --------------------------------------------------------------------------- #
# Chunking — split text into model-sized windows, sampled across the document
# --------------------------------------------------------------------------- #
_SENT_RE = re.compile(r"(?<=[.!?\u2026])\s+|\n+")


def chunk_text(text: str, size: int = CHUNK_CHARS, overlap: int = CHUNK_OVERLAP,
              max_chunks: int = MAX_CHUNKS):
    """Split into sentence-packed windows of ~`size` chars. If there are more
    than `max_chunks`, sample evenly (keeps beginning, middle and end)."""
    if len(text) <= size:
        return [text]
    sentences = [s.strip() for s in _SENT_RE.split(text) if s and s.strip()]
    chunks, buf = [], ""
    for s in sentences:
        if len(buf) + len(s) + 1 > size and buf:
            chunks.append(buf.strip())
            buf = buf[-overlap:] + " " + s if overlap else s
        else:
            buf = (buf + " " + s).strip() if buf else s
    if buf.strip():
        chunks.append(buf.strip())
    # Drop degenerate tiny chunks
    chunks = [c for c in chunks if len(c) > 40] or [text[:size]]
    if len(chunks) <= max_chunks:
        return chunks
    step = (len(chunks) - 1) / (max_chunks - 1)
    idx = sorted({round(i * step) for i in range(max_chunks)})
    return [chunks[i] for i in idx]


# --------------------------------------------------------------------------- #
# Model cache
# --------------------------------------------------------------------------- #
_agent_cache = {}
_agent_lock = threading.Lock()
# One iGPU: forward passes are serialised so two uploads queue instead of
# doubling activation memory and fighting over the same CUs.
_infer_lock = threading.Lock()
_warm = {"state": "idle"}


def _preload():
    _warm["state"] = "warming"
    try:
        for m in LAYA_PRELOAD:
            thermal_gate()
            with _infer_lock:
                get_agent(m.strip())
        _warm["state"] = "ready"
    except Exception as e:
        traceback.print_exc()
        _warm["state"] = f"error: {e}"


def get_agent(model: str):
    key = model or DEFAULT_MODEL
    with _agent_lock:
        if key not in _agent_cache:
            t0 = time.time()
            if key == "multilingual":
                agent = laya.load("convaiinnovations/laya", device=LAYA_DEVICE,
                                  subfolder="multilingual")
            else:
                agent = laya.load("convaiinnovations/laya", device=LAYA_DEVICE)
            if LAYA_COMPILE and agent.device.type == "cuda":
                agent.model.encoder = torch.compile(agent.model.encoder, dynamic=True)
                # Pay the compile now, under the lock, not on the first request.
                agent.system_one({STATE_KEY: "warm up " * 40}, _QUESTIONS)
                torch.cuda.synchronize()
                print("[laya] encoder compiled + warmed", flush=True)
            # Fast CPU path: bf16 autocast (~2x vs fp32) unless disabled.
            try:
                bf16_ok = True  # Zen5/AVX512-BF16 capable; verified locally.
                try:
                    props = getattr(torch.cpu, "list_properties", None)
                    if props is not None:
                        bf16_ok = bool(props().bf16)
                except Exception:
                    pass
                if LAYA_DTYPE == "bf16" and agent.device.type == "cpu" and bf16_ok:
                    agent.model = _AutoCastModel(agent.model, torch.bfloat16)
                    print("[laya] CPU bf16 autocast enabled", flush=True)
            except Exception as e:
                print("[laya] bf16 wrap skipped:", e, flush=True)
            _agent_cache[key] = (agent, time.time() - t0)
            print(f"[laya] loaded '{key}' checkpoint on {agent.device} "
                  f"in {time.time()-t0:.1f}s", flush=True)
        return _agent_cache[key][0]


# --------------------------------------------------------------------------- #
# Job store (background analysis with progress)
# --------------------------------------------------------------------------- #
_jobs = {}
_jobs_lock = threading.Lock()


def _job_update(job_id, **kw):
    with _jobs_lock:
        _jobs.setdefault(job_id, {}).update(kw)


def run_analysis(job_id, text, filename, model):
    try:
        _job_update(job_id, status="running", progress=0.0)
        chunks = chunk_text(text)
        n = len(chunks)
        _job_update(job_id, chunks=n)

        # Load model (may take a while first time) — report as stage 0
        thermal_gate(job_id)
        with _infer_lock:  # a first load compiles on the GPU too
            agent = get_agent(model)
        _job_update(job_id, progress=0.05)

        noul_sum = {qk: 0.0 for (c, nm, qk) in _DIM_ORDER}
        choice_sum = {k: {} for k in _CHOICE_QUESTIONS}
        t_pred = time.time()

        cooled = 0.0
        for i, chunk in enumerate(chunks):
            cooled += thermal_gate(job_id)
            with _infer_lock:
                answers = agent.system_one({STATE_KEY: chunk}, _QUESTIONS)["answers"]
            for (cat, name, qk) in _DIM_ORDER:
                noul_sum[qk] += float(answers.get(qk, {}).get("noul", 0.0) or 0.0)
            for ck in _CHOICE_QUESTIONS:
                probs = answers.get(ck, {}).get("probabilities", {}) or {}
                for opt, pv in probs.items():
                    choice_sum[ck][opt] = choice_sum[ck].get(opt, 0.0) + float(pv)
            _job_update(job_id, progress=0.05 + 0.9 * (i + 1) / n)

        elapsed_ms = (time.time() - t_pred - cooled) * 1000

        # ---- average noul probabilities across chunks ---- #
        stats = {}
        flat = []
        for cat, items in DIMENSIONS:
            cat_out = []
            for name, _desc in items:
                k = _qkey(cat, name)
                raw = noul_sum[k] / max(1, n)
                pct = round(max(0.0, min(100.0, raw * 100.0)), 1)
                cat_out.append({"name": name, "pct": pct, "raw": round(raw, 4)})
                flat.append((name, cat, pct))
            cat_out.sort(key=lambda r: r["pct"], reverse=True)
            stats[cat] = cat_out

        flat.sort(key=lambda r: r[2], reverse=True)
        top_signals = [{"name": nm, "category": c, "pct": p} for nm, c, p in flat[:6]]

        # ---- averaged choice verdicts ---- #
        choice_out = {}
        for ck in _CHOICE_QUESTIONS:
            total = sum(choice_sum[ck].values()) or 1.0
            avg = {k: v / total for k, v in choice_sum[ck].items()}
            top = sorted(((k, round(v * 100, 1)) for k, v in avg.items()),
                        key=lambda kv: kv[1], reverse=True)
            answer, conf = top[0] if top else ("unknown", 0.0)
            choice_out[ck] = {
                "answer": answer,
                "confidence": conf,
                "top_options": top[:5],
            }

        result = {
            "filename": filename,
            "words": len(re.findall(r"\S+", text)),
            "chars": len(text),
            "chunks": n,
            "model": model,
            "dimensions": len(_DIM_ORDER),
            "latency_ms": round(elapsed_ms, 1),
            "cooling_ms": round(cooled * 1000, 1),
            "device": LAYA_DEVICE,
            "stats": stats,
            "top_signals": top_signals,
            "choice": choice_out,
        }
        _job_update(job_id, status="done", progress=1.0, result=result)
    except Exception as e:
        traceback.print_exc()
        _job_update(job_id, status="error", error=str(e))


# --------------------------------------------------------------------------- #
# Endpoints
# --------------------------------------------------------------------------- #
@app.route("/")
def index():
    return send_from_directory(os.path.dirname(os.path.abspath(__file__)),
                              "laya_webui.html")


@app.route("/laya_webui.js")
def ui_js():
    return send_from_directory(os.path.dirname(os.path.abspath(__file__)),
                              "laya_webui.js", mimetype="application/javascript")


@app.route("/api/health")
@app.route("/health")
def health():
    return jsonify({
        "status": "ok",
        "app": "Laya Demo",
        "author": "Michael Amador <me@almodover.fr>",
        "model": DEFAULT_MODEL,
        "loaded": list(_agent_cache.keys()),
        "dimensions": len(_DIM_ORDER) + len(_CHOICE_QUESTIONS),
        "device": LAYA_DEVICE,
        "compiled": LAYA_COMPILE,
        "warm": _warm["state"],
        "acpitz": acpi_temp(),
        "thermal": {"soft": THERMAL_SOFT, "resume": THERMAL_RESUME},
        "dtype": LAYA_DTYPE if LAYA_DEVICE == "cpu" else "bf16 (amp)",
        "threads": LAYA_THREADS,
    })


@app.route("/ready")
def ready():
    """200 once the preloaded checkpoints are compiled — the panel's probe.
    /health answers 200 as soon as Flask is up, which would show the slot as
    ready a minute before the first analysis could run at full speed."""
    ok = not LAYA_PRELOAD or _warm["state"] == "ready"
    return jsonify({"ready": ok, "warm": _warm["state"]}), (200 if ok else 503)


@app.route("/predict", methods=["POST"])
def predict_compat():
    """Raw Laya passthrough for programmatic callers.

    Body: {"state": <str|dict|list>, "questions": {...}, "model": "english|multilingual"}
    Returns laya's raw system_one result.
    """
    j = request.get_json(silent=True) or {}
    if "state" not in j or "questions" not in j:
        return jsonify({"error": "need 'state' and 'questions'"}), 400
    model = j.get("model") or DEFAULT_MODEL
    try:
        thermal_gate()
        with _infer_lock:
            agent = get_agent(model)
            result = agent.system_one(j["state"], j["questions"])
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/presets")
def presets():
    """Back-compat: the built-in laya question sets."""
    out = {}
    for name, fn in (("triage", laya.triage_questions),
                    ("moderation", laya.moderation_questions),
                    ("guard", laya.guard_questions),
                    ("router", laya.router_questions),
                    ("email", laya.email_questions)):
        try:
            out[name] = fn()
        except Exception as e:
            out[name] = {"error": str(e)}
    return jsonify(out)


@app.route("/examples")
def examples():
    return jsonify([])


@app.route("/api/analyze", methods=["POST"])
def analyze():
    text = ""
    filename = "pasted text"
    model = request.form.get("model") or request.args.get("model") or DEFAULT_MODEL

    if request.files and "file" in request.files:
        upload = request.files["file"]
        if upload and upload.filename:
            filename = upload.filename
            path = None
            try:
                fd, path = tempfile.mkstemp()
                os.close(fd)
                upload.save(path)
                low = filename.lower()
                if low.endswith((".epub", ".ep3")):
                    text = extract_from_epub(path)
                elif low.endswith(".pdf"):
                    text = extract_from_pdf(path)
                else:
                    text = read_plain_text(path)
            finally:
                try:
                    if path and os.path.exists(path):
                        os.remove(path)
                except Exception:
                    pass
    elif request.get_json(silent=True):
        j = request.get_json(silent=True) or {}
        if j.get("text"):
            text = str(j["text"])
        elif j.get("base64"):
            try:
                text = base64.b64decode(j["base64"]).decode("utf-8", "ignore")
            except Exception:
                text = ""
        model = j.get("model", model)
        filename = j.get("filename", filename)

    if request.form.get("text"):
        text = request.form["text"]

    text = (text or "").strip()
    if not text:
        return jsonify({"error": "No text provided. Send a file or a 'text' field."}), 400

    # Only ASCII-check the first 50k chars for routing (speed).
    if detect_non_latin(text[:50000]):
        model = "multilingual"

    job_id = uuid.uuid4().hex
    _job_update(job_id, status="queued", progress=0.0, filename=filename)
    t = threading.Thread(target=run_analysis, args=(job_id, text, filename, model),
                        daemon=True)
    t.start()
    return jsonify({"job_id": job_id, "model": model,
                   "chars": len(text)})


@app.route("/api/job/<job_id>")
def job_status(job_id):
    with _jobs_lock:
        j = _jobs.get(job_id)
    if not j:
        return jsonify({"error": "unknown job"}), 404
    return jsonify(j)


# --------------------------------------------------------------------------- #
if __name__ == "__main__":
    print("=" * 60, flush=True)
    print("  Laya Demo server starting", flush=True)
    print("  by Michael Amador <me@almodover.fr>", flush=True)
    print(f"  URL      : http://{HOST}:{PORT}/", flush=True)
    print(f"  Model    : {DEFAULT_MODEL}", flush=True)
    print(f"  Dims     : {len(_DIM_ORDER) + len(_CHOICE_QUESTIONS)} calibrated stats", flush=True)
    print(f"  Device   : {LAYA_DEVICE}  compile={LAYA_COMPILE}  preload={LAYA_PRELOAD}", flush=True)
    print("  Press CTRL+C to stop", flush=True)
    print("=" * 60, flush=True)
    if LAYA_PRELOAD:
        threading.Thread(target=_preload, daemon=True).start()
    app.run(host=HOST, port=PORT, threaded=True)

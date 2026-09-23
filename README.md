# 📖 Laya Demo

**Analyse any text — a page, an article, a whole novel — on 82 calibrated
dimensions in seconds, entirely on your own machine.**

By **Michael Amador** · [me@almodover.fr](mailto:me@almodover.fr) · [github.com/almodover](https://github.com/almodover)

Laya Demo is a small web app built on [Laya](https://huggingface.co/convaiinnovations/laya),
an open-source model that doesn't chat or write: it reads a text and answers
dozens of questions about it at once, in a single parallel pass, with
calibrated probabilities. Paste text or drop a TXT / PDF / EPUB and get:

- **Genre** — fiction, sci-fi, fantasy, mystery, romance, thriller…
- **Mood** — suspense, hope, nostalgia, joy, dread…
- **Themes** — love, betrayal, survival, identity, freedom…
- **Style** — lyrical, fast-paced, cinematic, dialogue-driven…

## How fast

Measured on an **HP Z2 Mini G1a** with **AMD ROCm 10** and PyTorch
(`torch.compile`), one pass = 81 questions over ~27,700 tokens:

| | per page | a full novel (e.g. *Dune*) |
|---|---|---|
| ROCm 10 GPU, English model | **~1 s** | **under 10 s** |
| ROCm 10 GPU, multilingual model | **~0.4 s** | **~4 s** |
| same machine, CPU only | ~27 s | several minutes |

Long documents are sampled into up to 8 evenly spread chunks; results are
averaged across the whole text.

## Run it

Requires Python 3.13 and [uv](https://docs.astral.sh/uv/). The lock file
targets **Linux x86_64 with ROCm 10 (gfx1151)**; on a machine without a
supported GPU it falls back to the CPU.

    git clone https://github.com/almodover/laya-demo.git
    cd laya-demo
    uv sync
    LAYA_PRELOAD=english,multilingual uv run server.py

Then open <http://localhost:5001>. The first start downloads the model
(~1.5 GB) and compiles it for the GPU (about a minute).

Useful settings (environment variables):

| variable | default | meaning |
|---|---|---|
| `LAYA_PORT` | `5001` | HTTP port |
| `LAYA_DEVICE` | auto | `cuda` (ROCm reports as cuda) or `cpu` |
| `LAYA_COMPILE` | `1` on GPU | `torch.compile` the encoder |
| `LAYA_PRELOAD` | — | checkpoints to load + compile at startup |
| `LAYA_THERMAL_SOFT` / `_RESUME` | `78` / `72` | pause between chunks when the CPU thermal zone is hot |

On ROCm 10, if one CPU core sits at 100 % while the server is idle, preload
the system HSA runtime:
`LD_PRELOAD=/opt/rocm/core-10.0/lib/libhsa-runtime64.so.1`.

## API

    POST /api/analyze     file=<upload> | text=<string>  [model=english|multilingual]
    GET  /api/job/<id>    progress, then the full result
    POST /predict         raw Laya: {"state": ..., "questions": {...}}
    GET  /health  /ready

## Credits

- **Laya Demo** (web app, GPU/ROCm tuning, thermal governor) —
  Michael Amador <me@almodover.fr>
- **Laya** model and library — convaiinnovations / NandhaKishorM,
  [Hugging Face](https://huggingface.co/convaiinnovations/laya) ·
  [GitHub](https://github.com/NandhaKishorM/laya) (Apache-2.0)

HP and Z2 are trademarks of HP Inc.; AMD and ROCm are trademarks of Advanced
Micro Devices, Inc. This project is not affiliated with or endorsed by either.

## License

[0BSD](LICENSE) — do anything you like with this code, no conditions, no
attribution required (though a hello is always welcome). The Laya model and
library it uses are Apache-2.0, by their authors.

## Contact

Questions, bugs, ideas or just to say hi: **Michael Amador — [me@almodover.fr](mailto:me@almodover.fr)**
or open an issue on [GitHub](https://github.com/almodover/laya-demo/issues).

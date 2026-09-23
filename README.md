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

## Install on a Strix Halo machine

Works on AMD **Ryzen AI Max / Max+** machines (Radeon 8060S / 8050S, `gfx1151`),
e.g. the HP Z2 Mini G1a. Tested on Ubuntu 24.04, kernel 7.0.

You do **not** need to install ROCm system-wide: the PyTorch ROCm 10 wheels
bring their own runtime. The kernel's built-in `amdgpu` driver is enough.

**1. Give your user access to the GPU** (then log out and back in):

    sudo usermod -aG render,video $USER

**2. Install [uv](https://docs.astral.sh/uv/)** (it also fetches Python 3.13):

    curl -LsSf https://astral.sh/uv/install.sh | sh

**3. Get the app and its dependencies** (~6 GB, mostly PyTorch for ROCm 10
from AMD's package index):

    git clone https://github.com/almodover/laya-demo.git
    cd laya-demo
    uv sync

Check that the GPU is seen:

    uv run python -c "import torch; print(torch.cuda.get_device_name(0))"
    # -> AMD Radeon 8060S Graphics

**4. Get the model.** It is **not included** in this repository. It's
**[convaiinnovations/laya](https://huggingface.co/convaiinnovations/laya)** on
Hugging Face (~1.5 GB, Apache-2.0). It downloads automatically on first start,
or ahead of time with:

    uv run hf download convaiinnovations/laya

**5. Run it:**

    LAYA_PRELOAD=english,multilingual uv run server.py

Open <http://localhost:5001>. The first minute is spent compiling the model
for the GPU; after that, a page takes about a second.

Not on Strix Halo? The lock file targets Linux x86_64 with ROCm 10 for
`gfx1151`; without a supported GPU the app runs on the CPU (much slower).

Useful settings (environment variables):

| variable | default | meaning |
|---|---|---|
| `LAYA_PORT` | `5001` | HTTP port |
| `LAYA_DEVICE` | auto | `cuda` (ROCm reports as cuda) or `cpu` |
| `LAYA_COMPILE` | `1` on GPU | `torch.compile` the encoder |
| `LAYA_PRELOAD` | — | checkpoints to load + compile at startup |
| `LAYA_THERMAL_SOFT` / `_RESUME` | `78` / `72` | pause between chunks when the CPU thermal zone is hot |

Tip: with the ROCm 10 wheels, one CPU core can sit at 100 % while the server
is idle. If you also have ROCm 10 installed system-wide, preloading its runtime
fixes that:
`LD_PRELOAD=/opt/rocm/core-10.0/lib/libhsa-runtime64.so.1 uv run server.py`.

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

[Apache-2.0](LICENSE), same as Laya itself. See [NOTICE](NOTICE) for credits.

## Contact

Questions, bugs, ideas or just to say hi: **Michael Amador — [me@almodover.fr](mailto:me@almodover.fr)**
or open an issue on [GitHub](https://github.com/almodover/laya-demo/issues).

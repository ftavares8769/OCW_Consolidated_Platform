# LearnOCW

A self-hosted AI learning platform that turns MIT OpenCourseWare lectures into an interactive study environment — flashcards, quizzes, practice problems, AI-generated notes, a streaming tutor, and a mistake-review system. Runs entirely on your machine with a local LLM (Ollama) or optionally OpenAI / Anthropic.

![LearnOCW screenshot](https://i.imgur.com/placeholder.png)

---

## Features

| Feature | Details |
|---|---|
| **Home dashboard** | Daily goal rings, streak counter, 13-week activity heatmap, and per-course completion tracker |
| **Goal setting** | Set daily card and weekly lecture targets; confetti celebration fires when a goal is hit |
| **Library** | Import any MIT OCW course by URL or YouTube playlist |
| **AI Notes** | Auto-generated summaries and key-term definitions from lecture transcripts |
| **Quiz** | Mixed question types: multiple-choice, fill-in-the-blank, and open-ended (LLM-graded) |
| **Practice Problems** | Step-by-step problems with full solutions and LaTeX math rendering |
| **Flashcards** | Spaced-repetition deck (SM-2) — flip mode or type-answer mode; edit and delete individual cards |
| **Review tab** | Tracks every wrong answer (all question types); groups by concept; AI explanations and targeted practice |
| **AI Tutor** | Streaming chat tutor with full lecture transcript as context |
| **Resource scraper** | Finds and auto-downloads PDFs, slides, exams, and problem sets from OCW |
| **Discover** | Search the full MIT OCW catalogue (2 000+ courses) and import in one click |
| **Prompt Lab** | Side-by-side multi-model comparison tool — run any generation function against several models at once, inspect raw and parsed output, load any lecture transcript in one click, and export results as `.txt` or `.csv` |
| **Multi-provider AI** | Works with Ollama (local, free), OpenAI, or Anthropic — switch any time in Settings |

---

## Requirements

| Dependency | Version | Notes |
|---|---|---|
| Python | 3.10 + | 3.11 or 3.12 recommended |
| Node.js | 18 + | For the React frontend |
| Ollama | latest | Only needed for local LLM — [ollama.ai](https://ollama.com) |

> **Cloud AI alternative**: if you don't want to run Ollama, enter an OpenAI or Anthropic API key in Settings after first launch.

---

## Quick Start

### 1 — Clone the repo

```bash
git clone https://github.com/YOUR_USERNAME/learnOCW.git
cd learnOCW
```

### 2 — (Optional) Pull a local model with Ollama

> **Minimum requirement:** models below 8B parameters consistently fail to produce valid structured JSON and are **not supported**. `qwen3:8b` is the minimum viable model; `qwen3.5:9b` or larger is recommended.

```bash
# Install Ollama from https://ollama.com, then:
ollama pull qwen3.5:9b        # recommended default (~6 GB VRAM)
# or
ollama pull qwen3:8b          # minimum viable model (~5 GB VRAM)
# or
ollama pull mistral:7b        # alternative — borderline, results may vary
```

### 3 — Start everything

**macOS / Linux / Windows Git Bash:**
```bash
bash start.sh
```

**Windows (PowerShell):**
```powershell
# First time only — create venv and install deps:
python -m venv venv
venv\Scripts\pip install -r requirements.txt
cd frontend && npm install --legacy-peer-deps && cd ..

# Every time:
Start-Process -NoNewWindow venv\Scripts\python backend\main.py
cd frontend && npm run dev
```

The script will:
1. Create a Python virtual environment (first run only)
2. Install Python and Node.js dependencies (first run only)
3. Start the FastAPI backend on **http://localhost:8000**
4. Start the Vite dev server on **http://localhost:5173**

Open **http://localhost:5173** in your browser.

---

## Configuration

All settings are stored in `backend/data/settings.json` (created automatically on first run, excluded from git). You can edit them via the **Settings** page in the UI.

### AI Provider

| Provider | Setup |
|---|---|
| **Local (Ollama)** | Default. Start `ollama serve` and pull a model. No API key needed. |
| **OpenAI** | Enter your `sk-…` key in Settings → AI Model → OpenAI. |
| **Anthropic** | Enter your key in Settings → AI Model → Anthropic. |

You can use one provider for content generation and a different one for the AI Tutor (e.g. a fast local model for generation, GPT-4o for tutoring).

### Recommended Ollama models

> ⚠️ **Models below 8B parameters are not supported.** They cannot reliably produce the structured JSON required for quizzes, problems, and key terms. `qwen3:8b` is the bare minimum; expect occasional formatting errors even at 8B.

| Model | VRAM | Quality | Notes |
|---|---|---|---|
| `qwen3.5:9b` | ~6 GB | ⭐ Best | **Recommended default** — strong JSON reliability, fast |
| `qwen3:8b` | ~5 GB | Good | Minimum viable — occasional JSON errors possible |
| `mistral:7b` | ~5 GB | Fair | Borderline — results may vary; upgrade if output breaks |
| `llama3.1:8b` | ~6 GB | Good | Solid alternative at the 8B tier |
| Cloud (OpenAI / Anthropic) | — | Excellent | No VRAM needed — enter API key in Settings |

---

## Project Structure

```
learnOCW/
├── backend/                  # Python FastAPI API
│   ├── main.py               # App entry point, router registration
│   ├── models.py             # SQLAlchemy models
│   ├── database.py           # SQLite setup
│   ├── tasks.py              # Course import pipeline
│   ├── routes/
│   │   ├── courses.py        # Course import, search, CRUD
│   │   ├── lectures.py       # Lecture processing, study materials
│   │   ├── tutor.py          # Streaming AI tutor chat
│   │   ├── flashcards.py     # SRS deck & review session
│   │   ├── mistakes.py       # Wrong-answer tracking & review
│   │   ├── quiz.py           # Open-ended answer grading
│   │   ├── stats.py          # Dashboard stats, heatmap, goals
│   │   ├── lab.py            # Prompt Lab: multi-model comparison runs
│   │   └── settings.py       # AI provider config
│   ├── prompts/
│   │   ├── summary.txt       # Prompt: 2-3 sentence lecture summary
│   │   ├── notes.txt         # Prompt: key terms → JSON array
│   │   ├── quiz.txt          # Prompt: 5 mixed-type quiz questions → JSON
│   │   ├── problems.txt      # Prompt: 4 practice problems with solutions
│   │   └── chunk.txt         # Prompt: per-chunk bullet summary (long transcripts)
│   └── services/
│       ├── ai_client.py      # Ollama / OpenAI / Anthropic abstraction
│       ├── config.py         # Settings persistence (incl. daily/weekly goals)
│       ├── summarizer.py     # AI content generation (loads prompts from prompts/)
│       ├── scraper.py        # OCW resource scraper
│       ├── downloader.py     # Auto-download course files
│       ├── transcript.py     # YouTube transcript fetching & cleaning
│       └── youtube.py        # Playlist metadata
│
├── frontend/                 # React + Vite SPA
│   └── src/
│       ├── App.jsx           # Router & sidebar navigation
│       ├── pages/
│       │   ├── HomePage.jsx        # Dashboard: goals, heatmap, course completion
│       │   ├── CoursesPage.jsx     # Library + Discover
│       │   ├── LecturePage.jsx     # Video, notes, study, files
│       │   ├── FlashcardsPage.jsx
│       │   ├── ReviewPage.jsx      # Mistake review tab
│       │   ├── PromptLabPage.jsx   # Multi-model prompt comparison tool
│       │   └── SettingsPage.jsx
│       └── components/
│           ├── ActivityHeatmap.jsx  # GitHub-style 13-week review heatmap
│           ├── Confetti.jsx         # Goal-celebration particle animation
│           ├── TutorPanel.jsx       # Streaming AI chat
│           ├── LatexText.jsx        # KaTeX math renderer
│           ├── study/               # Quiz, ProblemSet components
│           ├── tabs/                # Notes, Study, Files tab content
│           └── flashcards/          # DeckBrowser, StudySession, Summary
│
├── data/                     # ← git-ignored (created at runtime)
│   ├── learnOCW.db           # SQLite database
│   ├── course_index.json     # OCW course index cache
│   └── resources/            # Downloaded PDFs, slides, etc.
│
├── requirements.txt          # Python dependencies
├── start.sh                  # One-command startup script
└── README.md
```

---

## How It Works

### Importing a course
1. Go to **Discover**, search for any MIT OCW course or paste a YouTube playlist URL
2. Click **Import** — the scraper fetches course metadata, lecture list, and downloadable resources
3. Open a lecture and click **Download** to trigger AI processing (transcript → notes → quiz → problems → flashcards)

### AI processing pipeline
```
YouTube transcript
      │
      ▼
  Clean & chunk  ──────────────────────────────────────┐
      │                                                 │
      ▼                                                 ▼
 Map step (chunk summaries)                     OCW section page text
      │                                         (augments transcript)
      ▼
 Phase 1: Summary + Key Terms  →  Notes tab (visible immediately)
      │
      ▼
 Phase 2: Quiz + Problems       →  Study tab
      │
      ▼
 Flashcard generation (on demand)  →  Flashcards tab
```

### Review tab
Every time you answer a quiz question incorrectly, the question, your answer, and the correct answer are silently recorded. The **Review** tab groups these by lecture and concept. For each mistake you can:
- Get an AI explanation of exactly why your answer was wrong
- Generate 3 targeted practice questions on that concept
- Mark it as mastered to clear it from the queue
- Ask the AI Tutor with the lecture's full context loaded automatically

---

## API

The backend exposes a REST API at `http://localhost:8000`. Interactive docs are available at **http://localhost:8000/docs**.

Key endpoints:

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/import` | Import a course |
| `GET` | `/api/courses` | List all imported courses |
| `POST` | `/api/lectures/{id}/process` | Trigger AI processing for a lecture |
| `GET` | `/api/lectures/{id}/tutor-context` | Fetch context for the AI tutor |
| `POST` | `/api/tutor/chat` | Streaming tutor chat |
| `GET` | `/api/flashcards/session` | Build a study session |
| `POST` | `/api/flashcards/review` | Submit a card rating |
| `POST` | `/api/mistakes` | Record a wrong answer |
| `GET` | `/api/mistakes` | All pending mistakes grouped by lecture |
| `POST` | `/api/mistakes/{id}/explain` | AI explanation for a mistake |
| `POST` | `/api/mistakes/{id}/practice` | Generate targeted practice questions |
| `POST` | `/api/quiz/grade-open-ended` | LLM grades an open-ended answer (0–5 score) |
| `GET` | `/api/stats/overview` | Dashboard data: heatmap, streak, goals, course completion |
| `GET` | `/api/stats/goals` | Current daily/weekly goals |
| `PUT` | `/api/stats/goals` | Update daily/weekly goals |
| `GET` | `/api/lab/models` | All available models (local + cloud) for Prompt Lab |
| `POST` | `/api/lab/run` | Run a single model + function in Prompt Lab |

---

## Contributing

Pull requests are welcome. A few conventions:

- **Backend**: Python 3.10+, FastAPI, SQLAlchemy 2.x, Pydantic v2. Avoid new runtime dependencies where possible.
- **Frontend**: React 18, Vite, no CSS frameworks (custom dark-theme CSS). Keep components small.
- **AI prompts**: all prompts live in `backend/prompts/*.txt` and are loaded at runtime. Changes there have the biggest UX impact — use the **Prompt Lab** to test against multiple models side-by-side before committing.
- **No secrets**: `backend/data/` is git-ignored. Never hardcode API keys or local file paths.

---

## License

GPL v3 — see [LICENSE](LICENSE) for details.

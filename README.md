# LearnOCW

A self-hosted AI learning platform that turns MIT OpenCourseWare lectures into an interactive study environment — flashcards, quizzes, practice problems, AI-generated notes, a streaming tutor, and a mistake-review system. Runs entirely on your machine with a local LLM (Ollama) or optionally OpenAI / Anthropic.

![LearnOCW screenshot](https://i.imgur.com/placeholder.png)

---

## Features

| Feature | Details |
|---|---|
| **Library** | Import any MIT OCW course by URL or YouTube playlist |
| **AI Notes** | Auto-generated summaries and key-term definitions from lecture transcripts |
| **Quiz & Problems** | AI-generated MCQs and step-by-step practice problems with LaTeX math |
| **Flashcards** | Spaced-repetition deck (SM-2 algorithm) — study by lecture or across all decks |
| **Review tab** | Tracks every wrong quiz answer; groups by concept; generates targeted explanations and practice |
| **AI Tutor** | Streaming chat tutor with full lecture transcript as context |
| **Resource scraper** | Finds and auto-downloads PDFs, slides, exams, and problem sets from OCW |
| **Discover** | Search the full MIT OCW catalogue (2 000+ courses) and import in one click |
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

```bash
# Install Ollama from https://ollama.com, then:
ollama pull qwen3:1.7b        # fast, low VRAM — good default
# or
ollama pull llama3.2:3b       # good alternative
# or
ollama pull mistral:7b        # higher quality, needs ~8 GB VRAM
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

| Model | VRAM | Quality | Notes |
|---|---|---|---|
| `qwen3:1.7b` | ~2 GB | Good | Default — fastest, runs on most hardware |
| `qwen3:8b` | ~6 GB | Better | Recommended if you have a mid-range GPU |
| `llama3.2:3b` | ~2 GB | Good | Alternative to qwen3 |
| `mistral:7b` | ~8 GB | Great | Best quality for math-heavy content |

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
│   │   └── settings.py       # AI provider config
│   └── services/
│       ├── ai_client.py      # Ollama / OpenAI / Anthropic abstraction
│       ├── config.py         # Settings persistence
│       ├── summarizer.py     # AI content generation (notes, quiz, problems)
│       ├── scraper.py        # OCW resource scraper
│       ├── downloader.py     # Auto-download course files
│       ├── transcript.py     # YouTube transcript fetching & cleaning
│       └── youtube.py        # Playlist metadata
│
├── frontend/                 # React + Vite SPA
│   └── src/
│       ├── App.jsx           # Router & sidebar navigation
│       ├── pages/
│       │   ├── CoursesPage.jsx   # Library + Discover
│       │   ├── LecturePage.jsx   # Video, notes, study, files
│       │   ├── FlashcardsPage.jsx
│       │   ├── ReviewPage.jsx    # Mistake review tab
│       │   └── SettingsPage.jsx
│       └── components/
│           ├── TutorPanel.jsx    # Streaming AI chat
│           ├── LatexText.jsx     # KaTeX math renderer
│           ├── study/            # Quiz, ProblemSet components
│           ├── tabs/             # Notes, Study, Files tab content
│           └── flashcards/       # DeckBrowser, StudySession, Summary
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

---

## Contributing

Pull requests are welcome. A few conventions:

- **Backend**: Python 3.10+, FastAPI, SQLAlchemy 2.x, Pydantic v2. Avoid new runtime dependencies where possible.
- **Frontend**: React 18, Vite, no CSS frameworks (custom dark-theme CSS). Keep components small.
- **AI prompts**: all prompts live in `backend/services/summarizer.py`. Changes there have the biggest UX impact — test with both a small local model and a cloud model.
- **No secrets**: `backend/data/` is git-ignored. Never hardcode API keys or local file paths.

---

## License

MIT — see [LICENSE](LICENSE) for details.

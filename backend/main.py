import logging
import os
import sys

# Add backend directory to Python path
sys.path.insert(0, os.path.dirname(__file__))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager
from database import engine, Base
import models  # noqa: F401 — ensure models are registered

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger(__name__)

RESOURCES_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "resources")
os.makedirs(RESOURCES_DIR, exist_ok=True)


def _migrate_db():
    """Apply lightweight schema migrations that SQLAlchemy's create_all misses."""
    from sqlalchemy import text
    with engine.connect() as conn:
        # Add playlist_id column if it doesn't exist yet (SQLite supports ADD COLUMN)
        try:
            conn.execute(text("ALTER TABLE courses ADD COLUMN playlist_id TEXT"))
            conn.commit()
            logger.info("Migration: added courses.playlist_id")
        except Exception:
            pass  # column already exists
        try:
            conn.execute(text("ALTER TABLE resources ADD COLUMN lecture_number INTEGER"))
            conn.commit()
            logger.info("Migration: added resources.lecture_number")
        except Exception:
            pass  # column already exists
        try:
            conn.execute(text("ALTER TABLE lectures ADD COLUMN error_message TEXT"))
            conn.commit()
            logger.info("Migration: added lectures.error_message")
        except Exception:
            pass  # column already exists
        # Flashcard table is created by create_all; no ALTER needed for new columns
        # DailyStats table is created by create_all
        try:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS mistake_records (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    lecture_id INTEGER NOT NULL REFERENCES lectures(id),
                    question_text TEXT NOT NULL,
                    question_type TEXT DEFAULT 'quiz',
                    concept TEXT,
                    correct_answer TEXT,
                    wrong_answer TEXT,
                    options JSON,
                    status TEXT DEFAULT 'needs_review',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    last_reviewed DATETIME
                )
            """))
            conn.commit()
            logger.info("Migration: created mistake_records table")
        except Exception:
            pass


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    _migrate_db()
    logger.info("Database initialized")
    yield
    logger.info("Shutting down LearnOCW backend")


app = FastAPI(
    title="LearnOCW API",
    description="Local learning platform powered by MIT OpenCourseWare and Ollama",
    version="1.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount static files for locally stored resources
app.mount("/files", StaticFiles(directory=RESOURCES_DIR), name="files")

# Register routers
from routes.courses import router as courses_router
from routes.lectures import router as lectures_router
from routes.tutor import router as tutor_router
from routes.flashcards import router as flashcards_router
from routes.settings import router as settings_router
from routes.mistakes import router as mistakes_router
from routes.quiz import router as quiz_router
from routes.stats import router as stats_router
from routes.lab import router as lab_router

app.include_router(courses_router)
app.include_router(lectures_router)
app.include_router(tutor_router)
app.include_router(flashcards_router)
app.include_router(settings_router)
app.include_router(mistakes_router)
app.include_router(quiz_router)
app.include_router(stats_router)
app.include_router(lab_router)


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "LearnOCW"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)

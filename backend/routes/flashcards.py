"""
Flashcard API: decks, sessions, SRS reviews, generation, stats.
"""
import json
import logging
import random
import re
from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from models import Course, DailyStats, Flashcard, Lecture, Resource, StudyMaterial
from services import ai_client
from services.config import get as cfg_get

logger = logging.getLogger(__name__)
router = APIRouter()

DAILY_NEW_LIMIT = 20       # default; overridden at runtime by user setting


# ── Helpers ───────────────────────────────────────────────────────────────────

def today_str() -> str:
    return date.today().isoformat()


def get_or_create_daily_stats(db: Session) -> DailyStats:
    today = today_str()
    stats = db.query(DailyStats).filter(DailyStats.date == today).first()
    if not stats:
        stats = DailyStats(date=today)
        db.add(stats)
        db.commit()
        db.refresh(stats)
    return stats


def get_daily_limit() -> int:
    """Read daily new-card limit from settings (falls back to hard-coded default)."""
    try:
        return int(cfg_get("daily_new_limit") or DAILY_NEW_LIMIT)
    except Exception:
        return DAILY_NEW_LIMIT


def new_seen_today(db: Session) -> int:
    """How many new cards have transitioned new→learning today."""
    stats = db.query(DailyStats).filter(DailyStats.date == today_str()).first()
    return stats.new_graduated if stats else 0


def serialize_card(card: Flashcard) -> dict:
    return {
        "id":               card.id,
        "lecture_id":       card.lecture_id,
        "front":            card.front,
        "back":             card.back,
        "tags":             card.tags or [],
        "state":            card.state,
        "ease_factor":      card.ease_factor,
        "interval":         card.interval,
        "repetitions":      card.repetitions,
        "next_review_date": card.next_review_date,
        "last_reviewed":    card.last_reviewed.isoformat() if card.last_reviewed else None,
    }


def serialize_stats(stats: DailyStats) -> dict:
    return {
        "date":             stats.date,
        "cards_reviewed":   stats.cards_reviewed,
        "again_count":      stats.again_count,
        "hard_count":       stats.hard_count,
        "good_count":       stats.good_count,
        "easy_count":       stats.easy_count,
        "new_graduated":    stats.new_graduated,
        "learned_graduated": stats.learned_graduated,
    }


# ── Decks browser ─────────────────────────────────────────────────────────────

@router.get("/api/flashcards/decks")
def get_decks(db: Session = Depends(get_db)):
    """
    Return all courses that have flashcards, with per-lecture stats
    (new / learning / learned counts, due today).
    """
    today      = today_str()
    seen_today = new_seen_today(db)
    remaining  = max(0, get_daily_limit() - seen_today)

    courses = db.query(Course).order_by(Course.title).all()
    result  = []

    for course in courses:
        decks = []
        for lec in sorted(course.lectures, key=lambda x: x.order_index):
            cards = db.query(Flashcard).filter(Flashcard.lecture_id == lec.id).all()
            if not cards:
                continue

            n_new      = sum(1 for c in cards if c.state == "new")
            n_learning = sum(1 for c in cards if c.state == "learning")
            n_learned  = sum(1 for c in cards if c.state == "learned")

            learning_due = sum(
                1 for c in cards
                if c.state == "learning"
                and c.next_review_date
                and c.next_review_date <= today
            )
            due_today = learning_due + min(n_new, remaining)

            decks.append({
                "lecture_id":    lec.id,
                "lecture_title": lec.title,
                "total":         len(cards),
                "new":           n_new,
                "learning":      n_learning,
                "learned":       n_learned,
                "due_today":     due_today,
            })

        if decks:
            result.append({
                "course_id":    course.id,
                "course_title": course.title,
                "lectures":     decks,
            })

    return result


# ── Session builder ───────────────────────────────────────────────────────────

@router.get("/api/flashcards/session")
def get_session(
    lecture_id: Optional[int] = None,
    mode: str = "normal",          # normal | free
    db: Session = Depends(get_db),
):
    """
    Build an ordered study session.

    normal mode:
      - learning cards whose next_review_date <= today  (shuffled)
      - new cards up to remaining daily limit           (shuffled, learning first)
    free mode:
      - all cards for the deck, shuffled (no SRS enforcement)
    """
    today      = today_str()
    seen_today = new_seen_today(db)
    daily_limit = get_daily_limit()

    if lecture_id is not None:
        cards = db.query(Flashcard).filter(Flashcard.lecture_id == lecture_id).all()
    else:
        cards = db.query(Flashcard).all()

    if mode == "free":
        shuffled = list(cards)
        random.shuffle(shuffled)
        return {
            "cards":  [serialize_card(c) for c in shuffled],
            "total":  len(shuffled),
            "mode":   "free",
        }

    # normal mode ────────────────────────────────────────────────────────────
    learning_due = [
        c for c in cards
        if c.state == "learning"
        and c.next_review_date
        and c.next_review_date <= today
    ]
    remaining  = max(0, daily_limit - seen_today)
    new_cards  = [c for c in cards if c.state == "new"]

    random.shuffle(learning_due)
    random.shuffle(new_cards)

    session_cards = learning_due + new_cards[:remaining]

    return {
        "cards":              [serialize_card(c) for c in session_cards],
        "total":              len(session_cards),
        "mode":               "normal",
        "learning_in_session": len(learning_due),
        "new_in_session":      len(new_cards[:remaining]),
    }


# ── Review ────────────────────────────────────────────────────────────────────

class ReviewRequest(BaseModel):
    card_id:     int
    rating:      int        # 1=Again 2=Hard 3=Good 4=Easy
    free_review: bool = False


@router.post("/api/flashcards/review")
def review_card(req: ReviewRequest, db: Session = Depends(get_db)):
    card = db.query(Flashcard).filter(Flashcard.id == req.card_id).first()
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")

    old_state = card.state
    card.last_reviewed = datetime.now()

    if not req.free_review:
        from services.srs import apply_sm2
        updates = apply_sm2(
            card.state, card.ease_factor, card.interval, card.repetitions, req.rating
        )
        card.state            = updates["state"]
        card.ease_factor      = updates["ease_factor"]
        card.interval         = updates["interval"]
        card.repetitions      = updates["repetitions"]
        card.next_review_date = updates["next_review_date"]

        stats = get_or_create_daily_stats(db)
        stats.cards_reviewed += 1
        if req.rating == 1:   stats.again_count += 1
        elif req.rating == 2: stats.hard_count  += 1
        elif req.rating == 3: stats.good_count  += 1
        elif req.rating == 4: stats.easy_count  += 1

        if old_state == "new"      and card.state == "learning": stats.new_graduated    += 1
        if old_state == "learning" and card.state == "learned":  stats.learned_graduated += 1

        db.commit()
        db.refresh(stats)
        return {"card": serialize_card(card), "stats": serialize_stats(stats)}
    else:
        db.commit()
        return {"card": serialize_card(card), "stats": None}


# ── Card existence check ──────────────────────────────────────────────────────

@router.get("/api/flashcards/lecture/{lecture_id}/exists")
def cards_exist(lecture_id: int, db: Session = Depends(get_db)):
    count = db.query(Flashcard).filter(Flashcard.lecture_id == lecture_id).count()
    return {"exists": count > 0, "count": count}


# ── Two-step flashcard generation helper ─────────────────────────────────────

_CONCEPT_SYSTEM = (
    "/no_think\n"
    "You are analysing a university lecture. "
    "Identify ALL key concepts, definitions, formulas, theorems, and facts that a student must understand.\n"
    "Include ONLY what is explicitly stated in the material. Do NOT add outside knowledge.\n"
    "Order them from most important to least important.\n"
    "For each concept also rate importance: "
    "\"core\" (essential to the lecture's main argument) or "
    "\"detail\" (supporting or peripheral).\n"
    "Output a JSON array only — no explanation, no markdown:\n"
    '[{"concept":"name","definition":"one-sentence explanation","type":"definition|formula|theorem|fact|process","importance":"core|detail"}]\n\n'
    "Example:\n"
    '[{"concept":"Derivative","definition":"Instantaneous rate of change of a function at a point","type":"definition","importance":"core"},'
    '{"concept":"Power Rule","definition":"d/dx[x^n] = nx^(n-1), shortcut for differentiating polynomials","type":"formula","importance":"core"},'
    '{"concept":"Limit","definition":"Value a function approaches as the input approaches a specific value","type":"definition","importance":"detail"}]'
)

_FC_SYSTEM = (
    "/no_think\n"
    "Create flashcards from the concept list below. Follow these rules exactly.\n\n"
    "Card writing rules:\n"
    "1. Front: one specific question. Start with What, How, Why, Define, or Give an example of. "
    "Max 12 words.\n"
    "2. Back: one direct answer. Max 20 words. "
    "Do not start with \"It is...\" or \"This is...\". State the fact plainly.\n"
    "3. For formulas: Front = \"What is the formula for X?\", "
    "Back = the expression + one-line meaning.\n"
    "4. For processes: Front = \"What are the steps of X?\", "
    "Back = numbered steps, max 5 words each.\n"
    "5. One card per concept. No compound questions.\n"
    "6. Tags: 1-2 labels max.\n\n"
    "Inclusion rules:\n"
    "- More than 30 concepts: include ONLY concepts marked [core]. Skip all [detail] items.\n"
    "- 30 or fewer concepts: include ALL concepts regardless of importance.\n\n"
    "Output a JSON array only — no explanation, no markdown:\n"
    '[{"front":"...","back":"...","tags":["..."]}]\n\n'
    "Example:\n"
    '[{"front":"What is the formula for Newton\'s Second Law?","back":"F = ma; net force equals mass times acceleration","tags":["mechanics"]},'
    '{"front":"Define inertia.","back":"Resistance of an object to changes in its state of motion","tags":["mechanics"]}]'
)

_FC_FALLBACK_SYSTEM = (
    "/no_think\n"
    "Create flashcards for a university student from the lecture material below.\n\n"
    "Steps:\n"
    "1. Identify ALL key concepts, definitions, formulas, and facts in the material.\n"
    "2. Create ONE flashcard per concept. If there are more than 30, keep only the most fundamental ones.\n"
    "3. Front: one specific question (max 12 words). "
    "Start with What, How, Why, Define, or Give an example of.\n"
    "4. Back: one direct answer (max 20 words). Do not start with \"It is\" or \"This is\".\n"
    "5. Tags: 1-2 labels max.\n\n"
    "Output a JSON array only — no explanation, no markdown:\n"
    '[{"front":"...","back":"...","tags":["..."]}]'
)


def _parse_json_array(raw: str) -> list | None:
    """Extract and parse a JSON array from a model response. Returns None on failure."""
    raw = re.sub(r"<think>[\s\S]*?</think>", "", raw)
    raw = re.sub(r"</think>", "", raw).strip()
    m = re.search(r"\[[\s\S]*\]", raw)
    if not m:
        return None
    try:
        result = json.loads(m.group(0))
        return result if isinstance(result, list) else None
    except json.JSONDecodeError:
        return None


def _generate_flashcards_two_step(context: str, lecture_id: int) -> list[dict]:
    """
    Step 1 — extract a structured concept list from the material.
    Step 2 — generate one flashcard per concept (80/20 if >30 concepts).
    Falls back to a single-step prompt if step 1 fails.
    """
    # ── Step 1: concept extraction ────────────────────────────────────────────
    logger.info(f"Lecture {lecture_id}: extracting concepts…")
    concepts_raw = ai_client.call(
        prompt=f"Lecture material:\n\n{context}",
        system=_CONCEPT_SYSTEM,
        temperature=0.1,
        max_tokens=3000,
    )
    concepts = _parse_json_array(concepts_raw)

    if concepts and len(concepts) > 0:
        logger.info(f"Lecture {lecture_id}: {len(concepts)} concepts found — generating cards…")

        # Format the concept list as compact text for the card-generation prompt.
        # Include [importance] so Step 2 can apply the 80/20 rule deterministically.
        concept_lines = []
        for i, c in enumerate(concepts, 1):
            name       = c.get("concept",    "").strip()
            defn       = c.get("definition", "").strip()
            typ        = c.get("type",       "").strip()
            importance = c.get("importance", "core").strip()
            if name:
                label = f"[{typ}][{importance}]"
                concept_lines.append(
                    f"{i}. {label} {name}: {defn}" if defn else f"{i}. {label} {name}"
                )
        concepts_text = "\n".join(concept_lines)

        # ── Step 2: flashcard generation ──────────────────────────────────────
        cards_raw = ai_client.call(
            prompt=f"Concepts to cover:\n\n{concepts_text}",
            system=_FC_SYSTEM,
            temperature=0.2,
            max_tokens=8000,
        )
        cards = _parse_json_array(cards_raw)
        if cards is not None:
            logger.info(f"Lecture {lecture_id}: {len(cards)} flashcards generated (two-step).")
            return cards
        logger.warning(f"Lecture {lecture_id}: step-2 parse failed — trying fallback.")

    else:
        logger.warning(f"Lecture {lecture_id}: concept extraction failed — trying fallback.")

    # ── Fallback: single-step ─────────────────────────────────────────────────
    logger.info(f"Lecture {lecture_id}: running single-step flashcard generation…")
    fallback_raw = ai_client.call(
        prompt=f"Lecture material:\n\n{context}",
        system=_FC_FALLBACK_SYSTEM,
        temperature=0.2,
        max_tokens=8000,
    )
    cards = _parse_json_array(fallback_raw)
    if cards is not None:
        logger.info(f"Lecture {lecture_id}: {len(cards)} flashcards generated (fallback).")
        return cards

    raise ValueError("All generation attempts produced unparseable output.")


# ── Generation ────────────────────────────────────────────────────────────────

@router.post("/api/flashcards/generate/{lecture_id}")
def generate_flashcards(lecture_id: int, db: Session = Depends(get_db)):
    """
    Generate flashcards for a lecture using a two-step concept-first approach.
    Context priority: transcript → local PDF notes → study notes.
    """
    lec = db.query(Lecture).filter(Lecture.id == lecture_id).first()
    if not lec:
        raise HTTPException(status_code=404, detail="Lecture not found")

    # ── Build context ─────────────────────────────────────────────────────────
    parts = []

    if lec.transcript_clean:
        parts.append(f"[Lecture Transcript]\n{lec.transcript_clean[:8000]}")
    elif lec.transcript_raw:
        parts.append(f"[Lecture Transcript]\n{lec.transcript_raw[:8000]}")

    # Extract text from any locally-stored PDF resources
    resources = db.query(Resource).filter(Resource.lecture_id == lecture_id).all()
    for res in resources:
        if res.local_path and res.local_path.lower().endswith(".pdf"):
            try:
                import fitz                                    # PyMuPDF
                doc = fitz.open(res.local_path)
                pdf_text = "".join(page.get_text() for page in doc[:5])
                doc.close()
                if pdf_text.strip():
                    parts.append(f"[{res.title or 'Lecture Notes'}]\n{pdf_text[:3000]}")
            except Exception:
                pass

    # Fallback: AI-generated notes already stored
    notes_mat = db.query(StudyMaterial).filter(
        StudyMaterial.lecture_id == lecture_id,
        StudyMaterial.type == "notes",
    ).first()
    if notes_mat and isinstance(notes_mat.content_json, str) and notes_mat.content_json.strip():
        parts.append(f"[Lecture Notes]\n{notes_mat.content_json[:2000]}")

    if not parts:
        raise HTTPException(
            status_code=400,
            detail="No content available. Process the lecture first to get a transcript.",
        )

    context = "\n\n".join(parts)

    # ── Two-step generation ───────────────────────────────────────────────────
    #  Step 1: extract every key concept from the material
    #  Step 2: generate one flashcard per concept (80/20 prioritisation if many)
    try:
        cards_data = _generate_flashcards_two_step(context, lecture_id)
    except Exception as exc:
        logger.error(f"Flashcard generation failed for lecture {lecture_id}: {exc}")
        raise HTTPException(status_code=500, detail=f"AI generation failed: {exc}")

    # ── Persist cards ─────────────────────────────────────────────────────────
    today  = today_str()
    created = []
    for item in cards_data:
        if not isinstance(item, dict):
            continue
        front = str(item.get("front", "")).strip()
        back  = str(item.get("back",  "")).strip()
        if not front or not back:
            continue
        tags = item.get("tags", [])
        if not isinstance(tags, list):
            tags = []

        db.add(Flashcard(
            lecture_id=lecture_id,
            front=front,
            back=back,
            tags=tags,
            state="new",
            ease_factor=2.5,
            interval=0,
            repetitions=0,
            next_review_date=today,
        ))
        created.append(True)

    db.commit()
    n = len(created)
    return {"cards_created": n, "message": f"{n} flashcards added to your deck."}


# ── Delete (for Regenerate) ───────────────────────────────────────────────────

@router.delete("/api/flashcards/lecture/{lecture_id}")
def delete_lecture_flashcards(lecture_id: int, db: Session = Depends(get_db)):
    deleted = db.query(Flashcard).filter(Flashcard.lecture_id == lecture_id).delete()
    db.commit()
    return {"deleted": deleted}


# ── Daily stats ───────────────────────────────────────────────────────────────

@router.get("/api/flashcards/daily-stats")
def get_daily_stats(db: Session = Depends(get_db)):
    stats = db.query(DailyStats).filter(DailyStats.date == today_str()).first()
    if not stats:
        return {
            "date": today_str(), "cards_reviewed": 0,
            "again_count": 0, "hard_count": 0, "good_count": 0, "easy_count": 0,
            "new_graduated": 0, "learned_graduated": 0,
        }
    return serialize_stats(stats)


# ── Settings ──────────────────────────────────────────────────────────────────

@router.get("/api/flashcards/settings")
def get_fc_settings():
    return {"daily_new_limit": get_daily_limit()}

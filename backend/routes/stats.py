"""
Stats / overview API — heatmap, streaks, goals, lecture completion scores.
"""
from datetime import date, timedelta

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func, distinct
from sqlalchemy.orm import Session

from database import get_db
from models import Course, DailyStats, Flashcard, Lecture, StudyMaterial
from services import config

router = APIRouter()


# ── helpers ───────────────────────────────────────────────────────────────────

def _calc_streak(db: Session) -> int:
    """Consecutive-day streak (includes today if cards reviewed today)."""
    streak = 0
    check = date.today()
    while True:
        row = db.query(DailyStats).filter(
            DailyStats.date == check.isoformat()
        ).first()
        if row and row.cards_reviewed > 0:
            streak += 1
            check -= timedelta(days=1)
        else:
            break
    return streak


# ── endpoints ─────────────────────────────────────────────────────────────────

@router.get("/api/stats/overview")
def get_overview(db: Session = Depends(get_db)):
    today_str = date.today().isoformat()

    # Today's card count
    today_row = db.query(DailyStats).filter(
        DailyStats.date == today_str
    ).first()
    today_cards = today_row.cards_reviewed if today_row else 0

    # Streak
    streak = _calc_streak(db)

    # Heatmap — last 91 days
    start_str = (date.today() - timedelta(days=90)).isoformat()
    heatmap_rows = db.query(DailyStats).filter(
        DailyStats.date >= start_str
    ).all()
    heatmap = {r.date: r.cards_reviewed for r in heatmap_rows}

    # Goals from settings
    cfg = config.load()
    goals = {
        "daily_cards":     cfg.get("goal_daily_cards", 20),
        "weekly_lectures": cfg.get("goal_weekly_lectures", 3),
    }

    # Weekly lectures processed (distinct lectures with quiz material created this calendar week)
    today_dt = date.today()
    week_start = (today_dt - timedelta(days=today_dt.weekday())).isoformat()
    weekly_done = (
        db.query(func.count(func.distinct(StudyMaterial.lecture_id)))
        .filter(
            StudyMaterial.type == "quiz",
            func.date(StudyMaterial.created_at) >= week_start,
        )
        .scalar()
        or 0
    )

    # ── Course completion — explicit queries, no lazy-loading ─────────────────

    # 1. All courses
    courses = db.query(Course).order_by(Course.created_at).all()
    course_map = {c.id: c for c in courses}

    # 2. All lectures (flat list)
    all_lectures = (
        db.query(Lecture)
        .filter(Lecture.course_id.in_(list(course_map.keys())))
        .all()
    ) if course_map else []

    # 3. Lectures that have a transcript
    transcript_ids = {
        lec.id for lec in all_lectures
        if lec.transcript_clean and len(lec.transcript_clean) > 50
    }

    # 4. Lectures with status="done"
    done_ids = {lec.id for lec in all_lectures if lec.status == "done"}

    # 5. Lecture ids that have quiz / problems study materials
    all_lec_ids = [lec.id for lec in all_lectures]
    quiz_ids     = set()
    problems_ids = set()
    if all_lec_ids:
        materials = (
            db.query(StudyMaterial.lecture_id, StudyMaterial.type)
            .filter(StudyMaterial.lecture_id.in_(all_lec_ids))
            .all()
        )
        for lec_id, mat_type in materials:
            if mat_type == "quiz":
                quiz_ids.add(lec_id)
            elif mat_type == "problems":
                problems_ids.add(lec_id)

    # 6. Lecture ids that have flashcards
    flashcard_ids = set()
    if all_lec_ids:
        rows = (
            db.query(distinct(Flashcard.lecture_id))
            .filter(Flashcard.lecture_id.in_(all_lec_ids))
            .all()
        )
        flashcard_ids = {row[0] for row in rows}

    # 7. Score each lecture
    def score_lecture(lec_id: int) -> int:
        s = 0
        if lec_id in transcript_ids: s += 1
        if lec_id in done_ids:       s += 1
        if lec_id in quiz_ids:       s += 1
        if lec_id in problems_ids:   s += 1
        if lec_id in flashcard_ids:  s += 1
        return s

    # 8. Group by course
    from collections import defaultdict
    lecs_by_course = defaultdict(list)
    for lec in all_lectures:
        lecs_by_course[lec.course_id].append(lec)

    course_progress = []
    for course in courses:
        lecs = lecs_by_course.get(course.id, [])
        if not lecs:
            continue
        scores      = [score_lecture(lec.id) for lec in lecs]
        fully_done  = sum(1 for s in scores if s == 5)
        avg_score   = sum(scores) / len(scores)
        course_progress.append({
            "id":            course.id,
            "title":         course.title,
            "lecture_count": len(lecs),
            "fully_done":    fully_done,
            "avg_score":     round(avg_score, 1),
            "max_score":     5,
        })

    return {
        "today_cards":          today_cards,
        "streak":               streak,
        "heatmap":              heatmap,
        "goals":                goals,
        "weekly_lectures_done": weekly_done,
        "course_progress":      course_progress,
    }


class GoalsBody(BaseModel):
    daily_cards:     int
    weekly_lectures: int


@router.get("/api/stats/goals")
def get_goals():
    cfg = config.load()
    return {
        "daily_cards":     cfg.get("goal_daily_cards", 20),
        "weekly_lectures": cfg.get("goal_weekly_lectures", 3),
    }


@router.put("/api/stats/goals")
def set_goals(body: GoalsBody):
    settings = config.load()
    settings["goal_daily_cards"]     = max(1, body.daily_cards)
    settings["goal_weekly_lectures"] = max(1, body.weekly_lectures)
    config.save(settings)
    return {"ok": True}

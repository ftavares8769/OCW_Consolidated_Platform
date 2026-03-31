"""
Mistake tracking — records quiz wrong answers, serves them grouped by lecture,
and generates targeted explanations + practice via the LLM.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional

from database import get_db
from models import MistakeRecord, Lecture, Course, StudyMaterial

router = APIRouter()


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class MistakeCreate(BaseModel):
    lecture_id: int
    question_text: str
    question_type: str = "quiz"       # quiz | concept_quiz
    concept: Optional[str] = None
    correct_answer: str
    wrong_answer: str
    options: Optional[list] = None


class StatusUpdate(BaseModel):
    status: str   # needs_review | mastered


# ── Helpers ───────────────────────────────────────────────────────────────────

def _serialize(r: MistakeRecord) -> dict:
    return {
        "id":            r.id,
        "lecture_id":    r.lecture_id,
        "question_text": r.question_text,
        "question_type": r.question_type,
        "concept":       r.concept,
        "correct_answer":r.correct_answer,
        "wrong_answer":  r.wrong_answer,
        "options":       r.options,
        "status":        r.status,
        "created_at":    r.created_at.isoformat() if r.created_at else None,
    }


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/api/mistakes", status_code=201)
def record_mistake(data: MistakeCreate, db: Session = Depends(get_db)):
    """Record a wrong quiz answer. Deduplicates by (lecture, question, wrong_answer)."""
    existing = db.query(MistakeRecord).filter(
        MistakeRecord.lecture_id    == data.lecture_id,
        MistakeRecord.question_text == data.question_text,
        MistakeRecord.wrong_answer  == data.wrong_answer,
        MistakeRecord.status        == "needs_review",
    ).first()
    if existing:
        return {"id": existing.id, "created": False}

    record = MistakeRecord(**data.dict())
    db.add(record)
    db.commit()
    db.refresh(record)
    return {"id": record.id, "created": True}


@router.get("/api/mistakes")
def get_all_mistakes(db: Session = Depends(get_db)):
    """Return all needs_review mistakes grouped by lecture (with course info)."""
    records = (
        db.query(MistakeRecord)
        .filter(MistakeRecord.status == "needs_review")
        .order_by(MistakeRecord.created_at.desc())
        .all()
    )

    # Group by lecture, preserving insertion order (most recent first per lecture)
    by_lecture: dict[int, dict] = {}
    for r in records:
        lid = r.lecture_id
        if lid not in by_lecture:
            lec = db.query(Lecture).filter(Lecture.id == lid).first()
            course = db.query(Course).filter(Course.id == lec.course_id).first() if lec else None
            by_lecture[lid] = {
                "lecture_id":    lid,
                "lecture_title": lec.title if lec else "Unknown Lecture",
                "course_id":     lec.course_id if lec else None,
                "course_title":  course.title if course else None,
                "mistakes":      [],
            }
        by_lecture[lid]["mistakes"].append(_serialize(r))

    return list(by_lecture.values())


@router.get("/api/mistakes/lecture/{lecture_id}")
def get_lecture_mistakes(lecture_id: int, db: Session = Depends(get_db)):
    """Return all mistake records for one lecture (both statuses)."""
    records = (
        db.query(MistakeRecord)
        .filter(MistakeRecord.lecture_id == lecture_id)
        .order_by(MistakeRecord.created_at.desc())
        .all()
    )
    return [_serialize(r) for r in records]


@router.patch("/api/mistakes/{mistake_id}/status")
def update_status(mistake_id: int, data: StatusUpdate, db: Session = Depends(get_db)):
    record = db.query(MistakeRecord).filter(MistakeRecord.id == mistake_id).first()
    if not record:
        raise HTTPException(404, "Mistake not found")
    record.status = data.status
    db.commit()
    return {"ok": True}


@router.delete("/api/mistakes/{mistake_id}")
def delete_mistake(mistake_id: int, db: Session = Depends(get_db)):
    record = db.query(MistakeRecord).filter(MistakeRecord.id == mistake_id).first()
    if not record:
        raise HTTPException(404, "Mistake not found")
    db.delete(record)
    db.commit()
    return {"ok": True}


@router.post("/api/mistakes/{mistake_id}/explain")
def explain_mistake(mistake_id: int, db: Session = Depends(get_db)):
    """Ask the LLM to explain why the student's answer was wrong."""
    record = db.query(MistakeRecord).filter(MistakeRecord.id == mistake_id).first()
    if not record:
        raise HTTPException(404, "Mistake not found")

    lec = db.query(Lecture).filter(Lecture.id == record.lecture_id).first()
    context = ""
    if lec:
        context = lec.transcript_clean or lec.summary or ""

    from services.summarizer import generate_targeted_explanation
    explanation = generate_targeted_explanation(
        question=record.question_text,
        correct_answer=record.correct_answer,
        wrong_answer=record.wrong_answer,
        concept=record.concept,
        context=context,
    )
    return {"explanation": explanation}


@router.post("/api/mistakes/{mistake_id}/practice")
def practice_mistake(mistake_id: int, db: Session = Depends(get_db)):
    """Generate 3 new MCQ questions targeting the concept the student got wrong."""
    record = db.query(MistakeRecord).filter(MistakeRecord.id == mistake_id).first()
    if not record:
        raise HTTPException(404, "Mistake not found")

    lec = db.query(Lecture).filter(Lecture.id == record.lecture_id).first()
    context = ""
    if lec:
        context = lec.transcript_clean or lec.summary or ""

    concept = record.concept or record.question_text[:80]
    from services.summarizer import generate_concept_questions
    questions = generate_concept_questions(concept=concept, context=context, n=3)
    return {"questions": questions, "concept": concept}

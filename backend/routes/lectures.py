from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from database import get_db
from models import Course, Flashcard, Lecture, Resource, StudyMaterial
import os
import logging

from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter()


class ConceptRequest(BaseModel):
    concept: str
    n: int = 3


class MoreProblemsRequest(BaseModel):
    problems: list  # List of {problem: str, solution: str} dicts


@router.get("/api/courses/{course_id}/resources")
def get_course_resources(course_id: int, db: Session = Depends(get_db)):
    """Get all resources attached to any lecture in a course."""
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    lecture_ids = [l.id for l in course.lectures]
    resources = db.query(Resource).filter(Resource.lecture_id.in_(lecture_ids)).all() if lecture_ids else []
    return {
        "resources": [
            {
                "id": r.id,
                "type": r.type,
                "title": r.title,
                "url": r.url,
                "local_path": r.local_path,
                "lecture_number": r.lecture_number,
                "status": r.status,
                "has_local": bool(r.local_path and os.path.exists(r.local_path)),
            }
            for r in resources
        ]
    }


# ── Static-path routes MUST come before /{lecture_id} to avoid param capture ──

@router.get("/api/lectures/regenerable")
def get_regenerable_lectures(db: Session = Depends(get_db)):
    """
    Return all lectures that have AI-generated content (summary, study materials,
    or flashcards), grouped by course.  Used by the Regenerate modal.
    """
    courses = db.query(Course).order_by(Course.title).all()
    result  = []

    for course in courses:
        lectures_out = []
        for lec in sorted(course.lectures, key=lambda x: x.order_index):
            if lec.title == "_resources_":
                continue

            materials = db.query(StudyMaterial).filter(
                StudyMaterial.lecture_id == lec.id
            ).all()
            mat_types = [m.type for m in materials if m.content_json]

            fc_count = db.query(Flashcard).filter(
                Flashcard.lecture_id == lec.id
            ).count()

            has_ai_content = bool(lec.summary) or bool(mat_types) or fc_count > 0
            if not has_ai_content:
                continue

            lectures_out.append({
                "lecture_id":      lec.id,
                "lecture_title":   lec.title,
                "has_transcript":  bool(lec.transcript_clean or lec.transcript_raw),
                "has_summary":     bool(lec.summary),
                "material_types":  mat_types,     # e.g. ["quiz", "problems", "notes"]
                "flashcard_count": fc_count,
            })

        if lectures_out:
            result.append({
                "course_id":    course.id,
                "course_title": course.title,
                "lectures":     lectures_out,
            })

    return result


# ── Parameterised lecture routes ───────────────────────────────────────────────

@router.get("/api/lectures/{lecture_id}")
def get_lecture(lecture_id: int, db: Session = Depends(get_db)):
    """Get full lecture details including transcript, summary, resources, study materials."""
    lec = db.query(Lecture).filter(Lecture.id == lecture_id).first()
    if not lec:
        raise HTTPException(status_code=404, detail="Lecture not found")

    resources = db.query(Resource).filter(Resource.lecture_id == lecture_id).all()
    materials = db.query(StudyMaterial).filter(StudyMaterial.lecture_id == lecture_id).all()

    return {
        "id": lec.id,
        "course_id": lec.course_id,
        "title": lec.title,
        "youtube_url": lec.youtube_url,
        "transcript_clean": lec.transcript_clean,
        "summary": lec.summary,
        "status": lec.status,
        "error_message": lec.error_message,
        "order_index": lec.order_index,
        "resources": [
            {
                "id": r.id,
                "type": r.type,
                "title": r.title,
                "url": r.url,
                "local_path": r.local_path,
                "status": r.status,
                "has_local": bool(r.local_path and os.path.exists(r.local_path))
            }
            for r in resources
        ],
        "study_materials": {
            m.type: m.content_json
            for m in materials
        }
    }


@router.post("/api/lectures/{lecture_id}/process")
def process_lecture(
    lecture_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    force: bool = False,
):
    """
    Trigger transcript fetch + summarization for a single lecture.
    Pass ?force=true to restart a lecture that is stuck in a processing state.
    """
    lec = db.query(Lecture).filter(Lecture.id == lecture_id).first()
    if not lec:
        raise HTTPException(status_code=404, detail="Lecture not found")
    if lec.status in ("fetching", "cleaning", "summarizing") and not force:
        return {"status": lec.status, "message": "Already processing"}
    from tasks import process_lecture as run_pipeline
    background_tasks.add_task(run_pipeline, lecture_id)
    lec.status = "fetching"
    lec.error_message = None
    db.commit()
    return {"status": "fetching"}


@router.get("/api/lectures/{lecture_id}/status")
def get_lecture_status(lecture_id: int, db: Session = Depends(get_db)):
    """Get processing status for a lecture."""
    lec = db.query(Lecture).filter(Lecture.id == lecture_id).first()
    if not lec:
        raise HTTPException(status_code=404, detail="Lecture not found")
    return {
        "status": lec.status,
        "has_transcript": bool(lec.transcript_clean),
        "has_summary": bool(lec.summary),
        "error_message": lec.error_message,
    }


@router.post("/api/lectures/{lecture_id}/regenerate-materials")
def regenerate_lecture_materials(lecture_id: int, db: Session = Depends(get_db)):
    """
    Re-run summarisation for a lecture that already has a transcript.
    Updates: lec.summary and StudyMaterial rows (quiz, problems, notes).
    Synchronous / blocking — the client waits for completion.
    """
    lec = db.query(Lecture).filter(Lecture.id == lecture_id).first()
    if not lec:
        raise HTTPException(status_code=404, detail="Lecture not found")

    transcript = lec.transcript_clean or lec.transcript_raw
    if not transcript:
        raise HTTPException(
            status_code=400,
            detail="No transcript available — process the lecture first.",
        )

    from services import ai_client
    if not ai_client.check_available():
        raise HTTPException(status_code=503, detail="AI provider not available.")

    # Optionally augment with OCW notes (same as original pipeline)
    try:
        from tasks import _fetch_ocw_notes_for_lecture
        ocw_text = _fetch_ocw_notes_for_lecture(db, lec)
        if ocw_text:
            logger.info(f"Augmenting lecture {lecture_id} with OCW notes ({len(ocw_text)} chars)")
            transcript = f"[OCW Course Notes]\n{ocw_text}\n\n[Lecture Transcript]\n{transcript}"
    except Exception as e:
        logger.warning(f"OCW notes augmentation skipped: {e}")

    def _upsert(mat_type, content):
        existing = db.query(StudyMaterial).filter(
            StudyMaterial.lecture_id == lecture_id,
            StudyMaterial.type == mat_type,
        ).first()
        if existing:
            existing.content_json = content
        else:
            db.add(StudyMaterial(
                lecture_id=lecture_id,
                type=mat_type,
                content_json=content,
            ))

    # Phase 1: overview (summary + notes) — save immediately
    from services.summarizer import generate_overview, generate_study
    try:
        combined_text, summary, notes = generate_overview(transcript)
    except Exception as e:
        logger.error(f"Overview generation failed for lecture {lecture_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Overview generation failed: {e}")

    lec.summary = summary
    _upsert("notes", notes)
    lec.status = "generating_study"
    db.commit()

    # Phase 2: quiz + problems
    try:
        quiz, problems = generate_study(combined_text)
    except Exception as e:
        logger.error(f"Study generation failed for lecture {lecture_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Study generation failed: {e}")

    _upsert("quiz", quiz)
    _upsert("problems", problems)
    lec.status = "done"
    db.commit()
    logger.info(f"Lecture {lecture_id} materials regenerated successfully")
    return {"ok": True, "lecture_id": lecture_id}


@router.get("/api/lectures/{lecture_id}/tutor-context")
def get_tutor_context(lecture_id: int, db: Session = Depends(get_db)):
    """Get lecture summary for AI tutor system prompt."""
    lec = db.query(Lecture).filter(Lecture.id == lecture_id).first()
    if not lec:
        raise HTTPException(status_code=404, detail="Lecture not found")

    notes_mat = db.query(StudyMaterial).filter(
        StudyMaterial.lecture_id == lecture_id,
        StudyMaterial.type == "notes"
    ).first()

    context = f"Lecture: {lec.title}\n\n"
    if lec.summary:
        context += f"Lecture Summary:\n{lec.summary[:2000]}\n\n"
    if notes_mat and notes_mat.content_json:
        notes = notes_mat.content_json
        if isinstance(notes, list) and notes:
            context += "Key Terms and Definitions:\n"
            context += "\n".join(f"- {n}" for n in notes[:20]) + "\n\n"
        elif isinstance(notes, str) and notes.strip():
            context += f"Key Terms and Definitions:\n{notes[:2000]}\n\n"

    # Fall back to transcript when summary is missing so the tutor has context
    if not lec.summary:
        transcript = lec.transcript_clean or lec.transcript_raw
        if transcript:
            context += f"Lecture Transcript:\n{transcript[:4000]}\n\n"

    return {"context": context.strip()}


@router.post("/api/lectures/{lecture_id}/study-extra")
def generate_extra_study(lecture_id: int, body: ConceptRequest, db: Session = Depends(get_db)):
    """
    Generate additional quiz questions focused on a specific concept the student
    is struggling with. Uses transcript + summary as context.
    """
    lec = db.query(Lecture).filter(Lecture.id == lecture_id).first()
    if not lec:
        raise HTTPException(status_code=404, detail="Lecture not found")

    from services import ai_client
    if not ai_client.check_available():
        raise HTTPException(status_code=503, detail="AI provider not available.")

    # Build context: summary + beginning of transcript
    context_parts = []
    if lec.summary:
        context_parts.append(f"Lecture summary:\n{lec.summary}")
    transcript = lec.transcript_clean or lec.transcript_raw
    if transcript:
        context_parts.append(f"Lecture transcript:\n{transcript[:4000]}")
    if not context_parts:
        raise HTTPException(status_code=400, detail="No lecture content available.")

    context = "\n\n".join(context_parts)

    from services.summarizer import generate_concept_questions
    questions = generate_concept_questions(body.concept, context, n=body.n)
    return {"quiz": questions, "concept": body.concept}


@router.post("/api/lectures/{lecture_id}/more-problems")
def generate_more_problems(lecture_id: int, body: MoreProblemsRequest, db: Session = Depends(get_db)):
    """
    Generate new practice problems similar to selected reference problems.
    Returns one new problem per reference problem, testing the same concept differently.
    """
    lec = db.query(Lecture).filter(Lecture.id == lecture_id).first()
    if not lec:
        raise HTTPException(status_code=404, detail="Lecture not found")

    from services import ai_client
    if not ai_client.check_available():
        raise HTTPException(status_code=503, detail="AI provider not available.")

    if not body.problems:
        raise HTTPException(status_code=400, detail="No reference problems provided.")

    # Build context: summary + beginning of transcript
    context_parts = []
    if lec.summary:
        context_parts.append(f"Lecture summary:\n{lec.summary}")
    transcript = lec.transcript_clean or lec.transcript_raw
    if transcript:
        context_parts.append(f"Lecture transcript:\n{transcript[:4000]}")
    if not context_parts:
        raise HTTPException(status_code=400, detail="No lecture content available.")

    context = "\n\n".join(context_parts)

    from services.summarizer import generate_similar_problems
    new_problems = generate_similar_problems(body.problems, context)
    return {"problems": new_problems}


@router.get("/api/resources/{resource_id}/file")
def get_resource_file(resource_id: int, db: Session = Depends(get_db)):
    """Serve a locally stored resource file."""
    res = db.query(Resource).filter(Resource.id == resource_id).first()
    if not res:
        raise HTTPException(status_code=404, detail="Resource not found")
    if not res.local_path or not os.path.exists(res.local_path):
        raise HTTPException(status_code=404, detail="File not found locally")
    return FileResponse(res.local_path, filename=os.path.basename(res.local_path))

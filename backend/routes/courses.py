from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Query
from sqlalchemy.orm import Session
from database import get_db
from models import Course, Lecture, Resource, StudyMaterial
from pydantic import BaseModel
from typing import Optional
import asyncio

router = APIRouter()


# ── Request models ────────────────────────────────────────────────────────────

class ImportRequest(BaseModel):
    url: str           # OCW course URL (or YouTube playlist URL as fallback)
    title: str
    subject: Optional[str] = ""
    course_number: Optional[str] = ""
    description: Optional[str] = ""
    playlist_id: Optional[str] = None   # YouTube playlist ID


# ── Search: YouTube playlists + OCW matching ──────────────────────────────────

@router.get("/api/search")
async def search_courses(q: str = Query(..., min_length=1)):
    """
    Search MIT OCW YouTube channel for playlists matching q.
    Each result is matched against the local OCW index for course metadata.
    Only returns results with a confident or possible OCW match (score ≥ 2).
    """
    from services.youtube import search_ocw_playlists
    from services.scraper import match_playlist_to_ocw

    loop = asyncio.get_event_loop()

    # Fetch playlists from YouTube (blocking network call → executor)
    playlists = await loop.run_in_executor(None, search_ocw_playlists, q)

    # Tokenize query for relevance filtering
    query_words = set(w.lower() for w in q.split() if len(w) > 2)

    results = []
    for pl in playlists:
        # Filter: at least one query word must appear in playlist title or OCW title
        pl_title_lower = pl["title"].lower()
        match = await loop.run_in_executor(None, match_playlist_to_ocw, pl)

        if match is None:
            # Still include if query words appear directly in playlist title
            if not any(w in pl_title_lower for w in query_words):
                continue
            # No OCW match but title is relevant — skip (we require OCW match for metadata)
            continue

        course = match["course"]
        ocw_title_lower = course["title"].lower()
        # Require at least one query word in playlist title or OCW course title
        if query_words and not any(w in pl_title_lower or w in ocw_title_lower for w in query_words):
            continue

        results.append({
            # Playlist data
            "playlist_id": pl["playlist_id"],
            "playlist_title": pl["title"],
            "video_count": pl["video_count"],
            "thumbnail": pl["thumbnail"],
            "playlist_url": pl["playlist_url"],
            # OCW match data
            "title": course["title"],
            "url": course["url"],
            "course_number": course.get("course_number", ""),
            "subject": course.get("subject", ""),
            "term": course.get("term", ""),
            "description": course.get("description", ""),
            # Confidence
            "confidence": match["confidence"],
            "match_score": match["score"],
        })

    return {"results": results}


# ── Import ────────────────────────────────────────────────────────────────────

@router.post("/api/import")
async def import_course(
    req: ImportRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Import a course.  If playlist_id is given, videos come from the playlist."""
    existing = db.query(Course).filter(Course.ocw_url == req.url).first()
    if existing:
        return {"id": existing.id, "status": existing.status, "already_exists": True}

    course = Course(
        title=req.title,
        subject=req.subject or "",
        ocw_url=req.url,
        playlist_id=req.playlist_id,
        description=req.description or "",
        course_number=req.course_number or "",
        status="importing",
    )
    db.add(course)
    db.commit()
    db.refresh(course)

    from tasks import process_course_import
    background_tasks.add_task(
        process_course_import, course.id, req.url, req.playlist_id
    )
    return {"id": course.id, "status": "importing"}


# ── Library CRUD ──────────────────────────────────────────────────────────────

@router.get("/api/courses")
def list_courses(db: Session = Depends(get_db)):
    courses = db.query(Course).order_by(Course.created_at.desc()).all()
    return [
        {
            "id": c.id,
            "title": c.title,
            "subject": c.subject,
            "course_number": c.course_number,
            "ocw_url": c.ocw_url,
            "playlist_id": c.playlist_id,
            "description": c.description,
            "status": c.status,
            "lecture_count": len(c.lectures),
        }
        for c in courses
    ]


@router.get("/api/courses/{course_id}")
def get_course(course_id: int, db: Session = Depends(get_db)):
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    return {
        "id": course.id,
        "title": course.title,
        "subject": course.subject,
        "course_number": course.course_number,
        "ocw_url": course.ocw_url,
        "playlist_id": course.playlist_id,
        "description": course.description,
        "status": course.status,
        "lectures": [
            {
                "id": l.id,
                "title": l.title,
                "youtube_url": l.youtube_url,
                "order_index": l.order_index,
                "status": l.status,
                "unit": getattr(l, "unit", None),
            }
            for l in sorted(course.lectures, key=lambda x: x.order_index)
        ],
    }


@router.post("/api/courses/{course_id}/rescan")
async def rescan_course(
    course_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    for lec in list(course.lectures):
        db.delete(lec)
    db.commit()
    course.status = "importing"
    db.commit()
    from tasks import process_course_import
    background_tasks.add_task(
        process_course_import, course.id, course.ocw_url, course.playlist_id
    )
    return {"status": "importing"}


@router.get("/api/courses/{course_id}/status")
def get_course_status(course_id: int, db: Session = Depends(get_db)):
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    lectures = db.query(Lecture).filter(Lecture.course_id == course_id).all()
    statuses = [l.status for l in lectures]
    return {
        "course_status": course.status,
        "total_lectures": len(lectures),
        "done_lectures": sum(1 for s in statuses if s == "done"),
        "lecture_statuses": statuses,
    }


@router.delete("/api/courses/{course_id}")
def delete_course(course_id: int, db: Session = Depends(get_db)):
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    db.delete(course)
    db.commit()
    return {"ok": True}

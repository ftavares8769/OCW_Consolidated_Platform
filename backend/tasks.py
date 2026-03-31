"""
Background task processing for course import pipeline.

process_course_import:
  - If playlist_id given: fetches all YouTube playlist videos → creates Lecture records
  - If ocw_url is a real OCW page: scrapes for downloadable documents
  - Lectures are created with status="pending" (no auto-processing of transcripts)

process_lecture (triggered manually per-lecture):
  transcript fetch → clean → summarize → store study materials
"""
import asyncio
import logging
from sqlalchemy.orm import Session
from database import SessionLocal
from models import Course, Lecture, Resource, StudyMaterial

logger = logging.getLogger(__name__)


def get_db() -> Session:
    return SessionLocal()


async def run_in_executor(func, *args):
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, func, *args)


# ── Course import ─────────────────────────────────────────────────────────────

async def process_course_import(
    course_id: int,
    course_url: str,
    playlist_id: str | None = None,
):
    """
    Import a course:
      1. If playlist_id provided → fetch videos from YouTube playlist
      2. If course_url is an OCW page → scrape for downloadable documents
      3. Lectures start with status='pending' (transcript pipeline is per-lecture)
    """
    db = get_db()
    try:
        course = db.query(Course).filter(Course.id == course_id).first()
        if not course:
            return
        course.status = "importing"
        db.commit()

        # ── Step 1: Videos from YouTube playlist ──────────────────────────────
        lectures_data = []
        if playlist_id:
            from services.youtube import fetch_playlist_videos, group_videos_by_structure
            raw_videos = await run_in_executor(fetch_playlist_videos, playlist_id)
            lectures_data = group_videos_by_structure(raw_videos)
            logger.info(f"Playlist {playlist_id} → {len(lectures_data)} videos")
        else:
            logger.info(f"No playlist_id for course {course_id}; no lectures added")

        # ── Step 2: OCW documents (only for real OCW URLs) ────────────────────
        docs = []
        is_ocw_url = "ocw.mit.edu" in course_url
        if is_ocw_url:
            from services.scraper import scrape_ocw_documents
            docs = await run_in_executor(scrape_ocw_documents, course_url)
            logger.info(f"OCW scrape → {len(docs)} documents")

        # ── Step 3: Persist lectures ──────────────────────────────────────────
        db_lectures = []
        for lec_data in lectures_data:
            existing = db.query(Lecture).filter(
                Lecture.course_id == course_id,
                Lecture.youtube_url == lec_data["youtube_url"],
            ).first()
            if existing:
                db_lectures.append(existing)
                continue

            lec = Lecture(
                course_id=course_id,
                title=lec_data.get("title", f"Lecture {lec_data['order_index'] + 1}"),
                youtube_url=lec_data.get("youtube_url"),
                order_index=lec_data.get("order_index", 0),
                status="pending",
            )
            db.add(lec)
            db.flush()
            db_lectures.append(lec)

        # ── Step 4: Persist documents ─────────────────────────────────────────
        anchor = db_lectures[0] if db_lectures else None
        for doc in docs:
            if not anchor:
                # No lectures yet — attach doc to a synthetic placeholder lecture
                placeholder = db.query(Lecture).filter(
                    Lecture.course_id == course_id,
                    Lecture.title == "_resources_",
                ).first()
                if not placeholder:
                    placeholder = Lecture(
                        course_id=course_id,
                        title="_resources_",
                        order_index=-1,
                        status="done",
                    )
                    db.add(placeholder)
                    db.flush()
                anchor = placeholder

            existing_res = db.query(Resource).filter(
                Resource.url == doc.get("url")
            ).first()
            if not existing_res:
                db.add(Resource(
                    lecture_id=anchor.id,
                    type=doc.get("type", "resource"),
                    title=doc.get("title", "Resource"),
                    url=doc.get("url"),
                    lecture_number=doc.get("lecture_number"),
                    status="done",
                ))

        course.status = "done"
        db.commit()
        logger.info(
            f"Course {course_id} import done — "
            f"{len(db_lectures)} lectures, {len(docs)} documents"
        )

        # ── Step 5: Auto-download discovered file resources (background) ──────
        if is_ocw_url and docs:
            from services.downloader import download_course_resources
            # Fire-and-forget — don't block the import response
            asyncio.ensure_future(run_in_executor(download_course_resources, course_id))
            logger.info(f"Course {course_id}: background download task started")

        # Mark courses with no videos so Discover filters them in future
        if len(db_lectures) == 0:
            import re as _re
            from services.scraper import mark_no_video
            m = _re.search(r'/courses/([^/]+)/', course_url)
            if m:
                mark_no_video(m.group(1))

    except Exception as e:
        logger.error(f"Course import failed: {e}", exc_info=True)
        try:
            course = db.query(Course).filter(Course.id == course_id).first()
            if course:
                course.status = "error"
                db.commit()
        except Exception:
            pass
    finally:
        db.close()


# ── OCW notes fetcher ─────────────────────────────────────────────────────────

def _fetch_ocw_notes_for_lecture(db: Session, lec) -> str | None:
    """
    Find OCW section-page resources that match this lecture's number and
    fetch a plain-text excerpt from each page URL (up to ~2000 chars combined).
    Returns None if no relevant pages found or all fetches fail.
    """
    import re
    import requests
    from bs4 import BeautifulSoup

    if not lec.course_id:
        return None

    # Determine this lecture's number (same logic as frontend extractLectureNumber)
    lec_num = None
    if lec.title:
        m = re.search(r'(?:lecture|lec|session|ses|class|week)\s*0*(\d+)', lec.title, re.I)
        if not m:
            m = re.match(r'^0*(\d+)[.:]', lec.title)
        if m:
            lec_num = int(m.group(1))
    if lec_num is None:
        lec_num = (lec.order_index or 0) + 1

    # Get section-page resources for this lecture number in the course
    from models import Course, Lecture as LecModel
    all_lecture_ids = [
        l.id for l in db.query(LecModel).filter(LecModel.course_id == lec.course_id).all()
    ]
    if not all_lecture_ids:
        return None

    section_resources = db.query(Resource).filter(
        Resource.lecture_id.in_(all_lecture_ids),
        Resource.lecture_number == lec_num,
        Resource.url.isnot(None),
    ).all()

    # Only fetch section pages (URLs that are not direct file downloads)
    _FILE_EXT_RE = re.compile(r'\.(pdf|zip|pptx|xlsx|docx|ppt)(\?|$)', re.I)
    section_pages = [r for r in section_resources if not _FILE_EXT_RE.search(r.url or "")]

    if not section_pages:
        return None

    collected_parts = []
    char_budget = 3000  # max chars to add from OCW notes

    for res in section_pages[:3]:  # limit to 3 pages
        try:
            resp = requests.get(res.url, timeout=10, headers={"User-Agent": "Mozilla/5.0"})
            if resp.status_code != 200:
                continue
            soup = BeautifulSoup(resp.text, "html.parser")
            # Remove navigation / script / style
            for tag in soup(["script", "style", "nav", "header", "footer"]):
                tag.decompose()
            # Try to find main content areas
            main = (
                soup.find("main")
                or soup.find("article")
                or soup.find(class_=re.compile(r'content|body|page', re.I))
                or soup.body
            )
            text = (main or soup).get_text(separator="\n", strip=True)
            # Collapse excessive blank lines
            text = re.sub(r'\n{3,}', '\n\n', text).strip()
            if len(text) > 200:
                excerpt = text[:char_budget - sum(len(p) for p in collected_parts)]
                if excerpt:
                    collected_parts.append(f"[{res.title}]\n{excerpt}")
                if sum(len(p) for p in collected_parts) >= char_budget:
                    break
        except Exception as e:
            logger.debug(f"OCW page fetch failed for {res.url}: {e}")
            continue

    return "\n\n".join(collected_parts) if collected_parts else None


# ── Per-lecture processing (manually triggered) ───────────────────────────────

async def _timed(coro, timeout: float, label: str):
    """Await a coroutine with a timeout; raises TimeoutError with a readable label."""
    try:
        return await asyncio.wait_for(coro, timeout=timeout)
    except asyncio.TimeoutError:
        raise TimeoutError(f"{label} timed out after {int(timeout)}s")


async def process_lecture(lecture_id: int):
    """
    Full pipeline for a single lecture (triggered manually):
    fetch transcript → clean → summarize → store study materials.

    Each network/AI step has an explicit timeout so a hanging call can never
    leave the lecture stuck in a processing status indefinitely.
    """
    db = get_db()
    try:
        lec = db.query(Lecture).filter(Lecture.id == lecture_id).first()
        if not lec or not lec.youtube_url:
            return

        from services.scraper import extract_youtube_id
        yt_id = extract_youtube_id(lec.youtube_url)
        if not yt_id:
            lec.error_message = "Could not extract a YouTube video ID from the lecture URL"
            lec.status = "error"
            db.commit()
            return

        lec.status = "fetching"
        lec.error_message = None
        db.commit()

        from services.transcript import fetch_transcript, clean_transcript
        # YouTube transcript fetch — 60 s should be generous for any network
        raw = await _timed(run_in_executor(fetch_transcript, yt_id), 60, "Transcript fetch")
        if not raw:
            # No transcript available (disabled / not found) — still a valid done state
            lec.status = "done"
            db.commit()
            return

        lec.transcript_raw = raw
        lec.status = "cleaning"
        db.commit()

        # clean_transcript is pure CPU — 30 s is more than enough
        cleaned = await _timed(run_in_executor(clean_transcript, raw), 30, "Transcript cleaning")
        lec.transcript_clean = cleaned
        db.commit()

        lec.status = "summarizing"
        db.commit()

        # ── Augment with OCW section page text (best-effort, non-fatal) ───────
        try:
            ocw_text = await _timed(
                run_in_executor(_fetch_ocw_notes_for_lecture, db, lec), 30, "OCW notes fetch"
            )
            if ocw_text:
                logger.info(f"Augmenting lecture {lecture_id} with {len(ocw_text)} chars of OCW notes")
                cleaned = f"[OCW Course Notes]\n{ocw_text}\n\n[Lecture Transcript]\n{cleaned}"
        except Exception as e:
            logger.warning(f"OCW notes skipped for lecture {lecture_id}: {e}")

        from services.summarizer import generate_overview, generate_study, check_ollama_available
        if check_ollama_available() and cleaned:
            try:
                # ── Phase 1: Map + summary + notes (show in Notes tab immediately) ──
                combined_text, summary, notes = await _timed(
                    run_in_executor(generate_overview, cleaned), 1800, "Overview generation"
                )
                lec.summary = summary
                lec.error_message = None

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

                _upsert("notes", notes)
                lec.status = "generating_study"
                db.commit()
                logger.info(f"Lecture {lecture_id} overview saved — starting quiz/problems")

                # ── Phase 2: Quiz + problems ──────────────────────────────────────
                quiz, problems = await _timed(
                    run_in_executor(generate_study, combined_text), 900, "Study generation"
                )
                _upsert("quiz", quiz)
                _upsert("problems", problems)
                db.commit()

            except Exception as e:
                logger.error(f"Summarization failed for lecture {lecture_id}: {e}", exc_info=True)
                lec.error_message = str(e)
                lec.status = "error"
                db.commit()
                return  # do not fall through to 'done'

        lec.status = "done"
        db.commit()
        logger.info(f"Lecture {lecture_id} processing complete")

    except Exception as e:
        logger.error(f"Lecture {lecture_id} processing failed: {e}", exc_info=True)
        try:
            lec = db.query(Lecture).filter(Lecture.id == lecture_id).first()
            if lec:
                lec.error_message = str(e)
                lec.status = "error"
                db.commit()
        except Exception:
            pass
    finally:
        db.close()

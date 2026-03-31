"""
Resource downloader — fetches discovered document files to local disk.

download_course_resources(course_id)
  Queries the DB for all pending/file resources belonging to a course,
  downloads each to data/resources/{course_id}/, and updates local_path + status.

Called from tasks.py after course import completes.
"""
import os
import re
import time
import logging
import requests
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    )
}

_DATA_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "data"
)
RESOURCES_DIR = os.path.join(_DATA_DIR, "resources")

# File extensions we will actually download
DOWNLOADABLE_EXTS = {".pdf", ".pptx", ".ppt", ".docx", ".doc", ".xlsx", ".xls", ".zip"}

# Skip these resource type values — videos handled via YouTube, not downloads
SKIP_TYPES = {"video"}

# Upper limit per file (60 MB — most lecture PDFs are well under 10 MB)
MAX_FILE_BYTES = 60 * 1024 * 1024

# Polite delay between downloads
DELAY_BETWEEN = 0.6


def is_file_url(url: str) -> bool:
    """True if the URL has a downloadable file extension."""
    if not url:
        return False
    ext = os.path.splitext(urlparse(url).path)[1].lower()
    return ext in DOWNLOADABLE_EXTS


def _safe_filename(url: str, title: str, existing: set) -> str:
    """
    Derive a filesystem-safe filename from the URL path.
    Falls back to the resource title when the URL path has no useful name.
    Appends a counter suffix if the name is already taken.
    """
    path = urlparse(url).path
    basename = path.rstrip("/").split("/")[-1]
    ext = os.path.splitext(basename)[1].lower()

    if not ext or ext not in DOWNLOADABLE_EXTS:
        # Construct from title
        safe_title = re.sub(r'[^\w\s-]', '', title or "resource").strip()
        safe_title = re.sub(r'\s+', '_', safe_title)[:80]
        ext = ext or ".pdf"
        basename = f"{safe_title}{ext}"
    else:
        # Sanitise the URL filename
        basename = re.sub(r'[<>:"/\\|?*]', '_', basename)

    # Strip OCW CDN hex-hash prefix: "74E213D46Fc146692Bc5D60223E610Eb_"
    basename = re.sub(r'^[0-9a-fA-F]{16,}[_\-]+', '', basename) or basename
    # Strip MIT/RES course-code prefixes: "MIT18_065S18_", "MITRES18_05S10_", etc.
    basename = re.sub(
        r'^(?:MIT)?(?:[A-Z]{1,4})?\d{1,3}[_\-][A-Za-z0-9]+[_\-]',
        '', basename, flags=re.IGNORECASE
    ) or basename

    # Deduplicate
    stem, sfx = os.path.splitext(basename)
    candidate = basename
    counter = 1
    while candidate.lower() in existing:
        candidate = f"{stem}_{counter}{sfx}"
        counter += 1

    existing.add(candidate.lower())
    return candidate


def _download_one(url: str, dest_path: str) -> tuple[bool, str]:
    """
    Fetch url and write to dest_path.
    Returns (success, reason).
    """
    try:
        resp = requests.get(url, headers=HEADERS, timeout=40, stream=True)

        if resp.status_code == 404:
            return False, "not_found"
        resp.raise_for_status()

        # If the server returns HTML instead of a file, the URL is a redirect page
        ct = resp.headers.get("content-type", "").lower()
        if "text/html" in ct:
            return False, "not_found"

        cl = resp.headers.get("content-length")
        if cl and int(cl) > MAX_FILE_BYTES:
            logger.warning(f"Skipping {url} — content-length {int(cl)//1024//1024} MB > limit")
            return False, "error"

        written = 0
        with open(dest_path, "wb") as fh:
            for chunk in resp.iter_content(chunk_size=65_536):
                if not chunk:
                    continue
                fh.write(chunk)
                written += len(chunk)
                if written > MAX_FILE_BYTES:
                    logger.warning(f"Skipping {url} — exceeded size limit mid-download")
                    fh.close()
                    try:
                        os.remove(dest_path)
                    except OSError:
                        pass
                    return False, "error"

        if written == 0:
            try:
                os.remove(dest_path)
            except OSError:
                pass
            return False, "not_found"

        return True, "done"

    except requests.exceptions.HTTPError as e:
        code = e.response.status_code if e.response is not None else 0
        return False, "not_found" if code == 404 else "error"
    except Exception as e:
        logger.warning(f"Download error for {url}: {e}")
        if os.path.exists(dest_path):
            try:
                os.remove(dest_path)
            except OSError:
                pass
        return False, "error"


def download_course_resources(course_id: int) -> dict:
    """
    Download all file-type resources for a course that haven't been saved yet.
    Creates its own DB session so it can be run in a thread executor.

    Returns a summary dict: {total, downloaded, skipped, failed}.
    """
    from database import SessionLocal
    from models import Resource, Lecture

    db = SessionLocal()
    stats = {"total": 0, "downloaded": 0, "skipped": 0, "failed": 0}

    try:
        # Get all lecture IDs for this course
        lecture_ids = [
            r.id for r in db.query(Lecture.id).filter(Lecture.course_id == course_id).all()
        ]
        if not lecture_ids:
            return stats

        resources = db.query(Resource).filter(
            Resource.lecture_id.in_(lecture_ids)
        ).all()

        stats["total"] = len(resources)

        dest_dir = os.path.join(RESOURCES_DIR, str(course_id))
        os.makedirs(dest_dir, exist_ok=True)

        existing_names: set = set(
            f.lower() for f in os.listdir(dest_dir)
        )

        for res in resources:
            # Skip non-file resources (section pages stay as URL links)
            if not is_file_url(res.url):
                stats["skipped"] += 1
                continue

            # Skip video types
            if (res.type or "").lower() in SKIP_TYPES:
                stats["skipped"] += 1
                continue

            # Already downloaded
            if res.local_path and os.path.exists(res.local_path):
                stats["skipped"] += 1
                continue

            filename = _safe_filename(res.url, res.title or "resource", existing_names)
            dest_path = os.path.join(dest_dir, filename)

            res.status = "downloading"
            db.commit()

            time.sleep(DELAY_BETWEEN)
            success, reason = _download_one(res.url, dest_path)

            res.status = reason
            res.local_path = dest_path if success else None
            db.commit()

            if success:
                stats["downloaded"] += 1
                logger.info(f"[{course_id}] ✓ {filename}")
            else:
                stats["failed"] += 1
                logger.debug(f"[{course_id}] ✗ {res.url} ({reason})")

    except Exception as e:
        logger.error(f"download_course_resources({course_id}) failed: {e}", exc_info=True)
    finally:
        db.close()

    logger.info(
        f"Course {course_id} downloads complete — "
        f"{stats['downloaded']} saved, {stats['skipped']} skipped, "
        f"{stats['failed']} not found/failed"
    )
    return stats

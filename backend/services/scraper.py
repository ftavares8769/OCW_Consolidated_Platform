"""
OCW course index, playlist→course matching, and document scraping.

search_courses()        — legacy local-index text search (kept for library use)
match_playlist_to_ocw() — match a YouTube playlist to an OCW course entry
scrape_ocw_documents()  — scrape an OCW page for downloadable files only
"""
import re
import json
import time
import logging
import os
import requests
from bs4 import BeautifulSoup
from urllib.parse import urljoin

logger = logging.getLogger(__name__)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    )
}
BASE_URL = "https://ocw.mit.edu"

CACHE_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "data"
)
COURSE_INDEX_PATH = os.path.join(CACHE_DIR, "course_index.json")
NO_VIDEO_PATH = os.path.join(CACHE_DIR, "no_video_courses.json")


# ── Local course index (from sitemap) ────────────────────────────────────────

def get_course_index() -> list[dict]:
    os.makedirs(CACHE_DIR, exist_ok=True)
    if os.path.exists(COURSE_INDEX_PATH):
        if time.time() - os.path.getmtime(COURSE_INDEX_PATH) < 7 * 86400:
            with open(COURSE_INDEX_PATH, "r", encoding="utf-8") as f:
                return json.load(f)

    logger.info("Downloading OCW course index from sitemap…")
    try:
        resp = requests.get(f"{BASE_URL}/sitemap.xml", headers=HEADERS, timeout=20)
        resp.raise_for_status()
    except Exception as e:
        logger.error(f"Sitemap fetch failed: {e}")
        if os.path.exists(COURSE_INDEX_PATH):
            with open(COURSE_INDEX_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        return []

    slugs = list(dict.fromkeys(
        re.findall(r"https://ocw\.mit\.edu/courses/([^/\"<\s]+)/", resp.text)
    ))
    courses = [parse_slug(s) for s in slugs]

    with open(COURSE_INDEX_PATH, "w", encoding="utf-8") as f:
        json.dump(courses, f)
    logger.info(f"Course index: {len(courses)} entries")
    return courses


DEPT_MAP = {
    "1": "Civil & Environmental Engineering", "2": "Mechanical Engineering",
    "3": "Materials Science", "4": "Architecture", "5": "Chemistry",
    "6": "Electrical Engineering & CS", "7": "Biology", "8": "Physics",
    "9": "Brain & Cognitive Sciences", "10": "Chemical Engineering",
    "11": "Urban Studies & Planning", "12": "Earth Sciences",
    "14": "Economics", "15": "Management", "16": "Aeronautics & Astronautics",
    "17": "Political Science", "18": "Mathematics", "20": "Biological Engineering",
    "21": "Humanities", "21A": "Anthropology", "21G": "Global Languages",
    "21H": "History", "21L": "Literature", "21M": "Music & Theater",
    "22": "Nuclear Science & Engineering", "24": "Linguistics & Philosophy",
    "STS": "Science, Technology & Society", "CMS": "Comparative Media Studies",
    "RES": "Resource", "ES": "Experimental Study", "EC": "Edgerton Center",
    "HST": "Health Sciences & Technology", "MAS": "Media Arts & Sciences",
    "SCM": "Supply Chain Management", "IDS": "Data, Systems & Society",
    "SP": "Special Programs", "WGS": "Women & Gender Studies",
    "PE": "Athletics", "CC": "Concourse",
}

NO_VIDEO_PREFIXES = {"RES", "PE", "CC", "ES", "EC", "SP"}


def parse_slug(slug: str) -> dict:
    parts = slug.split("-")
    num_parts, title_start = [], 0
    for i, p in enumerate(parts):
        if i == 0 and re.match(r'^[A-Z]{2,}$', p):
            num_parts.append(p); continue
        if bool(re.match(r'^[A-Z0-9]+[a-z]*$', p)) and len(p) <= 6 and i <= 2:
            num_parts.append(p)
        else:
            title_start = i; break

    course_number = "-".join(num_parts).upper() if num_parts else ""
    title_words = list(parts[title_start:])

    semesters = {"spring", "fall", "summer", "january", "iap"}
    year = semester = ""
    while title_words:
        last = title_words[-1].lower()
        if title_words[-1].isdigit() and len(title_words[-1]) == 4:
            year = title_words.pop()
        elif last in semesters:
            semester = title_words.pop().capitalize()
        else:
            break

    title = " ".join(w.capitalize() for w in title_words) if title_words else slug.replace("-", " ").title()
    dept_key = re.match(r'^([A-Z]+|[0-9]+)', course_number)
    subject = DEPT_MAP.get(dept_key.group(1), "") if dept_key else ""
    term = f"{semester} {year}".strip()

    return {
        "title": title,
        "course_number": course_number,
        "slug": slug,
        "url": f"{BASE_URL}/courses/{slug}/",
        "subject": subject,
        "term": term,
        "year": year,
        "description": f"{course_number} · {subject}{' · ' + term if term else ''}",
    }


# ── No-video blocklist ────────────────────────────────────────────────────────

def load_no_video_set() -> set:
    if os.path.exists(NO_VIDEO_PATH):
        try:
            with open(NO_VIDEO_PATH, "r", encoding="utf-8") as f:
                return set(json.load(f))
        except Exception:
            pass
    return set()


def mark_no_video(slug: str):
    os.makedirs(CACHE_DIR, exist_ok=True)
    nv = load_no_video_set()
    nv.add(slug)
    try:
        with open(NO_VIDEO_PATH, "w", encoding="utf-8") as f:
            json.dump(list(nv), f)
    except Exception as e:
        logger.warning(f"Could not save no-video list: {e}")


# ── Local text search (kept for possible internal use) ────────────────────────

def search_courses(query: str) -> list[dict]:
    index = get_course_index()
    if not index:
        return []
    q_words = set(re.findall(r'\w+', query.lower())) - {
        "the", "a", "an", "and", "or", "of", "in", "to", "for", "mit"
    }
    if not q_words:
        return []
    no_video = load_no_video_set()
    scored = []
    for course in index:
        slug = course.get("slug", "")
        if slug in no_video:
            continue
        cn = course.get("course_number", "")
        pfx = re.match(r'^([A-Z]+)', cn)
        if pfx and pfx.group(1) in NO_VIDEO_PREFIXES:
            continue
        text = (course["title"] + " " + cn + " " + course["subject"]).lower()
        text_words = set(re.findall(r'\w+', text))
        score = 10 if query.lower() in text else 0
        for w in q_words:
            if w in text_words:
                score += 2
            elif any(w in tw for tw in text_words):
                score += 1
        if score > 0:
            scored.append((score, course))
    scored.sort(key=lambda x: -x[0])
    return [c for _, c in scored[:15]]


# ── Playlist → OCW match ──────────────────────────────────────────────────────

STOP_WORDS = {"the", "a", "an", "of", "and", "in", "for", "with", "to"}


def match_playlist_to_ocw(playlist: dict) -> dict | None:
    """
    Score a YouTube playlist against the local OCW index.

    Scoring:
      +3  course numbers match exactly (normalised)
      +2  ≥2 significant title words overlap
      +1  1 title word overlaps
      +1  same year in both
      +1  instructor name appears in both (best-effort)

    Returns None if best score < 2.
    Returns {course, score, confidence: "verified"|"possible"}.
    """
    from services.youtube import normalize_course_number

    index = get_course_index()
    if not index:
        return None

    pl_title = playlist.get("title", "")
    pl_words = set(re.findall(r'\w+', pl_title.lower())) - STOP_WORDS
    pl_cn = playlist.get("course_number")  # already normalised or None
    pl_year = re.search(r'\b(20\d{2}|19\d{2})\b', pl_title)

    best_score = 0
    best_course = None

    for course in index:
        score = 0
        cn = course.get("course_number", "")

        # +3 course number exact match
        if pl_cn and cn:
            norm = normalize_course_number(cn) or cn
            if norm == pl_cn:
                score += 3

        # +2 / +1 title word overlap
        c_words = set(re.findall(r'\w+', course["title"].lower())) - STOP_WORDS
        overlap = len(pl_words & c_words)
        if overlap >= 2:
            score += 2
        elif overlap == 1:
            score += 1

        # +1 year
        if pl_year and pl_year.group() in course.get("term", ""):
            score += 1

        if score > best_score:
            best_score = score
            best_course = course

    if best_score < 2:
        return None

    return {
        "course": best_course,
        "score": best_score,
        "confidence": "verified" if best_score >= 4 else "possible",
    }


# ── YouTube ID helper (kept for tasks.py) ────────────────────────────────────

def extract_youtube_id(url: str) -> str | None:
    for pat in [
        r"youtube\.com/watch\?v=([a-zA-Z0-9_-]{11})",
        r"youtu\.be/([a-zA-Z0-9_-]{11})",
        r"youtube\.com/embed/([a-zA-Z0-9_-]{11})",
    ]:
        m = re.search(pat, url)
        if m:
            return m.group(1)
    return None


# ── Document scraping ─────────────────────────────────────────────────────────

_DOC_EXTS = {".pdf", ".zip", ".pptx", ".xlsx", ".docx"}

# File type inference — ordered most-specific first
_TYPE_PATTERNS = [
    (["slide", "slides"],                                          "slides"),
    (["lec", "lecture", "note", "handout", "ses", "session"],     "lecture_notes"),
    (["pset", "problem_set", "problem-set", "homework", "hw",
      "assignment"],                                               "problem_set"),
    (["exam", "quiz", "midterm", "test", "final"],                "exam"),
    (["textbook", "book", "chapter"],                             "textbook"),
    (["reading", "article", "paper"],                             "reading"),
]

# Section URL keywords → resource type (for course sub-pages, not individual files)
_SECTION_TYPE_MAP = [
    (["assignment", "pset", "problem"],  "problem_set"),
    (["exam", "quiz", "midterm"],        "exam"),
    (["slide"],                          "slides"),
    (["lecture", "note"],                "lecture_notes"),
    (["reading"],                        "reading"),
]

# Lecture number extraction patterns (ordered: specific → general)
_LEC_NUM_PATS = [
    re.compile(r'lec(?:ture)?\s*0*(\d+)',  re.IGNORECASE),
    re.compile(r'ses(?:sion)?\s*0*(\d+)',  re.IGNORECASE),
    re.compile(r'class\s*0*(\d+)',         re.IGNORECASE),
    re.compile(r'week\s*0*(\d+)',          re.IGNORECASE),
    re.compile(r'\bL\s*0*(\d+)\b'),
]
_PSET_NUM_PAT  = re.compile(r'(?:pset|hw|homework|problem.?set|assignment)\s*0*(\d+)', re.IGNORECASE)
_EXAM_NUM_PAT  = re.compile(r'(?:exam|quiz|midterm|test)\s*0*(\d+)', re.IGNORECASE)
_GENERIC_NUM_PAT = re.compile(r'\b0*([1-9]\d*)\b')


def _infer_type(raw: str, is_section: bool = False) -> str:
    """Infer resource type from combined title+url text."""
    s = raw.lower()
    patterns = _SECTION_TYPE_MAP if is_section else _TYPE_PATTERNS
    for keywords, rtype in patterns:
        if any(kw in s for kw in keywords):
            return rtype
    return "resource"


def _extract_lecture_number(raw: str) -> int | None:
    """Return the lecture/session number from a resource title or URL fragment."""
    for pat in _LEC_NUM_PATS:
        m = pat.search(raw)
        if m:
            return int(m.group(1))
    return None


def _extract_resource_number(raw: str, rtype: str) -> int | None:
    """Return a numbered index for problem sets, exams, etc."""
    if rtype == "problem_set":
        m = _PSET_NUM_PAT.search(raw)
        if m:
            return int(m.group(1))
    elif rtype == "exam":
        m = _EXAM_NUM_PAT.search(raw)
        if m:
            return int(m.group(1))
    return None


_TYPE_LABELS = {
    "slides":        "Slides",
    "lecture_notes": "Notes",
    "problem_set":   "Problem Set",
    "exam":          "Exam",
    "textbook":      "Textbook",
    "reading":       "Reading",
    "resource":      "Resource",
}

_BAD_TITLE_RE = re.compile(
    r'\.(pdf|zip|pptx|xlsx|docx)$'          # raw filename
    r'|^MIT\d'                               # OCW course code "MIT18_065S18_..."
    r'|^[A-Z]{2,3}\d'                        # e.g. "RES18-065"
    r'|^\d+\s*[kmg]b'                        # pure file size "169 kB"
    r'|^pdf\s*\d'                            # "pdf169 kB" (type+size button text)
    r'|^(?:pdf|zip|pptx|xlsx)$',            # single file-type word
    re.IGNORECASE,
)

# Strips file size / type suffixes OCW adds: "(PDF)", "PDF 169 kB", etc.
_CLEAN_ANCHOR_RE = re.compile(
    r'\s*\((?:PDF|ZIP|PPTX|XLSX|DOCX)\)\s*$'  # trailing (PDF)
    r'|\s+\d+\s*[kmg]b\s*$'                    # trailing "169 kB"
    r'|\s+(?:pdf|zip|pptx|xlsx)\s*$',          # trailing "pdf"
    re.IGNORECASE,
)


def _make_display_name(anchor: str, url: str, rtype: str, lec_num: int | None) -> str:
    """Produce a human-readable name from anchor text or URL."""
    anchor = anchor.strip()

    # Clean common OCW suffixes like "(PDF)", "169 kB", standalone "pdf"
    cleaned = _CLEAN_ANCHOR_RE.sub('', anchor).strip()

    # Accept cleaned anchor if it looks like real text (not a filename/code)
    if cleaned and not _BAD_TITLE_RE.search(cleaned) and len(cleaned) > 3:
        return cleaned

    # Fall back: construct from URL filename
    fname = url.rstrip('/').split("/")[-1]
    fname_clean = re.sub(r'\.[a-z]{2,4}$', '', fname, flags=re.IGNORECASE)
    # Strip OCW CDN hex-hash prefix: "74E213D46Fc146692Bc5D60223E610Eb_"
    fname_clean = re.sub(r'^[0-9a-fA-F]{16,}[_\-]+', '', fname_clean)
    # Strip MIT/RES course-code prefix: "MIT18_065S18_", "MITRES18_05S10_", etc.
    fname_clean = re.sub(r'^(?:MIT)?(?:[A-Z]{1,4})?\d{1,3}[_\-][A-Za-z0-9]+[_\-]', '', fname_clean, flags=re.IGNORECASE) or fname_clean
    fname_clean = fname_clean.replace("_", " ").replace("-", " ").strip()

    label = _TYPE_LABELS.get(rtype, "File")
    num = lec_num or _extract_resource_number(fname_clean + " " + anchor, rtype)
    if num:
        return f"{label} {num}"
    if fname_clean and len(fname_clean) > 2:
        return fname_clean.title()
    return label


def _parse_resource(anchor: str, url: str, is_section: bool = False) -> dict:
    """
    Parse a scraper hit into {title, url, type, lecture_number}.
    """
    combined = anchor + " " + url
    rtype = _infer_type(combined, is_section=is_section)
    lec_num = _extract_lecture_number(combined)
    title = _make_display_name(anchor, url, rtype, lec_num)
    return {
        "title": title,
        "url": url,
        "type": rtype,
        "lecture_number": lec_num,
    }


def _fetch_soup(url: str, timeout: int = 12) -> "BeautifulSoup | None":
    """Fetch a URL and return a BeautifulSoup, or None on failure."""
    try:
        r = requests.get(url, headers=HEADERS, timeout=timeout)
        r.raise_for_status()
        return BeautifulSoup(r.text, "html.parser")
    except Exception as e:
        logger.debug(f"Fetch failed {url}: {e}")
        return None


def _extract_download_url(soup: "BeautifulSoup", page_url: str) -> "str | None":
    """
    On an OCW individual resource page (/resources/{name}/), find the actual
    downloadable file URL.

    OCW resource pages embed the file as an <a> that:
      - Has an href with a known document extension, OR
      - Contains text / class hinting "download"
    """
    # Priority 1: any href with a known doc extension
    for a in soup.find_all("a", href=True):
        full = urljoin(page_url, a["href"]).split("?")[0].split("#")[0]
        if os.path.splitext(full)[1].lower() in _DOC_EXTS:
            return full
    # Priority 2: anchor whose text or class contains "download"
    for a in soup.find_all("a", href=True):
        text = a.get_text(strip=True).lower()
        cls  = " ".join(a.get("class", [])).lower()
        if "download" in text or "download" in cls:
            full = urljoin(page_url, a["href"]).split("?")[0].split("#")[0]
            if os.path.splitext(full)[1].lower() in _DOC_EXTS:
                return full
    return None


def scrape_ocw_documents(course_url: str) -> list[dict]:
    """
    Scrape an OCW course page for downloadable resources.

    OCW courses have a two-level structure:
      Level 1 — Section pages  (/pages/assignments/, /pages/lecture-notes/, …)
                listed on the course home.  These rarely have direct file links.
      Level 2 — Individual resource pages  (/resources/{name}/)
                linked from section pages.  Each typically embeds one file.

    Strategy
    ─────────
    1. Fetch the course home page; collect any direct file links.
    2. Probe {course_url}resources/ explicitly — the canonical listing OCW
       exposes on virtually every modern course; collect direct files there too.
    3. Discover all section pages (by URL/anchor keyword) from the home page;
       register each as a navigable section resource (type inferred from URL).
    4. Visit each section page (up to MAX_SECTION_PAGES); collect direct files
       and harvest all /resources/{name}/ sub-links.
    5. Follow each /resources/{name}/ sub-link (up to MAX_RESOURCE_PAGES);
       extract the actual download URL via _extract_download_url.
    6. Fall back to collecting any file links found on resource sub-pages that
       don't yield a clean download URL.

    Returns a list of {title, url, type, lecture_number} dicts.
    """
    MAX_SECTION_PAGES  = 20   # section/category pages to visit
    MAX_RESOURCE_PAGES = 80   # individual /resources/{name}/ pages to follow

    # ── Shared state ──────────────────────────────────────────────────────────
    seen_doc_urls:  set = set()   # normalised file / section URLs already added
    seen_page_urls: set = set()   # normalised page URLs already fetched/queued
    docs: list = []
    docs_by_url: dict = {}        # norm_url → index in docs (for title upgrades)

    # Detects titles contaminated by OCW CDN hex-hash prefixes
    _HEX_RUN = re.compile(r'[0-9a-fA-F]{8,}')

    def _norm(url: str) -> str:
        return url.lower().rstrip("/")

    def _add(resource: dict):
        key = _norm(resource["url"])
        if key not in seen_doc_urls:
            seen_doc_urls.add(key)
            docs_by_url[key] = len(docs)
            docs.append(resource)
        else:
            # Allow a clean anchor/h1 title to replace a garbled URL-derived one.
            # This fixes the race where _collect_files grabs the PDF first with a
            # bad anchor (icon + file-size text) and _extract_download_url later
            # finds the same URL with a proper human-readable h1 title.
            idx = docs_by_url.get(key)
            if idx is not None:
                old_title = docs[idx].get("title", "")
                new_title = resource.get("title", "")
                if new_title and not _HEX_RUN.search(new_title) and _HEX_RUN.search(old_title):
                    docs[idx] = resource

    def _collect_files(soup: BeautifulSoup, page_url: str):
        """Add every direct downloadable file link found in soup."""
        for a in soup.find_all("a", href=True):
            full = urljoin(page_url, a["href"]).split("?")[0].split("#")[0]
            if os.path.splitext(full)[1].lower() not in _DOC_EXTS:
                continue
            anchor = a.get_text(strip=True)
            _add(_parse_resource(anchor, full, is_section=False))

    def _harvest_resource_sublinks(
        soup: BeautifulSoup, page_url: str
    ) -> list[tuple[str, str]]:
        """
        Find /resources/{name}/ sub-links on a section page.
        Returns [(url, anchor_text), …] not yet queued.
        """
        hits = []
        for a in soup.find_all("a", href=True):
            full = urljoin(page_url, a["href"]).split("?")[0].rstrip("/")
            if not full.startswith(course_base):
                continue
            path = full[len(course_base):]
            # Match /resources/{single-segment} — individual resource pages
            if re.match(r"^/resources/[^/]+$", path):
                key = _norm(full)
                if key not in seen_page_urls:
                    seen_page_urls.add(key)
                    anchor = a.get_text(strip=True)
                    hits.append((full, anchor))
        return hits

    course_base = course_url.rstrip("/")

    SECTION_KW = {
        "assignment", "pset", "problem", "exam", "quiz", "midterm",
        "reading", "lecture", "note", "slide", "resource", "material",
        "project", "lab", "final", "homework", "hw", "recitation",
        "discussion", "tutorial",
    }

    # ── 1. Home page ──────────────────────────────────────────────────────────
    home_soup = _fetch_soup(course_url, timeout=20)
    if home_soup is None:
        logger.error(f"scrape_ocw_documents: cannot load {course_url}")
        return docs

    _collect_files(home_soup, course_url)

    # ── 2. Discover section pages ─────────────────────────────────────────────
    section_pages: list[tuple[str, str]] = []

    for a in home_soup.find_all("a", href=True):
        full = urljoin(course_url, a["href"]).split("?")[0].rstrip("/")
        if not full.startswith(course_base) or full == course_base:
            continue
        text     = a.get_text(strip=True)
        path_lc  = full[len(course_base):].lower()
        if any(kw in path_lc or kw in text.lower() for kw in SECTION_KW):
            key = _norm(full)
            if key not in seen_page_urls:
                seen_page_urls.add(key)
                section_pages.append((full, text))

    # Always probe the /resources/ listing — most reliable on modern OCW courses
    resources_index = f"{course_base}/resources"
    if _norm(resources_index) not in seen_page_urls:
        seen_page_urls.add(_norm(resources_index))
        section_pages.insert(0, (resources_index, "Resources"))

    # Also probe the /download/ page — OCW's "Download Course" button links here
    # and it often lists every file in the course in one place.
    download_index = f"{course_base}/download"
    if _norm(download_index) not in seen_page_urls:
        seen_page_urls.add(_norm(download_index))
        section_pages.insert(1, (download_index, "Download"))

    # ── 3 & 4. Visit section pages; harvest resource sub-links ───────────────
    resource_queue: list[tuple[str, str]] = []   # (url, anchor) to follow

    for sp_url, anchor in section_pages[:MAX_SECTION_PAGES]:
        # Register the section page as a navigable resource for the UI
        _add(_parse_resource(anchor, sp_url, is_section=True))

        time.sleep(0.25)
        sp_soup = _fetch_soup(sp_url, timeout=12)
        if sp_soup is None:
            continue

        _collect_files(sp_soup, sp_url)
        resource_queue.extend(_harvest_resource_sublinks(sp_soup, sp_url))

    # ── 5. Follow individual resource pages ───────────────────────────────────
    for res_url, res_anchor in resource_queue[:MAX_RESOURCE_PAGES]:
        time.sleep(0.2)
        res_soup = _fetch_soup(res_url, timeout=10)
        if res_soup is None:
            continue

        file_url = _extract_download_url(res_soup, res_url)
        if file_url:
            # Prefer the page's <h1> or <title> as the display name if the
            # anchor text is blank or looks like a URL slug.
            display = res_anchor
            if not display or re.match(r'^[a-z0-9-]+$', display):
                h1 = res_soup.find("h1")
                if h1:
                    display = h1.get_text(strip=True)
                if not display:
                    title_tag = res_soup.find("title")
                    if title_tag:
                        display = title_tag.get_text(strip=True).split("|")[0].strip()
            _add(_parse_resource(display or res_anchor, file_url, is_section=False))
        else:
            # No clean download URL — collect any file links on the page anyway
            _collect_files(res_soup, res_url)

    logger.info(
        f"scrape_ocw_documents: {len(docs)} resources from {course_url} "
        f"(section pages={min(len(section_pages), MAX_SECTION_PAGES)}, "
        f"resource pages followed={min(len(resource_queue), MAX_RESOURCE_PAGES)})"
    )
    return docs

"""
Readings fallback service.

For a reading title that has no direct download link, searches in order:
  1. arXiv API (by title)
  2. OpenStax book list
  3. Falls back to status="not_found" so the UI can prompt a manual upload.
"""
import re
import json
import logging
import requests

logger = logging.getLogger(__name__)

HEADERS = {"User-Agent": "LearnOCW/1.0 (educational use)"}

# Cached OpenStax catalogue so we don't fetch it repeatedly
_openstax_books: list[dict] | None = None


def find_reading(title: str) -> dict:
    """
    Try to find an open-access URL for a reading by title.

    Returns a dict:
        {title, url, source, status}   — status "found" or "not_found"
    """
    result = _search_arxiv(title) or _search_openstax(title)
    if result:
        return {**result, "title": title, "status": "found"}
    return {"title": title, "url": None, "source": None, "status": "not_found"}


# ── arXiv ─────────────────────────────────────────────────────────────────────

def _search_arxiv(title: str) -> dict | None:
    """Search arXiv for a paper/book by title. Returns {url, source} or None."""
    clean = re.sub(r'[^\w\s]', ' ', title).strip()
    if len(clean) < 5:
        return None
    try:
        r = requests.get(
            "https://export.arxiv.org/api/query",
            params={"search_query": f'ti:"{clean}"', "max_results": "1"},
            headers=HEADERS,
            timeout=10,
        )
        r.raise_for_status()
        # arXiv returns Atom XML — just extract the first <id> tag
        m = re.search(r'<id>https://arxiv\.org/abs/([^<]+)</id>', r.text)
        if m:
            arxiv_id = m.group(1).strip()
            # Check that entry has a meaningful title (not a 0-results response)
            if "<entry>" in r.text:
                return {
                    "url": f"https://arxiv.org/abs/{arxiv_id}",
                    "source": "arxiv",
                }
    except Exception as e:
        logger.debug(f"arXiv search failed for '{title}': {e}")
    return None


# ── OpenStax ──────────────────────────────────────────────────────────────────

def _load_openstax_books() -> list[dict]:
    global _openstax_books
    if _openstax_books is not None:
        return _openstax_books
    try:
        r = requests.get(
            "https://openstax.org/api/v2/pages/",
            params={
                "type": "books.Book",
                "fields": "title,slug",
                "format": "json",
                "limit": "200",
            },
            headers=HEADERS,
            timeout=12,
        )
        r.raise_for_status()
        data = r.json()
        _openstax_books = data.get("items", [])
    except Exception as e:
        logger.debug(f"OpenStax catalogue fetch failed: {e}")
        _openstax_books = []
    return _openstax_books


def _search_openstax(title: str) -> dict | None:
    """Check if the title closely matches an OpenStax book. Returns {url, source} or None."""
    books = _load_openstax_books()
    title_words = set(re.findall(r'\w+', title.lower())) - {"a", "an", "the", "of", "and"}
    if not title_words:
        return None

    best_score = 0
    best_book = None
    for book in books:
        book_words = set(re.findall(r'\w+', book.get("title", "").lower()))
        overlap = len(title_words & book_words)
        # Require majority overlap to avoid false positives
        if overlap >= max(2, len(title_words) * 0.6):
            if overlap > best_score:
                best_score = overlap
                best_book = book

    if best_book:
        slug = best_book.get("slug", "")
        return {
            "url": f"https://openstax.org/details/books/{slug}",
            "source": "openstax",
        }
    return None

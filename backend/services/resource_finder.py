import requests
import os
import re
import logging
from urllib.parse import quote_plus, urljoin
import xml.etree.ElementTree as ET

logger = logging.getLogger(__name__)

HEADERS = {
    "User-Agent": "LearnOCW/1.0 (educational tool)"
}

RESOURCES_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "data", "resources")
os.makedirs(RESOURCES_DIR, exist_ok=True)

OPENSTAX_BOOKS = [
    {"title": "University Physics", "url": "https://openstax.org/details/books/university-physics-volume-1"},
    {"title": "Calculus", "url": "https://openstax.org/details/books/calculus-volume-1"},
    {"title": "Chemistry: Atoms First", "url": "https://openstax.org/details/books/chemistry-atoms-first-2e"},
    {"title": "Introduction to Sociology", "url": "https://openstax.org/details/books/introduction-sociology-3e"},
    {"title": "Economics", "url": "https://openstax.org/details/books/principles-economics-3e"},
    {"title": "Biology", "url": "https://openstax.org/details/books/biology-2e"},
    {"title": "Statistics", "url": "https://openstax.org/details/books/introductory-statistics"},
    {"title": "Linear Algebra", "url": "https://openstax.org/details/books/elementary-algebra-2e"},
]


def search_arxiv(title: str) -> dict | None:
    """Search arXiv for a paper by title."""
    query = quote_plus(title)
    url = f"http://export.arxiv.org/api/query?search_query=ti:{query}&max_results=3"
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        root = ET.fromstring(resp.text)
        ns = {"atom": "http://www.w3.org/2005/Atom"}
        entries = root.findall("atom:entry", ns)
        for entry in entries:
            entry_title = entry.find("atom:title", ns)
            entry_id = entry.find("atom:id", ns)
            if entry_title is not None and entry_id is not None:
                if title_similarity(title, entry_title.text or "") > 0.6:
                    arxiv_url = entry_id.text or ""
                    pdf_url = arxiv_url.replace("abs", "pdf") + ".pdf"
                    return {
                        "title": (entry_title.text or "").strip(),
                        "url": pdf_url,
                        "source": "arxiv"
                    }
    except Exception as e:
        logger.warning(f"arXiv search failed for '{title}': {e}")
    return None


def search_openstax(title: str) -> dict | None:
    """Check if a reading matches an OpenStax book."""
    title_lower = title.lower()
    for book in OPENSTAX_BOOKS:
        if title_similarity(title_lower, book["title"].lower()) > 0.5:
            return {
                "title": book["title"],
                "url": book["url"],
                "source": "openstax"
            }
    return None


def search_ocw_library(title: str) -> dict | None:
    """Search MIT OCW for a resource by title."""
    query = quote_plus(title)
    url = f"https://ocw.mit.edu/search/?q={query}&type=resource"
    try:
        from bs4 import BeautifulSoup
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")
        links = soup.find_all("a", href=re.compile(r"\.(pdf|zip)"))
        for link in links[:3]:
            href = link.get("href", "")
            full = urljoin("https://ocw.mit.edu", href)
            link_title = link.get_text(strip=True)
            if title_similarity(title, link_title) > 0.4:
                return {
                    "title": link_title,
                    "url": full,
                    "source": "ocw"
                }
    except Exception as e:
        logger.warning(f"OCW library search failed for '{title}': {e}")
    return None


def find_resource(title: str) -> dict:
    """
    Try to find a resource in order:
    1. arXiv
    2. OpenStax
    3. MIT OCW library
    """
    # Try arXiv
    result = search_arxiv(title)
    if result:
        return result

    # Try OpenStax
    result = search_openstax(title)
    if result:
        return result

    # Try OCW library
    result = search_ocw_library(title)
    if result:
        return result

    return {"title": title, "url": None, "source": None, "status": "not_found"}


def download_resource(url: str, filename: str) -> str | None:
    """Download a resource to local storage. Returns local path."""
    safe_name = re.sub(r'[^\w\-_\.]', '_', filename)[:100]
    local_path = os.path.join(RESOURCES_DIR, safe_name)

    if os.path.exists(local_path):
        return local_path

    try:
        resp = requests.get(url, headers=HEADERS, timeout=60, stream=True)
        resp.raise_for_status()
        with open(local_path, 'wb') as f:
            for chunk in resp.iter_content(chunk_size=8192):
                f.write(chunk)
        return local_path
    except Exception as e:
        logger.error(f"Download failed for {url}: {e}")
        return None


def title_similarity(a: str, b: str) -> float:
    """Simple word-overlap similarity between two titles."""
    a_words = set(re.findall(r'\w+', a.lower()))
    b_words = set(re.findall(r'\w+', b.lower()))
    stopwords = {'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'for', 'with', 'on', 'at'}
    a_words -= stopwords
    b_words -= stopwords
    if not a_words or not b_words:
        return 0.0
    intersection = a_words & b_words
    union = a_words | b_words
    return len(intersection) / len(union)

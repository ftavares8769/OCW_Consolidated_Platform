"""
YouTube playlist service for MIT OCW content discovery.

Scrapes the MIT OCW YouTube channel (no API key required) to find playlists
matching a query, fetches their video lists, and groups videos by detected structure.
"""
import re
import json
import time
import logging
import requests

logger = logging.getLogger(__name__)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}

MIT_OCW_CHANNEL_ID = "UCEBb1b_L6zDS3xTUrIALZOw"


# ── ytInitialData extraction ──────────────────────────────────────────────────

def _extract_yt_data(html: str) -> dict | None:
    """
    Extract the ytInitialData JSON blob embedded in any YouTube page.
    Uses raw_decode for speed and reliability over regex on large HTML.
    """
    for marker in ("var ytInitialData = ", 'window["ytInitialData"] = '):
        idx = html.find(marker)
        if idx == -1:
            continue
        start = idx + len(marker)
        try:
            obj, _ = json.JSONDecoder().raw_decode(html[start:])
            return obj
        except json.JSONDecodeError:
            pass
    return None


def _walk(obj, key: str) -> list:
    """Recursively collect every value stored under `key` in a nested structure."""
    out = []
    if isinstance(obj, dict):
        if key in obj:
            out.append(obj[key])
        for v in obj.values():
            out.extend(_walk(v, key))
    elif isinstance(obj, list):
        for item in obj:
            out.extend(_walk(item, key))
    return out


def _text(obj) -> str:
    """Unwrap YouTube's {simpleText: ...} or {runs: [{text: ...}]} text objects."""
    if isinstance(obj, dict):
        if "simpleText" in obj:
            return obj["simpleText"]
        if "runs" in obj:
            return "".join(r.get("text", "") for r in obj["runs"])
    return str(obj) if obj else ""


# ── Course number normalisation ───────────────────────────────────────────────

def normalize_course_number(text: str) -> str | None:
    """
    Extract and normalise an MIT course number from arbitrary text.

    Examples:
        "MIT6_006"       → "6.006"
        "18.06SC"        → "18.06"
        "6.004 Spring"   → "6.004"
        "8-01T"          → "8.01"
    """
    # MIT6_006 style (used in some repo names / playlist titles)
    m = re.search(r'\bMIT(\d{1,3})[_](\d{2,3})', text, re.IGNORECASE)
    if m:
        return f"{m.group(1)}.{m.group(2)}"
    # 18.06, 6.004, 8.01SC, 18.06SC, 8-01 …
    m = re.search(r'\b(\d{1,3})[.\-](\d{2,3})[A-Za-z]*\b', text)
    if m:
        return f"{m.group(1)}.{m.group(2)}"
    return None


# ── Playlist search ───────────────────────────────────────────────────────────

# YouTube's own public API key (embedded in every youtube.com page)
_YT_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8"
_YT_CLIENT = {"clientName": "WEB", "clientVersion": "2.20240101.00.00"}


def search_ocw_playlists(query: str) -> list[dict]:
    """
    Search YouTube for MIT OCW playlists matching *query*.

    Uses YouTube's internal innertube API (no personal API key required) with
    the playlist-only filter (params=EgIQAw==).  Results are filtered to the
    MIT OCW channel by checking the channel name in each item's metadata rows.
    "Full Course" / "Complete Course" playlists are sorted first, then by
    video count descending.
    """
    try:
        resp = requests.post(
            "https://www.youtube.com/youtubei/v1/search",
            params={"key": _YT_KEY},
            json={
                "context": {"client": _YT_CLIENT},
                "query": f"{query} MIT OCW",
                "params": "EgIQAw==",   # filter: playlists only
            },
            headers=HEADERS,
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        logger.error(f"YouTube innertube search failed: {e}")
        return []

    playlists = []
    for item in _walk(data, "lockupViewModel"):
        try:
            playlist_id = item.get("contentId", "")
            if not playlist_id:
                continue
            if item.get("contentType") not in (
                "LOCKUP_CONTENT_TYPE_PLAYLIST", "LOCKUP_CONTENT_TYPE_COURSE", None
            ):
                continue

            meta_vm = item.get("metadata", {}).get("lockupMetadataViewModel", {})
            title = meta_vm.get("title", {}).get("content", "")
            if not title:
                continue

            # Channel name is the first metadataRow text
            rows = (
                meta_vm.get("metadata", {})
                .get("contentMetadataViewModel", {})
                .get("metadataRows", [])
            )
            channel_name = ""
            for row in rows:
                for part in row.get("metadataParts", []):
                    t = part.get("text", {}).get("content", "")
                    if t:
                        channel_name = t
                        break
                if channel_name:
                    break

            is_ocw = (
                "mit opencourseware" in channel_name.lower()
                or "mitocw" in channel_name.lower()
            )
            if not is_ocw:
                continue

            # Video count from thumbnail badge overlay
            badges = _walk(item.get("contentImage", {}), "thumbnailBadgeViewModel")
            count_text = next((b.get("text", "") for b in badges if b.get("text")), "")
            try:
                video_count = int(re.search(r'\d+', count_text).group())
            except Exception:
                video_count = 0

            # Best thumbnail
            thumbs = _walk(item.get("contentImage", {}), "sources")
            thumbnail = thumbs[0][0].get("url", "") if thumbs and thumbs[0] else ""

            playlists.append({
                "playlist_id": playlist_id,
                "title": title,
                "video_count": video_count,
                "thumbnail": thumbnail,
                "course_number": normalize_course_number(title),
                "channel": channel_name,
                "playlist_url": f"https://www.youtube.com/playlist?list={playlist_id}",
            })

        except Exception as e:
            logger.debug(f"Error parsing lockupViewModel: {e}")

    # Sort: full/complete-course first, then by video count
    def _priority(p: dict) -> tuple:
        t = p["title"].lower()
        is_full = "full course" in t or "complete course" in t
        return (0 if is_full else 1, -p["video_count"])

    playlists.sort(key=_priority)
    logger.info(f"YouTube search '{query}' → {len(playlists)} OCW playlists")
    return playlists


# ── Playlist video listing ────────────────────────────────────────────────────

def fetch_playlist_videos(playlist_id: str) -> list[dict]:
    """
    Fetch all videos in a YouTube playlist in their playlist order.

    Returns a list of dicts with keys: title, youtube_id, youtube_url, order_index.
    YouTube only embeds the first ~100 videos in ytInitialData; for longer
    playlists we also attempt one continuation request.
    """
    url = f"https://www.youtube.com/playlist?list={playlist_id}"
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
    except Exception as e:
        logger.error(f"Failed to fetch playlist {playlist_id}: {e}")
        return []

    data = _extract_yt_data(resp.text)
    if not data:
        logger.warning(f"No ytInitialData on playlist page {playlist_id}")
        return []

    videos = _parse_video_renderers(_walk(data, "playlistVideoRenderer"))

    # If the playlist has a continuation token, fetch one more page
    continuation_tokens = _walk(data, "continuationCommand")
    if continuation_tokens and len(videos) >= 100:
        token = continuation_tokens[0].get("token", "")
        if token:
            more = _fetch_continuation(token)
            videos.extend(more)

    # Re-index order
    for i, v in enumerate(videos):
        v["order_index"] = i

    return videos


def _parse_video_renderers(renderers: list) -> list[dict]:
    videos = []
    for vr in renderers:
        vid_id = vr.get("videoId", "")
        if not vid_id:
            continue
        title = _text(vr.get("title", {})) or f"Lecture {len(videos) + 1}"
        videos.append({
            "title": title,
            "youtube_id": vid_id,
            "youtube_url": f"https://www.youtube.com/watch?v={vid_id}",
            "order_index": len(videos),
        })
    return videos


def _fetch_continuation(token: str) -> list[dict]:
    """Fetch one continuation page of playlist videos via YouTube's innertube API."""
    try:
        resp = requests.post(
            "https://www.youtube.com/youtubei/v1/browse",
            params={"key": "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8"},
            json={
                "context": {
                    "client": {"clientName": "WEB", "clientVersion": "2.20240101.00.00"}
                },
                "continuation": token,
            },
            headers=HEADERS,
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()
        return _parse_video_renderers(_walk(data, "playlistVideoRenderer"))
    except Exception as e:
        logger.warning(f"Continuation fetch failed: {e}")
        return []


# ── Video structure detection ─────────────────────────────────────────────────

def group_videos_by_structure(videos: list[dict]) -> list[dict]:
    """
    Detect if video titles carry a numeric grouping (e.g. "1.2 ...", "Lecture 3",
    "Week 2") and annotate each video with `unit` (int | None) and
    `unit_label` (str | None).

    Grouping is applied only when ≥30 % of videos have a detectable unit number.
    Otherwise every video gets unit=None (flat list).
    """
    if not videos:
        return videos

    UNIT_PATTERNS = [
        r'^\s*(\d+)[.\-]\d+',                                      # "1.2 Title"
        r'^(?:lecture|lec|week|unit|session|class|part)\s+(\d+)',   # "Lecture 3"
        r'^\s*(\d+)\s+(?=[A-Z])',                                   # "3 Title"
    ]

    detected: list[int | None] = []
    for v in videos:
        unit = None
        for pat in UNIT_PATTERNS:
            m = re.match(pat, v["title"], re.IGNORECASE)
            if m:
                unit = int(m.group(1))
                break
        detected.append(unit)

    has_unit = sum(1 for u in detected if u is not None)
    if has_unit < len(videos) * 0.3:
        return [dict(v, unit=None, unit_label=None) for v in videos]

    result = []
    for v, unit in zip(videos, detected):
        result.append(dict(v, unit=unit, unit_label=f"Unit {unit}" if unit else None))
    return result

import re
import logging
from youtube_transcript_api import YouTubeTranscriptApi

# v1.x moved error classes to the top-level package
try:
    from youtube_transcript_api import TranscriptsDisabled, NoTranscriptFound
except ImportError:
    from youtube_transcript_api._errors import TranscriptsDisabled, NoTranscriptFound

logger = logging.getLogger(__name__)

FILLER_WORDS = re.compile(
    r'\b(uh+|um+|uh-huh|hmm+|you know|sort of|kind of|like|basically|literally|actually|right\?|okay\?|alright\?)\b',
    re.IGNORECASE
)


def fetch_transcript(youtube_id: str) -> str | None:
    """Fetch raw transcript from YouTube (youtube-transcript-api v1.x)."""
    try:
        api = YouTubeTranscriptApi()
        # fetch() accepts a list of preferred languages
        data = api.fetch(youtube_id, languages=["en", "en-US", "en-GB"])
        raw_text = " ".join(entry.text for entry in data)
        return raw_text
    except (TranscriptsDisabled, NoTranscriptFound) as e:
        logger.warning(f"No transcript for {youtube_id}: {e}")
        return None
    except Exception as e:
        logger.error(f"Error fetching transcript for {youtube_id}: {e}")
        return None


def clean_transcript(raw_text: str) -> str:
    """
    Clean a raw transcript:
    - Strip timestamps (already stripped by youtube-transcript-api)
    - Remove filler words
    - Merge broken caption lines into full sentences
    - Normalize whitespace
    """
    if not raw_text:
        return ""

    # Remove HTML entities and tags
    text = re.sub(r'<[^>]+>', ' ', raw_text)
    text = re.sub(r'&amp;', '&', text)
    text = re.sub(r'&lt;', '<', text)
    text = re.sub(r'&gt;', '>', text)
    text = re.sub(r'&#39;', "'", text)
    text = re.sub(r'&quot;', '"', text)

    # Remove timestamps if present [00:00] or (00:00)
    text = re.sub(r'\[?\d{1,2}:\d{2}(?::\d{2})?\]?', '', text)
    text = re.sub(r'\(\d{1,2}:\d{2}(?::\d{2})?\)', '', text)

    # Remove speaker labels like "PROFESSOR:" or "[STUDENT]:"
    text = re.sub(r'\[?[A-Z][A-Z\s]+\]?:', '', text)

    # Remove filler words
    text = FILLER_WORDS.sub('', text)

    # Normalize whitespace
    text = re.sub(r'\s+', ' ', text).strip()

    # Merge broken lines into sentences
    text = merge_sentences(text)

    # Final whitespace normalization
    text = re.sub(r'\s+', ' ', text).strip()
    text = re.sub(r' ([.,;:!?])', r'\1', text)

    return text


def merge_sentences(text: str) -> str:
    """
    Merge caption fragments into proper sentences.
    YouTube captions often break mid-sentence.
    """
    # Split into segments (captions are separated by newlines or periods)
    segments = text.split('\n')
    merged = []
    buffer = ""

    for segment in segments:
        segment = segment.strip()
        if not segment:
            continue

        if buffer:
            # If buffer doesn't end with sentence-ending punctuation, merge
            if not buffer[-1] in '.!?':
                buffer += ' ' + segment
            else:
                merged.append(buffer)
                buffer = segment
        else:
            buffer = segment

    if buffer:
        merged.append(buffer)

    # Now join and re-split by sentences for better formatting
    full_text = ' '.join(merged)

    # Ensure sentences start with capital letters
    sentences = re.split(r'(?<=[.!?])\s+', full_text)
    capitalized = []
    for s in sentences:
        s = s.strip()
        if s:
            capitalized.append(s[0].upper() + s[1:] if len(s) > 1 else s.upper())

    return ' '.join(capitalized)


def chunk_transcript(text: str, chunk_size: int = 800, overlap: int = 100) -> list[str]:
    """
    Split transcript into chunks of ~chunk_size words with overlap.
    """
    words = text.split()
    if not words:
        return []

    chunks = []
    start = 0

    while start < len(words):
        end = start + chunk_size
        chunk = ' '.join(words[start:end])
        chunks.append(chunk)
        if end >= len(words):
            break
        start = end - overlap

    return chunks

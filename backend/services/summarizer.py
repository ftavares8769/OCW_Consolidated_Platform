import json
import logging
import re
from services.transcript import chunk_transcript
from services import ai_client

logger = logging.getLogger(__name__)

# Larger chunks mean fewer sequential LLM calls (much faster).
# 1500 words ≈ 8 chunks for a 90-min lecture vs ~30 with 400-word chunks.
CHUNK_SIZE    = 1500
CHUNK_OVERLAP = 150

# /no_think suppresses Qwen3 chain-of-thought (ignored by cloud providers)
CHUNK_SYSTEM_PROMPT = (
    "/no_think\n"
    "Summarise the key points from this lecture segment as bullet points.\n"
    "Rules:\n"
    "- Write one bullet per key idea, starting each line with '- '.\n"
    "- Include definitions, formulas, and worked examples actually stated.\n"
    "- Be specific: use the actual terms and values from the text.\n"
    "- No introduction, no conclusion, no filler, no repetition."
)

# ── Per-section system prompts (one focused call per section) ─────────────────

_SUMMARY_SYSTEM = (
    "/no_think\n"
    "Summarize this lecture for a student in 2-3 sentences.\n"
    "Sentence 1: what topic the lecture covers.\n"
    "Sentence 2: the single most important concept or finding.\n"
    "Sentence 3 (optional): one concrete method or example introduced.\n"
    "Use ONLY content from the lecture. Write the summary text directly — no preamble, no labels."
)

_QUIZ_SYSTEM = (
    "/no_think\n"
    "Create 5 high-quality multiple-choice quiz questions from this lecture.\n"
    "Output a JSON array ONLY. Each element:\n"
    '{"question":"...","options":["A","B","C","D"],"correct_index":0}\n'
    "Rules:\n"
    "- Write clear, specific questions. Use LaTeX math notation where appropriate (e.g. $f\'(x)$, $\\\\int$).\n"
    "- 4 answer choices each; correct_index is 0-3.\n"
    "- Cover the 5 most important testable concepts from the lecture.\n"
    "- Wrong options must be mathematically/conceptually plausible, not obviously absurd.\n"
    "- Use ONLY content from the lecture.\n"
    "- Do NOT write questions about the professor, institution, or the video itself.\n"
    "Output compact JSON (no extra spaces or newlines). No explanation, no markdown fences."
)

_PROBLEMS_SYSTEM = (
    "/no_think\n"
    "Write exactly 4 numbered practice problems from this lecture. One problem per major concept.\n"
    "Use this EXACT format for each — no deviations:\n\n"
    "1. PROBLEM: [problem statement — use LaTeX math notation where appropriate, e.g. $f(x) = x^2$]\n"
    "   SOLUTION: [step 1] | [step 2] | [step 3]\n"
    "2. PROBLEM: ...\n"
    "   SOLUTION: ...\n"
    "3. PROBLEM: ...\n"
    "   SOLUTION: ...\n"
    "4. PROBLEM: ...\n"
    "   SOLUTION: ...\n\n"
    "Rules:\n"
    "- One distinct concept per problem.\n"
    "- Use LaTeX for all math expressions (wrap in $...$).\n"
    "- Use as many steps as the problem genuinely requires (between 2 and 6). Steps separated by ' | '.\n"
    "- Simple problems may need only 2-3 steps; complex derivations may need 5-6.\n"
    "- Each step should be a clear, complete instruction or calculation.\n"
    "- Use ONLY content from the lecture.\n"
    "- Write all 4 problems before stopping."
)

_NOTES_SYSTEM = (
    "/no_think\n"
    "Extract key terms and definitions from this lecture.\n"
    "Output a JSON array of strings ONLY.\n"
    'Each string format: "Term \u2014 definition" (keep definitions concise, 12 words or fewer)\n'
    "Rules:\n"
    "- Max 10 entries, most important first.\n"
    "- Extract ONLY core technical concepts a student needs for an exam.\n"
    "- Do NOT include names of people, institutions, or meta-talk about the video.\n"
    "- Use ONLY content from the lecture.\n"
    "Output valid JSON array only. No explanation, no markdown fences."
)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _strip_artifacts(text: str) -> str:
    """Remove think tags and strip surrounding whitespace."""
    text = re.sub(r'<think>[\s\S]*?</think>', '', text)
    text = re.sub(r'</think>', '', text)
    return text.strip()


def _parse_list(raw: str) -> list:
    """Extract a JSON array from raw model output.

    Strategy (each tried in order):
    1. Code-fenced block
    2. raw_decode from first '[' (handles complete arrays)
    3. cleaned raw_decode (collapses literal newlines inside strings)
    4. Scan for individual complete {…} objects (handles truncated arrays)
    5. Newline-delimited string fallback
    """
    raw = _strip_artifacts(raw)
    decoder = json.JSONDecoder()

    # 1. Code-fenced block
    code_block = re.search(r'```(?:json)?\s*([\s\S]*?)```', raw)
    if code_block:
        candidate = code_block.group(1).strip()
        try:
            obj = json.loads(candidate)
            if isinstance(obj, list):
                return obj
        except json.JSONDecodeError:
            pass

    # 2. raw_decode from first '[' (works when array is complete + well-formed)
    bracket = raw.find('[')
    if bracket != -1:
        try:
            obj, _ = decoder.raw_decode(raw, bracket)
            if isinstance(obj, list):
                return obj
        except json.JSONDecodeError:
            pass

    # 3. Collapse literal newlines (fixes raw \n inside JSON strings) then retry
    if bracket != -1:
        cleaned = raw[bracket:].replace('\n', ' ').replace('\r', '')
        try:
            obj = json.loads(cleaned)
            if isinstance(obj, list):
                return obj
        except json.JSONDecodeError:
            pass

    # 4. Scan for individual complete {…} objects — robust against truncated arrays
    objects = []
    i = 0
    search_text = raw.replace('\n', ' ').replace('\r', '')  # collapse newlines first
    while i < len(search_text):
        j = search_text.find('{', i)
        if j == -1:
            break
        try:
            obj, end = decoder.raw_decode(search_text, j)
            if isinstance(obj, dict):
                objects.append(obj)
            i = end
        except json.JSONDecodeError:
            i = j + 1
    if objects:
        logger.info(f"_parse_list: extracted {len(objects)} objects via object-scan")
        return objects

    # 5. Newline-delimited string fallback (for plain bullet lists)
    lines = [l.strip().lstrip('-•*').strip() for l in raw.split('\n') if l.strip()]
    lines = [l for l in lines if l]
    if lines:
        logger.warning("_parse_list fell back to line-split")
        return lines

    return []


# ── Focused section generators ────────────────────────────────────────────────

def _gen_summary(text: str) -> str:
    """Generate a 2-3 sentence overview of the lecture."""
    try:
        raw = ai_client.call(
            prompt=f"Lecture:\n\n{text}\n\nWrite the summary.",
            system=_SUMMARY_SYSTEM,
            temperature=0.1,
            max_tokens=200,
        )
        return _strip_artifacts(raw)
    except Exception as e:
        logger.error(f"_gen_summary failed: {e}", exc_info=True)
        return ""


def _parse_problems_text(raw: str) -> list:
    """Parse the numbered PROBLEM/SOLUTION plain-text format into a list of dicts."""
    raw = _strip_artifacts(raw)
    problems = []
    # Match: digit(s) + dot + PROBLEM: ... SOLUTION: ...
    # The lookahead (?=\d+\.|$) stops each match at the next numbered item or end.
    pattern = re.compile(
        r'\d+\.\s*PROBLEM:\s*(.+?)\s*SOLUTION:\s*(.+?)(?=\s*\d+\.\s*PROBLEM:|$)',
        re.DOTALL | re.IGNORECASE,
    )
    for m in pattern.finditer(raw):
        problem  = re.sub(r'\s+', ' ', m.group(1)).strip()
        solution = re.sub(r'\s+', ' ', m.group(2)).strip()
        if problem and solution:
            problems.append({"problem": problem, "solution": solution})
    if problems:
        logger.info(f"_parse_problems_text: parsed {len(problems)} problems")
    return problems


def _build_system(base: str, extra_key: str) -> str:
    """Return base system prompt, appending any user-defined extra instructions."""
    from services.config import get as cfg_get
    extra = (cfg_get(extra_key) or "").strip()
    if extra:
        return base + f"\n\nAdditional instructions:\n{extra}"
    return base


def _gen_quiz(text: str) -> list:
    """Generate MCQ quiz questions as a list of dicts."""
    try:
        raw = ai_client.call(
            prompt=f"Lecture notes:\n\n{text}\n\nOutput the JSON quiz array.",
            system=_build_system(_QUIZ_SYSTEM, "prompt_quiz_extra"),
            temperature=0.15,
            max_tokens=1600,
        )
        return _parse_list(raw)
    except Exception as e:
        logger.error(f"_gen_quiz failed: {e}", exc_info=True)
        return []


def _gen_problems(text: str) -> list:
    """Generate practice problems as a list of dicts (plain-text format, regex-parsed)."""
    try:
        raw = ai_client.call(
            prompt=f"Lecture notes:\n\n{text}\n\nWrite the 4 numbered practice problems now.",
            system=_build_system(_PROBLEMS_SYSTEM, "prompt_problems_extra"),
            temperature=0.15,
            max_tokens=1600,
        )
        problems = _parse_problems_text(raw)
        if problems:
            return problems
        # Fallback: try JSON in case model ignored the format instruction
        logger.warning("_gen_problems: plain-text parse empty, trying JSON fallback")
        return _parse_list(raw)
    except Exception as e:
        logger.error(f"_gen_problems failed: {e}", exc_info=True)
        return []


def _gen_notes(text: str) -> list:
    """Generate key terms as a list of strings."""
    try:
        raw = ai_client.call(
            prompt=f"Lecture notes:\n\n{text}\n\nOutput the JSON array of key terms.",
            system=_NOTES_SYSTEM,
            temperature=0.1,
            max_tokens=300,
        )
        return _parse_list(raw)
    except Exception as e:
        logger.error(f"_gen_notes failed: {e}", exc_info=True)
        return []


# ── Main entry point ──────────────────────────────────────────────────────────

def _run_map_step(transcript: str) -> str:
    """
    Map step: chunk the transcript and summarise each chunk to bullet points.
    Short transcripts (≤ 3000 words) are returned as-is.
    Returns the combined bullet-point text used as input for all Reduce calls.
    """
    import time as _time

    words = transcript.split()
    logger.info(f"Transcript length: {len(words)} words")

    if len(words) <= 3000:
        logger.info("Short transcript — skipping Map step")
        return transcript

    chunks = chunk_transcript(transcript, chunk_size=CHUNK_SIZE, overlap=CHUNK_OVERLAP)
    logger.info(f"Long transcript — Map step over {len(chunks)} chunks")

    chunk_summaries = []
    for i, chunk in enumerate(chunks):
        t0 = _time.monotonic()
        logger.info(f"Map chunk {i+1}/{len(chunks)} (~{len(chunk.split())} words)…")
        try:
            raw = ai_client.call(
                prompt=f"Lecture segment:\n\n{chunk}",
                system=CHUNK_SYSTEM_PROMPT,
                temperature=0.15,
                max_tokens=400,
            )
            elapsed = _time.monotonic() - t0
            stripped = _strip_artifacts(raw)
            logger.info(
                f"Map chunk {i+1}/{len(chunks)} done in {elapsed:.1f}s "
                f"({len(stripped)} chars) — preview: {stripped[:100]!r}"
            )
            chunk_summaries.append(stripped)
        except Exception as e:
            logger.error(f"Chunk {i+1} failed: {e}", exc_info=True)
            chunk_summaries.append("")

    good = [s for s in chunk_summaries if s]
    logger.info(f"Map complete: {len(good)}/{len(chunks)} chunks produced output")

    if not good:
        logger.warning("All Map chunks empty — falling back to truncated transcript")
        return " ".join(words[:2500])
    return "\n\n".join(good)


def generate_overview(transcript: str) -> tuple[str, str, list]:
    """
    Phase 1: Map step + summary + notes.
    Returns (combined_text, summary, notes_list).
    Call this first; save summary and notes immediately so the UI can show them.
    """
    import time as _time

    combined_text = _run_map_step(transcript)
    logger.info(f"Overview input: {len(combined_text)} chars")

    t0 = _time.monotonic()
    summary = _gen_summary(combined_text)
    logger.info(f"  summary: {len(summary)} chars in {_time.monotonic()-t0:.1f}s")

    t0 = _time.monotonic()
    notes = _gen_notes(combined_text)
    logger.info(f"  notes: {len(notes)} items in {_time.monotonic()-t0:.1f}s")

    return combined_text, summary, notes


def generate_study(combined_text: str) -> tuple[list, list]:
    """
    Phase 2: Quiz + problems from the already-processed combined_text.
    Returns (quiz_list, problems_list).
    Call this after generate_overview; save quiz and problems when done.
    """
    import time as _time

    t0 = _time.monotonic()
    quiz = _gen_quiz(combined_text)
    logger.info(f"  quiz: {len(quiz)} items in {_time.monotonic()-t0:.1f}s")

    t0 = _time.monotonic()
    problems = _gen_problems(combined_text)
    logger.info(f"  problems: {len(problems)} items in {_time.monotonic()-t0:.1f}s")

    return quiz, problems


def generate_concept_questions(concept: str, context: str, n: int = 5) -> list:
    """
    Generate n focused MCQ questions about a specific concept.
    Uses the same JSON schema as _gen_quiz.
    The lecture context provides background; questions focus on the requested concept
    even if it is only loosely covered in the lecture.
    """
    # Build a compact example so the model sees the exact expected format
    example = (
        '[{"question":"What is the formula for integration by parts?",'
        '"options":["$\\\\int u\\\\,dv = uv - \\\\int v\\\\,du$",'
        '"$\\\\int u\\\\,dv = uv + \\\\int v\\\\,du$",'
        '"$\\\\int u\\\\,dv = u^2v$",'
        '"$\\\\int u\\\\,dv = \\\\int u\\\\,du$"],'
        '"correct_index":0}]'
    )
    system = (
        f"Generate exactly {n} multiple-choice quiz questions about: {concept}\n"
        "The lecture notes below are background context only — you may also draw on "
        "general mathematical knowledge to produce well-formed questions.\n\n"
        "Output a JSON array ONLY — no explanation, no markdown fences, no text before or after.\n"
        "Each element must have this exact structure:\n"
        '{"question":"...","options":["choice A","choice B","choice C","choice D"],"correct_index":0}\n\n'
        f"FORMAT EXAMPLE (integration by parts — for structure only):\n{example}\n\n"
        "Rules:\n"
        f"- Write exactly {n} complete question objects.\n"
        f"- Every question must test a different aspect of '{concept}'.\n"
        "- Use LaTeX math notation where appropriate (wrap in $...$).\n"
        "- 4 answer choices each; correct_index is 0-3 (integer).\n"
        "- Wrong options must be plausible — not obviously wrong.\n"
        "- Every string value must be non-empty.\n"
        "Output only the JSON array. Start with '[' and end with ']'."
    )
    try:
        raw = ai_client.call(
            prompt=(
                f"Lecture context (background):\n\n{context}\n\n"
                f"Generate {n} quiz questions about: {concept}"
            ),
            system=system,
            temperature=0.3,
            max_tokens=2000,
        )
        questions = _parse_list(raw)
        # Filter out any incomplete/empty question objects
        valid = [
            q for q in questions
            if isinstance(q, dict)
            and q.get("question", "").strip()
            and isinstance(q.get("options"), list)
            and len(q["options"]) == 4
            and all(str(o).strip() for o in q["options"])
        ]
        logger.info(f"generate_concept_questions: {len(valid)}/{len(questions)} valid questions")
        return valid
    except Exception as e:
        logger.error(f"generate_concept_questions failed: {e}", exc_info=True)
        return []


def generate_similar_problems(reference_problems: list, context: str) -> list:
    """
    Generate new practice problems similar to the given reference problems.
    One new problem per reference problem, testing the same concept with different values.
    """
    n = len(reference_problems)
    if n == 0:
        return []

    problems_text = "\n".join([
        f"{i+1}. PROBLEM: {p.get('problem', '')}\n   SOLUTION: {p.get('solution', '')}"
        for i, p in enumerate(reference_problems)
    ])

    system = (
        f"/no_think\n"
        f"Write exactly {n} NEW practice problem(s) similar to the EXAMPLE PROBLEMS below.\n"
        "Each new problem must test the same concept but use different values, scenarios, or angles.\n"
        "Use this EXACT format for each — no deviations:\n\n"
        "1. PROBLEM: [problem statement — use LaTeX math where appropriate, e.g. $f(x) = x^2$]\n"
        "   SOLUTION: [step 1] | [step 2] | [step 3] | [step 4]\n\n"
        "Rules:\n"
        "- Match the difficulty level of the example problems.\n"
        "- Use LaTeX for all math expressions (wrap in $...$).\n"
        "- Use as many steps as the problem genuinely requires (2-6). Steps separated by ' | '.\n"
        "- Use ONLY content from the lecture context.\n"
        "- Do NOT copy the example problems — create genuinely different ones.\n"
        "- Write all problems before stopping."
    )

    prompt = (
        f"Lecture context:\n\n{context}\n\n"
        f"EXAMPLE PROBLEMS (generate similar new ones):\n{problems_text}\n\n"
        f"Write {n} new practice problem(s) now."
    )

    try:
        raw = ai_client.call(
            prompt=prompt,
            system=system,
            temperature=0.3,
            max_tokens=1200,
        )
        problems = _parse_problems_text(raw)
        if problems:
            logger.info(f"generate_similar_problems: parsed {len(problems)} problems")
            return problems
        logger.warning("generate_similar_problems: plain-text parse empty, trying JSON fallback")
        return _parse_list(raw)
    except Exception as e:
        logger.error(f"generate_similar_problems failed: {e}", exc_info=True)
        return []


def summarize_chunks(transcript: str) -> tuple[str, dict]:
    """
    Backward-compatible wrapper: runs both phases and returns (combined_text, study_materials).
    For new code, prefer calling generate_overview() + generate_study() separately
    so results can be saved and displayed progressively.
    """
    combined_text, summary, notes = generate_overview(transcript)
    quiz, problems = generate_study(combined_text)
    return combined_text, {
        "summary":  summary,
        "quiz":     quiz,
        "problems": problems,
        "notes":    notes,
    }


def parse_json_response(raw: str) -> dict:
    """Extract and parse JSON — handles fenced blocks, raw JSON, and braces inside strings."""
    raw = re.sub(r'<think>[\s\S]*?</think>', '', raw)
    raw = re.sub(r'</think>', '', raw).strip()

    # 1. Code-fenced block (```json ... ```)
    code_block = re.search(r'```(?:json)?\s*([\s\S]*?)```', raw)
    if code_block:
        candidate = code_block.group(1).strip()
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            pass

    # 2. raw_decode from the first '{' — correctly handles '}' inside strings
    brace_start = raw.find('{')
    if brace_start != -1:
        try:
            obj, _ = json.JSONDecoder().raw_decode(raw, brace_start)
            return obj
        except json.JSONDecodeError:
            cleaned = raw[brace_start:].replace('\n', ' ').replace('\r', '')
            try:
                return json.loads(cleaned)
            except json.JSONDecodeError as exc:
                logger.warning(f"JSON parse failed ({exc}) — tail: {raw[-100:]!r}")

    logger.warning("JSON parse failed — returning raw notes")
    return {"summary": "", "quiz": [], "problems": [], "notes": []}


def get_empty_study_materials() -> dict:
    return {"summary": "", "quiz": [], "problems": [], "notes": []}


def check_ollama_available() -> bool:
    """Legacy alias — delegates to ai_client.check_available()."""
    return ai_client.check_available()


def generate_targeted_explanation(
    question: str,
    correct_answer: str,
    wrong_answer: str,
    concept: str | None,
    context: str,
) -> str:
    """
    Generate a focused, encouraging explanation of why the student's answer was wrong
    and why the correct answer is right. Returns plain text with optional LaTeX.
    """
    ctx_snippet = context[:3000] if context else ""
    topic = concept or "this concept"

    prompt = (
        f"A student answered a quiz question incorrectly.\n\n"
        f"Question: {question}\n"
        f"Student's answer: {wrong_answer}\n"
        f"Correct answer: {correct_answer}\n\n"
        + (f"Lecture context (for reference):\n{ctx_snippet}\n\n" if ctx_snippet else "")
        + f"Write a clear, concise explanation (3-6 sentences) covering:\n"
        f"1. Why the student's answer is incorrect\n"
        f"2. Why the correct answer is right\n"
        f"3. The key insight to remember about {topic}\n\n"
        f"Use LaTeX for any math (e.g. $f'(x)$). Be encouraging and precise. "
        f"Do NOT include any <think> blocks."
    )

    resp = ai_client.call(
        prompt=prompt,
        system="You are a concise, encouraging math tutor. Explain mistakes clearly.",
        max_tokens=500,
    )
    if not resp:
        return "Unable to generate an explanation at this time."
    # Strip any leaked <think>...</think> blocks
    import re
    resp = re.sub(r'<think>[\s\S]*?</think>', '', resp).strip()
    return resp

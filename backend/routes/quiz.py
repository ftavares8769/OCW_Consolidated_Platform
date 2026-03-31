"""Quiz API: LLM grading for open-ended answers."""
import json
import logging
import re

from fastapi import APIRouter
from pydantic import BaseModel

from services import ai_client

logger = logging.getLogger(__name__)
router = APIRouter()

_GRADE_SYSTEM = (
    "/no_think\n"
    "You are grading a student's open-ended answer. Respond with a JSON object ONLY — "
    "no explanation, no markdown fences, no text outside the JSON.\n\n"
    "Score 0-5:\n"
    "  5 = complete and correct\n"
    "  4 = mostly correct with minor gaps\n"
    "  3 = partially correct, key idea present\n"
    "  2 = some relevant content, significant gaps\n"
    "  1 = minimal relevant content\n"
    "  0 = off-topic, wrong, or blank\n\n"
    'Output format: {"score":4,"max_score":5,"feedback":"1-2 encouraging sentences."}\n'
    "Be specific in the feedback: say what was good and what was missing."
)


class GradeRequest(BaseModel):
    question: str
    sample_answer: str
    user_answer: str


@router.post("/api/quiz/grade-open-ended")
def grade_open_ended(req: GradeRequest):
    if not req.user_answer.strip():
        return {"score": 0, "max_score": 5, "feedback": "No answer provided."}

    prompt = (
        f"Question: {req.question}\n\n"
        f"Key points to cover: {req.sample_answer}\n\n"
        f"Student's answer: {req.user_answer}\n\n"
        "Grade this answer. Return JSON only."
    )

    try:
        raw = ai_client.call(
            prompt=prompt,
            system=_GRADE_SYSTEM,
            temperature=0.1,
            max_tokens=200,
        )
        raw = re.sub(r"<think>[\s\S]*?</think>", "", raw).strip()
        m = re.search(r"\{[\s\S]*?\}", raw)
        if m:
            data = json.loads(m.group(0))
            return {
                "score":     int(data.get("score", 0)),
                "max_score": int(data.get("max_score", 5)),
                "feedback":  str(data.get("feedback", "")),
            }
    except Exception as exc:
        logger.error(f"grade_open_ended failed: {exc}")

    return {
        "score":     None,
        "max_score": 5,
        "feedback":  "Could not grade answer automatically. Check the sample answer below.",
    }

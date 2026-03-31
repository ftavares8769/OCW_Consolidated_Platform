from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional
import json
import requests

from services import ai_client

router = APIRouter()

TUTOR_SYSTEM = (
    "You are a university lecture tutor. Your only knowledge source is the lecture "
    "context provided below. Do not use outside knowledge.\n\n"
    "Rules:\n"
    "1. Answer ONLY questions about the lecture content. "
    "If a question is off-topic, say: \"That's outside this lecture — try asking "
    "about [brief relevant topic from the lecture].\"\n"
    "2. Keep answers focused and direct. Do not go on tangents.\n"
    "3. If a concept is not in the lecture context, say so clearly rather than guessing.\n"
    "4. Guide the student with questions when they seem stuck, but do not over-explain.\n"
    "5. Never produce large walls of text — prefer short paragraphs or a brief numbered "
    "list when steps are involved.\n\n"
)


class ChatRequest(BaseModel):
    message: str
    system_context: Optional[str] = ""
    history: Optional[list[dict]] = []


@router.post("/api/tutor/chat")
async def tutor_chat(req: ChatRequest):
    """Stream a response from the configured AI provider."""
    system = TUTOR_SYSTEM
    if req.system_context:
        system += f"Lecture context:\n{req.system_context}"

    # Build conversation prompt (works for both Ollama and chat APIs)
    prompt_parts = []
    for msg in (req.history or [])[-6:]:
        role    = msg.get("role", "user")
        content = msg.get("content", "")
        prompt_parts.append(f"{role.title()}: {content}")
    prompt_parts.append(f"User: {req.message}")
    prompt_parts.append("Assistant:")
    prompt = "\n".join(prompt_parts)

    def generate():
        try:
            for token in ai_client.stream_tutor(prompt=prompt, system=system, temperature=0.7):
                yield f"data: {json.dumps({'token': token})}\n\n"
            yield f"data: {json.dumps({'done': True})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


@router.get("/api/tutor/status")
def tutor_status():
    """Check if the tutor's configured AI provider is available and list local models."""
    available = ai_client.check_tutor_available()
    models: list[str] = []
    try:
        resp = requests.get("http://localhost:11434/api/tags", timeout=5)
        if resp.status_code == 200:
            models = [m.get("name") for m in resp.json().get("models", [])]
    except Exception:
        pass
    return {"available": available, "models": models}

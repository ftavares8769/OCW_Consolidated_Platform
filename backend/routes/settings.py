"""
Settings API
  GET  /api/settings           — return current settings (API keys masked)
  POST /api/settings           — update settings (send only changed fields)
  GET  /api/settings/models    — list locally installed Ollama models
"""
import logging
from typing import Optional

import requests
from fastapi import APIRouter
from pydantic import BaseModel

from services import config as cfg

logger = logging.getLogger(__name__)
router = APIRouter()

OLLAMA_TAGS_URL = "http://localhost:11434/api/tags"


# ── Pydantic schema ────────────────────────────────────────────────────────────

class SettingsUpdate(BaseModel):
    ai_provider:      Optional[str] = None   # "local" | "openai" | "anthropic"
    local_model:      Optional[str] = None
    context_window:   Optional[int] = None
    openai_api_key:   Optional[str] = None   # None = keep existing
    openai_model:     Optional[str] = None
    anthropic_api_key: Optional[str] = None
    anthropic_model:  Optional[str] = None
    daily_new_limit:  Optional[int] = None
    # ── Tutor-specific AI (empty string = inherit from main) ────
    tutor_ai_provider:     Optional[str] = None
    tutor_local_model:     Optional[str] = None
    tutor_openai_model:    Optional[str] = None
    tutor_anthropic_model: Optional[str] = None
    # ── Generation prompt extras ─────────────────────────────────
    prompt_quiz_extra:     Optional[str] = None
    prompt_problems_extra: Optional[str] = None


# ── Helpers ────────────────────────────────────────────────────────────────────

def _masked_settings(s: dict) -> dict:
    """Return settings safe to send to the browser (keys never leave server)."""
    out = {k: v for k, v in s.items()
           if k not in ("openai_api_key", "anthropic_api_key")}
    out["openai_api_key_set"]    = bool(s.get("openai_api_key", "").strip())
    out["anthropic_api_key_set"] = bool(s.get("anthropic_api_key", "").strip())
    return out


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get("/api/settings")
def get_settings():
    return _masked_settings(cfg.load())


@router.post("/api/settings")
def update_settings(body: SettingsUpdate):
    settings = cfg.load()
    updates  = body.model_dump(exclude_none=True)

    # API keys: empty string means "clear"; non-empty means "update"
    for key in ("openai_api_key", "anthropic_api_key"):
        if key in updates:
            settings[key] = updates.pop(key)

    settings.update(updates)

    # Tutor fields need explicit handling: "" (inherit) is a valid value that
    # must be saved, but model_dump(exclude_none=True) can miss it if the
    # JSON body sends the field as null/omits it.  Read directly from the
    # Pydantic model so None ("not sent") vs "" ("inherit") is unambiguous.
    for key in ("tutor_ai_provider", "tutor_local_model",
                "tutor_openai_model", "tutor_anthropic_model"):
        raw = getattr(body, key)
        if raw is not None:          # None = field was absent from request body
            settings[key] = raw      # "" = inherit, any string = custom value

    cfg.save(settings)
    # Return the in-memory dict directly (avoids a redundant file re-read)
    return {"ok": True, "settings": _masked_settings(settings)}


@router.get("/api/settings/prompt-defaults")
def get_prompt_defaults():
    """Return the built-in default system prompts so the UI can display them."""
    from services.summarizer import _QUIZ_SYSTEM, _PROBLEMS_SYSTEM
    return {
        "quiz":     _QUIZ_SYSTEM,
        "problems": _PROBLEMS_SYSTEM,
    }


@router.get("/api/settings/models")
def list_local_models():
    """Return the list of Ollama models installed on this machine."""
    try:
        resp = requests.get(OLLAMA_TAGS_URL, timeout=5)
        resp.raise_for_status()
        models = resp.json().get("models", [])
        return {
            "available": True,
            "models": [
                {
                    "name":        m.get("name", ""),
                    "size_gb":     round(m.get("size", 0) / 1e9, 1),
                    "modified_at": m.get("modified_at", ""),
                }
                for m in models
            ],
        }
    except Exception as e:
        logger.warning(f"Ollama unavailable while listing models: {e}")
        return {"available": False, "models": []}

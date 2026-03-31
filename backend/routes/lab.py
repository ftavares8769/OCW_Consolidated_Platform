"""
Prompt Lab API — run and compare generation functions across different models.
"""
import json
import time
from typing import List, Optional

import requests
from fastapi import APIRouter
from pydantic import BaseModel

from services import ai_client, config
from services.summarizer import (
    _NOTES_SYSTEM,
    _PROBLEMS_SYSTEM,
    _QUIZ_SYSTEM,
    _SUMMARY_SYSTEM,
    _parse_list,
    _parse_problems_text,
    _build_system,
)

router = APIRouter()

# ── Function registry ─────────────────────────────────────────────────────────

FUNCTIONS = {
    "quiz": {
        "system_base":  _QUIZ_SYSTEM,
        "extra_key":    "prompt_quiz_extra",
        "user_tmpl":    "Lecture notes:\n\n{text}\n\nOutput the JSON quiz array.",
        "max_tokens":   2800,
        "parse":        "json_array",
    },
    "problems": {
        "system_base":  _PROBLEMS_SYSTEM,
        "extra_key":    "prompt_problems_extra",
        "user_tmpl":    "Lecture notes:\n\n{text}\n\nWrite the 4 numbered practice problems now.",
        "max_tokens":   2800,
        "parse":        "problems_text",
    },
    "notes": {
        "system_base":  _NOTES_SYSTEM,
        "extra_key":    None,
        "user_tmpl":    "Lecture content:\n\n{text}\n\nOutput the JSON key-terms array.",
        "max_tokens":   1200,
        "parse":        "json_array",
    },
    "summary": {
        "system_base":  _SUMMARY_SYSTEM,
        "extra_key":    None,
        "user_tmpl":    "Lecture:\n\n{text}\n\nWrite the summary.",
        "max_tokens":   400,
        "parse":        "text",
    },
}


def _try_parse(raw: str, parse_mode: str):
    """Return (parsed_value, valid, item_count)."""
    if parse_mode == "json_array":
        items = _parse_list(raw)
        return items, bool(items), len(items)
    if parse_mode == "problems_text":
        items = _parse_problems_text(raw)
        if not items:
            items = _parse_list(raw)   # JSON fallback
        return items, bool(items), len(items)
    # text
    return raw.strip(), True, 1 if raw.strip() else 0


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/api/lab/models")
def get_lab_models():
    """Return available Ollama models + cloud model lists + key status."""
    local_models = []
    try:
        r = requests.get("http://localhost:11434/api/tags", timeout=3)
        local_models = [m["name"] for m in r.json().get("models", [])]
    except Exception:
        pass

    cfg_data = config.load()
    return {
        "local": sorted(local_models),
        "openai": [
            "gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo",
        ],
        "anthropic": [
            "claude-opus-4-5", "claude-sonnet-4-5", "claude-3-5-sonnet-20241022",
            "claude-3-haiku-20240307",
        ],
        "configured": {
            "openai_key":    bool(cfg_data.get("openai_api_key",    "").strip()),
            "anthropic_key": bool(cfg_data.get("anthropic_api_key", "").strip()),
        },
    }


class LabRunRequest(BaseModel):
    transcript:         str
    function:           str           # quiz | problems | notes | summary
    provider:           str           # local | openai | anthropic
    model:              str
    extra_instructions: Optional[str] = ""
    temperature:        float = 0.2


@router.post("/api/lab/run")
def run_lab(req: LabRunRequest):
    """Run one function on one model and return timing + raw + parsed output."""
    fn = FUNCTIONS.get(req.function)
    if not fn:
        return {"error": f"Unknown function '{req.function}'", "raw": "", "provider": req.provider, "model": req.model}

    # Build system prompt (with user extra instructions appended)
    system = _build_system(fn["system_base"], fn["extra_key"]) if fn["extra_key"] else fn["system_base"]
    if req.extra_instructions and req.extra_instructions.strip():
        system = system.rstrip() + "\n\nExtra instructions from user:\n" + req.extra_instructions.strip()

    user_prompt = fn["user_tmpl"].format(text=req.transcript)

    start = time.time()
    raw, error, parsed, valid, item_count = "", None, None, False, 0

    try:
        raw = ai_client.call_explicit(
            prompt=user_prompt,
            system=system,
            provider=req.provider,
            model=req.model,
            temperature=req.temperature,
            max_tokens=fn["max_tokens"],
        )
        parsed, valid, item_count = _try_parse(raw, fn["parse"])
    except Exception as e:
        error = str(e)

    elapsed = round(time.time() - start, 2)

    return {
        "provider":   req.provider,
        "model":      req.model,
        "function":   req.function,
        "time_s":     elapsed,
        "valid":      valid,
        "item_count": item_count,
        "raw":        raw,
        "parsed":     parsed,
        "error":      error,
    }

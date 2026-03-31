"""
Persistent app settings — stored in data/settings.json.
Thread-safe load/save; merged with defaults so new keys are always present.
"""
import json
import logging
import os

logger = logging.getLogger(__name__)

_DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
_SETTINGS_FILE = os.path.join(_DATA_DIR, "settings.json")

DEFAULTS: dict = {
    # ── AI provider ────────────────────────────────────────────
    "ai_provider":      "local",        # "local" | "openai" | "anthropic"

    # ── Local / Ollama ─────────────────────────────────────────
    "local_model":      "qwen3:1.7b",
    "context_window":   4096,           # num_predict / max_tokens

    # ── OpenAI ─────────────────────────────────────────────────
    "openai_api_key":   "",
    "openai_model":     "gpt-4o-mini",

    # ── Anthropic ──────────────────────────────────────────────
    "anthropic_api_key":  "",
    "anthropic_model":    "claude-3-haiku-20240307",

    # ── Flashcards ─────────────────────────────────────────────
    "daily_new_limit":  20,

    # ── AI Tutor (separate model from content generation) ──────
    # Empty string means "inherit from ai_provider / *_model above"
    "tutor_ai_provider":      "",    # "" | "local" | "openai" | "anthropic"
    "tutor_local_model":      "",    # "" = inherit local_model
    "tutor_openai_model":     "gpt-4o-mini",
    "tutor_anthropic_model":  "claude-3-haiku-20240307",

    # ── Generation prompt overrides ─────────────────────────────
    # Extra instructions appended to the built-in system prompt.
    # Empty string = use only the built-in default.
    "prompt_quiz_extra":     "",
    "prompt_problems_extra": "",
}


def load() -> dict:
    os.makedirs(_DATA_DIR, exist_ok=True)
    if not os.path.exists(_SETTINGS_FILE):
        return dict(DEFAULTS)
    try:
        with open(_SETTINGS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        return {**DEFAULTS, **data}
    except Exception as e:
        logger.warning(f"Failed to load settings: {e} — using defaults")
        return dict(DEFAULTS)


def save(settings: dict) -> None:
    os.makedirs(_DATA_DIR, exist_ok=True)
    merged = {**DEFAULTS, **settings}
    with open(_SETTINGS_FILE, "w", encoding="utf-8") as f:
        json.dump(merged, f, indent=2)


def get(key: str):
    return load().get(key, DEFAULTS.get(key))

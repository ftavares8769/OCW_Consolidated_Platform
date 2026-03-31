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
    "local_model":      "qwen3.5:9b",
    "context_window":   8192,           # num_predict / max_tokens

    # ── OpenAI ─────────────────────────────────────────────────
    "openai_api_key":   "",
    "openai_model":     "gpt-4o-mini",

    # ── Anthropic ──────────────────────────────────────────────
    "anthropic_api_key":  "",
    "anthropic_model":    "claude-3-haiku-20240307",

    # ── Flashcards ─────────────────────────────────────────────
    "daily_new_limit":  20,

    # ── Goals ──────────────────────────────────────────────────
    "goal_daily_cards":     20,   # cards reviewed per day target
    "goal_weekly_lectures":  3,   # lectures processed per week target

    # ── AI Tutor (separate model from content generation) ──────
    # Empty string means "inherit from ai_provider / *_model above"
    "tutor_ai_provider":      "",    # "" | "local" | "openai" | "anthropic"
    "tutor_local_model":      "",    # "" = inherit local_model
    "tutor_openai_model":     "gpt-4o-mini",
    "tutor_anthropic_model":  "claude-3-haiku-20240307",

    # ── Generation prompt overrides ─────────────────────────────
    # Extra instructions appended to the built-in system prompt.
    # Users can edit or clear these in Settings.
    "prompt_quiz_extra": (
        "To ensure high-level cognitive engagement, at least 50% of the quiz questions must target "
        "the Application or Analysis levels of Bloom's Taxonomy. This requires moving away from rote "
        "recall and \"What is...\" or \"Define...\" phrasing entirely. Instead, every question should "
        "require the user to apply core principles to a novel scenario or explain the underlying "
        "significance and mechanisms of a concept. The goal is to prioritize inquiries that probe "
        "relationships, such as \"How does X relate to Y?\" or \"Why is X significant for Z?\", "
        "ensuring the user must synthesize information rather than simply repeating it.\n\n"
        "The structural focus of the assessment should remain on Comparative Analysis and the systemic "
        "relationships between components. Rather than asking for static descriptions, questions should "
        "explore how changing one variable or contextual factor affects the rest of a system. By framing "
        "questions around scenario-based logic—such as \"If Variable A is modified by Condition B, what "
        "is the most likely outcome for Variable C?\"—the quiz challenges the user to demonstrate a "
        "functional understanding of cause-and-effect that transcends specific subject matter.\n\n"
        "Finally, the design of incorrect options is critical to the quiz's effectiveness; all distractors "
        "must be \"Near-Misses.\" These should be logically or procedurally plausible answers that stem "
        "from common misconceptions, \"half-right\" reasoning, or errors resulting from a single procedural "
        "misstep. Avoid obviously incorrect filler options or \"none of the above.\" Every wrong answer "
        "should look like a correct choice to someone with only a surface-level understanding, ensuring "
        "the quiz accurately distinguishes between superficial familiarity and true conceptual mastery."
    ),
    "prompt_problems_extra": (
        "To ensure these exercises drive true mastery, the generation of problems should center on "
        "Threshold Concepts—those pivotal, often difficult ideas that serve as the \"gateways\" to a "
        "deeper understanding of the discipline. Rather than rehashing examples from the source material, "
        "every problem must be Scenario-Based, transplanting core logic into a novel context. For "
        "quantitative fields, this requires using unique variables and numerical data to test functional "
        "application; for qualitative fields, the focus should be on causality and \"What If\" scenarios "
        "that challenge the user to predict how changing one factor alters the entire outcome.\n\n"
        "To maintain professional standards and technical clarity, all variables, formulas, and symbolic "
        "logic must be rendered in LaTeX (e.g., $k_{n+1}$ or $\\int_a^b f(x)\\,dx$). These instructions "
        "prioritize Mathematical and Conceptual Rigor over brevity, meaning solutions should be as "
        "detailed as necessary to ensure clarity. Crucially, every solution must articulate the "
        "\"Logical Pivot\"—the specific conceptual bridge or reasoning that justifies the transition "
        "from one step to the next. By emphasizing the \"why\" of the methodology over the mere "
        "calculation of the final result, the problems ensure the user understands the underlying "
        "framework of the subject matter."
    ),
}


def load() -> dict:
    os.makedirs(_DATA_DIR, exist_ok=True)
    if not os.path.exists(_SETTINGS_FILE):
        return dict(DEFAULTS)
    try:
        with open(_SETTINGS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        merged = {**DEFAULTS, **data}
        # For prompt extras: if the saved value is an empty string but the
        # default is non-empty, fall back to the default so new prompt
        # templates reach existing users who hadn't customised these fields.
        for key in ("prompt_quiz_extra", "prompt_problems_extra"):
            if not str(data.get(key, "")).strip() and DEFAULTS.get(key, "").strip():
                merged[key] = DEFAULTS[key]
        return merged
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

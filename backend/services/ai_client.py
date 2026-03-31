"""
Unified AI client — routes calls to Ollama (local), OpenAI, or Anthropic
based on the current app settings.

Non-streaming:  ai_client.call(prompt, system, temperature, expect_json)
Streaming:      ai_client.stream(prompt, system, temperature)
Tutor stream:   ai_client.stream_tutor(prompt, system, temperature)
Availability:   ai_client.check_available()
"""
import json
import logging
import re
from typing import Generator, Optional

import requests

from services import config as cfg

logger = logging.getLogger(__name__)

OLLAMA_URL = "http://localhost:11434/api/generate"

# Qwen3-specific chain-of-thought suppression prefix.
# NOTE: for Ollama this must be prepended to the USER PROMPT, not the system
# message.  _call_ollama moves it automatically when detected in the system.
_NO_THINK = "/no_think\n"


def _strip_no_think(system: str) -> str:
    """Remove /no_think prefix for cloud providers (they ignore it anyway)."""
    return system.removeprefix(_NO_THINK)


# ── Public API ─────────────────────────────────────────────────────────────────

def call(
    prompt: str,
    system: str = "",
    temperature: float = 0.2,
    expect_json: bool = False,
    max_tokens: Optional[int] = None,
) -> str:
    """Blocking AI call — thinking disabled.  Returns the full response string."""
    s = cfg.load()
    provider = s.get("ai_provider", "local")
    if provider == "openai":
        return _call_openai(prompt, _strip_no_think(system), temperature, max_tokens, s)
    if provider == "anthropic":
        return _call_anthropic(prompt, _strip_no_think(system), temperature, max_tokens, s)
    return _call_ollama(prompt, system, temperature, expect_json, max_tokens, s)


def stream(
    prompt: str,
    system: str = "",
    temperature: float = 0.7,
    max_tokens: Optional[int] = None,
) -> Generator[str, None, None]:
    """Streaming AI call — thinking disabled."""
    s = cfg.load()
    provider = s.get("ai_provider", "local")
    if provider == "openai":
        yield from _stream_openai(prompt, _strip_no_think(system), temperature, max_tokens, s)
    elif provider == "anthropic":
        yield from _stream_anthropic(prompt, _strip_no_think(system), temperature, max_tokens, s)
    else:
        yield from _stream_ollama(prompt, system, temperature, max_tokens, s, think=False)


def check_available() -> bool:
    """Return True if the configured AI provider is reachable / has a key."""
    s = cfg.load()
    provider = s.get("ai_provider", "local")
    if provider == "local":
        try:
            resp = requests.get("http://localhost:11434/api/tags", timeout=5)
            return resp.status_code == 200
        except Exception:
            return False
    if provider == "openai":
        return bool(s.get("openai_api_key", "").strip())
    if provider == "anthropic":
        return bool(s.get("anthropic_api_key", "").strip())
    return False


# ── Tutor-specific helpers ─────────────────────────────────────────────────────

def _resolve_tutor_settings(s: dict) -> dict:
    """
    Return a settings dict with tutor-specific overrides applied.
    If tutor_ai_provider is empty, all tutor keys fall back to the main settings.
    API keys are always shared (never duplicated per-purpose).
    """
    tutor_provider = s.get("tutor_ai_provider", "").strip()
    if not tutor_provider:
        return s

    tutor_local     = s.get("tutor_local_model", "").strip() or s.get("local_model", "qwen3:1.7b")
    tutor_openai    = s.get("tutor_openai_model", "").strip() or s.get("openai_model", "gpt-4o-mini")
    tutor_anthropic = s.get("tutor_anthropic_model", "").strip() or s.get("anthropic_model", "claude-3-haiku-20240307")

    return {
        **s,
        "ai_provider":     tutor_provider,
        "local_model":     tutor_local,
        "openai_model":    tutor_openai,
        "anthropic_model": tutor_anthropic,
    }


def stream_tutor(
    prompt: str,
    system: str = "",
    temperature: float = 0.7,
    max_tokens: Optional[int] = None,
) -> Generator[str, None, None]:
    """
    Streaming call using the tutor-specific AI configuration.
    For local Ollama models: thinking mode is ENABLED so the model reasons
    before answering, but <think> blocks are filtered from the output stream
    so the user only sees the final polished response.
    """
    s        = _resolve_tutor_settings(cfg.load())
    provider = s.get("ai_provider", "local")
    if provider == "openai":
        yield from _stream_openai(prompt, _strip_no_think(system), temperature, max_tokens, s)
    elif provider == "anthropic":
        yield from _stream_anthropic(prompt, _strip_no_think(system), temperature, max_tokens, s)
    else:
        # think=True — enables Qwen3 extended thinking; blocks are stripped below
        yield from _stream_ollama(prompt, system, temperature, max_tokens, s, think=True)


def check_tutor_available() -> bool:
    """Return True if the tutor's configured AI provider is reachable / has a key."""
    s        = _resolve_tutor_settings(cfg.load())
    provider = s.get("ai_provider", "local")
    if provider == "local":
        try:
            resp = requests.get("http://localhost:11434/api/tags", timeout=5)
            return resp.status_code == 200
        except Exception:
            return False
    if provider == "openai":
        return bool(s.get("openai_api_key", "").strip())
    if provider == "anthropic":
        return bool(s.get("anthropic_api_key", "").strip())
    return False


# ── Ollama ─────────────────────────────────────────────────────────────────────

def _num_ctx_for(prompt: str, system: str, num_predict: int) -> int:
    """
    Calculate the num_ctx (total context window) Ollama needs for this call.

    Ollama's num_ctx = input tokens + output tokens.  If it is too small the
    model is silently truncated and produces empty or skeletal output.

    Estimation: 1 token ≈ 3.5 characters (conservative for English + code).
    We round up to the next power-of-two so Ollama allocates a clean KV cache.
    """
    import math
    input_est  = (len(prompt) + len(system)) // 3   # chars → tokens (conservative)
    needed     = input_est + num_predict + 256       # 256 token safety margin
    # Round up to next power of 2, minimum 4096
    exponent   = math.ceil(math.log2(max(needed, 4096)))
    return 1 << exponent                             # e.g. 4096, 8192, 16384, 32768


def _call_ollama(prompt, system, temperature, expect_json, max_tokens, s) -> str:
    """
    Blocking Ollama call — uses streaming internally to avoid non-streaming
    quirks with qwen3 models.

    With stream:False + think:True, Ollama splits output into separate
    'thinking' and 'response' fields, leaving 'response' empty or containing
    only '</think>' artifacts on qwen3/qwen3.5 models.
    With stream:False + think:False, qwen3.5 writes output into its thinking
    buffer which Ollama discards — 'response' is always empty.

    Root cause: Ollama only respects 'think' as a TOP-LEVEL key.  When buried
    inside options{}, it is silently ignored — the model defaults to thinking
    mode, spends the full generation budget on a monologue, and puts it all in
    the 'thinking' field while 'response' stays empty.
    Solution: stream:True + think:False at top level.  With thinking disabled,
    all tokens go directly into the 'response' field of each streaming chunk.
    """
    model = s.get("local_model", "qwen3:1.7b")
    ctx   = max_tokens or s.get("context_window", 4096)

    # Strip /no_think from system; do NOT move it to user prompt.
    # With think:True + _filter_think_blocks we don't need it.
    actual_system = system.removeprefix(_NO_THINK)
    actual_prompt = prompt

    num_ctx = _num_ctx_for(actual_prompt, actual_system, ctx)
    input_chars = len(actual_prompt) + len(actual_system)
    logger.info(
        f"Ollama call: model={model} num_predict={ctx} num_ctx={num_ctx} "
        f"input_chars={input_chars} (~{input_chars//3} tokens)"
    )

    payload: dict = {
        "model":   model,
        "prompt":  actual_prompt,
        "system":  actual_system,
        "stream":  True,
        "think":   False,   # TOP-LEVEL — Ollama ignores think inside options{}
        "options": {
            "temperature":    temperature,
            "top_p":          0.8,
            "repeat_penalty": 1.1,
            "num_predict":    ctx,
            "num_ctx":        num_ctx,
        },
    }

    tokens: list[str] = []
    try:
        with requests.post(OLLAMA_URL, json=payload, stream=True, timeout=600) as resp:
            resp.raise_for_status()
            for line in resp.iter_lines():
                if not line:
                    continue
                try:
                    data = json.loads(line)
                except Exception:
                    continue
                if "error" in data:
                    raise RuntimeError(f"Ollama error: {data['error']}")
                token = data.get("response", "")
                if token:
                    tokens.append(token)
                if data.get("done"):
                    break
    except RuntimeError:
        raise
    except Exception as e:
        raise RuntimeError(f"Ollama request failed: {e}") from e

    response = "".join(tokens).strip()
    logger.info(f"Ollama response: {len(response)} chars — preview: {response[:200]!r}")
    return response


def _filter_think_blocks(lines) -> Generator[str, None, None]:
    """
    Consume Ollama streaming lines and yield only text OUTSIDE <think>…</think>.
    Keeps a small suffix buffer so partial opening/closing tags that span token
    boundaries are handled correctly.
    """
    in_think = False
    buf      = ""

    for line in lines:
        if not line:
            continue
        try:
            data = json.loads(line)
        except Exception:
            continue

        token = data.get("response", "")
        if not token:
            if data.get("done"):
                break
            continue

        buf += token

        # Drain as much of buf as we safely can
        while True:
            if not in_think:
                idx = buf.find("<think>")
                if idx == -1:
                    # No opening tag visible — emit everything except a small tail
                    # that might be the start of "<think>" split across tokens.
                    cutoff = max(0, len(buf) - 7)
                    if cutoff:
                        yield buf[:cutoff]
                        buf = buf[cutoff:]
                    break
                else:
                    if idx > 0:
                        yield buf[:idx]          # text before the tag
                    buf = buf[idx + 7:]          # consume "<think>"
                    in_think = True
            else:
                idx = buf.find("</think>")
                if idx == -1:
                    # Still thinking — discard content, keep tiny tail for partial tag
                    buf = buf[max(0, len(buf) - 9):]
                    break
                else:
                    buf = buf[idx + 8:]          # consume "</think>"
                    in_think = False

    # Flush any remaining non-think content
    if not in_think and buf:
        yield buf


def _stream_ollama(
    prompt, system, temperature, max_tokens, s,
    think: bool = False,
) -> Generator[str, None, None]:
    """
    Streaming Ollama call.

    think=False (default / generation):
      - options.think=False hard-disables Qwen3 reasoning.
      - Tokens are yielded as-is; no <think> blocks appear.

    think=True (tutor):
      - options.think=True lets Qwen3 reason before answering.
      - <think>…</think> blocks are filtered from the stream so the user
        sees only the final response, not the raw chain-of-thought.
    """
    model   = s.get("local_model", "qwen3:1.7b")
    ctx     = max_tokens or s.get("context_window", 4096)
    num_ctx = _num_ctx_for(prompt, system, ctx)
    payload = {
        "model":   model,
        "prompt":  prompt,
        "system":  system,
        "stream":  True,
        "think":   think,   # TOP-LEVEL — Ollama ignores think inside options{}
        "options": {
            "temperature": temperature,
            "num_predict": ctx,
            "num_ctx":     num_ctx,
        },
    }
    try:
        with requests.post(OLLAMA_URL, json=payload, stream=True, timeout=120) as resp:
            resp.raise_for_status()
            if think:
                yield from _filter_think_blocks(resp.iter_lines())
            else:
                for line in resp.iter_lines():
                    if line:
                        data  = json.loads(line)
                        token = data.get("response", "")
                        if token:
                            yield token
                        if data.get("done"):
                            break
    except Exception as e:
        logger.error(f"Ollama stream error: {e}")
        yield f"[Error: {e}]"


# ── OpenAI ─────────────────────────────────────────────────────────────────────

def _call_openai(prompt, system, temperature, max_tokens, s) -> str:
    api_key = s.get("openai_api_key", "").strip()
    if not api_key:
        raise ValueError("OpenAI API key not configured. Set it in Settings.")
    try:
        import openai
    except ImportError:
        raise RuntimeError("openai package not installed. Run: pip install openai")

    client = openai.OpenAI(api_key=api_key)
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})

    model   = s.get("openai_model", "gpt-4o-mini")
    max_tok = max_tokens or s.get("context_window", 4096)

    resp = client.chat.completions.create(
        model=model, messages=messages,
        temperature=temperature, max_tokens=max_tok,
    )
    return resp.choices[0].message.content or ""


def _stream_openai(prompt, system, temperature, max_tokens, s) -> Generator[str, None, None]:
    api_key = s.get("openai_api_key", "").strip()
    if not api_key:
        yield "[Error: OpenAI API key not configured — go to Settings]"
        return
    try:
        import openai
    except ImportError:
        yield "[Error: openai package not installed — run: pip install openai]"
        return

    client = openai.OpenAI(api_key=api_key)
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})

    model   = s.get("openai_model", "gpt-4o-mini")
    max_tok = max_tokens or 2048

    try:
        with client.chat.completions.create(
            model=model, messages=messages,
            temperature=temperature, max_tokens=max_tok, stream=True,
        ) as stream_obj:
            for chunk in stream_obj:
                delta = chunk.choices[0].delta.content
                if delta:
                    yield delta
    except Exception as e:
        logger.error(f"OpenAI stream error: {e}")
        yield f"[Error: {e}]"


# ── Anthropic ──────────────────────────────────────────────────────────────────

def _call_anthropic(prompt, system, temperature, max_tokens, s) -> str:
    api_key = s.get("anthropic_api_key", "").strip()
    if not api_key:
        raise ValueError("Anthropic API key not configured. Set it in Settings.")
    try:
        import anthropic
    except ImportError:
        raise RuntimeError("anthropic package not installed. Run: pip install anthropic")

    client   = anthropic.Anthropic(api_key=api_key)
    model    = s.get("anthropic_model", "claude-3-haiku-20240307")
    max_tok  = max_tokens or s.get("context_window", 4096)

    msg = client.messages.create(
        model=model,
        max_tokens=max_tok,
        system=system or None,
        messages=[{"role": "user", "content": prompt}],
        temperature=temperature,
    )
    return msg.content[0].text


def _stream_anthropic(prompt, system, temperature, max_tokens, s) -> Generator[str, None, None]:
    api_key = s.get("anthropic_api_key", "").strip()
    if not api_key:
        yield "[Error: Anthropic API key not configured — go to Settings]"
        return
    try:
        import anthropic
    except ImportError:
        yield "[Error: anthropic package not installed — run: pip install anthropic]"
        return

    client  = anthropic.Anthropic(api_key=api_key)
    model   = s.get("anthropic_model", "claude-3-haiku-20240307")
    max_tok = max_tokens or 2048

    try:
        with client.messages.stream(
            model=model,
            max_tokens=max_tok,
            system=system or None,
            messages=[{"role": "user", "content": prompt}],
            temperature=temperature,
        ) as stream_obj:
            for text in stream_obj.text_stream:
                yield text
    except Exception as e:
        logger.error(f"Anthropic stream error: {e}")
        yield f"[Error: {e}]"

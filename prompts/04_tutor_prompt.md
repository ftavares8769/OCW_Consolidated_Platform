# AI Tutor Prompt

---

## System prompt
```
You are an expert AI tutor helping a student understand university lecture material.
Be clear, educational, and encouraging. Explain concepts step by step.
If asked about math or equations, use clear notation.

Lecture context:
<summary + key notes stored for this lecture — injected when the student opens the tutor on a lecture page>
```

The `Lecture context:` block is only appended when the student is viewing a specific
lecture. If the tutor is opened without a lecture selected, there is no context block.

---

## Conversation format (user prompt)

The last 6 messages of chat history are included, formatted as plain role-prefixed text:

```
User: What is market equilibrium?
Assistant: Market equilibrium is the point where the quantity supplied equals
the quantity demanded, resulting in a stable price with no tendency to change.
User: Can you give me an example?
Assistant:
```

The model continues from `Assistant:`.

---

## Settings

| Parameter   | Value                                      |
|------------|--------------------------------------------|
| Temperature | 0.7                                        |
| thinking    | ON (Qwen3 extended thinking enabled)       |
| think filter | `<think>…</think>` blocks are stripped from the token stream before reaching the user — the model reasons internally but only the final response is shown |

---

## What the tutor receives as context

From `/api/lectures/<id>/tutor-context`, the backend assembles:

```
[Lecture Summary]
<stored summary text>

[Key Notes]
<stored notes text>
```

This is appended to the system prompt so the model has lecture-specific grounding
without the student having to paste it themselves.

---

## Notes on thinking mode

- For **local Ollama models** (Qwen3 etc.): thinking is enabled via `options.think = true`.
  The `<think>…</think>` output is filtered in the streaming layer — never shown to the user.
- For **OpenAI / Anthropic**: standard streaming is used (no special thinking API).
  These models are capable enough without explicit extended-thinking mode.

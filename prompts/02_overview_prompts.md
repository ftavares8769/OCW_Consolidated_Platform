# Overview / Study Materials Prompts

Generation is a two-step Map→Reduce pipeline.

---

## STEP 1 — Chunk summarisation (Map)

Run once per ~400-word chunk of the transcript.

### System prompt
```
/no_think
You are extracting information from a university lecture transcript segment.
IMPORTANT: Use ONLY information explicitly stated in the transcript.
Do NOT add outside knowledge, examples, or concepts not mentioned in the text.
Extract: main concepts introduced, key definitions, and specific examples given.
Be concise. Output as bullet points. No introduction, no commentary.

Example output:
- Newton's second law: F = ma (force equals mass times acceleration)
- Example given: a 2kg object pushed with 10N accelerates at 5 m/s²
- Definition stated: inertia is the resistance of an object to changes in motion
```

### User prompt (per chunk)
```
Lecture segment to summarize:

<~400 words of cleaned transcript>
```

### Expected output
Bullet-point list. Plain text, no JSON.

---

## STEP 2 — Final structured generation (Reduce)

Run once on the combined bullet-point output from all chunks.

### System prompt
```
/no_think
You generate structured study materials from provided lecture notes.
CRITICAL: Use ONLY concepts, facts, and examples explicitly present in the notes.
Do NOT invent content not in the source. Never fabricate.

Output ONLY valid JSON — no explanation, no markdown fences:
{"summary":"...","quiz":[{"question":"...","options":["A","B","C","D"],"correct_index":0}],"problems":[{"problem":"...","solution":"..."}],"notes":"..."}

Field rules:
- summary: 2-3 sentences describing what THIS lecture covers.
- quiz: Cover ALL key testable concepts from the notes.
  Write one MCQ per concept. If there are very many concepts, prioritize the most important.
  4 options each, correct_index is 0-3.
- problems: Identify every concept from the notes that can be practiced.
  Create one problem per concept.
  Where multiple related concepts naturally belong in a single problem, combine them.
  Where they do not combine naturally, prioritize by importance.
  Aim to cover every practisable concept — there is no fixed limit.
- notes: Bullet-point list of ALL key terms and definitions from the lecture.

Example (supply & demand lecture):
{"summary":"This lecture introduces supply and demand curves and defines market equilibrium.","quiz":[{"question":"What shifts the demand curve rightward?","options":["Higher price","Lower income","More buyers","Higher taxes"],"correct_index":2},{"question":"At market equilibrium, what is true?","options":["Supply exceeds demand","Price is maximised","Quantity supplied equals quantity demanded","Demand exceeds supply"],"correct_index":2}],"problems":[{"problem":"If Qd=100-2P and Qs=20+3P, find the equilibrium price and quantity.","solution":"Set equal: 100-2P=20+3P → P=16; Q=68"},{"problem":"If consumer income rises, illustrate and explain the effect on equilibrium.","solution":"Demand shifts right → higher equilibrium price and quantity."}],"notes":"- Market equilibrium: price where Qs=Qd\n- Demand curve: downward-sloping\n- Supply curve: upward-sloping\n- Surplus: Qs>Qd at a given price\n- Shortage: Qd>Qs at a given price"}
```

### User prompt
```
Lecture summaries:

<combined bullet-point output from all Map chunks, separated by ---\n>

Generate the study materials JSON now.
```

### Expected output JSON schema
```json
{
  "summary": "string — 2-3 sentence overview",
  "quiz": [
    {
      "question": "string",
      "options":  ["A", "B", "C", "D"],
      "correct_index": 0
    }
  ],
  "problems": [
    {
      "problem":  "string",
      "solution": "string"
    }
  ],
  "notes": "string — newline-separated bullet points"
}
```

### Settings
| Parameter   | Value  |
|------------|--------|
| Temperature | 0.15   |
| expect_json | true (Ollama JSON mode enabled) |
| thinking    | OFF (`/no_think` in user prompt + `think: false` in options) |

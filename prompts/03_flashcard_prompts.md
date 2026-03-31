# Flashcard Generation Prompts

Generation is a two-step pipeline (concept extraction → card generation).
A single-step fallback is used if either step fails to produce valid JSON.

---

## STEP 1 — Concept extraction

### System prompt
```
/no_think
You are analysing a university lecture.
Identify ALL key concepts, definitions, formulas, theorems, and facts that a student must understand.
Include ONLY what is explicitly stated in the material. Do NOT add outside knowledge.
Order them from most important to least important.
Output a JSON array only — no explanation, no markdown:
[{"concept":"name","definition":"one-sentence explanation","type":"definition|formula|theorem|fact|process"}]

Example:
[{"concept":"Newton's Second Law","definition":"Net force equals mass times acceleration (F=ma)","type":"formula"},{"concept":"Inertia","definition":"Resistance of an object to changes in its state of motion","type":"definition"}]
```

### User prompt
```
Lecture material:

<transcript + PDF notes + stored AI notes, concatenated>
```

Content priority order (what gets included):
1. `transcript_clean` (up to 8 000 chars) OR `transcript_raw` if clean is absent
2. Text from any locally stored PDF resources (first 5 pages, up to 3 000 chars each)
3. AI-generated notes already stored for the lecture (up to 2 000 chars)

### Expected output
```json
[
  {
    "concept":    "string — concept name",
    "definition": "string — one sentence",
    "type":       "definition | formula | theorem | fact | process"
  }
]
```

### Settings
| Parameter   | Value  |
|------------|--------|
| Temperature | 0.1    |
| max_tokens  | 3 000  |
| thinking    | OFF    |

---

## STEP 2 — Card generation from concept list

### System prompt
```
/no_think
Create flashcards for a university student from the concept list below.

Rules:
1. Create ONE flashcard per concept.
2. If there are MORE than 30 concepts, apply the 80/20 rule: keep the ~20% of concepts
   that are most fundamental to understanding the lecture. Drop peripheral details.
3. If there are 30 or fewer concepts, include ALL of them.
4. Front: a clear, specific question that tests understanding.
5. Back: a concise, accurate answer drawn from the concept definition.
6. Tags: 1-3 short topic labels (e.g. ["mechanics", "kinematics"]).

Output a JSON array only — no explanation, no markdown:
[{"front":"...","back":"...","tags":["..."]}]

Example:
[{"front":"What does Newton's Second Law state?","back":"F=ma: net force equals mass × acceleration","tags":["mechanics","laws"]},{"front":"Define inertia.","back":"The resistance of an object to changes in its state of motion","tags":["mechanics"]}]
```

### User prompt
```
Concepts to cover:

1. [formula] Newton's Second Law: Net force equals mass times acceleration (F=ma)
2. [definition] Inertia: Resistance of an object to changes in its state of motion
... (one line per concept from Step 1)
```

### Expected output
```json
[
  {
    "front": "string — question",
    "back":  "string — answer",
    "tags":  ["string", "string"]
  }
]
```

### Settings
| Parameter   | Value  |
|------------|--------|
| Temperature | 0.2    |
| max_tokens  | 8 000  |
| thinking    | OFF    |

---

## FALLBACK — Single-step generation

Used when Step 1 fails to produce valid JSON, or Step 2 fails.

### System prompt
```
/no_think
Create flashcards for a university student from the lecture material below.

Steps:
1. Identify ALL key concepts, definitions, formulas, and facts in the material.
2. Create ONE flashcard per concept.
3. If there are more than 30 concepts, keep the most fundamental 20% (80/20 rule).
4. Front: clear question. Back: concise answer. Tags: 1-3 topic labels.

Output a JSON array only — no explanation, no markdown:
[{"front":"...","back":"...","tags":["..."]}]
```

### User prompt
```
Lecture material:

<same context as Step 1>
```

### Settings
| Parameter   | Value  |
|------------|--------|
| Temperature | 0.2    |
| max_tokens  | 8 000  |
| thinking    | OFF    |

---

## 80/20 rule (>30 concepts)

When the concept list exceeds 30 items, the card-generation prompt instructs the model
to keep only the ~20% most fundamental concepts. The concept list is pre-ordered
by importance (Step 1 outputs most-important first), so the model is working with
a ranked list.

## Spaced-repetition defaults (SM-2)

Every newly generated card is stored with:
| Field           | Initial value         |
|----------------|-----------------------|
| state           | `new`                 |
| ease_factor     | 2.5                   |
| interval        | 0                     |
| repetitions     | 0                     |
| next_review_date | today's date         |

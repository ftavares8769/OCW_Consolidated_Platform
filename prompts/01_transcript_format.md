# Transcript Format — What the AI Sees

## Source
YouTube captions fetched via `youtube-transcript-api`.
All caption entries are joined into a single string with spaces (no timestamps).

## Cleaning steps (applied before anything is stored or sent to the AI)
1. HTML tags and entities stripped (`&amp;`, `&lt;`, `&#39;`, etc.)
2. Timestamps removed — both `[00:00]` and `(00:00)` formats
3. Speaker labels removed — e.g. `PROFESSOR:`, `[STUDENT]:`
4. Filler words removed:
   `uh`, `um`, `uh-huh`, `hmm`, `you know`, `sort of`, `kind of`,
   `like`, `basically`, `literally`, `actually`, `right?`, `okay?`, `alright?`
5. Whitespace normalised (collapsed to single spaces)
6. Caption fragments merged into full sentences (capitalised at sentence starts)
7. Stray spaces before punctuation removed (` ,` → `,` etc.)

## Result (transcript_clean stored in DB)
Plain prose, no timestamps, no speaker labels.

Example (supply & demand lecture):
```
The demand curve shows the relationship between price and quantity demanded.
As price increases, quantity demanded falls. The supply curve slopes upward
because higher prices incentivise producers to supply more. Market equilibrium
occurs where quantity supplied equals quantity demanded, giving us the
equilibrium price and quantity.
```

---

## How it is chunked for the AI (Map step)

The cleaned transcript is split into overlapping word-count chunks:

| Parameter    | Value       |
|-------------|-------------|
| Chunk size  | 400 words   |
| Overlap     | 50 words    |

Each chunk is a plain-text excerpt of ~400 words.
The overlap ensures concepts that straddle a boundary appear in both adjacent chunks.

Example chunk sent to the AI:
```
Lecture segment to summarize:

The demand curve shows the relationship between price and quantity demanded.
As price increases, quantity demanded falls. The supply curve slopes upward
because higher prices incentivise producers to supply more. Market equilibrium
occurs where quantity supplied equals quantity demanded, giving us the
equilibrium price and quantity. A shift in the demand curve occurs when a
non-price determinant changes — for example, an increase in consumer income
shifts the demand curve rightward, raising equilibrium price and quantity.
```

---

## Conversation format sent to the AI Tutor

The last 6 messages from chat history are prepended to the user's message
in a simple role-prefixed format:

```
User: What is market equilibrium?
Assistant: Market equilibrium is the point where the quantity supplied equals
the quantity demanded, resulting in a stable price.
User: Why does the demand curve slope downward?
Assistant:
```

The model is expected to continue from `Assistant:`.

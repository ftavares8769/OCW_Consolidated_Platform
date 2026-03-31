"""
SM-2 spaced repetition algorithm for LearnOCW flashcards.

Ratings:
  1 = Again  — complete blackout / wrong
  2 = Hard   — recalled with significant difficulty
  3 = Good   — recalled correctly with some effort
  4 = Easy   — recalled perfectly without hesitation
"""
from datetime import date, timedelta

RATING_AGAIN = 1
RATING_HARD  = 2
RATING_GOOD  = 3
RATING_EASY  = 4


def apply_sm2(
    state: str,
    ease_factor: float,
    interval: int,
    repetitions: int,
    rating: int,
) -> dict:
    """
    Apply one SM-2 review step.

    Returns a dict with updated:
      state, ease_factor, interval, repetitions, next_review_date (ISO string)
    """
    ef   = ease_factor
    reps = repetitions
    ivl  = interval

    # ── Ease factor update ────────────────────────────────────────────────────
    if rating == RATING_AGAIN:
        ef = max(1.3, ef - 0.20)
    elif rating == RATING_HARD:
        ef = max(1.3, ef - 0.15)
    elif rating == RATING_GOOD:
        pass                          # no change
    elif rating == RATING_EASY:
        ef = min(3.0, ef + 0.15)

    # ── Interval + repetition update ─────────────────────────────────────────
    if rating == RATING_AGAIN:
        reps = 0
        ivl  = 1

    elif rating == RATING_HARD:
        # Don't increment reps; slow down the interval
        ivl = max(1, round(ivl * 1.2)) if ivl > 0 else 1

    elif rating in (RATING_GOOD, RATING_EASY):
        reps += 1
        if reps == 1:
            ivl = 1
        elif reps == 2:
            ivl = 6
        else:
            multiplier = ef if rating == RATING_GOOD else ef * 1.3
            ivl = max(1, round(ivl * multiplier))

    # ── State transitions (per spec) ──────────────────────────────────────────
    # new → learning: first time the card is seen (any rating)
    # learning → learned: Good or Easy when repetitions >= 2
    # learned → learning: Again (lapse)
    if state == "new":
        new_state = "learning"   # seeing it for the first time → always learning

    elif state == "learning":
        if rating == RATING_AGAIN:
            new_state = "learning"
        elif rating in (RATING_GOOD, RATING_EASY) and reps >= 2:
            new_state = "learned"
        else:
            new_state = "learning"

    elif state == "learned":
        if rating == RATING_AGAIN:
            new_state = "learning"   # lapse
        else:
            new_state = "learned"

    else:
        new_state = "learning"

    next_review = date.today() + timedelta(days=ivl)

    return {
        "state":            new_state,
        "ease_factor":      round(ef, 4),
        "interval":         ivl,
        "repetitions":      reps,
        "next_review_date": next_review.isoformat(),
    }

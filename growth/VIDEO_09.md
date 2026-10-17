# VIDEO 09 — "AI doesn't decide who gets hired here"

Positions against an entire category. Short, flat, confident.

- **Length:** 22s · **One idea:** the model explains, it never decides
- **Claimable:** yes — this is an architectural constraint, not a promise

## Hook — second zero

Plain text: **"Our AI can't reject you."**

Then, immediately: **"That's not a setting. It's not built to."**

## Script

> "Plenty of hiring tools score candidates with a model and let the score do
> the filtering. Somebody gets removed and nobody can say exactly why.
>
> Here, a model can summarise evidence and explain why something might fit.
> It cannot make the decision.
>
> It never sees your name, your photo or your contact details. It can't infer
> anything protected from them because it never receives them.
>
> And when the model is unavailable, or unsure, or switched off, matching
> still works. It's a plain, explainable scorer underneath.
>
> A person decides. You can ask why."

## Shot list

| Time | Vision | Caption |
| --- | --- | --- |
| 0:00–0:03 | Text only | "Our AI can't reject you." |
| 0:03–0:07 | Text | "It isn't built to." |
| 0:07–0:12 | What the model receives: evidence only, fields visibly absent | "It never gets your name or your face." |
| 0:12–0:17 | AI path switched off; matching still returning results | "Turn it off. Matching still works." |
| 0:17–0:20 | The explainable score, factors listed | "A plain scorer underneath." |
| 0:20–0:22 | Static | "A person decides. You can ask why." |

## Claim discipline

Every sentence maps to a real constraint: the AI path is behind a feature flag
that is currently off, the deterministic scorer is the always-on matcher, and
protected/contact data is excluded from model input. **Do not** soften "cannot
decide" into "shouldn't decide", and **do not** claim the system is unbiased.
It is explainable. That is a different and defensible claim.

# Zoryvex brand system

**This documents the brand that already exists.** It does not propose a new
one. Every token below is read from `apps/web/app/globals.css` and is live in
production today.

Anything that appears here and not in the product is marked **EXTENSION** and
is a proposal for content and print only, never a change to the application.

---

## The idea underneath the brand

Zoryvex's entire argument is that a **claim** and a **source** are different
things, and that the difference is worth paying for.

Every design decision has to serve that one sentence. Which means the brand
has an unusual constraint for a startup: **it must not look impressive.**

A product that sells verification cannot market itself with the visual
vocabulary of hype. Gradients, glow, floating 3D shapes, "AI-powered" chrome —
these are the visual equivalent of a padded CV. If the design oversells, the
product's own pitch convicts it.

So the brand is quiet on purpose. It looks like a document, an instrument, a
record. Not a pitch deck.

---

## Colour

Live tokens. Do not change one without re-checking contrast.

| Token | Hex | Role |
| --- | --- | --- |
| `ink-950` | `#0e1013` | Primary text; dark surface background |
| `ink-900` | `#14171d` | Secondary dark surface |
| `ink-700` | `#3a3f4b` | Secondary text (10.0:1 on warm-50) |
| `ink-500` | `#6b7280` | Muted text — **warm-50 only** (4.6:1) |
| `warm-50` | `#fbf9f5` | Page background |
| `warm-100` | `#f3efe7` | Card / section background |
| `warm-200` | `#e8e2d5` | Borders and dividers |
| `accent-700` | `#0b6b4f` | Accent text and icons (6.2:1) |
| `accent-600` | `#0f7a5c` | Accent fill; pair with white |
| `accent-800` | `#08543e` | Pressed fill |
| `accent-400` | `#4fc79a` | Accent text on dark (9.0:1) |
| `error-700` | `#b42318` | Error text and destructive fill |
| `error-400` | `#f1948a` | Error text on dark (8.5:1) |

### Three rules that are not negotiable

1. **`ink-500` on `warm-100` fails AA** (4.21:1). It is only safe on
   `warm-50`. Shared components use `ink-700` instead, because a component
   cannot know its own background. The accessibility check caught this twice —
   once on a page, once in a shared component. Neither was a guess.
2. **An accent link inside a paragraph must also be underlined.** Colour alone
   is insufficient contrast against `ink-700` body text. A standalone link — a
   nav item, a footer item, a link that is the whole line — does not need it.
3. **The green is not decoration.** `accent-*` means *verified*. Using it for
   a heading, a border flourish, or a background wash weakens the one signal
   the product depends on. If it is green, something was checked.

### Why this palette and not another

The warm off-white is paper. The near-black is ink. The single green is the
mark a checker makes in a margin. That is the whole metaphor, and it is why
the palette is not the default startup blue-to-purple gradient on pure white.

---

## Type

```
ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif
```

The system font stack, deliberately. No webfont, no Inter, no Space Grotesk.

Three reasons, in order of importance:

1. It renders instantly with no layout shift and no third-party request.
2. It looks like the operating system the reader is already using, which reads
   as *utility* rather than *campaign*.
3. Inter and Space Grotesk are the two most recognisable "a startup designed
   this" faces in circulation. Avoiding them is a positioning decision.

### Scale in use

| Role | Treatment |
| --- | --- |
| Page title | Large, tight tracking, `text-wrap: balance` |
| Section heading | Clear step down, weight not size where possible |
| Body | ~65 characters per line, generous leading |
| Label / eyebrow | Small, uppercase, slight letter-spacing |
| Data and numbers | `font-variant-numeric: tabular-nums` wherever digits align |

**EXTENSION — for print and video only:** where a genuinely typographic
moment is needed (a poster, a title card), set the word in the same system
stack at a large size with tight tracking rather than importing a display
face. The restraint is the identity.

---

## Surfaces

- **Cards are border-based.** `warm-100` fill, `warm-200` border. No shadow,
  no gradient, no blur.
- **No glassmorphism, no backdrop-blur, no gradient hero, no floating 3D
  shapes, no icon-in-a-circle feature grid.** These are listed by name in the
  project's standing rules because they are the exact vocabulary the brand is
  defined against.
- **Motion is functional.** `prefers-reduced-motion` is honoured globally.
  Animation exists to show that something happened, never to impress.

Why borders instead of shadows: a shadow implies depth and hierarchy that is
not really there. A border says *this is a bounded region of a document*. The
product is a record. It should look like one.

---

## Voice

The most distinctive part of the brand, and the easiest to break.

### Say the concrete thing

> **Not:** "Unlock world-class talent with our seamless, AI-powered
> verification platform."
>
> **Yes:** "We check the certificate with the body that issued it."

If a sentence needs an impressive word to sound impressive, the sentence has
no content. Cut it and state the fact.

### Banned vocabulary

seamless · leverage · empower · unlock your potential · elevate · cutting-edge
· revolutionize · dive into · unleash · robust solution · tailored to your
needs · state-of-the-art · holistic · frictionless · supercharge · effortless
· world-class · best-in-class · game-changer · "whether you're… or…" · "it's
important to note" · "in today's [x] world"

### Punctuation

Em dashes are the single most recognisable machine-writing tell. In visible
prose use a period, a comma, or a colon. For a compact inline metadata
separator in a UI row (`action · target`), use a middle dot. Never stack two
em dashes as a parenthetical in one sentence.

`<title>` tags and short compact labels are a normal web convention and are
unaffected.

### The four things the voice always does

1. **Names the limit.** "We cannot check this one" is said at the form, not
   discovered later.
2. **Says what happens next.** A button that says Publish is followed by a
   message that says Published.
3. **Never claims what is not built.** No customer counts, no outcome
   statistics, no "trusted by" until it is true and evidenced.
4. **Takes the blame correctly.** An error explains what went wrong and what
   to do. No apology theatre, no vagueness.

### Two sentences that carry the whole brand

> A CV is a claim. A certificate confirmed with the body that issued it is a
> source.

> We show employers only what we actually checked, and we say so when we
> could not check something.

Everything else is elaboration.

---

## The required legal line

Exact wording, before every paid redirect and on support:

> Payments are securely processed by Paystack under our business name, Abba's
> Solutions.

Not paraphrased, not shortened, not restyled.

---

## Content application

**EXTENSION — content only.**

### Video

- `warm-50` ground, `ink-950` text. The world is bright; a dark feed video on
  a light ground is more distinctive than the reverse.
- Captions in the system stack, high weight, burned in. Assume silence.
- Green enters **once**, at the moment of verification, and nowhere else. If
  green appears twice in a video, one of them is decoration — cut it.
- No stock footage of people pointing at whiteboards. No spinning logos.
- Screen recordings are the strongest asset available. The product's argument
  is visible in the interface; show the interface.

### Written posts

Same voice, no exceptions. A post that reads like marketing undoes what a
verification product is selling.

### What a competitor's slide deck would have that this does not

A hero gradient. A three-icon feature row. The word "seamless". An arrow
diagram with a brain in the middle. A customer logo wall.

Every one of those is absent on purpose. If one appears, someone stopped
following this document.

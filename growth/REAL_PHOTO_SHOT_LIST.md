# Real photo shot list

Photographs of real things, shot on a phone. No stock, no AI-generated
imagery, no illustrations of people.

---

## Why real photos, and why this is a constraint not a preference

Zoryvex sells the difference between a claim and a source. Stock photography
is a claim: a picture of people who were never in your office, doing work that
was never done, arranged to look like success.

An AI-generated image is worse. A verification company illustrating itself
with a generated photograph is a self-refuting object, and someone will point
that out publicly.

So: real photographs, of real things, imperfect. The imperfection is the
point. It is the same argument the product makes.

**Hard rule: no photograph of a person who has not given permission for that
specific use, in writing.** No exceptions for "you can't really see their
face".

---

## Equipment

A recent phone, held still, near a window. That is genuinely enough.

- Daylight, indirect. Never the on-camera flash
- Lock focus and exposure before shooting
- Shoot more frames than you think, from slightly different distances
- No filters, no heavy grading. Slight contrast is the limit
- Shoot both vertical and horizontal of anything worth keeping

---

## A · The workspace (real, not staged)

1. **The actual desk, unstaged.** Whatever is on it. Do not tidy it first
2. **The screen mid-work**, with a terminal or the codebase visible. Check for
   secrets before shooting, then check again before posting
3. **Hands on a keyboard.** Yours. Close crop, no face
4. **A notebook page** with real working on it. Verify nothing private is
   legible
5. **Coffee going cold next to a laptop at an unremarkable hour.** No mug
   arranged at an angle
6. **The room from the doorway.** Wide, honest, including the parts that are
   not photogenic
7. **The window the light comes from**, because every other photo will be lit
   by it
8. **Cables.** Genuinely. An untidy cable run is more credible than any
   arranged flat-lay

## B · Evidence and verification as objects

9. **A printed certificate on a plain surface**, shot straight down. Your own
   only
10. **A phone showing an issuer's verification page**, resolved, held in one
    hand
11. **The same claim on paper and on the verification page**, in one frame.
    This is the whole product in one photograph
12. **A screen showing the one-time code** before it is published. Use an
    expired or test code
13. **A gist being published**, screen and hands
14. **A green verified mark on screen**, tight crop. This becomes the single
    most reused image in the set
15. **A claim marked as not checkable**, equally tight. Shoot it with the same
    care as the green one, because the honesty is the point

## C · The work itself

16. **A `terraform plan` on screen.** Redact account identifiers before
    shooting
17. **A failing test**, in red. Real failure, not manufactured
18. **The same test passing**, same framing, so the pair works as a diptych
19. **A whiteboard or paper with the actual data model on it**, in real
    handwriting
20. **A deploy running**, the terminal mid-output
21. **A phone showing the live site**, held at arm's length in real daylight
22. **The health endpoint's JSON on screen.** Unglamorous and completely
    authentic

## D · Place

23. **The street outside**, whatever it looks like
24. **Working somewhere that is not a desk.** Real location, real light
25. **Early morning or late evening light** on the workspace. Same room,
    different hour
26. **Rain, dust, heat haze, power cut, whatever is actually happening.**
    Context is credibility
27. **The commute**, if there is one
28. **A local landmark that is genuinely nearby.** Not a skyline that could be
    anywhere

## E · The founder, if and only if you want to be visible

**Every one of these is optional. A company can be credible without a face.**

29. **Working, shot from behind or to the side.** Not looking at camera
30. **Hands, close.** Identity without exposure
31. **One straight portrait**, daylight, plain background, no styling. Use it
    everywhere rather than shooting five
32. **Talking, mid-sentence**, captured while actually recording something

---

## What never to shoot

- Any other person without written permission for this specific use
- Any screen with a real candidate's data, a real email, or a real name
- Any secret, key, token, account identifier, or `.env` file
- A Paystack dashboard containing real transaction data
- Anything staged to look like a team that does not exist
- Anything implying an office, a headcount, or a scale that is not real
- Money, in any arrangement
- A handshake, a whiteboard being pointed at, or a laptop in a coffee shop
  arranged to be photographed

---

## Before anything is published

Run this every time. It takes a minute and one failure is permanent.

1. **Zoom to 100% on every screen in the frame.** Read every legible line
2. Check reflections: windows, glasses, screens behind screens
3. Check for account identifiers, emails, names, tokens
4. Check the background for anything about a person who did not consent
5. Strip metadata. The project already has a proven approach in
   `scripts/process-founder-photo.mjs` — reuse it rather than trusting a
   platform to strip location data

---

## The shortlist

If you only shoot ten:

**11** (paper claim beside the resolved verification page) · **14** (the green
mark) · **15** (the not-checkable mark) · **3** (hands on keyboard) · **6**
(the room, honestly) · **17** and **18** (failing then passing) · **22** (the
health endpoint) · **21** (live site in daylight) · **31** (one plain
portrait, if you want to be visible)

Number 11 is the one to get right. It is the argument, in one frame, with no
words.

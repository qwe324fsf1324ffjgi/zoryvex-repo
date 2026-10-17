# VIDEO 04 — "Prove you own a repository in about a minute"

**The how-to.** Teaches a real mechanism. Useful outside the product.

- **Length:** 32s · **Format:** screen recording, no face · **One idea:** a one-time code in a public gist proves control
- **Claimable:** yes

## Hook — second zero

A terminal-style frame, a random string appearing:

Caption: **"This string proves the repo is yours. Here's how."**

## Shot list

| Time | Vision | Caption |
| --- | --- | --- |
| 0:00–0:04 | A one-time code appears on screen | "This string proves the repo is yours." |
| 0:04–0:09 | The code pasted into a new **public** gist. Create | "Publish it in a public gist." |
| 0:09–0:14 | Gist URL copied back into Zoryvex alongside the repo URL | "Give us both links." |
| 0:14–0:20 | Check running: gist read, code matched | "We read the gist. Only your account could publish it." |
| 0:20–0:26 | Repo read: public, not a fork, not empty, commits credited | "Then we read the repo." |
| 0:26–0:30 | Verified state, green mark, `owner/repo` shown | "Control, proven. Not claimed." |
| 0:30–0:32 | Static | — |

## The part worth saying out loud

> "Notice what this doesn't ask for. No OAuth. No token. No access to your
> private code. You publish one string in public and it's done."

That line is the reason a developer shares this video. Most verification
flows ask for account access. This one asks for a public post.

## Do not

- Do not show a real one-time code from a live account
- Do not show a private repository
- Do not skip the "public gist" word. A secret gist does not prove anything
  and a viewer who tries it will fail and blame the product

# DESIGN_SYSTEM.md

Surface: the single-page site at `site/index.html` (static, inline CSS, no framework, no web fonts). The product itself has no UI; the agent conversation is covered in FLOWS.md. Derived from the live CSS on 2026-11-04. Items marked "assumed, confirm" were inferred, not decided.

## Soul

A quiet terminal-adjacent dark page for developers: ink background, one amber accent, mono for anything you type or that labels a section, system sans for reading. Plain words over marketing words.

## Tokens (`:root` in site/index.html)

| Token | Value | Use |
|-------|-------|-----|
| `--ink` | #0e1116 | Page background |
| `--panel`, `--panel-2` | #161b22, #1b2129 | Cards, code blocks |
| `--line` | #232a33 | Borders, section dividers |
| `--text` | #e7ecf2 | Body and headings |
| `--muted` | #95a1b0 | Secondary text |
| `--dim` | #7d8b9a | Eyebrows, footer, meta (4.5:1 on --ink, WCAG AA) |
| `--amber` | #f0a828 | Primary button, focus ring, hover |
| `--green`, `--flag` | #3dc48f, #e0705a | Pass and problem states, always with a text label |
| `--mono`, `--sans` | system stacks | Code and labels; reading text |
| `--measure` | 64ch | Reading column width |

Type: body 17px / 1.65; h1 clamp(2.1rem, 7.2vw, 3.4rem); h2 clamp(1.4rem, 4.4vw, 1.95rem); eyebrow mono .7rem uppercase. Layout: `.wrap` max 960px with 20px side padding; sections 60px vertical with a `--line` top border. Designed from 320px up.

## Components

- `.btn` (amber primary), `.btn.ghost` (outline secondary). Min height 44px. Always a text label.
- `.install` (command in `code` with a Copy button, `aria-label` set).
- `.needs` (body-size muted line under the hero CTA saying what a first-time user must have before step 1).
- `.cta-row`, `.reassure` (mono small print under the hero CTA; keep to one or two lines, put anything a first-time user must read in body text instead. Assumed, confirm).
- `.steps` (numbered setup list with `pre` blocks for commands).
- `.eyebrow` section label.

## Senior-clarity rules in force

No icon-only primaries; state never by color alone; focus-visible ring in amber; touch targets 44px; copy states what is needed before asking for an action; no em-dashes.

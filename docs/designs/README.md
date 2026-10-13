# Studyfy board reference pack

Written specs, not pictures. The project builds from §8.2–§8.4's written
specification (STUDYFY_PROJECT_SPEC.md §8.1: AI-mockup artifacts removed —
no fabricated stats, no invented screens), so this pack describes each
dashboard exactly as specified and implemented. There are deliberately no
PNG mockups here; a picture in this folder would either duplicate the
running app or lie about it.

How to read each board file:
- **Badge** — §8.2 color + icon, as rendered by `Shell` from
  `apps/web/components/ui/role-boards.ts` (the single source of truth —
  every sidebar renders from it, so this pack cannot drift unless that
  file does).
- **Nav** — exact §8.4 labels in order. `Soon` = `href: null`, rendered as
  dimmed text + pill, never a dead link.
- **Screens** — real routes under `apps/web/app/` that the role can open.
- **Tokens** — §8.2 locked values (Inter, navy `#0F172A` sidebar, blue
  `#2563EB` primary, amber `#F59E0B` warning, red `#DC2626` danger).

Boards: `school-admin.md`, `teacher.md`, `accountant.md`, `student.md`,
`parent.md`, `platform-owner.md`.

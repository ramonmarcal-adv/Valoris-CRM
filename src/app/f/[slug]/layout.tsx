// ============================================================
// /f/[slug] layout — minimal full-bleed shell for a public form,
// outside both `(auth)` and `(dashboard)` for the same reason as
// `/join/[token]`: it must render for a fully anonymous visitor, and
// reusing either route group would funnel them through that group's
// own auth redirect.
//
// Unlike /join, this page is MEANT to be found/shared/indexed (a
// form's whole point is external distribution) — no `robots`/
// `Referrer-Policy` lockdown here.
// ============================================================

import type { ReactNode } from "react";

export default function PublicFormLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-screen bg-background px-4 py-10">{children}</div>;
}

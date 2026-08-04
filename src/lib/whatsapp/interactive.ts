// ============================================================
// Interactive message payload — shared shape + validation.
//
// The persisted, round-trippable representation of a WhatsApp
// interactive message (reply buttons or a list). This is the single
// source of truth used by:
//   - the inbox composer + automation "send interactive" builders,
//   - the send-message core + automation engine (send + persist),
//   - the message bubble + preview (render),
//   - quick replies (store an interactive snippet).
//
// The field names (`id`/`title`/`description` on buttons/rows) match
// `meta-api.ts`'s `InteractiveButton` / `InteractiveListRow` /
// `InteractiveListSection` on purpose, so a payload maps straight onto
// the Meta send args with no translation.
//
// `validateInteractivePayload` mirrors the throws already inside the
// meta-api senders, but returns a result object so callers (API routes,
// activation checks) can surface a clean error to the user *before* the
// network call rather than turning a bad payload into a 400 from Meta
// mid-conversation.
// ============================================================

import { INTERACTIVE_LIMITS } from './meta-api'

export interface InteractiveButton {
  /** Stable id echoed back in the webhook when tapped. */
  id: string
  /** Visible label (≤ 20 chars per Meta). */
  title: string
}

export interface InteractiveButtonsPayload {
  kind: 'buttons'
  /** Body text shown above the buttons (≤ 1024 chars). */
  body: string
  /** Optional plain-text header (≤ 60 chars). */
  header?: string
  /** Optional grey footer line (≤ 60 chars). */
  footer?: string
  /** 1–3 buttons. */
  buttons: InteractiveButton[]
}

export interface InteractiveListRow {
  /** Stable id echoed back in the webhook when selected. */
  id: string
  /** Row title (≤ 24 chars per Meta). */
  title: string
  /** Optional secondary line (≤ 72 chars). */
  description?: string
}

export interface InteractiveListSection {
  /** Optional section header shown above its rows. */
  title?: string
  rows: InteractiveListRow[]
}

export interface InteractiveListPayload {
  kind: 'list'
  body: string
  header?: string
  footer?: string
  /** Label of the tap-to-expand button on the message bubble (≤ 20 chars). */
  button_label: string
  /** 1–10 rows TOTAL across all sections. */
  sections: InteractiveListSection[]
}

export type InteractiveMessagePayload =
  | InteractiveButtonsPayload
  | InteractiveListPayload

export type InteractiveValidation =
  | { ok: true }
  | { ok: false; error: string }

/** Matches `useTranslations()`'s call signature — passed in by UI
 *  callers (interactive-builder.tsx, message-composer.tsx) so the
 *  error actually shown to an agent is translated. Server-side/
 *  background callers (automation engine, API routes, tests) omit it
 *  and get the English fallback text below, since those don't run in
 *  a request-scoped locale context. */
type Translator = (key: string, values?: Record<string, string | number>) => string

function ok(): InteractiveValidation {
  return { ok: true }
}

/** `fallback` is the English text (already interpolated via template
 *  literal at the call site) used when no `t` is provided; `key`/
 *  `values` resolve the translated version when it is. */
function fail(
  t: Translator | undefined,
  key: string,
  values: Record<string, string | number> | undefined,
  fallback: string,
): InteractiveValidation {
  return { ok: false, error: t ? t(key, values) : fallback }
}

function validateHeaderFooter(
  header: string | undefined,
  footer: string | undefined,
  t: Translator | undefined,
): InteractiveValidation {
  if (header && header.length > INTERACTIVE_LIMITS.headerTextMaxLength) {
    return fail(
      t,
      'headerTooLong',
      { max: INTERACTIVE_LIMITS.headerTextMaxLength },
      `Header exceeds the ${INTERACTIVE_LIMITS.headerTextMaxLength}-character limit.`,
    )
  }
  if (footer && footer.length > INTERACTIVE_LIMITS.footerMaxLength) {
    return fail(
      t,
      'footerTooLong',
      { max: INTERACTIVE_LIMITS.footerMaxLength },
      `Footer exceeds the ${INTERACTIVE_LIMITS.footerMaxLength}-character limit.`,
    )
  }
  return ok()
}

/**
 * Validate an interactive payload against Meta's hard limits + our
 * structural rules (non-empty ids/titles, unique ids). Returns a result
 * object rather than throwing so API routes can map it to a 400 with a
 * user-facing message.
 *
 * `unknown` in, narrowed here, so it's safe to call straight on a parsed
 * request body. `t` is optional — pass `useTranslations("Interactive.validation")`
 * from a UI caller to get a translated `.error`; omit it (automation
 * engine, API routes, tests) to get the English fallback.
 */
export function validateInteractivePayload(
  payload: unknown,
  t?: Translator,
): InteractiveValidation {
  if (!payload || typeof payload !== 'object') {
    return fail(t, 'payloadRequired', undefined, 'Interactive message payload is required.')
  }
  const p = payload as Partial<InteractiveMessagePayload>

  if (typeof p.body !== 'string' || p.body.trim() === '') {
    return fail(t, 'bodyRequired', undefined, 'Interactive message body text is required.')
  }
  if (p.body.length > INTERACTIVE_LIMITS.bodyMaxLength) {
    return fail(
      t,
      'bodyTooLong',
      { max: INTERACTIVE_LIMITS.bodyMaxLength },
      `Body text exceeds the ${INTERACTIVE_LIMITS.bodyMaxLength}-character limit.`,
    )
  }
  const hf = validateHeaderFooter(p.header, p.footer, t)
  if (!hf.ok) return hf

  if (p.kind === 'buttons') {
    const buttons = (p as InteractiveButtonsPayload).buttons
    if (!Array.isArray(buttons) || buttons.length < 1) {
      return fail(t, 'buttonsRequired', undefined, 'Add at least one reply button.')
    }
    if (buttons.length > INTERACTIVE_LIMITS.maxButtons) {
      return fail(
        t,
        'tooManyButtons',
        { max: INTERACTIVE_LIMITS.maxButtons },
        `A reply-button message allows at most ${INTERACTIVE_LIMITS.maxButtons} buttons.`,
      )
    }
    const seen = new Set<string>()
    for (const b of buttons) {
      if (!b || typeof b.id !== 'string' || b.id.trim() === '') {
        return fail(t, 'buttonIdRequired', undefined, 'Every button needs an id.')
      }
      if (seen.has(b.id)) {
        return fail(t, 'duplicateButtonId', { id: b.id }, `Duplicate button id "${b.id}".`)
      }
      seen.add(b.id)
      if (typeof b.title !== 'string' || b.title.trim() === '') {
        return fail(t, 'buttonLabelRequired', undefined, 'Every button needs a label.')
      }
      if (b.title.length > INTERACTIVE_LIMITS.buttonTitleMaxLength) {
        return fail(
          t,
          'buttonLabelTooLong',
          { label: b.title, max: INTERACTIVE_LIMITS.buttonTitleMaxLength },
          `Button label "${b.title}" exceeds the ${INTERACTIVE_LIMITS.buttonTitleMaxLength}-character limit.`,
        )
      }
    }
    return ok()
  }

  if (p.kind === 'list') {
    const list = p as InteractiveListPayload
    if (
      typeof list.button_label !== 'string' ||
      list.button_label.trim() === ''
    ) {
      return fail(t, 'listButtonLabelRequired', undefined, 'The list needs a button label.')
    }
    if (list.button_label.length > INTERACTIVE_LIMITS.buttonTitleMaxLength) {
      return fail(
        t,
        'listButtonLabelTooLong',
        { max: INTERACTIVE_LIMITS.buttonTitleMaxLength },
        `List button label exceeds the ${INTERACTIVE_LIMITS.buttonTitleMaxLength}-character limit.`,
      )
    }
    if (!Array.isArray(list.sections) || list.sections.length < 1) {
      return fail(t, 'sectionsRequired', undefined, 'Add at least one list section.')
    }
    if (list.sections.length > INTERACTIVE_LIMITS.maxListSections) {
      return fail(
        t,
        'tooManySections',
        { max: INTERACTIVE_LIMITS.maxListSections },
        `A list allows at most ${INTERACTIVE_LIMITS.maxListSections} sections.`,
      )
    }
    const seen = new Set<string>()
    let total = 0
    for (const section of list.sections) {
      if (!section || !Array.isArray(section.rows)) {
        return fail(t, 'sectionRowsRequired', undefined, 'Every list section needs rows.')
      }
      for (const row of section.rows) {
        total++
        if (!row || typeof row.id !== 'string' || row.id.trim() === '') {
          return fail(t, 'rowIdRequired', undefined, 'Every list row needs an id.')
        }
        if (seen.has(row.id)) {
          return fail(t, 'duplicateRowId', { id: row.id }, `Duplicate list row id "${row.id}".`)
        }
        seen.add(row.id)
        if (typeof row.title !== 'string' || row.title.trim() === '') {
          return fail(t, 'rowTitleRequired', undefined, 'Every list row needs a title.')
        }
        if (row.title.length > INTERACTIVE_LIMITS.listRowTitleMaxLength) {
          return fail(
            t,
            'rowTitleTooLong',
            { title: row.title, max: INTERACTIVE_LIMITS.listRowTitleMaxLength },
            `List row title "${row.title}" exceeds the ${INTERACTIVE_LIMITS.listRowTitleMaxLength}-character limit.`,
          )
        }
        if (
          row.description &&
          row.description.length >
            INTERACTIVE_LIMITS.listRowDescriptionMaxLength
        ) {
          return fail(
            t,
            'rowDescriptionTooLong',
            { max: INTERACTIVE_LIMITS.listRowDescriptionMaxLength },
            `List row description exceeds the ${INTERACTIVE_LIMITS.listRowDescriptionMaxLength}-character limit.`,
          )
        }
      }
    }
    if (total < 1) return fail(t, 'rowsRequired', undefined, 'Add at least one list row.')
    if (total > INTERACTIVE_LIMITS.maxListRowsTotal) {
      return fail(
        t,
        'tooManyRows',
        { max: INTERACTIVE_LIMITS.maxListRowsTotal },
        `A list allows at most ${INTERACTIVE_LIMITS.maxListRowsTotal} rows in total.`,
      )
    }
    return ok()
  }

  return fail(t, 'invalidKind', undefined, 'Interactive message must be reply buttons or a list.')
}

/**
 * Short single-line summary used for `conversations.last_message_text`
 * and quick-reply list rows — the body, trimmed, or a sensible fallback.
 */
export function interactivePayloadPreviewText(
  payload: InteractiveMessagePayload,
): string {
  const body = payload.body?.trim()
  if (body) return body
  return payload.kind === 'buttons' ? '[buttons]' : '[list]'
}

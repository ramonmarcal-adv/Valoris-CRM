export type WhatsAppFormatSegment =
  | { type: 'text'; value: string }
  | { type: 'bold'; value: string }
  | { type: 'italic'; value: string }
  | { type: 'strike'; value: string }
  | { type: 'code'; value: string }

/**
 * WhatsApp's own message-formatting markers: `*bold*`, `_italic_`,
 * `~strikethrough~`, and `` ```monospace``` ``. A marker only takes
 * effect hugging non-whitespace content and not glued to a surrounding
 * word character — e.g. `5*3=15` or `a_b_c` must not format — which the
 * lookaround groups below approximate (WhatsApp's own client uses a
 * similar word-boundary rule, not a full CommonMark grammar). Code spans
 * are matched first so `*` / `_` / `~` inside `` ```...``` `` are taken
 * literally rather than re-parsed.
 */
const TOKEN_RE =
  /```([^`]+)```|(?<![*\w])\*([^\s*](?:[^*]*[^\s*])?)\*(?![*\w])|(?<![_\w])_([^\s_](?:[^_]*[^_])?)_(?![_\w])|(?<![~\w])~([^\s~](?:[^~]*[^~])?)~(?![~\w])/g

/** Splits `text` into plain-text and WhatsApp-formatting segments. Each
 *  segment's `value` is the *inner* content with markers stripped — the
 *  caller decides how to render each type (e.g. `<strong>`, `<em>`). */
export function parseWhatsAppFormatting(text: string): WhatsAppFormatSegment[] {
  const segments: WhatsAppFormatSegment[] = []
  let lastIndex = 0
  TOKEN_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = TOKEN_RE.exec(text))) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', value: text.slice(lastIndex, match.index) })
    }
    const [, code, bold, italic, strike] = match
    if (code !== undefined) segments.push({ type: 'code', value: code })
    else if (bold !== undefined) segments.push({ type: 'bold', value: bold })
    else if (italic !== undefined) segments.push({ type: 'italic', value: italic })
    else if (strike !== undefined) segments.push({ type: 'strike', value: strike })
    lastIndex = TOKEN_RE.lastIndex
  }
  if (lastIndex < text.length) {
    segments.push({ type: 'text', value: text.slice(lastIndex) })
  }
  return segments
}

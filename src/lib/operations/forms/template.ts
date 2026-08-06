/**
 * `{{field_key}}` interpolation for a form's title/description templates
 * (PRD 17.6, e.g. `{{nome}} - {{cidade}}`). Bare keys, no namespace
 * prefix — unlike src/lib/automations/engine.ts's interpolate() (hardcoded
 * to message./vars. namespaces) and src/lib/flows/engine.ts's
 * interpolateVars() (hardcodes a `vars.` prefix), neither of which fits a
 * flat "one key per form question" lookup and neither of which is
 * exported anyway. Missing keys render as empty string, same behavior as
 * both of those.
 */
export function interpolate(template: string, values: Record<string, string>): string {
  if (!template) return "";
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => {
    const v = values[key];
    return v === undefined || v === null ? "" : v;
  });
}

/** Strips accents/diacritics (NFD normalize + combining-mark removal) so pt-BR labels slugify cleanly. */
function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function slugifyBase(s: string): string {
  return stripAccents(s)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

/** A question's stable {{field_key}} — used in title/description templates. */
export function slugifyFieldKey(label: string): string {
  return slugifyBase(label) || "campo";
}

/** A form's public URL slug — same normalization as slugifyFieldKey but hyphenated (URL convention, not a template key). */
export function slugifyFormSlug(name: string): string {
  return slugifyBase(name).replace(/_/g, "-") || "formulario";
}

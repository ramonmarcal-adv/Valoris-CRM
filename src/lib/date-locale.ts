import { ptBR, enUS, ko } from "date-fns/locale";
import { useLocale } from "next-intl";
import type { Locale } from "date-fns";

/**
 * date-fns locale object matching the app's active next-intl locale
 * (`NEXT_PUBLIC_APP_LOCALE` — pt/en/ko, see src/i18n/request.ts). Pass the
 * result as `{ locale }` to any `format`/`formatDistanceToNow` call so
 * dates/times render in the user's language instead of defaulting to
 * date-fns's built-in English.
 */
export function useDateFnsLocale(): Locale {
  const locale = useLocale();
  if (locale === "pt") return ptBR;
  if (locale === "ko") return ko;
  return enUS;
}

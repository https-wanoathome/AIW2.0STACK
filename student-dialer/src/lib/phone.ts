/**
 * Best-effort phone country code extraction.
 *
 * Returns "+1" for US/Canada numbers, the leading "+NN" for other
 * E.164 numbers, or null if we can't tell.
 *
 * Not a phone-number-parsing library. Good enough to split "US" from
 * "Rest of World" for lead filtering.
 */
export function extractCountryCode(
  phone: string | null | undefined,
): string | null {
  if (!phone) return null;
  const cleaned = phone.replace(/[^\d+]/g, "");
  if (cleaned.length === 0) return null;

  if (!cleaned.startsWith("+")) {
    // Plain digit string. Heuristic:
    // - 11 digits starting with 1 => +1 (US with leading 1)
    // - 10 digits => assume US (NANP)
    if (/^\d{11}$/.test(cleaned) && cleaned.startsWith("1")) return "+1";
    if (/^\d{10}$/.test(cleaned)) return "+1";
    return null;
  }

  // Properly E.164 prefixed.
  // +1 is the most common single-digit code.
  if (cleaned.startsWith("+1") && cleaned.length >= 11) return "+1";
  if (cleaned.startsWith("+7") && cleaned.length >= 11) return "+7";

  // Most other country codes are 2 digits. We're not trying to be a
  // libphonenumber, just want SOMETHING to filter on.
  if (cleaned.length >= 3) return cleaned.slice(0, 3);

  return null;
}

export function isUsPhone(phone: string | null | undefined): boolean {
  return extractCountryCode(phone) === "+1";
}

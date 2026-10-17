/**
 * Every ISO 3166-1 alpha-2 country code, and the UTC offsets in real use.
 *
 * The full list rather than a curated one. A shortlist of "countries we
 * expect" would mean a candidate whose country was left off it could not
 * describe where they work from, which is a quiet exclusion of exactly the
 * people least likely to be thought of when the shortlist was written.
 *
 * Only the codes are stored here. Names come from Intl.DisplayNames, so the
 * list needs no maintenance when a country is renamed, and it renders in the
 * viewer's own language where the browser has one.
 */
const ALPHA2 =
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR ' +
  'BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ ' +
  'EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW ' +
  'GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY ' +
  'KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV ' +
  'MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY ' +
  'QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG ' +
  'TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW';

export const COUNTRY_CODES: readonly string[] = ALPHA2.split(' ');

let displayNames: Intl.DisplayNames | null = null;

/** The country's name, falling back to the code where the browser has no name for it. */
export function countryName(code: string): string {
  try {
    displayNames ??= new Intl.DisplayNames(undefined, { type: 'region' });
    return displayNames.of(code) ?? code;
  } catch {
    return code;
  }
}

/** Codes with names, sorted by name so the list reads the way a person scans it. */
export function countriesByName(): { code: string; name: string }[] {
  return COUNTRY_CODES.map((code) => ({ code, name: countryName(code) })).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

/**
 * The UTC offsets that countries actually use, including the half and
 * quarter hours. Chosen from a list rather than typed, because "+5:45" is
 * not a number anybody should have to work out, and a free number field
 * invites minutes where hours were meant.
 */
const OFFSET_MINUTES = [
  -720, -660, -600, -570, -540, -480, -420, -360, -300, -240, -210, -180, -150, -120, -60, 0, 60,
  120, 180, 210, 240, 270, 300, 330, 345, 360, 390, 420, 480, 525, 540, 570, 600, 630, 660, 720,
  765, 780, 840,
];

export function formatUtcOffset(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+';
  const absolute = Math.abs(minutes);
  const hours = String(Math.floor(absolute / 60)).padStart(2, '0');
  const remainder = String(absolute % 60).padStart(2, '0');
  return `UTC${sign}${hours}:${remainder}`;
}

export function utcOffsetOptions(): { minutes: number; label: string }[] {
  return OFFSET_MINUTES.map((minutes) => ({ minutes, label: formatUtcOffset(minutes) }));
}

/**
 * The viewer's current offset, as a starting suggestion only. Suggesting is
 * the most this may ever do: the stored value has to be what the person
 * chose, because an offset quietly taken from the browser would be a
 * location inferred rather than stated, and inferred location is the thing
 * that turns a payroll filter into a proxy for where somebody is from.
 */
export function suggestedUtcOffsetMinutes(now: Date = new Date()): number {
  const raw = -now.getTimezoneOffset();
  return OFFSET_MINUTES.includes(raw) ? raw : 0;
}

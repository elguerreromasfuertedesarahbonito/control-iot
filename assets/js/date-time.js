const UNKNOWN_ZONE = 'Zona del backend sin confirmar';
const NANOSECONDS = 1_000_000_000n;
const ISO_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(?:([Zz])|([+-])(\d{2}):(\d{2}))?$/;

function parseDateTime(value) {
  if (typeof value !== 'string') return null;
  const match = ISO_DATE_TIME.exec(value);
  if (!match || match[0] !== value) return null;
  const [, y, m, d, h, minute, second, fraction = '', z, sign, offsetHour, offsetMinute] = match;
  const [year, month, day, hour, minutes, seconds] = [y, m, d, h, minute, second].map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1] ||
      hour > 23 || minutes > 59 || seconds > 59 ||
      (sign && (Number(offsetHour) > 23 || Number(offsetMinute) > 59))) return null;
  const offset = z ? 0 : sign
    ? (Number(offsetHour) * 60 + Number(offsetMinute)) * (sign === '-' ? -1 : 1)
    : null;
  return { year, month, day, hour, minutes, seconds, fraction, offset, iso: value };
}

/** Strict calendar validation, without the rollover accepted by Date constructors. */
export function isBackendDateTime(value) {
  return parseDateTime(value) !== null;
}

// Gregorian calendar arithmetic avoids both local time and Date.UTC's 1900 bias
// for years 1–99. The result is the number of calendar days since 1970-01-01.
function calendarDays({ year, month, day }) {
  const adjustedYear = year - (month <= 2 ? 1 : 0);
  const era = Math.floor(adjustedYear / 400);
  const yearOfEra = adjustedYear - era * 400;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  return era * 146097 + yearOfEra * 365 + Math.floor(yearOfEra / 4)
    - Math.floor(yearOfEra / 100) + dayOfYear - 719468;
}

function orderKey(parts) {
  const seconds = BigInt(calendarDays(parts)) * 86400n + BigInt(parts.hour * 3600 + parts.minutes * 60 + parts.seconds);
  const offsetSeconds = BigInt(parts.offset ?? 0) * 60n;
  return (seconds - offsetSeconds) * NANOSECONDS + BigInt(parts.fraction.padEnd(9, '0'));
}

/**
 * Comparable nanosecond key, or null for invalid input. Naive timestamps are UTC
 * according to the backend's confirmed MySQL UTC session/global/system contract.
 * Explicit ISO offsets always take precedence. This does not infer the user's
 * local timezone and retains the backend's microsecond precision.
 */
export function timestampOrderKey(value) {
  const parts = parseDateTime(value);
  return parts ? orderKey(parts) : null;
}

const pad = value => String(value).padStart(2, '0');
function wallTime(parts, zoneLabel) {
  return { date: `${pad(parts.day)}/${pad(parts.month)}/${String(parts.year).padStart(4, '0')}`,
    time: `${pad(parts.hour)}:${pad(parts.minutes)}:${pad(parts.seconds)}`, zoneLabel, iso: parts.iso };
}

function milliseconds(key) {
  // BigInt division truncates toward zero; Date needs the earlier millisecond
  // for a negative instant with sub-millisecond precision.
  return Number(key >= 0n ? key / 1_000_000n : (key - 999_999n) / 1_000_000n);
}

/** Keep unknown naive wall times intact; convert only confirmed instants. */
export function formatBackendDateTime(value, { sourceTimeZone = null, displayTimeZone = 'America/Mexico_City' } = {}) {
  const parts = parseDateTime(value);
  if (!parts) return { date: '—', time: '—', zoneLabel: UNKNOWN_ZONE, iso: typeof value === 'string' ? value : null };
  if (parts.offset === null && sourceTimeZone === null) return wallTime(parts, UNKNOWN_ZONE);
  if (parts.offset === null && sourceTimeZone === displayTimeZone) return wallTime(parts, displayTimeZone);
  // A naive IANA wall time from another zone would require DST ambiguity rules.
  // Only the confirmed UTC source is converted; other sources remain explicit.
  if (parts.offset === null && sourceTimeZone !== 'UTC') return wallTime(parts, `Zona del backend: ${sourceTimeZone}`);
  try {
    const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: displayTimeZone,
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    const fields = Object.fromEntries(formatter.formatToParts(new Date(milliseconds(orderKey(parts))))
      .filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
    return { date: `${fields.day}/${fields.month}/${fields.year.padStart(4, '0')}`,
      time: `${fields.hour}:${fields.minute}:${fields.second}`, zoneLabel: displayTimeZone, iso: parts.iso };
  } catch {
    // An invalid/unsupported display zone must not silently change the wall time.
    return wallTime(parts, parts.offset === null ? `Zona del backend: ${sourceTimeZone}` : `Zona ISO: ${parts.iso.match(/(?:[Zz]|[+-]\d{2}:\d{2})$/)[0]}`);
  }
}

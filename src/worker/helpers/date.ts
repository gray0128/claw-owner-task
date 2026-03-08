import { toSqliteUtc } from '../utils';

// Time format validation
export const isValidDate = (dateStr: string) => {
  if (!dateStr || typeof dateStr !== 'string') return true;
  const isoRegex = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}:\d{2}(\.\d{3})?(Z|[+-]\d{2}:\d{2})?)?$/;
  return isoRegex.test(dateStr) && !isNaN(Date.parse(dateStr));
};

export const normalizeDate = (d: any, timeZone: string = 'Asia/Shanghai') => {
  if (!d || typeof d !== 'string') return d;
  // If it has a timezone identifier (Z, +HH:mm, -HH:mm), parse it directly
  if (/[Z]|[+-]\d{2}:\d{2}$/.test(d)) {
    return toSqliteUtc(new Date(d));
  }

  // Floating time from AI/user: assume it is in the specified user timezone
  let normalized = d.replace(' ', 'T');
  if (normalized.length === 10) normalized += 'T00:00:00';
  if (normalized.length === 16) normalized += ':00';

  try {
    // Correct way to parse a floating time string as being in a specific timezone
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });

    // We need to find the UTC time that, when formatted in `timeZone`, matches `normalized`
    // A simpler approach in modern JS:
    const dt = new Date(normalized); // This treats it as local to the RUNTIME (UTC in Workers)
    // We need to adjust it.

    // Using a more robust approach for Workers environment:
    // 1. Parse as UTC first
    const utcDate = new Date(normalized + 'Z');
    // 2. Get the "local" representation of that UTC date in the target timezone
    const parts = formatter.formatToParts(utcDate);
    const partMap: Record<string, string> = {};
    parts.forEach(p => partMap[p.type] = p.value);

    const formattedInTz = `${partMap.year}-${partMap.month}-${partMap.day}T${partMap.hour}:${partMap.minute}:${partMap.second}Z`;
    const offsetDate = new Date(formattedInTz);

    // Difference tells us how far off the "UTC-as-local" interpretation was
    const diff = utcDate.getTime() - offsetDate.getTime();
    return toSqliteUtc(new Date(utcDate.getTime() + diff));
  } catch (e) {
    return toSqliteUtc(new Date(d));
  }
};

// Helper: convert UTC string "YYYY-MM-DD HH:MM:SS" back to localized string
export const fromSqliteUtc = (utcStr: string | null, timeZone: string = 'Asia/Shanghai'): string | null => {
  if (!utcStr) return null;
  const date = new Date(utcStr.replace(' ', 'T') + 'Z');
  return date.toLocaleString('zh-CN', { timeZone, hour12: false }).replace(/\//g, '-');
};

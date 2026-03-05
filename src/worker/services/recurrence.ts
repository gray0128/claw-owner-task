/**
 * Calculates the next due date based on the current due date and the recurring rule.
 * Everything is handled in UTC.
 */
export function calculateNextOccurrence(currentDueDateStr: string | null, rule: string): string | null {
  if (!currentDueDateStr || rule === 'none') {
    return null;
  }

  // Parse current UTC due date
  const date = new Date(currentDueDateStr.endsWith('Z') ? currentDueDateStr : currentDueDateStr + 'Z');
  if (isNaN(date.getTime())) {
    return null;
  }

  switch (rule) {
    case 'daily':
      date.setUTCDate(date.getUTCDate() + 1);
      break;
    case 'weekly':
      date.setUTCDate(date.getUTCDate() + 7);
      break;
    case 'monthly':
      date.setUTCMonth(date.getUTCMonth() + 1);
      break;
    default:
      return null;
  }

  // Format back to YYYY-MM-DD HH:mm:ss (UTC without Z)
  return formatSqliteDate(date);
}

/**
 * Calculates the next remind_at date based on the new due date and the original offset.
 */
export function calculateNextRemindAt(currentDueDateStr: string, currentRemindAtStr: string, nextDueDateStr: string): string | null {
  const parseUTC = (d: string) => new Date(d.endsWith('Z') ? d : d + 'Z');
  const currentDueDate = parseUTC(currentDueDateStr);
  const currentRemindAt = parseUTC(currentRemindAtStr);
  const nextDueDate = parseUTC(nextDueDateStr);

  if (isNaN(currentDueDate.getTime()) || isNaN(currentRemindAt.getTime()) || isNaN(nextDueDate.getTime())) {
    return null;
  }

  // Calculate the offset in milliseconds
  const offsetMs = currentDueDate.getTime() - currentRemindAt.getTime();

  const nextRemindAt = new Date(nextDueDate.getTime() - offsetMs);

  return formatSqliteDate(nextRemindAt);
}

/**
 * Calculates the next remind_at date based on the current remind_at and recurring rule,
 * ensuring the returned date is in the future (to avoid notification storms).
 */
export function calculateNextFutureRemindAt(currentRemindAtStr: string, rule: string): string | null {
  if (rule === 'none') {
    return null;
  }

  const parseUTC = (d: string) => new Date(d.endsWith('Z') ? d : d + 'Z');
  let date = parseUTC(currentRemindAtStr);

  if (isNaN(date.getTime())) {
    return null;
  }

  const now = new Date();

  // Loop until the date is in the future
  // Limit iterations to prevent infinite loops
  let iterations = 0;
  while (date <= now && iterations < 1000) {
    switch (rule) {
      case 'daily':
        date.setUTCDate(date.getUTCDate() + 1);
        break;
      case 'weekly':
        date.setUTCDate(date.getUTCDate() + 7);
        break;
      case 'monthly':
        date.setUTCMonth(date.getUTCMonth() + 1);
        break;
      default:
        return null; // Unsupported rule
    }
    iterations++;
  }

  // If after 1000 iterations it's still not in the future, just jump it based on current time
  if (date <= now) {
    date = now;
    if (rule === 'daily') date.setUTCDate(date.getUTCDate() + 1);
    else if (rule === 'weekly') date.setUTCDate(date.getUTCDate() + 7);
    else if (rule === 'monthly') date.setUTCMonth(date.getUTCMonth() + 1);
  }

  return formatSqliteDate(date);
}

function formatSqliteDate(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

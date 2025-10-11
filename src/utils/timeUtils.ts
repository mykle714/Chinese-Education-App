/**
 * Converts minutes into a human-readable time format
 * Returns an object with years, months, days, hours, and minutes
 */
export interface TimeBreakdown {
  years: number;
  months: number;
  days: number;
  hours: number;
  minutes: number;
}

export const convertMinutesToTimeFormat = (totalMinutes: number): TimeBreakdown => {
  if (totalMinutes < 0) {
    return { years: 0, months: 0, days: 0, hours: 0, minutes: 0 };
  }

  // Convert to larger time units
  const minutes = totalMinutes % 60;
  const totalHours = Math.floor(totalMinutes / 60);
  
  const hours = totalHours % 24;
  const totalDays = Math.floor(totalHours / 24);
  
  const days = totalDays % 30; // Approximate month as 30 days
  const totalMonths = Math.floor(totalDays / 30);
  
  const months = totalMonths % 12;
  const years = Math.floor(totalMonths / 12);

  return {
    years,
    months,
    days,
    hours,
    minutes
  };
};

/**
 * Formats a time breakdown into a readable string
 * Only includes non-zero values and uses proper singular/plural forms
 */
export const formatTimeBreakdown = (breakdown: TimeBreakdown): string => {
  const parts: string[] = [];

  if (breakdown.years > 0) {
    parts.push(`${breakdown.years} ${breakdown.years === 1 ? 'year' : 'years'}`);
  }
  if (breakdown.months > 0) {
    parts.push(`${breakdown.months} ${breakdown.months === 1 ? 'month' : 'months'}`);
  }
  if (breakdown.days > 0) {
    parts.push(`${breakdown.days} ${breakdown.days === 1 ? 'day' : 'days'}`);
  }
  if (breakdown.hours > 0) {
    parts.push(`${breakdown.hours} ${breakdown.hours === 1 ? 'hour' : 'hours'}`);
  }
  if (breakdown.minutes > 0) {
    parts.push(`${breakdown.minutes} ${breakdown.minutes === 1 ? 'minute' : 'minutes'}`);
  }

  if (parts.length === 0) {
    return '0 minutes';
  }

  if (parts.length === 1) {
    return parts[0];
  }

  if (parts.length === 2) {
    return `${parts[0]} and ${parts[1]}`;
  }

  // For 3 or more parts, join with commas and "and" before the last item
  const lastPart = parts.pop();
  return `${parts.join(', ')} and ${lastPart}`;
};

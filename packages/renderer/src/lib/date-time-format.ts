import type { SettingsValues } from '@cosmosh/api-contract';
import React from 'react';

import { useSettingsValues } from './settings-store';

type DateTimeParts = {
  year: string;
  yearShort: string;
  month: string;
  monthShort: string;
  day: string;
  hour24: string;
  hour12: string;
  minute: string;
  second: string;
  dayPeriod: string;
};

type DateTimeFormatter = {
  formatDateTime: (value: string | number | Date, fallback?: string) => string;
  formatTime: (value: string | number | Date, fallback?: string) => string;
};

const DEFAULT_DATE_TIME_FALLBACK = '-';
const SYSTEM_TIME_ZONE_VALUE = 'system';

/**
 * Resolves the Intl timeZone option from persisted settings.
 *
 * @param timeZone Stored setting value.
 * @returns IANA time zone or undefined for the system time zone.
 */
const resolveIntlTimeZone = (timeZone: string): string | undefined => {
  const normalizedTimeZone = timeZone.trim();
  return normalizedTimeZone === SYSTEM_TIME_ZONE_VALUE ? undefined : normalizedTimeZone;
};

/**
 * Reads a specific part from Intl formatted output.
 *
 * @param parts Intl formatted parts.
 * @param type Part type to resolve.
 * @returns Part value or an empty string.
 */
const readPart = (parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string => {
  return parts.find((part) => part.type === type)?.value ?? '';
};

/**
 * Builds reusable date-time parts using the selected locale and time zone.
 *
 * @param date Valid date instance.
 * @param settings Current application settings.
 * @returns Display parts used by the configured format patterns.
 */
const buildDateTimeParts = (date: Date, settings: SettingsValues): DateTimeParts => {
  const timeZone = resolveIntlTimeZone(settings.dateTimeTimeZone);
  const locale = settings.language;

  const numericParts = new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    month: '2-digit',
    second: '2-digit',
    timeZone,
    year: 'numeric',
  }).formatToParts(date);

  const shortMonthParts = new Intl.DateTimeFormat(locale, {
    month: 'short',
    timeZone,
  }).formatToParts(date);

  const twelveHourParts = new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    hour12: true,
    minute: '2-digit',
    second: '2-digit',
    timeZone,
  }).formatToParts(date);

  const year = readPart(numericParts, 'year');

  return {
    year,
    yearShort: year.slice(-2),
    month: readPart(numericParts, 'month'),
    monthShort: readPart(shortMonthParts, 'month'),
    day: readPart(numericParts, 'day'),
    hour24: readPart(numericParts, 'hour'),
    hour12: readPart(twelveHourParts, 'hour'),
    minute: readPart(numericParts, 'minute'),
    second: readPart(numericParts, 'second'),
    dayPeriod: readPart(twelveHourParts, 'dayPeriod'),
  };
};

/**
 * Applies the configured date format pattern.
 *
 * @param parts Resolved date-time parts.
 * @param format Selected date format.
 * @returns Formatted date text.
 */
const formatDatePart = (parts: DateTimeParts, format: SettingsValues['dateFormat']): string => {
  if (format === 'yyyy/MM/dd') {
    return `${parts.year}/${parts.month}/${parts.day}`;
  }

  if (format === 'dd/MM/yy') {
    return `${parts.day}/${parts.month}/${parts.yearShort}`;
  }

  if (format === 'MM/dd/yyyy') {
    return `${parts.month}/${parts.day}/${parts.year}`;
  }

  if (format === 'MMM d, yyyy') {
    return `${parts.monthShort} ${Number(parts.day)}, ${parts.year}`;
  }

  return `${parts.year}-${parts.month}-${parts.day}`;
};

/**
 * Applies the configured time format pattern.
 *
 * @param parts Resolved date-time parts.
 * @param format Selected time format.
 * @returns Formatted time text.
 */
const formatTimePart = (parts: DateTimeParts, format: SettingsValues['timeFormat']): string => {
  if (format === 'HH:mm') {
    return `${parts.hour24}:${parts.minute}`;
  }

  if (format === 'h:mm:ss a') {
    return `${parts.hour12}:${parts.minute}:${parts.second} ${parts.dayPeriod}`.trim();
  }

  if (format === 'h:mm a') {
    return `${parts.hour12}:${parts.minute} ${parts.dayPeriod}`.trim();
  }

  return `${parts.hour24}:${parts.minute}:${parts.second}`;
};

/**
 * Parses supported timestamp inputs into a valid Date.
 *
 * @param value Timestamp value to parse.
 * @returns Valid Date instance or null.
 */
const parseDateTimeInput = (value: string | number | Date): Date | null => {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * Formats a timestamp using the current application date-time settings.
 *
 * @param value Timestamp value to format.
 * @param settings Current application settings.
 * @param fallback Fallback for missing or invalid timestamps.
 * @returns Formatted date-time text.
 */
export const formatDateTimeWithSettings = (
  value: string | number | Date,
  settings: SettingsValues,
  fallback: string = DEFAULT_DATE_TIME_FALLBACK,
): string => {
  const date = parseDateTimeInput(value);
  if (!date) {
    return fallback;
  }

  try {
    const parts = buildDateTimeParts(date, settings);
    return `${formatDatePart(parts, settings.dateFormat)} ${formatTimePart(parts, settings.timeFormat)}`;
  } catch {
    return fallback;
  }
};

/**
 * Formats only the time portion using the current application date-time settings.
 *
 * @param value Timestamp value to format.
 * @param settings Current application settings.
 * @param fallback Fallback for missing or invalid timestamps.
 * @returns Formatted time text.
 */
export const formatTimeWithSettings = (
  value: string | number | Date,
  settings: SettingsValues,
  fallback: string = DEFAULT_DATE_TIME_FALLBACK,
): string => {
  const date = parseDateTimeInput(value);
  if (!date) {
    return fallback;
  }

  try {
    const parts = buildDateTimeParts(date, settings);
    return formatTimePart(parts, settings.timeFormat);
  } catch {
    return fallback;
  }
};

/**
 * Subscribes to settings and returns stable date-time formatting helpers.
 *
 * @returns Formatter helpers backed by current settings.
 */
export const useDateTimeFormatter = (): DateTimeFormatter => {
  const settings = useSettingsValues();

  return React.useMemo(
    () => ({
      formatDateTime: (value, fallback) => formatDateTimeWithSettings(value, settings, fallback),
      formatTime: (value, fallback) => formatTimeWithSettings(value, settings, fallback),
    }),
    [settings],
  );
};

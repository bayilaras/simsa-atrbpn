export const MAX_NOTIFICATION_READ_IDS = 100;
export const MAX_NOTIFICATION_ID_LENGTH = 255;

const CATEGORY = '(?:surat-masuk|arsip-retensi|distribusi|verifikasi-retensi|appraisal|penyusutan|penyerahan-permanen)';
const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const STATE = '[A-Za-z0-9][A-Za-z0-9 _.:/-]{0,127}';
const TYPE = '(?:urgent|warning|info)';

/** Exact bounded grammar emitted by NotificationService.statefulId(). */
export const NOTIFICATION_ID_PATTERN = new RegExp(
    `^${CATEGORY}:${UUID}:${STATE}:${TYPE}$`,
);

export function isValidNotificationId(value: unknown): value is string {
    return typeof value === 'string'
        && value.length <= MAX_NOTIFICATION_ID_LENGTH
        && NOTIFICATION_ID_PATTERN.test(value);
}

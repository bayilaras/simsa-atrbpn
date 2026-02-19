// Export all schemas
// Export all schemas
export * from './users';
// Alias for Better Auth (singular model names)
export { users as user, accounts as account, sessions as session, verifications as verification } from './users';
export * from './unit-kerja';
export * from './surat-masuk';
export * from './surat-keluar';
export * from './arsip';
export * from './arsip-items';
export * from './file-attachments';
export * from './audit-log';
export * from './master-data';
export * from './storage-locations';
export * from './archive-lending';
export * from './dosir';
export * from './surat-distribution';
export * from './penyusutan';
export * from './arsip-vital';
export * from './arsip-terjaga';
export * from './arsip-elektronik';
export * from './tunjuk-silang';
export * from './klasifikasi-jra-mapping';
export * from './autentikasi';
export * from './layanan-arsip';
export * from './notification-reads';
export * from './preservasi-track';
// NOTE: Standalone indexes disabled — they crash at runtime with Drizzle ORM's
// index().on() API due to JSON.parse(undefined). Use inline indexes in pgTable
// or create indexes via raw SQL migrations instead.
// export * from './indexes';
export * from './approvals';
export * from './signatures';

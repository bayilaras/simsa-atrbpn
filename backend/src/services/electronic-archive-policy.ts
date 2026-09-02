export type ElectronicSourceType = 'digitized' | 'born_digital' | 'received';
export type ScanCategory = 'paper' | 'cartographic' | 'photo' | 'born_digital';

export interface ScanQualityInput {
    sourceType: ElectronicSourceType;
    scanCategory?: ScanCategory | null;
    resolutionDpi?: number | null;
    colorDepth?: number | null;
}

export interface ScanQualityResult {
    passed: boolean;
    minimumDpi: number | null;
    errors: string[];
}

const MINIMUM_DPI: Record<Exclude<ScanCategory, 'born_digital'>, number> = {
    paper: 300,
    cartographic: 400,
    photo: 600,
};

export function evaluateScanQuality(input: ScanQualityInput): ScanQualityResult {
    if (input.sourceType !== 'digitized') {
        return { passed: true, minimumDpi: null, errors: [] };
    }

    const errors: string[] = [];
    const category = input.scanCategory && input.scanCategory !== 'born_digital'
        ? input.scanCategory
        : 'paper';
    const minimumDpi = MINIMUM_DPI[category];

    if (!input.resolutionDpi || input.resolutionDpi < minimumDpi) {
        errors.push(`Resolusi minimal untuk ${category} adalah ${minimumDpi} DPI.`);
    }
    if (!input.colorDepth || input.colorDepth < 24) {
        errors.push('Kedalaman warna hasil pemindaian minimal 24-bit.');
    }

    return { passed: errors.length === 0, minimumDpi, errors };
}

export function identifyFileFormat(mimeType?: string | null, fileName?: string | null): string {
    const byMime: Record<string, string> = {
        'application/pdf': 'PDF',
        'image/tiff': 'TIFF',
        'image/jpeg': 'JPEG',
        'image/png': 'PNG',
        'application/msword': 'DOC',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
        'application/vnd.ms-excel': 'XLS',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
    };
    if (mimeType && byMime[mimeType.toLowerCase()]) return byMime[mimeType.toLowerCase()];

    const extension = fileName?.split('.').pop()?.trim().toUpperCase();
    return extension && /^[A-Z0-9]{1,10}$/.test(extension) ? extension : 'UNKNOWN';
}

export function createElectronicRegistrationCode(
    unitKerjaId: string,
    randomSuffix: string,
    now: Date = new Date(),
): string {
    const unit = unitKerjaId.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) || 'UNIT';
    const suffix = randomSuffix.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
    if (!suffix) throw new Error('Registration suffix is required');
    return `AE-${now.getUTCFullYear()}-${unit}-${suffix}`;
}

export const PRESERVATION_ACTIONS = [
    'migration',
    'conversion',
    'encapsulation',
    'emulation',
    'replication',
    'refreshing',
    'backup',
    'integrity_check',
] as const;

export function isPreservationAction(value: string): value is typeof PRESERVATION_ACTIONS[number] {
    return (PRESERVATION_ACTIONS as readonly string[]).includes(value);
}

export function canDecideVerification(currentStatus: string): boolean {
    // A decision is final for that version. Rejected metadata must first be
    // corrected through update(), which deliberately returns it to pending.
    return currentStatus === 'pending';
}

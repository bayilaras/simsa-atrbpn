import { Request, Response, NextFunction } from 'express';
import { createLogger } from '../utils/logger';

const log = createLogger('FileValidation');

/**
 * File Validation Middleware
 * Validates uploaded files using magic bytes (file signatures)
 * to prevent file type spoofing
 */

interface FileSignature {
    mimeType: string;
    extension: string;
    signature: number[][];
    offset?: number;
}

/**
 * Common file signatures (magic bytes)
 * Reference: https://en.wikipedia.org/wiki/List_of_file_signatures
 */
const FILE_SIGNATURES: FileSignature[] = [
    // PDF
    {
        mimeType: 'application/pdf',
        extension: 'pdf',
        signature: [[0x25, 0x50, 0x44, 0x46]] // %PDF
    },
    // JPEG
    {
        mimeType: 'image/jpeg',
        extension: 'jpg',
        signature: [
            [0xFF, 0xD8, 0xFF, 0xE0], // JFIF
            [0xFF, 0xD8, 0xFF, 0xE1], // EXIF
            [0xFF, 0xD8, 0xFF, 0xE2], // Canon
            [0xFF, 0xD8, 0xFF, 0xE3]  // Samsung
        ]
    },
    // PNG
    {
        mimeType: 'image/png',
        extension: 'png',
        signature: [[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]]
    },
    // Microsoft Word (.doc)
    {
        mimeType: 'application/msword',
        extension: 'doc',
        signature: [[0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]]
    },
    // Microsoft Word (.docx) - ZIP-based
    {
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        extension: 'docx',
        signature: [[0x50, 0x4B, 0x03, 0x04]] // ZIP signature
    },
    // Microsoft Excel (.xlsx) - ZIP-based
    {
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        extension: 'xlsx',
        signature: [[0x50, 0x4B, 0x03, 0x04]] // ZIP signature
    },
    // ZIP
    {
        mimeType: 'application/zip',
        extension: 'zip',
        signature: [
            [0x50, 0x4B, 0x03, 0x04],
            [0x50, 0x4B, 0x05, 0x06],
            [0x50, 0x4B, 0x07, 0x08]
        ]
    }
];

/**
 * Check if buffer matches a file signature
 */
function matchesSignature(buffer: Buffer, signature: number[]): boolean {
    if (buffer.length < signature.length) {
        return false;
    }

    for (let i = 0; i < signature.length; i++) {
        if (buffer[i] !== signature[i]) {
            return false;
        }
    }

    return true;
}

/**
 * Detect file type from buffer using magic bytes
 */
export function detectFileType(buffer: Buffer): FileSignature | null {
    for (const fileType of FILE_SIGNATURES) {
        for (const signature of fileType.signature) {
            if (matchesSignature(buffer, signature)) {
                return fileType;
            }
        }
    }

    return null;
}

/**
 * Validate that file content matches its declared MIME type
 */
export function validateFileContent(
    buffer: Buffer,
    declaredMimeType: string,
    filename: string
): { isValid: boolean; error?: string; detectedType?: string } {
    const detectedType = detectFileType(buffer);

    if (!detectedType) {
        return {
            isValid: false,
            error: 'Unable to detect file type. File may be corrupted or unsupported.',
            detectedType: 'unknown'
        };
    }

    // For Office documents (.docx, .xlsx), they all use ZIP signature
    // We need additional validation
    if (declaredMimeType.includes('openxmlformats')) {
        if (detectedType.mimeType !== 'application/zip' &&
            !detectedType.mimeType.includes('openxmlformats')) {
            return {
                isValid: false,
                error: `File type mismatch. Expected Office document, but detected ${detectedType.mimeType}`,
                detectedType: detectedType.mimeType
            };
        }
        return { isValid: true, detectedType: declaredMimeType };
    }

    // For other files, strict matching
    if (detectedType.mimeType !== declaredMimeType) {
        return {
            isValid: false,
            error: `File type mismatch. Declared as ${declaredMimeType}, but detected as ${detectedType.mimeType}`,
            detectedType: detectedType.mimeType
        };
    }

    return { isValid: true, detectedType: detectedType.mimeType };
}

/**
 * Express middleware for file validation
 * Use after multer middleware
 */
export function fileValidationMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
) {
    const file = req.file;

    if (!file) {
        // No file uploaded, skip validation
        return next();
    }

    try {
        const validation = validateFileContent(
            file.buffer || Buffer.from([]), // Use buffer if available
            file.mimetype,
            file.originalname
        );

        if (!validation.isValid) {
            return res.status(400).json({
                error: 'Invalid file',
                message: validation.error,
                details: {
                    filename: file.originalname,
                    declaredType: file.mimetype,
                    detectedType: validation.detectedType
                }
            });
        }

        // Attach validation result to request
        (req as any).fileValidation = validation;

        next();
    } catch (error) {
        log.error({ err: error }, 'File validation error:');
        return res.status(500).json({
            error: 'File validation failed',
            message: 'An error occurred while validating the file'
        });
    }
}

/**
 * Validate file size
 */
export function validateFileSize(
    maxSizeBytes: number
): (req: Request, res: Response, next: NextFunction) => void {
    return (req: Request, res: Response, next: NextFunction) => {
        const file = req.file;

        if (!file) {
            return next();
        }

        if (file.size > maxSizeBytes) {
            const maxSizeMB = (maxSizeBytes / (1024 * 1024)).toFixed(2);
            const fileSizeMB = (file.size / (1024 * 1024)).toFixed(2);

            return res.status(400).json({
                error: 'File too large',
                message: `File size (${fileSizeMB}MB) exceeds maximum allowed size (${maxSizeMB}MB)`,
                details: {
                    filename: file.originalname,
                    size: file.size,
                    maxSize: maxSizeBytes
                }
            });
        }

        next();
    };
}

/**
 * Sanitize filename to prevent directory traversal and other attacks
 */
export function sanitizeFilename(filename: string): string {
    // Remove path separators
    let sanitized = filename.replace(/[\/\\]/g, '_');

    // Remove null bytes
    sanitized = sanitized.replace(/\0/g, '');

    // Remove leading dots (hidden files)
    sanitized = sanitized.replace(/^\.+/, '');

    // Limit length
    if (sanitized.length > 255) {
        const ext = sanitized.split('.').pop();
        const name = sanitized.substring(0, 255 - (ext ? ext.length + 1 : 0));
        sanitized = ext ? `${name}.${ext}` : name;
    }

    return sanitized;
}

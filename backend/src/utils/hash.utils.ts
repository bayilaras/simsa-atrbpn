import crypto from 'crypto';
import fs from 'fs';

/**
 * Calculate SHA-256 hash of a file
 * @param filePath Path to the file
 * @returns Hex string of the hash
 */
export const calculateFileHash = (filePath: string): Promise<string> => {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(filePath);

        stream.on('error', (err) => reject(err));
        stream.on('data', (chunk) => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
    });
};

/**
 * Verify if a file matches a given hash
 * @param filePath Path to the file
 * @param expectedHash The hash to compare against
 * @returns Boolean indicating match
 */
export const verifyFileHash = async (filePath: string, expectedHash: string): Promise<boolean> => {
    const actualHash = await calculateFileHash(filePath);
    return actualHash === expectedHash;
};

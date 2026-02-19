import { Request, Response, NextFunction } from 'express';

/**
 * Password Policy Middleware
 * Enforces strong password requirements for user registration and password changes
 */

export interface PasswordValidationResult {
    isValid: boolean;
    errors: string[];
    strength: 'weak' | 'medium' | 'strong' | 'very-strong';
    score: number;
}

const COMMON_PASSWORDS = [
    'password', 'password123', '12345678', 'qwerty', 'abc123',
    'monkey', '1234567', 'letmein', 'trustno1', 'dragon',
    'baseball', 'iloveyou', 'master', 'sunshine', 'ashley',
    'bailey', 'passw0rd', 'shadow', '123123', '654321',
    'superman', 'qazwsx', 'michael', 'football', 'admin',
    'administrator', 'root', 'toor', 'pass', 'test'
];

/**
 * Validate password strength and policy compliance
 */
export function validatePassword(password: string): PasswordValidationResult {
    const errors: string[] = [];
    let score = 0;

    // Minimum length check (12 characters)
    if (password.length < 12) {
        errors.push('Password must be at least 12 characters long');
    } else {
        score += 1;
        if (password.length >= 16) score += 1;
        if (password.length >= 20) score += 1;
    }

    // Uppercase letter check
    if (!/[A-Z]/.test(password)) {
        errors.push('Password must contain at least one uppercase letter');
    } else {
        score += 1;
    }

    // Lowercase letter check
    if (!/[a-z]/.test(password)) {
        errors.push('Password must contain at least one lowercase letter');
    } else {
        score += 1;
    }

    // Number check
    if (!/[0-9]/.test(password)) {
        errors.push('Password must contain at least one number');
    } else {
        score += 1;
    }

    // Special character check
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
        errors.push('Password must contain at least one special character');
    } else {
        score += 1;
    }

    // Common password check
    const lowerPassword = password.toLowerCase();
    if (COMMON_PASSWORDS.some(common => lowerPassword.includes(common))) {
        errors.push('Password is too common or contains common words');
        score = Math.max(0, score - 2);
    }

    // Sequential characters check
    if (/(.)\1{2,}/.test(password)) {
        errors.push('Password should not contain repeated characters (e.g., "aaa", "111")');
        score = Math.max(0, score - 1);
    }

    // Sequential numbers check
    if (/(?:012|123|234|345|456|567|678|789|890)/.test(password)) {
        errors.push('Password should not contain sequential numbers');
        score = Math.max(0, score - 1);
    }

    // Determine strength
    let strength: PasswordValidationResult['strength'];
    if (score <= 2) strength = 'weak';
    else if (score <= 4) strength = 'medium';
    else if (score <= 6) strength = 'strong';
    else strength = 'very-strong';

    return {
        isValid: errors.length === 0,
        errors,
        strength,
        score
    };
}

/**
 * Express middleware to validate password in request body
 * Use this on registration and password change endpoints
 */
export function passwordPolicyMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
) {
    const password = req.body.password;

    if (!password) {
        return res.status(400).json({
            error: 'Password is required',
            field: 'password'
        });
    }

    const validation = validatePassword(password);

    if (!validation.isValid) {
        return res.status(400).json({
            error: 'Password does not meet security requirements',
            field: 'password',
            details: validation.errors,
            strength: validation.strength
        });
    }

    // Attach validation result to request for logging
    (req as any).passwordValidation = validation;

    next();
}

/**
 * API endpoint to check password strength (for client-side feedback)
 */
export function checkPasswordStrength(req: Request, res: Response) {
    const { password } = req.body;

    if (!password) {
        return res.status(400).json({
            error: 'Password is required'
        });
    }

    const validation = validatePassword(password);

    return res.json({
        isValid: validation.isValid,
        strength: validation.strength,
        score: validation.score,
        errors: validation.errors,
        suggestions: getPasswordSuggestions(validation)
    });
}

/**
 * Get helpful suggestions based on validation errors
 */
function getPasswordSuggestions(validation: PasswordValidationResult): string[] {
    const suggestions: string[] = [];

    if (validation.errors.some(e => e.includes('12 characters'))) {
        suggestions.push('Try using a passphrase with multiple words');
    }

    if (validation.errors.some(e => e.includes('uppercase'))) {
        suggestions.push('Add some capital letters');
    }

    if (validation.errors.some(e => e.includes('special character'))) {
        suggestions.push('Include symbols like !@#$%^&*');
    }

    if (validation.errors.some(e => e.includes('common'))) {
        suggestions.push('Avoid common words and patterns');
    }

    if (validation.strength === 'weak' || validation.strength === 'medium') {
        suggestions.push('Consider using a password manager to generate a strong password');
    }

    return suggestions;
}

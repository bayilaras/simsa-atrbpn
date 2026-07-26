import { useState, useEffect } from 'react';
import { Check, X, AlertCircle } from 'lucide-react';

/**
 * Password Strength Indicator Component
 * Provides real-time feedback on password strength
 */

interface PasswordStrengthProps {
    password: string;
    onStrengthChange?: (strength: string, isValid: boolean) => void;
}

interface PasswordCheck {
    label: string;
    test: (password: string) => boolean;
}

const PASSWORD_CHECKS: PasswordCheck[] = [
    {
        label: 'At least 12 characters',
        test: (p) => p.length >= 12
    },
    {
        label: 'Contains uppercase letter',
        test: (p) => /[A-Z]/.test(p)
    },
    {
        label: 'Contains lowercase letter',
        test: (p) => /[a-z]/.test(p)
    },
    {
        label: 'Contains number',
        test: (p) => /[0-9]/.test(p)
    },
    {
        label: 'Contains special character',
        test: (p) => /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(p)
    }
];

export function PasswordStrengthIndicator({ password, onStrengthChange }: PasswordStrengthProps) {
    const [strength, setStrength] = useState < 'weak' | 'medium' | 'strong' | 'very-strong' > ('weak');
    const [score, setScore] = useState(0);

    useEffect(() => {
        if (!password) {
            setStrength('weak');
            setScore(0);
            onStrengthChange?.('weak', false);
            return;
        }

        let currentScore = 0;

        // Check all requirements
        PASSWORD_CHECKS.forEach(check => {
            if (check.test(password)) {
                currentScore++;
            }
        });

        // Bonus points for length
        if (password.length >= 16) currentScore++;
        if (password.length >= 20) currentScore++;

        // Penalties
        if (/(.)\1{2,}/.test(password)) currentScore = Math.max(0, currentScore - 1);
        if (/(?:012|123|234|345|456|567|678|789|890)/.test(password)) currentScore = Math.max(0, currentScore - 1);

        setScore(currentScore);

        // Determine strength
        let newStrength: typeof strength;
        if (currentScore <= 2) newStrength = 'weak';
        else if (currentScore <= 4) newStrength = 'medium';
        else if (currentScore <= 6) newStrength = 'strong';
        else newStrength = 'very-strong';

        setStrength(newStrength);

        const isValid = PASSWORD_CHECKS.every(check => check.test(password));
        onStrengthChange?.(newStrength, isValid);
    }, [password, onStrengthChange]);

    if (!password) {
        return null;
    }

    const strengthColors = {
        'weak': 'bg-red-500',
        'medium': 'bg-yellow-500',
        'strong': 'bg-blue-500',
        'very-strong': 'bg-green-500'
    };

    const strengthLabels = {
        'weak': 'Weak',
        'medium': 'Medium',
        'strong': 'Strong',
        'very-strong': 'Very Strong'
    };

    const strengthWidth = {
        'weak': 'w-1/4',
        'medium': 'w-1/2',
        'strong': 'w-3/4',
        'very-strong': 'w-full'
    };

    return (
        <div className="space-y-3 mt-2">
            {/* Strength Bar */}
            <div className="space-y-1">
                <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">Password Strength</span>
                    <span className={`font-medium ${strength === 'weak' ? 'text-red-600 dark:text-red-400' :
                            strength === 'medium' ? 'text-yellow-600' :
                                strength === 'strong' ? 'text-blue-600 dark:text-blue-400' :
                                    'text-green-600'
                        }`}>
                        {strengthLabels[strength]}
                    </span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                        className={`h-full transition-all duration-300 ${strengthColors[strength]} ${strengthWidth[strength]}`}
                    />
                </div>
            </div>

            {/* Requirements Checklist */}
            <div className="space-y-1.5">
                <p className="text-sm font-medium text-muted-foreground">Requirements:</p>
                {PASSWORD_CHECKS.map((check, index) => {
                    const passed = check.test(password);
                    return (
                        <div key={index} className="flex items-center gap-2 text-sm">
                            {passed ? (
                                <Check className="w-4 h-4 text-green-600" />
                            ) : (
                                <X className="w-4 h-4 text-muted-foreground" />
                            )}
                            <span className={passed ? 'text-green-700 dark:text-green-300' : 'text-muted-foreground'}>
                                {check.label}
                            </span>
                        </div>
                    );
                })}
            </div>

            {/* Warning for weak passwords */}
            {strength === 'weak' && password.length > 0 && (
                <div className="flex items-start gap-2 p-3 bg-yellow-50 dark:bg-yellow-500/15 border border-yellow-200 rounded-md">
                    <AlertCircle className="w-4 h-4 text-yellow-600 mt-0.5 flex-shrink-0" />
                    <p className="text-sm text-yellow-800 dark:text-yellow-300">
                        Your password is weak. Consider using a longer password with a mix of characters.
                    </p>
                </div>
            )}
        </div>
    );
}

export default PasswordStrengthIndicator;

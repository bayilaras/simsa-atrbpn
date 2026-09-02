const SESSION_CSRF_KEY = 'simsa.firebase.session-csrf';
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,256}$/;

let memoryToken = null;

function browserSessionStorage() {
    try {
        return typeof window !== 'undefined' ? window.sessionStorage : null;
    } catch {
        return null;
    }
}

export function isValidFirebaseSessionCsrfToken(value) {
    return typeof value === 'string' && TOKEN_PATTERN.test(value);
}

export function setFirebaseSessionCsrfToken(value) {
    if (!isValidFirebaseSessionCsrfToken(value)) {
        throw new Error('Token CSRF sesi Firebase dari server tidak valid.');
    }

    memoryToken = value;
    browserSessionStorage()?.setItem(SESSION_CSRF_KEY, value);
}

export function getFirebaseSessionCsrfToken() {
    if (isValidFirebaseSessionCsrfToken(memoryToken)) return memoryToken;

    const stored = browserSessionStorage()?.getItem(SESSION_CSRF_KEY);
    if (!isValidFirebaseSessionCsrfToken(stored)) {
        if (stored) browserSessionStorage()?.removeItem(SESSION_CSRF_KEY);
        return null;
    }

    memoryToken = stored;
    return stored;
}

export function clearFirebaseSessionCsrfToken() {
    memoryToken = null;
    browserSessionStorage()?.removeItem(SESSION_CSRF_KEY);
}

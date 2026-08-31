let firebaseClientPromise = null;

function requiredFirebaseConfig(env = import.meta.env) {
    const config = {
        apiKey: env.VITE_FIREBASE_API_KEY,
        authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
        projectId: env.VITE_FIREBASE_PROJECT_ID,
        appId: env.VITE_FIREBASE_APP_ID,
        storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || undefined,
        messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || undefined,
    };
    const missing = Object.entries(config)
        .filter(([key, value]) => ['apiKey', 'authDomain', 'projectId', 'appId'].includes(key) && !value)
        .map(([key]) => key);

    if (missing.length) {
        throw new Error(`Konfigurasi Firebase Web belum lengkap: ${missing.join(', ')}.`);
    }
    if (!env.VITE_FIREBASE_APP_CHECK_SITE_KEY) {
        throw new Error('VITE_FIREBASE_APP_CHECK_SITE_KEY wajib untuk mode Firebase.');
    }
    return config;
}

async function initializeFirebaseClient() {
    const env = import.meta.env;
    const debugToken = env.VITE_FIREBASE_APP_CHECK_DEBUG_TOKEN?.trim();
    if (debugToken) {
        if (!env.DEV) {
            throw new Error('Firebase App Check debug token hanya boleh dipakai pada build development.');
        }
        globalThis.FIREBASE_APPCHECK_DEBUG_TOKEN = debugToken === 'true' ? true : debugToken;
    }

    const [appModule, authModule, appCheckModule] = await Promise.all([
        import('firebase/app'),
        import('firebase/auth'),
        import('firebase/app-check'),
    ]);
    const app = appModule.initializeApp(requiredFirebaseConfig(env));
    const auth = authModule.getAuth(app);
    await authModule.setPersistence(auth, authModule.inMemoryPersistence);
    const appCheck = appCheckModule.initializeAppCheck(app, {
        provider: new appCheckModule.ReCaptchaEnterpriseProvider(
            env.VITE_FIREBASE_APP_CHECK_SITE_KEY,
        ),
        isTokenAutoRefreshEnabled: true,
    });

    return { auth, authModule, appCheck, appCheckModule };
}

function getFirebaseClient() {
    if (!firebaseClientPromise) {
        firebaseClientPromise = initializeFirebaseClient().catch((error) => {
            firebaseClientPromise = null;
            throw error;
        });
    }
    return firebaseClientPromise;
}

export async function getFirebaseAppCheckToken(forceRefresh = false) {
    const { appCheck, appCheckModule } = await getFirebaseClient();
    const result = await appCheckModule.getToken(appCheck, forceRefresh);
    if (!result?.token) throw new Error('Firebase App Check tidak menghasilkan token.');
    return result.token;
}

export async function getFirebaseLimitedUseAppCheckToken() {
    const { appCheck, appCheckModule } = await getFirebaseClient();
    const result = await appCheckModule.getLimitedUseToken(appCheck);
    if (!result?.token) throw new Error('Firebase App Check tidak menghasilkan limited-use token.');
    return result.token;
}

export async function signInFirebaseWithGoogle() {
    const { auth, authModule } = await getFirebaseClient();
    const provider = new authModule.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    const result = await authModule.signInWithPopup(auth, provider);
    return result.user;
}

export async function signInFirebaseWithEmail(email, password) {
    const { auth, authModule } = await getFirebaseClient();
    const result = await authModule.signInWithEmailAndPassword(auth, email, password);
    return result.user;
}

export async function getFirebaseIdToken(user, forceRefresh = true) {
    if (!user) throw new Error('Firebase tidak mengembalikan pengguna terautentikasi.');
    return user.getIdToken(forceRefresh);
}

export async function signOutFirebaseClient() {
    if (!firebaseClientPromise) return;
    const { auth, authModule } = await getFirebaseClient();
    await authModule.signOut(auth);
}

export const firebaseClient = {
    getAppCheckToken: getFirebaseAppCheckToken,
    getLimitedUseAppCheckToken: getFirebaseLimitedUseAppCheckToken,
    signInWithGoogle: signInFirebaseWithGoogle,
    signInWithEmail: signInFirebaseWithEmail,
    getIdToken: getFirebaseIdToken,
    signOut: signOutFirebaseClient,
};

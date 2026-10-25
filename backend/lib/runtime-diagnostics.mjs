import { isNativeError } from 'node:util/types';

const types = new Set(['Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError',
    'AggregateError', 'AbortError', 'ValidationError', 'ZodError', 'DatabaseError',
    'DrizzleQueryError', 'MalwareScannerError', 'AppError', 'ServiceUnavailableError']);
const codeReasons = new Map([
    ['ERR_MODULE_NOT_FOUND', 'module_missing'], ['MODULE_NOT_FOUND', 'module_missing'],
    ['ERR_DLOPEN_FAILED', 'native_binding_failed'], ['ERR_UNKNOWN_FILE_EXTENSION', 'module_format_invalid'],
    ['ERR_PACKAGE_PATH_NOT_EXPORTED', 'module_export_invalid'], ['ERR_REQUIRE_ESM', 'module_format_invalid'],
    ['ENOENT', 'file_missing'], ['EACCES', 'file_access_denied'], ['EPERM', 'file_access_denied'],
    ['ETIMEDOUT', 'connection_timeout'], ['ECONNREFUSED', 'connection_refused'],
    ['ECONNRESET', 'connection_reset'], ['ENOTFOUND', 'dns_lookup_failed'], ['EAI_AGAIN', 'dns_lookup_failed'],
    ['ERR_TLS_CERT_ALTNAME_INVALID', 'tls_verification_failed'], ['CERT_HAS_EXPIRED', 'tls_verification_failed'],
    ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'tls_verification_failed'],
    ['28P01', 'database_authentication_failed'], ['28000', 'database_authentication_failed'],
    ['42501', 'database_permission_denied'], ['42P01', 'database_relation_missing'],
    ['42704', 'database_object_missing'], ['42703', 'database_column_missing'],
    ['08000', 'database_connection_failed'], ['08001', 'database_connection_failed'],
    ['08003', 'database_connection_failed'], ['08004', 'database_connection_failed'],
    ['08006', 'database_connection_failed'], ['53300', 'database_capacity_exceeded'],
    ['57P03', 'database_unavailable'], ['57014', 'database_query_cancelled'],
    ['ABORT_ERR', 'operation_aborted'], ['scanner_error', 'scanner_failed'], ['timeout', 'operation_timeout'],
]);
const packages = new Map([
    ['pdfkit', 'missing_pdfkit'], ['exceljs', 'missing_exceljs'], ['pg', 'missing_pg'],
    ['@vercel/functions', 'missing_vercel_functions'], ['@vercel/blob', 'missing_vercel_blob'],
    ['@napi-rs/canvas', 'missing_canvas'], ['@napi-rs/canvas-linux-x64-gnu', 'missing_canvas_binding'],
    ['swagger-jsdoc', 'missing_swagger'], ['swagger-ui-express', 'missing_swagger'],
    ['better-auth', 'missing_better_auth'], ['drizzle-orm', 'missing_drizzle'],
]);
const messageReasons = new Map([
    ...['Invalid Vercel metadata profile', 'Incomplete Vercel metadata profile',
        'Invalid authentication configuration', 'Invalid private Blob connection alias',
        'Explicit HTTPS origin required', 'Canonical HTTPS origin required',
        'Worker target mismatch'].map(message => [message, 'configuration_invalid']),
    ['timeout exceeded when trying to connect', 'database_connect_timeout'],
    ['Connection terminated due to connection timeout', 'database_connect_timeout'],
    ['Invalid worker database role', 'database_role_invalid'],
    ['Missing request handler', 'request_handler_missing'],
    ['Express app module does not export a request handler', 'request_handler_missing'],
    ...['Invalid antivirus asset', 'Invalid antivirus manifest', 'Invalid antivirus manifest identity',
        'Packaged antivirus definition hash mismatch', 'Definition signature authentication failed',
        'Invalid signed definition header', 'Invalid native executable'].map(message => [message, 'native_artifact_invalid']),
    ['Verified engine evidence unavailable', 'native_evidence_unavailable'],
    ['Official antivirus definition update failed', 'native_refresh_failed'],
    ['Antivirus definitions expired during verification', 'native_definitions_expired'],
    ['Unsupported native antivirus runtime', 'native_platform_unsupported'],
    ['Antivirus deadline exhausted', 'native_deadline_exhausted'],
    ['Worker deadline exhausted', 'worker_deadline_exhausted'],
    ['Worker lock connection lost', 'database_lock_connection_lost'],
]);
const sourceMarkers = [
    [/^app\.js$/, 'app'], [/^index\.js$/, 'index'],
    [/^api-runtime(?:-[A-Z0-9]{8})?\.js$/, 'api_runtime'],
    [/^internal-runtime\.js$/, 'internal_runtime'], [/^vercel-runtime\.js$/, 'vercel_runtime'],
    [/^internal-malware-scan-runtime\.js$/, 'malware_runtime'],
    [/^(?:env-[A-Z0-9]{8}|config\/env)\.js$/, 'environment'],
    [/^config\/database\.js$/, 'database'], [/^auth-[A-Z0-9]{8}\.js$/, 'authentication'],
    [/^chunk-[A-Z0-9]{8}\.js$/, 'dist_chunk'],
    [/^(?:workers\/malware-scan-on-demand|malware-scan\.worker-[A-Z0-9]{8})\.js$/, 'malware_worker'],
    [/^workers\/native-clamav-process\.js$/, 'native_process'],
    [/^services\/native-clamav\.service\.js$/, 'native_scanner'],
    [/^services\/native-clamav-definitions\.js$/, 'native_definitions'],
];
const nativeStackGetter = Object.getOwnPropertyDescriptor(new Error(), 'stack')?.get;

// Never call input getters, toString, toJSON, or constructor. Node 24 stores its
// own Error stack in a shared native accessor; only that accessor is permitted.
function field(input, key, inherited = false) {
    if (input === null || typeof input !== 'object') return undefined;
    try {
        let current = input;
        for (let depth = 0; current && depth < (inherited ? 3 : 1); depth++) {
            const descriptor = Object.getOwnPropertyDescriptor(current, key);
            if (descriptor) {
                if (Object.hasOwn(descriptor, 'value')) return descriptor.value;
                if (key === 'stack' && nativeStackGetter && descriptor.get === nativeStackGetter && isNativeError(input)) {
                    return nativeStackGetter.call(input);
                }
                return undefined;
            }
            current = inherited ? Object.getPrototypeOf(current) : null;
        }
    } catch { /* Diagnostics must not replace the original failure. */ }
    return undefined;
}
function textField(input, key, maximum) {
    const value = field(input, key);
    return typeof value === 'string' && value.length <= maximum ? value : undefined;
}
function marker(path) {
    const relative = path.replaceAll('\\', '/').split('/dist-vercel/').at(1);
    if (relative === undefined) return undefined;
    return sourceMarkers.find(([pattern]) => pattern.test(relative))?.[1];
}
function source(input) {
    const stack = textField(input, 'stack', 32768);
    for (const line of stack?.split('\n').slice(0, 40) ?? []) {
        if (!/^\s+at /.test(line)) continue;
        const match = line.match(/([/\\]dist-vercel[/\\][^\s():?#]+):\d+:\d+\)?$/);
        const found = match && marker(match[1]);
        if (found) return found;
    }
    return undefined;
}

/** Static diagnostic labels only; callers supply a static stage/event separately. */
export function runtimeFailureDetails(error) {
    const name = field(error, 'name', true);
    const result = { errorType: typeof name === 'string' && types.has(name) ? name : 'Error' };
    let current = error;
    for (let depth = 0; current && depth < 3; depth++) {
        const code = field(current, 'code');
        const message = textField(current, 'message', 16384);
        if (!result.source) result.source = source(current);
        if (!result.errorCode && typeof code === 'string' && codeReasons.has(code)) {
            result.errorCode = code;
            result.reason = codeReasons.get(code);
            if (result.reason === 'module_missing' && message) {
                const match = message.match(/^Cannot find (?:package|module) ['"]([^'"\r\n]+)['"](?: imported from |\r?\n|$)/);
                if (match) {
                    result.reason = packages.get(match[1]) ?? result.reason;
                    result.source ??= marker(match[1]);
                }
            }
        }
        if (!result.reason && message) {
            result.reason = messageReasons.get(message);
            if (!result.reason && /^Cannot find native binding(?:\.|$)/.test(message)) result.reason = 'native_binding_failed';
            if (!result.reason && /^(?:Missing required environment variables: |Invalid malware scanner configuration: )/.test(message)) result.reason = 'configuration_invalid';
        }
        current = field(current, 'cause');
    }
    if (!result.reason && ['ZodError', 'ValidationError'].includes(result.errorType)) result.reason = 'validation_failed';
    // Omit absent fields so all serialized values are finite, known labels.
    return Object.fromEntries(Object.entries(result).filter(([, value]) => value !== undefined));
}

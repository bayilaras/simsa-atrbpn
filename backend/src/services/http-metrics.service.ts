// Fixed API groups keep identifiers and query strings out of telemetry and bound
// its memory footprint, including for arbitrary URLs and unsupported methods.
const GROUPS = new Set([
    'auth', 'dashboard', 'surat-masuk', 'surat-keluar', 'arsip',
    'bulk-upload', 'files', 'upload', 'operations',
]);
const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
export const LATENCY_BUCKETS_MS = [5, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

export function httpMetricGroup(path: string): string {
    if (path === '/health' || path === '/ready' || path === '/api/health') return 'health';
    if (path.startsWith('/api/')) {
        const group = path.split('/')[2];
        return GROUPS.has(group) ? `/api/${group}` : 'other-api';
    }
    return 'frontend';
}

export class HttpMetrics {
    private startedAt = new Date().toISOString();
    private activeRequests = 0;
    private series = new Map<string, {
        group: string; method: string; count: number; aborted: number;
        statuses: number[]; latencyBuckets: number[];
    }>();

    start(path: string, rawMethod: string) {
        const group = httpMetricGroup(path);
        const method = METHODS.has(rawMethod) ? rawMethod : 'OTHER';
        const key = `${group}:${method}`;
        this.activeRequests += 1;
        let ended = false;
        return {
            group, method,
            finish: (status: number, durationMs: number, aborted = false) => {
                if (ended) return;
                ended = true;
                this.activeRequests -= 1;
                const metric = this.series.get(key) || {
                    group, method, count: 0, aborted: 0,
                    statuses: [0, 0, 0, 0, 0],
                    latencyBuckets: Array(LATENCY_BUCKETS_MS.length + 1).fill(0),
                };
                metric.count += 1;
                if (aborted) metric.aborted += 1;
                else metric.statuses[Math.min(4, Math.max(0, Math.floor(status / 100) - 1))] += 1;
                const duration = Math.max(0, durationMs);
                const bucket = LATENCY_BUCKETS_MS.findIndex(bound => duration <= bound);
                metric.latencyBuckets[bucket < 0 ? LATENCY_BUCKETS_MS.length : bucket] += 1;
                this.series.set(key, metric);
            },
        };
    }

    snapshot() {
        return {
            scope: 'current_process_since_start',
            startedAt: this.startedAt,
            activeRequests: this.activeRequests,
            requests: [...this.series.values()].map(metric => {
                let cumulative = 0;
                return {
                    group: metric.group, method: metric.method,
                    count: metric.count, aborted: metric.aborted,
                    statusClasses: Object.fromEntries(metric.statuses.map((count, index) => [`${index + 1}xx`, count])),
                    latencyMs: metric.latencyBuckets.map((count, index) => ({
                        upperBound: LATENCY_BUCKETS_MS[index] ?? null,
                        count: (cumulative += count),
                    })),
                };
            }),
        };
    }
}

export const httpMetrics = new HttpMetrics();

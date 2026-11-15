import { isIP } from 'node:net';
import type { Request } from 'express';

const INTERNAL_IP_HEADER = 'x-simsa-client-ip';
export const betterAuthIpOptions = {
    ipAddressHeaders: [INTERNAL_IP_HEADER],
    // Match express-rate-limit's default IPv6 network quota.
    ipv6Subnet: 56,
};

/** The client address prepareBetterAuthClientIp handed to Better Auth, if any. */
export function betterAuthClientIp(headers: Headers | null | undefined): string | undefined {
    const address = headers?.get(INTERNAL_IP_HEADER);
    return address && isIP(address) ? address : undefined;
}

/** Replace any caller-supplied value with Express's trusted-proxy resolution. */
export function prepareBetterAuthClientIp(req: Request): void {
    delete req.headers[INTERNAL_IP_HEADER];
    if (req.ip && isIP(req.ip)) req.headers[INTERNAL_IP_HEADER] = req.ip;
    // An unavailable/invalid address must keep Better Auth's closed shared
    // fallback; never fall back to reading a caller's raw forwarded chain.
}

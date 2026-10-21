import net from 'node:net';

/**
 * Loopback TCP proxy that delays every chunk by a fixed one-way latency in each
 * direction, preserving order. A PostgreSQL round trip through it therefore
 * costs about 2 × oneWayMs, which models a remote database (for example a
 * function in iad1 talking to Neon in ap-southeast-1) on a local cluster.
 */
export async function startLatencyProxy(target: { host: string; port: number }, oneWayMs: number) {
    const sockets = new Set<net.Socket>();
    const relay = (from: net.Socket, to: net.Socket) => {
        const queue: { due: number; chunk: Buffer }[] = [];
        let timer: NodeJS.Timeout | undefined;
        const drain = () => {
            timer = undefined;
            while (queue.length && queue[0].due <= Date.now()) {
                const { chunk } = queue.shift()!;
                if (!to.destroyed) to.write(chunk);
            }
            if (queue.length) timer = setTimeout(drain, queue[0].due - Date.now());
        };
        from.on('data', chunk => {
            queue.push({ due: Date.now() + oneWayMs, chunk });
            if (!timer) timer = setTimeout(drain, oneWayMs);
        });
    };
    const server = net.createServer(client => {
        const upstream = net.connect(target.port, target.host);
        sockets.add(client); sockets.add(upstream);
        const close = () => { client.destroy(); upstream.destroy(); sockets.delete(client); sockets.delete(upstream); };
        for (const socket of [client, upstream]) { socket.on('error', close); socket.on('close', close); }
        relay(client, upstream); relay(upstream, client);
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    return {
        port: (server.address() as net.AddressInfo).port,
        async close() {
            for (const socket of sockets) socket.destroy();
            await new Promise<void>(resolve => server.close(() => resolve()));
        },
    };
}

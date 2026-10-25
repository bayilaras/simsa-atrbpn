// Deliberately block the main event loop after the independent guard is ready.
// An IPC disconnect handler on this thread cannot run once the loop starts.
process.once('disconnect', () => process.exit(1));
process.once('message', async ({ guard, maxLifetimeMs, pollIntervalMs }) => {
    const { startChildLifetimeGuard } = await import(guard);
    await startChildLifetimeGuard({ maxLifetimeMs, pollIntervalMs });
    process.send?.({ type: 'ready' }, () => { for (;;) Math.sqrt(Math.random()); });
});

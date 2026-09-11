// Real child-process fixture: consume the bounded PDF input, then occupy one
// CPU until the owning test/service terminates this exact child.
process.stdin.resume();
process.stdin.once('end', () => {
    process.stdout.write('READY\n', () => {
        for (;;) Math.sqrt(Math.random());
    });
});

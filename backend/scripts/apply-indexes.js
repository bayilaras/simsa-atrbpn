require('dotenv').config();
const postgres = require('postgres');
const fs = require('fs');

async function applyIndexes() {
    const sql = postgres(process.env.DATABASE_URL);

    try {
        // First check which tables exist
        const tables = await sql`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`;
        console.log('Existing tables:', tables.map(t => t.tablename).join(', '));

        // Read the migration
        const migration = fs.readFileSync('src/db/migrations/add_indexes.sql', 'utf8');

        // Remove comment lines and split by semicolons
        const cleaned = migration
            .split('\n')
            .filter(line => !line.trim().startsWith('--'))
            .join('\n');

        const statements = cleaned
            .split(';')
            .map(s => s.trim())
            .filter(s => s.length > 0);

        console.log(`\nFound ${statements.length} index statements to apply\n`);

        let success = 0;
        let skipped = 0;
        let errors = [];

        for (const stmt of statements) {
            try {
                await sql.unsafe(stmt);
                success++;
                // Extract index name from statement
                const match = stmt.match(/idx_\w+/);
                if (match) console.log(`  OK: ${match[0]}`);
            } catch (e) {
                if (e.message.includes('does not exist')) {
                    skipped++;
                    const match = stmt.match(/idx_\w+/);
                    console.log(`  SKIP (table missing): ${match ? match[0] : stmt.substring(0, 60)}`);
                } else if (e.message.includes('already exists')) {
                    skipped++;
                    const match = stmt.match(/idx_\w+/);
                    console.log(`  SKIP (exists): ${match ? match[0] : stmt.substring(0, 60)}`);
                } else {
                    errors.push({ stmt: stmt.substring(0, 80), error: e.message });
                    console.error(`  ERROR: ${e.message}`);
                }
            }
        }

        console.log('\n=== SUMMARY ===');
        console.log(`Created: ${success} indexes`);
        console.log(`Skipped: ${skipped} (table missing or already exists)`);
        console.log(`Errors: ${errors.length}`);

        if (errors.length > 0) {
            console.log('\nErrors:');
            errors.forEach(e => console.log(`  - ${e.error}: ${e.stmt}`));
        }

    } catch (e) {
        console.error('Fatal error:', e.message);
    } finally {
        await sql.end({ timeout: 5 });
    }
}

applyIndexes();

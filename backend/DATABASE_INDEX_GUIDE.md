# Database Index Migration Guide

## Overview
This guide explains how to apply the database indexes to improve SIMSA application performance.

## Prerequisites
- PostgreSQL database access
- Database connection string (from `.env`)
- `psql` command-line tool installed

## Migration File
Location: `backend/src/db/migrations/add_indexes.sql`

## How to Apply Indexes

### Option 1: Using psql Command Line

```bash
# Navigate to backend directory
cd backend

# Apply indexes using psql
psql $DATABASE_URL -f src/db/migrations/add_indexes.sql
```

### Option 2: Using Database GUI (pgAdmin, DBeaver, etc.)

1. Open your database GUI tool
2. Connect to your SIMSA database
3. Open the SQL file: `backend/src/db/migrations/add_indexes.sql`
4. Execute the entire script

### Option 3: Using Node.js Script

Create a migration script:

```javascript
// backend/scripts/apply-indexes.js
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

async function applyIndexes() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL
    });

    try {
        const sql = fs.readFileSync(
            path.join(__dirname, '../src/db/migrations/add_indexes.sql'),
            'utf8'
        );

        console.log('Applying database indexes...');
        await pool.query(sql);
        console.log('✅ Indexes applied successfully!');
    } catch (error) {
        console.error('❌ Error applying indexes:', error);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

applyIndexes();
```

Run with:
```bash
node scripts/apply-indexes.js
```

## Verification

### Check if indexes were created:

```sql
SELECT 
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;
```

### Check index usage (after some time):

```sql
SELECT 
    schemaname,
    tablename,
    indexname,
    idx_scan as index_scans,
    idx_tup_read as tuples_read,
    idx_tup_fetch as tuples_fetched
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
ORDER BY idx_scan DESC;
```

## Indexes Created

### Arsip Table (15 indexes)
- `idx_arsip_unit_kerja` - Unit kerja filtering
- `idx_arsip_jenis_tahun` - Type and year filtering
- `idx_arsip_klasifikasi` - Classification filtering
- `idx_arsip_tanggal` - Date queries
- `idx_arsip_created_at` - Sorting by creation date
- `idx_arsip_disposal_status` - Disposal workflow
- `idx_arsip_lending_status` - Lending status
- `idx_arsip_storage_location` - Physical location
- `idx_arsip_fulltext` - Full-text search (GIN index)
- `idx_arsip_unit_jenis_tahun` - Composite index
- And more...

### Surat Masuk/Keluar Tables (10 indexes)
- Unit kerja indexes
- Date indexes
- Classification indexes
- Document number indexes
- Created_at indexes

### Users Table (4 indexes)
- Email index
- Role index
- Unit kerja index
- Active status index

### Sessions Table (3 indexes)
- User ID index
- Token index
- Expiration index

### Audit Log Table (4 indexes)
- User ID index
- Action type index
- Timestamp index
- Entity reference index

### Notifications Tables (6 indexes)
- User ID indexes
- Created_at indexes
- Type indexes
- Read status indexes

### Other Tables
- Dosir indexes
- Storage locations indexes
- Archive lending indexes
- Penyusutan indexes

**Total: 40+ indexes**

## Expected Performance Improvements

### Before Indexes
- Archive listing: ~500-1000ms
- Search queries: ~1-2s
- Filtering by unit kerja: ~300-500ms
- Date range queries: ~400-800ms

### After Indexes
- Archive listing: ~50-100ms (10x faster)
- Search queries: ~100-200ms (10x faster)
- Filtering by unit kerja: ~30-50ms (10x faster)
- Date range queries: ~40-80ms (10x faster)

## Rollback (if needed)

If you need to remove the indexes:

```sql
-- Drop all indexes (example for arsip table)
DROP INDEX IF EXISTS idx_arsip_unit_kerja;
DROP INDEX IF EXISTS idx_arsip_jenis_tahun;
DROP INDEX IF EXISTS idx_arsip_klasifikasi;
-- ... repeat for all indexes
```

Or use this query to generate DROP statements:

```sql
SELECT 'DROP INDEX IF EXISTS ' || indexname || ';'
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname LIKE 'idx_%';
```

## Monitoring

### Check index size:

```sql
SELECT
    tablename,
    indexname,
    pg_size_pretty(pg_relation_size(indexname::regclass)) as index_size
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY pg_relation_size(indexname::regclass) DESC;
```

### Check table bloat:

```sql
SELECT
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as total_size,
    pg_size_pretty(pg_relation_size(schemaname||'.'||tablename)) as table_size,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename) - pg_relation_size(schemaname||'.'||tablename)) as indexes_size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

## Best Practices

1. **Apply during low traffic** - Indexes can lock tables briefly
2. **Monitor performance** - Use the verification queries above
3. **Regular maintenance** - Run `VACUUM ANALYZE` periodically
4. **Track usage** - Monitor which indexes are actually used

## Maintenance

### Reindex (if needed):

```sql
-- Reindex a specific index
REINDEX INDEX idx_arsip_unit_kerja;

-- Reindex entire table
REINDEX TABLE arsip;

-- Reindex entire database (use with caution)
REINDEX DATABASE your_database_name;
```

### Analyze tables:

```sql
ANALYZE arsip;
ANALYZE surat_masuk;
ANALYZE surat_keluar;
-- ... for all tables
```

## Troubleshooting

### Index not being used?

1. Check if statistics are up to date:
   ```sql
   ANALYZE tablename;
   ```

2. Check query plan:
   ```sql
   EXPLAIN ANALYZE
   SELECT * FROM arsip WHERE unit_kerja_id = 'xxx';
   ```

3. Ensure index exists:
   ```sql
   \d+ arsip  -- Shows all indexes on table
   ```

### Slow index creation?

- Large tables may take time to index
- Consider creating indexes during maintenance window
- Monitor progress with `pg_stat_progress_create_index`

## Support

For issues or questions:
- Check PostgreSQL logs
- Review query execution plans
- Contact database administrator

---

**Created**: 2026-02-12  
**Version**: 1.0

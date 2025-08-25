import db from '../dist/db.js';

async function fixUnicodeSchema() {
  try {
    console.log('Fixing database schema for Unicode support...\n');
    
    const pool = await db.poolPromise;
    
    // Check current data count
    console.log('1. Checking current data...');
    const countResult = await pool.request().query('SELECT COUNT(*) as TotalEntries FROM VocabEntries');
    console.log(`   Found ${countResult.recordset[0].TotalEntries} entries`);
    
    // Convert entryKey to NVARCHAR(MAX)
    console.log('2. Converting entryKey column to NVARCHAR(MAX)...');
    await pool.request().query('ALTER TABLE VocabEntries ALTER COLUMN entryKey NVARCHAR(MAX) NOT NULL');
    console.log('   ✅ entryKey column updated');
    
    // Convert entryValue to NVARCHAR(MAX)
    console.log('3. Converting entryValue column to NVARCHAR(MAX)...');
    await pool.request().query('ALTER TABLE VocabEntries ALTER COLUMN entryValue NVARCHAR(MAX) NOT NULL');
    console.log('   ✅ entryValue column updated');
    
    // Verify the schema change
    console.log('4. Verifying schema changes...');
    const schemaResult = await pool.request().query(`
      SELECT 
        COLUMN_NAME,
        DATA_TYPE,
        CHARACTER_MAXIMUM_LENGTH,
        IS_NULLABLE
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_NAME = 'VocabEntries' 
      AND COLUMN_NAME IN ('entryKey', 'entryValue')
      ORDER BY ORDINAL_POSITION
    `);
    
    console.log('   Updated schema:');
    schemaResult.recordset.forEach(col => {
      console.log(`   ${col.COLUMN_NAME}: ${col.DATA_TYPE}(${col.CHARACTER_MAXIMUM_LENGTH || 'MAX'})`);
    });
    
    console.log('\n✅ Schema update completed successfully!');
    console.log('⚠️  Note: Existing data with question marks will need to be re-imported with correct encoding.');
    
  } catch (error) {
    console.error('❌ Error fixing schema:', error);
    throw error;
  }
}

fixUnicodeSchema().then(() => {
  console.log('\nUnicode fix completed.');
  process.exit(0);
}).catch(error => {
  console.error('Unicode fix failed:', error);
  process.exit(1);
});

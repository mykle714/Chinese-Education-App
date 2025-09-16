import sql from 'mssql';
import fs from 'fs';
import path from 'path';

// Azure SQL Database configuration
// NOTE: This script requires environment variables to be set:
// DB_SERVER, DB_NAME, CLIENT_ID, CLIENT_SECRET, TENANT_ID
const azureConfig = {
  server: process.env.DB_SERVER || 'your-server.database.windows.net',
  database: process.env.DB_NAME || 'your-database',
  authentication: {
    type: 'azure-active-directory-service-principal-secret',
    options: {
      clientId: process.env.CLIENT_ID || 'your-client-id',
      clientSecret: process.env.CLIENT_SECRET || 'your-client-secret',
      tenantId: process.env.TENANT_ID || 'your-tenant-id'
    }
  },
  options: {
    encrypt: true,
    trustServerCertificate: false,
    enableArithAbort: true
  }
};

async function exportData() {
  let pool;
  
  try {
    console.log('🔄 Connecting to Azure SQL Database...');
    pool = new sql.ConnectionPool(azureConfig);
    await pool.connect();
    console.log('✅ Connected to Azure SQL Database');

    // Create export directory
    const exportDir = path.join(process.cwd(), '..', 'database', 'exports');
    if (!fs.existsSync(exportDir)) {
      fs.mkdirSync(exportDir, { recursive: true });
    }

    // Export Users table
    console.log('🔄 Exporting Users table...');
    const usersResult = await pool.request().query('SELECT * FROM Users ORDER BY createdAt');
    const usersData = {
      tableName: 'Users',
      exportDate: new Date().toISOString(),
      totalRecords: usersResult.recordset.length,
      data: usersResult.recordset
    };
    
    fs.writeFileSync(
      path.join(exportDir, 'users_export.json'),
      JSON.stringify(usersData, null, 2),
      'utf8'
    );
    console.log(`✅ Exported ${usersData.totalRecords} users to users_export.json`);

    // Export VocabEntries table
    console.log('🔄 Exporting VocabEntries table...');
    const vocabResult = await pool.request().query('SELECT * FROM VocabEntries ORDER BY createdAt');
    const vocabData = {
      tableName: 'VocabEntries',
      exportDate: new Date().toISOString(),
      totalRecords: vocabResult.recordset.length,
      data: vocabResult.recordset
    };
    
    fs.writeFileSync(
      path.join(exportDir, 'vocabentries_export.json'),
      JSON.stringify(vocabData, null, 2),
      'utf8'
    );
    console.log(`✅ Exported ${vocabData.totalRecords} vocabulary entries to vocabentries_export.json`);

    // Export OnDeckVocabSets table (if exists)
    console.log('🔄 Checking for OnDeckVocabSets table...');
    try {
      const onDeckResult = await pool.request().query('SELECT * FROM OnDeckVocabSets ORDER BY updatedAt');
      const onDeckData = {
        tableName: 'OnDeckVocabSets',
        exportDate: new Date().toISOString(),
        totalRecords: onDeckResult.recordset.length,
        data: onDeckResult.recordset
      };
      
      fs.writeFileSync(
        path.join(exportDir, 'ondeckvocabsets_export.json'),
        JSON.stringify(onDeckData, null, 2),
        'utf8'
      );
      console.log(`✅ Exported ${onDeckData.totalRecords} on-deck vocab sets to ondeckvocabsets_export.json`);
    } catch (error) {
      console.log('ℹ️  OnDeckVocabSets table not found or empty - skipping');
    }

    // Create summary report
    const summary = {
      exportDate: new Date().toISOString(),
      sourceDatabase: 'Azure SQL Database (cow-db)',
      targetDatabase: 'PostgreSQL (cow_db)',
      tables: {
        users: usersData.totalRecords,
        vocabentries: vocabData.totalRecords,
        ondeckvocabsets: 0 // Will be updated if table exists
      },
      exportLocation: exportDir,
      nextSteps: [
        'Run import-data.js to import data into PostgreSQL',
        'Verify data integrity after import',
        'Test application functionality'
      ]
    };

    fs.writeFileSync(
      path.join(exportDir, 'export_summary.json'),
      JSON.stringify(summary, null, 2),
      'utf8'
    );

    console.log('\n🎉 Data export completed successfully!');
    console.log(`📁 Export location: ${exportDir}`);
    console.log(`📊 Total records exported: ${usersData.totalRecords + vocabData.totalRecords}`);
    console.log('\n📋 Next steps:');
    console.log('1. Run: node import-data.js');
    console.log('2. Test application functionality');
    console.log('3. Verify multi-language support');

  } catch (error) {
    console.error('❌ Export failed:', error.message);
    console.error('Full error:', error);
    process.exit(1);
  } finally {
    if (pool) {
      await pool.close();
      console.log('🔌 Disconnected from Azure SQL Database');
    }
  }
}

// Run the export
exportData();

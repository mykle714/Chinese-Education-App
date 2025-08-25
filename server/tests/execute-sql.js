 // Script to execute SQL queries against the database
import fs from 'fs';
import path from 'path';
import db from '../db.js';

// SQL file to execute
const SQL_FILE = process.argv[2] || 'update-password-hash.sql';

async function executeSql() {
  try {
    console.log(`Reading SQL file: ${SQL_FILE}`);
    const sqlPath = path.join(process.cwd(), SQL_FILE);
    const sqlContent = fs.readFileSync(sqlPath, 'utf8');
    
    // Split the SQL content into individual queries
    const queries = sqlContent
      .split(';')
      .map(query => query.trim())
      .filter(query => query.length > 0);
    
    console.log(`Found ${queries.length} queries to execute`);
    
    // Connect to the database
    console.log('Connecting to database...');
    const pool = await db.poolPromise;
    console.log('Connected to database');
    
    // Execute each query
    for (let i = 0; i < queries.length; i++) {
      const query = queries[i];
      console.log(`\nExecuting query ${i + 1}/${queries.length}:`);
      console.log(query);
      
      const result = await pool.request().query(query);
      
      if (result.recordset) {
        console.log(`\nQuery result (${result.recordset.length} rows):`);
        console.table(result.recordset);
      } else {
        console.log(`\nQuery executed successfully. Rows affected: ${result.rowsAffected[0]}`);
      }
    }
    
    console.log('\nAll queries executed successfully');
    
  } catch (err) {
    console.error('Error executing SQL:', err);
  }
}

// Run the function
executeSql();

// Script to check if the password column exists in the Users table
import sql from 'mssql';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Database configuration
const config = {
  server: process.env.DB_SERVER,
  database: process.env.DB_NAME,
  authentication: {
    type: 'azure-active-directory-service-principal-secret',
    options: {
      clientId: process.env.CLIENT_ID,
      clientSecret: process.env.CLIENT_SECRET,
      tenantId: process.env.TENANT_ID
    }
  },
  options: {
    encrypt: true,
    trustServerCertificate: false
  }
};

async function checkPasswordColumn() {
  try {
    console.log('Connecting to database...');
    const pool = await sql.connect(config);
    console.log('Connected to database');
    
    // Check if the password column exists
    console.log('Checking if password column exists...');
    const columnResult = await pool.request()
      .query(`
        SELECT COLUMN_NAME, DATA_TYPE 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_NAME = 'Users' 
        AND COLUMN_NAME = 'password'
      `);
    
    if (columnResult.recordset.length === 0) {
      console.log('❌ Password column does not exist in Users table');
    } else {
      console.log('✅ Password column exists in Users table');
      console.log(`   Data type: ${columnResult.recordset[0].DATA_TYPE}`);
      
      // Check if any users have passwords set
      const usersResult = await pool.request()
        .query(`
          SELECT id, email, name, 
            CASE 
              WHEN password IS NULL THEN 'No password set'
              ELSE 'Password has been set'
            END AS password_status
          FROM Users
        `);
      
      console.log(`\nFound ${usersResult.recordset.length} users:`);
      console.table(usersResult.recordset.map(user => ({
        email: user.email,
        name: user.name,
        password_status: user.password_status
      })));
      
      // Count users with and without passwords
      const countResult = await pool.request()
        .query(`
          SELECT 
            SUM(CASE WHEN password IS NULL THEN 1 ELSE 0 END) AS users_without_password,
            SUM(CASE WHEN password IS NOT NULL THEN 1 ELSE 0 END) AS users_with_password
          FROM Users
        `);
      
      const counts = countResult.recordset[0];
      console.log(`\nUsers without password: ${counts.users_without_password}`);
      console.log(`Users with password: ${counts.users_with_password}`);
    }
    
    // Close the connection
    await pool.close();
    console.log('\nDatabase connection closed');
    
  } catch (err) {
    console.error('Error checking password column:', err);
  }
}

// Run the function
checkPasswordColumn();

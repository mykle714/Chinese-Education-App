// Script to update user passwords in the database
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

// The new password hash for "Password123"
const NEW_PASSWORD_HASH = '$2b$10$1WyjhA9ZvWQJ41XCsSfvveysrjlbzm.x3FgAUFLXz00upTtfaL/fW';

async function updatePasswords() {
  try {
    console.log('Connecting to database...');
    const pool = await sql.connect(config);
    console.log('Connected to database');
    
    // Update all users with the new password hash
    console.log('Updating user passwords...');
    const updateResult = await pool.request()
      .input('password', sql.NVarChar, NEW_PASSWORD_HASH)
      .query('UPDATE Users SET password = @password');
    
    console.log(`Updated ${updateResult.rowsAffected[0]} users with new password hash`);
    
    // Verify the update
    console.log('\nVerifying update...');
    const verifyResult = await pool.request()
      .query(`
        SELECT id, email, name, 
          CASE 
            WHEN password IS NULL THEN 'No password set'
            ELSE 'Password has been set'
          END AS password_status
        FROM Users
      `);
    
    console.log(`\nFound ${verifyResult.recordset.length} users:`);
    console.table(verifyResult.recordset.map(user => ({
      email: user.email,
      name: user.name,
      password_status: user.password_status
    })));
    
    // Close the connection
    await pool.close();
    console.log('\nDatabase connection closed');
    
  } catch (err) {
    console.error('Error updating passwords:', err);
  }
}

// Run the function
updatePasswords();

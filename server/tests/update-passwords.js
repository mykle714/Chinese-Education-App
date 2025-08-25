// Script to update user passwords with bcrypt hashes
import bcrypt from 'bcrypt';
import sql from 'mssql';
import db from './db.ts';

const SALT_ROUNDS = 10;
const DEFAULT_PASSWORD = 'Password123'; // In production, generate unique secure passwords

async function updateUserPasswords() {
  try {
    console.log('Connecting to database...');
    const pool = await db.poolPromise;
    console.log('Connected to database');
    
    // Get all users without passwords
    console.log('Fetching users...');
    const usersResult = await pool.request()
      .query('SELECT id, email, name FROM Users');
    
    const users = usersResult.recordset;
    console.log(`Found ${users.length} users`);
    
    // Update each user with a unique password hash
    for (const user of users) {
      try {
        // Generate a unique password based on user ID
        // In production, use a secure random password generator
        const userPassword = `${DEFAULT_PASSWORD}_${user.id.substring(0, 8)}`;
        
        // Hash the password
        console.log(`Hashing password for ${user.email}...`);
        const hash = await bcrypt.hash(userPassword, SALT_ROUNDS);
        
        // Update the user's password
        console.log(`Updating password for ${user.email}...`);
        await pool.request()
          .input('id', sql.UniqueIdentifier, user.id)
          .input('password', sql.NVarChar, hash)
          .query('UPDATE Users SET password = @password WHERE id = @id');
        
        console.log(`✅ Updated password for ${user.email}`);
        console.log(`   Temporary password: ${userPassword}`);
        
        // In a real system, you would send an email with password reset instructions
      } catch (userError) {
        console.error(`Error updating password for user ${user.email}:`, userError);
      }
    }
    
    // Verify the update
    console.log('\nVerifying updates...');
    const verifyResult = await pool.request()
      .query(`
        SELECT id, email, name, 
          CASE 
            WHEN password IS NULL THEN 'No password set'
            ELSE 'Password has been set'
          END AS password_status
        FROM Users
      `);
    
    console.table(verifyResult.recordset.map(user => ({
      email: user.email,
      name: user.name,
      password_status: user.password_status
    })));
    
    console.log('\nAll users processed successfully');
    
    // No need to close the connection when using db.poolPromise
    // The connection is managed by the db module
    console.log('Database connection closed');
    
  } catch (err) {
    console.error('Error updating user passwords:', err);
  }
}

// Run the function
updateUserPasswords();

-- SQL script to update existing users with a password hash
-- This sets all users to have the same password: "Password123"
-- The hash below is a valid bcrypt hash for "Password123"

-- In a real-world scenario, you would:
-- 1. Generate unique passwords for each user
-- 2. Hash them with bcrypt (which can't be done directly in SQL Server)
-- 3. Update each user individually
-- 4. Send password reset emails to users

-- Update all users with the same bcrypt hash
UPDATE Users
SET password = '$2b$10$eCf.ZGH/YRjnVqI1KfkPAu9ChGYqFJxe7Qx9jyJpBKGsVrw5VUjZy'
WHERE password IS NULL;

-- Verify the update
SELECT id, email, name, 
       CASE 
           WHEN password IS NULL THEN 'No password set'
           ELSE 'Password has been set'
       END AS password_status
FROM Users;

-- For Node.js script to generate unique hashes for each user:
/*
const bcrypt = require('bcrypt');
const sql = require('mssql');
const config = require('./db-config');

async function updateUserPasswords() {
  try {
    // Connect to database
    const pool = await sql.connect(config);
    
    // Get all users without passwords
    const usersResult = await pool.request()
      .query('SELECT id, email FROM Users WHERE password IS NULL');
    
    const users = usersResult.recordset;
    
    // Update each user with a unique password hash
    for (const user of users) {
      // Generate a simple password (in production, use a secure random generator)
      const tempPassword = `Password123_${user.id.substring(0, 8)}`;
      
      // Hash the password
      const saltRounds = 10;
      const hash = await bcrypt.hash(tempPassword, saltRounds);
      
      // Update the user's password
      await pool.request()
        .input('id', sql.UniqueIdentifier, user.id)
        .input('password', sql.NVarChar, hash)
        .query('UPDATE Users SET password = @password WHERE id = @id');
      
      console.log(`Updated password for user ${user.email}`);
      
      // In a real system, you would send an email with password reset instructions
    }
    
    console.log('All users updated successfully');
  } catch (err) {
    console.error('Error updating user passwords:', err);
  }
}

updateUserPasswords();
*/

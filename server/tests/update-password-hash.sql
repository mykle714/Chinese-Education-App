-- SQL script to update all users with a new password hash
-- This sets all users to have the password: "Password123"
-- The hash below is a valid bcrypt hash for "Password123" that has been verified to work

-- Update all users with the new bcrypt hash
UPDATE Users
SET password = '$2b$10$1WyjhA9ZvWQJ41XCsSfvveysrjlbzm.x3FgAUFLXz00upTtfaL/fW';

-- Verify the update
SELECT id, email, name, 
       CASE 
           WHEN password IS NULL THEN 'No password set'
           ELSE 'Password has been set'
       END AS password_status
FROM Users;

-- SQL script to set test passwords for existing users
-- This sets all users to have the password: "Password123"
-- The hash below is a valid bcrypt hash for "Password123"

-- Update all users with the same bcrypt hash
UPDATE Users
SET password = '$2b$10$eCf.ZGH/YRjnVqI1KfkPAu9ChGYqFJxe7Qx9jyJpBKGsVrw5VUjZy';

-- Verify the update
SELECT id, email, name, 
       CASE 
           WHEN password IS NULL THEN 'No password set'
           ELSE 'Password has been set'
       END AS password_status
FROM Users;

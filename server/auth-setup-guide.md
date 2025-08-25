# Authentication Setup Guide

This guide explains how to set up and test the authentication system for the Vocabulary Manager application.

## Database Setup

Before users can log in, you need to update the database schema and add password hashes for existing users.

### 1. Update Database Schema

First, run the SQL script to add the password column to the Users table:

```bash
# Connect to your Azure SQL Database and run:
# server/update-users-table.sql
```

This script adds a `password` column to the Users table if it doesn't already exist.

### 2. Add Password Hashes for Existing Users

You have two options to add password hashes for existing users:

#### Option 1: Using SQL Script (All users get the same password)

```bash
# Connect to your Azure SQL Database and run:
# server/update-user-passwords.sql
```

This sets all users to have the same password: `Password123`

#### Option 2: Using Node.js Script (Each user gets a unique password)

```bash
# Run the Node.js script:
cd server
node update-passwords.js
```

This script:
1. Connects to the database
2. Retrieves all users
3. Generates a unique password for each user based on their ID
4. Hashes the password using bcrypt
5. Updates the user record in the database
6. Outputs the temporary password for each user

The temporary password format is: `Password123_[first 8 chars of user ID]`

## Testing the Login Flow

After setting up the database, you can test the login functionality:

1. Start the server:
   ```bash
   cd server
   npm run build
   npm run start
   ```

2. Start the client:
   ```bash
   # In a new terminal
   npm run dev
   ```

3. Navigate to the login page:
   ```
   http://localhost:5175/login
   ```

4. Log in with a user's email and their temporary password:
   - Email: [user's email from the database]
   - Password: `Password123` (if using SQL script) or `Password123_[first 8 chars of user ID]` (if using Node.js script)

5. After successful login, you should be redirected to the home page and see authenticated content.

## Security Considerations

In a production environment:

1. Use HTTPS for all communications
2. Generate truly random passwords for users
3. Implement a password reset flow
4. Set up email notifications for password changes
5. Implement rate limiting for login attempts
6. Consider adding multi-factor authentication

## Troubleshooting

If you encounter login issues:

1. Check the server logs for error messages
2. Verify the user exists in the database
3. Ensure the password column is properly populated
4. Check that the JWT_SECRET is consistent between server restarts
5. Clear browser cookies and localStorage if you've made changes to the authentication system

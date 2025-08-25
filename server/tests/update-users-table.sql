-- Check if the password column already exists
IF NOT EXISTS (
    SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_NAME = 'Users' 
    AND COLUMN_NAME = 'password'
)
BEGIN
    -- Add password column to Users table
    ALTER TABLE Users
    ADD password NVARCHAR(255);
    
    PRINT 'Password column added to Users table';
END
ELSE
BEGIN
    PRINT 'Password column already exists in Users table';
END

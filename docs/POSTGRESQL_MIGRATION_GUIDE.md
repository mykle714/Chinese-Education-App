# PostgreSQL Migration Guide

## 🎉 Migration Status: COMPLETE

Your application has been successfully migrated from Azure SQL Database to PostgreSQL with Docker. This guide provides all the information you need to use and maintain your new database setup.

## 📋 What Was Completed

### ✅ Database Infrastructure
- **PostgreSQL 15** running in Docker container with full Unicode support
- **Multi-language support** verified for Chinese, Japanese, Korean, Vietnamese
- **Database schema** migrated with proper indexes and constraints
- **Connection pooling** implemented for better performance
- **Backup/restore scripts** created for data management

### ✅ Application Code Migration
- **Dependencies**: Migrated from `mssql` to `pg` (PostgreSQL driver)
- **Database Layer**: Complete DAL (Data Access Layer) migration to PostgreSQL syntax
- **Query Conversion**: All SQL Server queries converted to PostgreSQL syntax
- **Transaction Management**: Updated for PostgreSQL BEGIN/COMMIT/ROLLBACK
- **Error Handling**: PostgreSQL-specific error codes implemented

### ✅ Development Environment
- **Docker Compose**: Local development environment ready
- **Environment Variables**: Updated for PostgreSQL connection
- **Build System**: TypeScript compilation working correctly
- **Server**: Successfully running on port 3001

## 🚀 Quick Start Commands

### Start Database (Local Development)
```bash
# Start PostgreSQL and pgAdmin
docker-compose up -d

# Check status
docker-compose ps

# View logs
docker-compose logs postgres
```

### Start Database (Production Server)
```bash
# Create environment file
echo "POSTGRES_PASSWORD=your_strong_password_here" > .env.prod
echo "PGADMIN_EMAIL=your-email@domain.com" >> .env.prod
echo "PGADMIN_PASSWORD=your_pgadmin_password" >> .env.prod

# Start production database
docker-compose -f docker-compose.prod.yml --env-file .env.prod up -d
```

### Application Commands
```bash
# Build and start server
cd server
npm run build
npm start

# Test database connection
node test-pg-connection.js

# Create database backup
../database/backup.sh

# Restore from backup
../database/restore.sh database/backups/cow_db_backup_20240102_143000.sql
```

## 🔄 Data Migration (Optional)

If you want to migrate your existing data from Azure SQL Database:

### Step 1: Export Data from Azure SQL
```bash
cd server
npm install mssql  # Temporarily install for export
node export-azure-data.js
```

### Step 2: Import Data to PostgreSQL
```bash
node import-data.js
```

### Step 3: Verify Migration
```bash
node test-pg-connection.js
```

## 🗄️ Database Connection Details

### Local Development
- **Host**: localhost
- **Port**: 5432
- **Database**: cow_db
- **Username**: cow_user
- **Password**: cow_password_local

### pgAdmin Web Interface
- **URL**: http://localhost:8080
- **Email**: admin@cow.local
- **Password**: admin123

### Direct Database Access
```bash
# Connect to database directly
docker exec -it cow-postgres-local psql -U cow_user -d cow_db

# Example queries
\dt                                    # List tables
SELECT * FROM users LIMIT 5;          # View users
SELECT * FROM vocabentries LIMIT 5;   # View vocabulary entries
```

## 🏗️ Database Schema

### Tables Created
1. **users** - User accounts with UUID primary keys
2. **vocabentries** - Vocabulary entries with multi-language support
3. **ondeckvocabsets** - Flashcard sets with JSONB storage

### New Multi-Language Columns
- `language` - Language code (zh, ja, ko, vi)
- `script` - Script type (simplified, traditional, hiragana, hangul, latin)

### Indexes for Performance
- Full-text search indexes using `pg_trgm` extension
- Foreign key indexes for relationships
- Language-specific indexes for filtering

## 🔧 Configuration Files

### Environment Variables (.env)
```bash
# PostgreSQL Database credentials (Local Development)
DB_HOST=localhost
DB_PORT=5432
DB_NAME=cow_db
DB_USER=cow_user
DB_PASSWORD=cow_password_local

# Authentication
JWT_SECRET=your_jwt_secret_here
CLIENT_URL=http://localhost:5175
```

### Production Environment (.env.prod)
```bash
# Strong password for production
POSTGRES_PASSWORD=your_very_strong_password_here

# pgAdmin credentials (if using)
PGADMIN_EMAIL=your-email@domain.com
PGADMIN_PASSWORD=your_pgadmin_password
```

## 🧪 Testing Multi-Language Support

### Test Chinese Characters
```sql
INSERT INTO vocabentries (userid, entrykey, entryvalue, language, script) 
VALUES (
  (SELECT id FROM users LIMIT 1),
  '你好世界', 
  'Hello World', 
  'zh', 
  'simplified'
);
```

### Test Japanese Characters
```sql
INSERT INTO vocabentries (userid, entrykey, entryvalue, language, script) 
VALUES (
  (SELECT id FROM users LIMIT 1),
  'こんにちは世界', 
  'Hello World', 
  'ja', 
  'hiragana'
);
```

### Test Korean Characters
```sql
INSERT INTO vocabentries (userid, entrykey, entryvalue, language, script) 
VALUES (
  (SELECT id FROM users LIMIT 1),
  '안녕하세요 세계', 
  'Hello World', 
  'ko', 
  'hangul'
);
```

### Test Vietnamese Characters
```sql
INSERT INTO vocabentries (userid, entrykey, entryvalue, language, script) 
VALUES (
  (SELECT id FROM users LIMIT 1),
  'Xin chào thế giới', 
  'Hello World', 
  'vi', 
  'latin'
);
```

## 🔍 Troubleshooting

### Database Connection Issues
```bash
# Check if containers are running
docker-compose ps

# Check database logs
docker-compose logs postgres

# Test connection manually
docker exec -it cow-postgres-local psql -U cow_user -d cow_db -c "SELECT version();"
```

### Application Issues
```bash
# Check server logs
cd server && npm start

# Test database connection
node test-pg-connection.js

# Rebuild if needed
npm run build
```

### Performance Monitoring
```bash
# Check database performance
docker exec cow-postgres-local psql -U cow_user -d cow_db -c "
SELECT 
  schemaname,
  tablename,
  attname,
  n_distinct,
  correlation
FROM pg_stats 
WHERE tablename IN ('users', 'vocabentries', 'ondeckvocabsets');"
```

## 📊 Key Improvements Over Azure SQL

### 1. **Better Unicode Support**
- Native UTF-8 handling for all Asian languages
- No need for NVARCHAR vs VARCHAR distinctions
- Consistent character counting and string operations

### 2. **Enhanced Performance**
- Connection pooling with automatic retry logic
- Better indexing for multi-language text search
- JSONB support for flexible data structures

### 3. **Cost Efficiency**
- No cloud database costs
- Local development environment
- Full control over database configuration

### 4. **Development Experience**
- Faster local development
- Easy database reset and testing
- Better debugging capabilities

## 🔐 Security Considerations

### Production Deployment
1. **Change default passwords** in production environment
2. **Use strong passwords** for database and pgAdmin
3. **Bind to localhost only** (already configured in prod compose)
4. **Regular backups** using provided scripts
5. **Monitor database logs** for suspicious activity

### Network Security
- Database only accessible from localhost in production
- pgAdmin only accessible from localhost
- Use reverse proxy (nginx) for external access if needed

## 📈 Next Steps

1. **Test your application** thoroughly with the new PostgreSQL backend
2. **Migrate your data** using the provided export/import scripts
3. **Deploy to production** using the production docker-compose file
4. **Set up automated backups** using cron jobs
5. **Monitor performance** and optimize as needed

## 🆘 Support

If you encounter any issues:
1. Check the troubleshooting section above
2. Review the database logs: `docker-compose logs postgres`
3. Test the connection: `node test-pg-connection.js`
4. Verify the schema: Connect to database and run `\dt`

Your PostgreSQL migration is complete and ready for production use! 🎉

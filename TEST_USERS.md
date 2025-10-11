# Test Users Documentation

This document describes all test users that are automatically created when the Docker containers are started.

## Automatic Test User Creation

All test users are created automatically via database initialization scripts in `database/init/` when Docker containers start up. No manual setup is required.

## Available Test Users

### 1. Empty User
- **Email**: `empty@test.com`
- **Password**: `testing123`
- **Vocabulary Entries**: 0
- **Purpose**: Testing empty state UI and new user experience

### 2. Small User
- **Email**: `small@test.com`
- **Password**: `testing123`
- **Vocabulary Entries**: 11 (10 basic + 1 custom)
- **Content**: Basic HSK1-2 vocabulary
- **Purpose**: Testing small dataset functionality

### 3. Large User
- **Email**: `large@test.com`
- **Password**: `testing123`
- **Vocabulary Entries**: 52 (50 varied + 2 custom)
- **Content**: Mixed HSK levels (1-6) with diverse vocabulary
- **Purpose**: Testing performance with larger datasets

### 4. Reader Vocabulary Test User ⭐ NEW
- **Email**: `reader-vocab-test@example.com`
- **Password**: `TestPassword123!`
- **Vocabulary Entries**: 135 words from reader texts
- **Content**: All vocabulary from the three reader documents:
  - **咖啡店的早晨** (Coffee Shop Morning) - 47 words
  - **春节的准备** (Spring Festival Preparation) - 47 words  
  - **公园里的太极** (Tai Chi in the Park) - 41 words
- **Purpose**: Testing reader functionality with authentic text vocabulary

## Reader Vocabulary Details

The Reader Vocabulary Test User contains comprehensive vocabulary extracted from all sample texts in the reader documentation (`data/sample-texts.json`). This includes:

### Text Coverage
1. **Coffee Shop Morning** - Everyday vocabulary about visiting a café
2. **Spring Festival Preparation** - Family and cultural vocabulary for Chinese New Year
3. **Tai Chi in the Park** - Health, exercise, and elderly life vocabulary

### Sample Vocabulary
- 今天 → today
- 咖啡店 → coffee shop
- 春节 → Spring Festival, Chinese New Year
- 太极拳 → Tai Chi
- 市中心 → city center, downtown
- 年夜饭 → New Year's Eve dinner
- 强身健体 → to strengthen the body

## Usage

1. **Start Docker containers**: `docker-compose up`
2. **Wait for initialization**: Database scripts run automatically
3. **Login**: Use any of the test accounts above
4. **Test features**: Each account is designed for different testing scenarios

## Development Notes

- Test users are recreated on every container restart
- The Reader Vocabulary Test User data is synchronized with `data/sample-texts.json`
- Password hashes are pre-generated for consistent authentication
- All accounts use UTF-8 encoding for proper Chinese character support

## Files

- `database/init/02-test-users.sql` - Original 3 test users
- `database/init/03-reader-vocab-test-user.sql` - Reader vocabulary test user
- `server/tests/create-reader-vocab-test-account.js` - Manual creation script (backup)

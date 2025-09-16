# Test Users for Docker Development

This document lists the test users that are automatically created when you start fresh Docker containers.

## Automatic Test User Creation

When you run `docker-compose down -v && docker-compose up --build`, the database initialization scripts automatically create 3 test users with different amounts of vocabulary data for comprehensive testing.

## Test User Credentials

All test users use the same password: **`testing123`**

### 👤 User 1: Empty State Testing
- **Email**: `empty@test.com`
- **Password**: `testing123`
- **Name**: Empty User
- **Vocabulary Cards**: 0 entries
- **Purpose**: Test empty states, onboarding flow, first-time user experience

### 👤 User 2: Small Dataset Testing  
- **Email**: `small@test.com`
- **Password**: `testing123`
- **Name**: Small User
- **Vocabulary Cards**: 11 entries (10 basic + 1 custom)
- **Content**: Basic HSK1-2 vocabulary (你好, 谢谢, 学习, etc.)
- **Purpose**: Test basic functionality, small list rendering, quick flashcard sessions

### 👤 User 3: Large Dataset Testing
- **Email**: `large@test.com`
- **Password**: `testing123`
- **Name**: Large User
- **Vocabulary Cards**: 52 entries (50 varied + 2 custom)
- **Content**: Mixed HSK levels (HSK1-6), variety of Chinese vocabulary
- **Features**: Includes OnDeck vocab sets for testing advanced features
- **Purpose**: Test pagination, performance, longer flashcard sessions

## Testing Scenarios

### Empty State Testing (`empty@test.com`)
- Login and see empty dashboard
- Test "Add your first entry" flows
- Test empty flashcards page
- Test CSV import functionality
- Verify onboarding experience

### Basic Functionality (`small@test.com`)
- Test entry listing with small dataset
- Quick flashcard sessions (10 cards)
- Test CRUD operations on entries
- Verify search functionality with limited data
- Test export functionality

### Performance & Features (`large@test.com`)
- Test pagination with larger dataset
- Longer flashcard sessions (50+ cards)
- Test search and filtering with more data
- Verify OnDeck vocab sets functionality
- Test bulk operations and CSV import
- Performance testing with realistic data volume

## Quick Login Commands

For easy testing, you can use these credentials:

```bash
# Empty state testing
Email: empty@test.com
Password: testing123

# Small dataset testing  
Email: small@test.com
Password: testing123

# Large dataset testing
Email: large@test.com
Password: testing123
```

## Data Reset

To get fresh test data:

```bash
# Reset all containers and data
docker-compose down -v

# Start fresh with clean test users
docker-compose up --build
```

This will recreate all 3 test users with their respective vocabulary data automatically.

## Sample Data Details

### Small User Vocabulary (10 entries)
- Basic greetings: 你好 (Hello), 谢谢 (Thank you), 再见 (Goodbye)
- Essential words: 水 (Water), 吃 (To eat), 喝 (To drink)
- Common verbs: 学习 (To study), 工作 (To work)
- Basic nouns: 朋友 (Friend), 家 (Home)
- Plus 1 custom entry for testing custom tags

### Large User Vocabulary (50 entries)
- Mixed HSK levels (HSK1 through HSK6)
- Variety of topics: emotions, actions, concepts
- Advanced vocabulary: 来源 (Source), 斗争 (Struggle), 转折 (twist)
- Common phrases: 与众不同 (to stand out), 胡言乱语 (yapping)
- Plus 2 custom entries and OnDeck vocab sets

This setup provides comprehensive testing coverage for all features of your vocabulary learning application.

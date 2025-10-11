# Vocabulary Manager Application

A full-stack application for managing 
vocabulary entries with user authentication.

## Features

- User authentication (register, login, logout)
- Protected routes for authenticated users
- User profile management
- CRUD operations for vocabulary entries
- Reading materials interface for Chinese text practice
- Responsive design with Material UI

## Localization Guidelines

### Code Localization Standards
All hardcoded strings in the codebase should be in English to maintain consistency and accessibility for developers. The only Chinese text that should appear in the code is:

1. **Data content** - Actual learning materials (text titles, descriptions, content)
2. **User-generated content** - Vocabulary entries and other user data

### UI/Metadata Translation Requirements
- **Character counts**: Use "chars" or "characters" instead of "字"
- **Date formatting**: Use English locale (`'en-US'`) for date display
- **Interface labels**: All buttons, headers, error messages, and navigation elements should be in English
- **Form labels and placeholders**: All form elements should use English text

### What Should Remain in Chinese
- Text content in data files (sample-texts.json, vocabulary entries)
- User-entered vocabulary terms and definitions
- Reading material titles, descriptions, and content
- Any educational content meant for language learning

This ensures the application interface is accessible to English-speaking developers and users while preserving the Chinese learning content.

## Tech Stack

### Frontend
- React with TypeScript
- React Router for navigation
- Material UI for components
- React Hook Form for form handling
- Zod for form validation

### Backend
- Node.js with Express
- TypeScript
- JWT for authentication
- bcrypt for password hashing
- Azure SQL Database for data storage

## Setup Instructions

**This application uses Docker exclusively for development and deployment. Docker ensures consistent environments, eliminates dependency conflicts, and provides automatic database setup.**

### Prerequisites
- Docker Engine 20.10+
- Docker Compose 2.0+
- Git (for cloning the repository)

### Getting Started

1. **Clone the repository**:
   ```bash
   git clone <repository-url>
   cd <project-directory>
   ```

2. **Start all services**:
   ```bash
   docker-compose up --build
   ```

3. **Access the application**:
   - Frontend: http://localhost:3000
   - Backend API: http://localhost:5000
   - Database: localhost:5432

### Docker Development Environment

The Docker setup provides a complete development environment with:

- **Frontend**: React + Vite with hot reload for instant code changes
- **Backend**: Express + TypeScript API server with hot reload
- **Database**: PostgreSQL with automatic schema initialization
- **Test Data**: Pre-populated with test users and vocabulary entries
- **Volume Mounting**: Code changes reflect immediately without rebuilds
- **Isolated Dependencies**: No need to install Node.js, npm, or PostgreSQL locally

### Docker Commands

```bash
# Start all services (development mode with hot reload)
docker-compose up --build

# Start services in background
docker-compose up -d --build

# View real-time logs from all services
docker-compose logs -f

# View logs from specific service
docker-compose logs -f frontend
docker-compose logs -f backend
docker-compose logs -f database

# Stop all services
docker-compose down

# Stop and remove all containers, networks, and volumes
docker-compose down -v

# Rebuild containers after dependency changes
docker-compose build --no-cache
```

### Database Setup

The database is automatically configured when you start the Docker containers:

- **PostgreSQL Database**: Automatically created with proper schema
- **Test Users**: Pre-populated for immediate testing:
  - `empty@test.com` (0 vocabulary cards)
  - `small@test.com` (11 vocabulary cards) 
  - `large@test.com` (52 vocabulary cards)
- **Test Password**: All test users use password `testing123`
- **Data Persistence**: Database data persists between container restarts
- **Schema Migrations**: Automatically applied on startup

### Development Workflow

1. **Start the application**: `docker-compose up --build`
2. **Make code changes**: Files are automatically synced to containers
3. **View changes**: Frontend and backend automatically reload
4. **Test features**: Use pre-populated test accounts
5. **View logs**: Monitor application behavior in real-time
6. **Stop when done**: `docker-compose down`

### Production Deployment

For production deployment, use the production Docker Compose configuration:

```bash
# Production build and deployment
docker-compose -f docker-compose.prod.yml up --build -d
```

The production setup includes optimized builds, proper environment variables, and production-ready configurations.

## Authentication Flow

1. Users can register with email, name, and password
2. Upon successful registration, users are automatically logged in
3. Authentication is handled via JWT tokens
4. Protected routes require authentication
5. User data is stored securely in the database with hashed passwords

## API Endpoints

### Authentication
- POST `/api/auth/register` - Register a new user
- POST `/api/auth/login` - Login a user
- POST `/api/auth/logout` - Logout a user
- GET `/api/auth/me` - Get current authenticated user

### Users
- GET `/api/users` - Get all users (protected)
- GET `/api/users/:id` - Get user by ID (protected)
- POST `/api/users` - Create a new user (protected, admin only)

### Vocabulary Entries
- GET `/api/vocabEntries` - Get all vocabulary entries (protected)
- GET `/api/vocabEntries/:id` - Get vocabulary entry by ID (protected)
- POST `/api/vocabEntries` - Create a new vocabulary entry (protected)
- PUT `/api/vocabEntries/:id` - Update a vocabulary entry (protected)
- DELETE `/api/vocabEntries/:id` - Delete a vocabulary entry (protected)

## Tag System

The application includes a comprehensive tag system for vocabulary entries:

### Tag Types

1. **isCustomTag** (Boolean)
   - `true`: User-created entries (via UI or CSV import)
   - `false`: Entries from official/standard sources
   - `null`: Legacy entries (backward compatibility)

2. **hskLevelTag** (Enum)
   - Valid values: `HSK1`, `HSK2`, `HSK3`, `HSK4`, `HSK5`, `HSK6`
   - Represents HSK (Hanyu Shuiping Kaoshi) difficulty levels
   - Enforced by database CHECK constraint

### Tag Features

- **Database Constraints**: HSK levels enforced with CHECK constraint
- **UI Display**: Tags shown as badges in upper right corner of entry cards
- **Material UI Icons**: HSK levels display with numbered icons (1-6)
- **Automatic Assignment**: New entries default to `isCustomTag = true`
- **CSV Import Support**: Imported entries automatically tagged as custom
- **Backward Compatibility**: Existing entries remain functional with null tag values

### Tag Display Rules

- **Custom Badge**: Only visible when `isCustomTag === true`
- **HSK Badge**: Only visible when `hskLevelTag` is not null
- **Badge Styling**: Material UI Chip components with appropriate colors and icons

### Database Migration

To add the tag system to an existing database:

1. Run `server/tests/add-tag-columns.sql` to add the new columns
2. Run `server/tests/assign-random-hsk-levels.sql` to populate test data (randomly assigns both HSK levels and custom tag values)
3. Use `server/tests/test-tag-functionality.js` to verify the implementation

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
- PostgreSQL for data storage

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

## Difficulty (formerly the "tag system")

> ⚠️ The `isCustomTag` / `hskLevel` tag columns this section used to describe **no longer
> exist**, and neither do the `server/tests/add-tag-columns.sql`,
> `assign-random-hsk-levels.sql` or `test-tag-functionality.js` scripts it pointed at.

Difficulty is a **dictionary-entry** property, not a vocab-entry tag:

- Column: **`dictionaryentries_zh.difficulty`** (and `dictionaryentries_es.difficulty`),
  `smallint` 1..6 — a language-agnostic band. Migration 76 renamed `hskLevel` →
  `difficulty`, 79 stripped the `HSK` prefix, 92 retyped it to smallint.
- For Chinese the values ARE HSK levels (1 = HSK1 … 6 = HSK6), and the UI re-adds an HSK
  badge from them. For Spanish the same 1..6 band means CEFR-ish difficulty.
- Populated by `server/scripts/backfill/chinese/backfill-hsk-level.js` (name kept, column
  changed) or by import/seed data.
- It drives the discover band and the sort-pack level ladder — see
  [docs/DISCOVER_FLOW.md](docs/DISCOVER_FLOW.md) and
  [docs/SORT_PACKS_IMPLEMENTATION.md](docs/SORT_PACKS_IMPLEMENTATION.md).

Card ownership/provenance, which `isCustomTag` used to express, is now
`vocabentries_*.starterPackBucket` (`'library'` = Learn Now, `'provisional'` = lent) plus
the nullable `author` FK for user-authored cards.

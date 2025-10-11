# Vocabulary API Server

This is the backend API server for the vocabulary application, providing endpoints for managing vocabulary entries and users.

## Features

- RESTful API endpoints for vocabulary entries and users
- TypeScript for strong typing and better code quality
- Express.js for handling HTTP requests
- PostgreSQL database integration with DAL architecture
- JWT authentication with bcrypt password hashing
- Error handling with custom error types
- Docker containerization for consistent deployment

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register a new user
- `POST /api/auth/login` - Login a user
- `POST /api/auth/logout` - Logout a user
- `GET /api/auth/me` - Get current authenticated user
- `POST /api/auth/change-password` - Change user password

### Vocabulary Entries
- `GET /api/vocabEntries` - Get all vocabulary entries (protected)
- `GET /api/vocabEntries/paginated` - Get paginated vocabulary entries (protected)
- `GET /api/vocabEntries/:id` - Get a specific vocabulary entry by ID (protected)
- `POST /api/vocabEntries` - Create a new vocabulary entry (protected)
- `PUT /api/vocabEntries/:id` - Update a vocabulary entry (protected)
- `DELETE /api/vocabEntries/:id` - Delete a vocabulary entry (protected)
- `POST /api/vocabEntries/import` - Import vocabulary entries from CSV (protected)
- `POST /api/vocabEntries/by-tokens` - Get vocabulary entries by tokens (protected)

### Users
- `GET /api/users` - Get all users (protected)
- `GET /api/users/:id` - Get a specific user by ID (protected)
- `POST /api/users` - Create a new user (protected, admin only)

### Reading Materials
- `GET /api/texts` - Get all reading texts (protected)

### OnDeck Vocabulary Sets
- `GET /api/onDeckPage` - Get all on-deck vocab sets (protected)
- `GET /api/onDeckPage/:featureName` - Get specific on-deck vocab set (protected)
- `PUT /api/onDeckPage/:featureName` - Create or update on-deck vocab set (protected)
- `DELETE /api/onDeckPage/:featureName` - Delete on-deck vocab set (protected)

## Project Structure

```
server/
├── controllers/           # Request handlers
│   ├── UserController.ts
│   ├── VocabEntryController.ts
│   └── OnDeckVocabController.ts
├── dal/                   # Data Access Layer
│   ├── base/             # Base DAL classes
│   ├── implementations/  # Concrete DAL implementations
│   ├── interfaces/       # DAL interfaces
│   └── setup.ts          # DAL configuration
├── services/             # Business logic layer
│   ├── UserService.ts
│   ├── VocabEntryService.ts
│   └── OnDeckVocabService.ts
├── types/                # TypeScript type definitions
│   ├── index.ts          # Shared type definitions
│   └── dal.ts            # DAL-specific types
├── tests/                # Test scripts and SQL queries
├── authMiddleware.ts     # JWT authentication middleware
├── db.ts                 # Database connection setup
├── db-config.ts          # Database configuration
├── server.ts             # Main server file with API routes
├── Dockerfile            # Docker container configuration
├── tsconfig.json         # TypeScript configuration
└── package.json          # Project dependencies and scripts
```

## Getting Started (Docker - Recommended)

### Prerequisites
- Docker Engine 20.10+
- Docker Compose 2.0+

### Quick Start
From the project root directory:

```bash
# Start all services (frontend, backend, database)
docker-compose up --build

# The backend will be available at http://localhost:5000
# Database will be automatically set up with test data
```

### Development with Docker
```bash
# Start in development mode with hot reload
docker-compose up --build

# View backend logs
docker-compose logs -f backend

# Execute commands in backend container
docker-compose exec backend sh

# Access database
docker-compose exec postgres psql -U cow_user -d cow_db
```

## Alternative: Manual Setup (Not Recommended)

### Prerequisites
- Node.js (v18 or higher)
- npm or yarn
- PostgreSQL database

### Installation

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create a `.env` file in the server directory:
   ```bash
   DB_HOST=localhost
   DB_PORT=5432
   DB_NAME=cow_db
   DB_USER=cow_user
   DB_PASSWORD=your-password
   JWT_SECRET=your-jwt-secret
   PORT=5000
   NODE_ENV=development
   ```

3. Set up PostgreSQL database and run initialization scripts

4. Build the TypeScript code:
   ```bash
   npm run build
   ```

5. Start the server:
   ```bash
   npm start
   ```

### Development (Manual)
For development with automatic reloading:
```bash
npm run dev
```

## Architecture

### DAL (Data Access Layer) Pattern
The server uses a clean architecture with:

- **Controllers**: Handle HTTP requests and responses
- **Services**: Contain business logic
- **DAL**: Abstract database operations
- **Models**: Define data structures

### Database
- **PostgreSQL**: Primary database with UTF-8 support for Chinese characters
- **Automatic Setup**: Docker containers include database initialization
- **Test Data**: Automatically creates test users and sample data

### Authentication
- **JWT Tokens**: Secure authentication with configurable expiration
- **bcrypt**: Password hashing for security
- **Middleware**: Protected routes require valid JWT tokens

## TypeScript Benefits

This project uses TypeScript to provide:

1. **Strong typing** for better code quality and fewer runtime errors
2. **Better IDE support** with autocompletion and type checking
3. **Self-documenting code** with explicit type definitions
4. **Improved maintainability** and scalability
5. **Compile-time error detection** before deployment

## Docker Benefits

Docker containerization provides:

1. **Consistent environment** across development and production
2. **Easy setup** with single command deployment
3. **Isolated dependencies** preventing conflicts
4. **Scalable architecture** ready for production deployment
5. **Automatic database setup** with test data

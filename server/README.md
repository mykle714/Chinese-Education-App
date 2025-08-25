# Vocabulary API Server

This is the backend API server for the vocabulary application, providing endpoints for managing vocabulary entries and users.

## Features

- RESTful API endpoints for vocabulary entries and users
- TypeScript for strong typing and better code quality
- Express.js for handling HTTP requests
- MS SQL Server database integration
- Error handling with custom error types

## API Endpoints

### Vocabulary Entries

- `GET /api/vocabEntries` - Get all vocabulary entries
- `GET /api/vocabEntries/:id` - Get a specific vocabulary entry by ID
- `POST /api/vocabEntries` - Create a new vocabulary entry
- `PUT /api/vocabEntries/:id` - Update a vocabulary entry
- `DELETE /api/vocabEntries/:id` - Delete a vocabulary entry

### Users

- `GET /api/users` - Get all users
- `GET /api/users/:id` - Get a specific user by ID
- `POST /api/users` - Create a new user

## Project Structure

```
server/
├── dist/                  # Compiled JavaScript files
├── models/                # Data models
│   ├── userModel.ts       # User model functions
│   └── vocabEntryModel.ts # Vocabulary entry model functions
├── types/                 # TypeScript type definitions
│   └── index.ts           # Shared type definitions
├── db.ts                  # Database connection setup
├── db-config.ts           # Database configuration
├── server.ts              # Main server file with API routes
├── tsconfig.json          # TypeScript configuration
└── package.json           # Project dependencies and scripts
```

## Getting Started

### Prerequisites

- Node.js (v14 or higher)
- npm or yarn
- MS SQL Server database

### Installation

1. Install dependencies:
   ```
   npm install
   ```

2. Create a `.env` file in the server directory with the following variables:
   ```
   PORT=3001
   DB_SERVER=your-db-server
   DB_NAME=your-db-name
   CLIENT_ID=your-client-id
   CLIENT_SECRET=your-client-secret
   TENANT_ID=your-tenant-id
   ```

3. Build the TypeScript code:
   ```
   npm run build
   ```

4. Start the server:
   ```
   npm start
   ```

### Development

For development with automatic reloading:
```
npm run dev
```

## TypeScript Conversion

This project has been converted from JavaScript to TypeScript to provide:

1. Strong typing for better code quality and fewer runtime errors
2. Better IDE support with autocompletion and type checking
3. Self-documenting code with explicit type definitions
4. Improved maintainability and scalability

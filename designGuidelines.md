# Design Guidelines for Vocabulary Entry Manager

## Application Purpose

This service (internally referred to as cow) is a web application to help non-mandarin speakers learn mandarin. It will provide tools and games to engage users. 

## Design Goals
- The UX should be high quality.
- The UI should be engaging.
- The UI should be easy to comprehend.
- The UI should use "Material UI" where applicable
- Use Typescript and use strong typing as much as possible while avoiding errors.
- Lightly comment the code to explain to me how complicated parts of the code work.

## Constructs
You can understand the different constructs of this project by inspecting the tables in the Database Schema section below.

## Current Features
- User authentication system (login/register/logout)
- User profile management with password change functionality
- Dictionary interface for users to look up and explore vocabulary entries
- Personal vocabulary entry management (view, add, edit, delete)
- **Flashcards study mode** for vocabulary practice
- **CSV card import functionality** - Bulk import vocabulary entries from CSV files
- Reader interface for text analysis
- Responsive design with consistent navigation
- Protected routes requiring authentication

## Technology Stack

### Frontend
- **Framework**: React 19.1.0
- **UI Library**: Material UI 7.1.1
- **Build Tool**: Vite 6.3.5
- **Language**: TypeScript 5.8.3

### Backend
- **Framework**: Express.js 5.1.0
- **Language**: TypeScript
- **Database**: MS SQL Server (Azure SQL Database)
- **Authentication**: Azure Active Directory Service Principal

### Development Tools
- **Linting**: ESLint 9.25.0
- **Package Manager**: npm

### Frontend Structure

```
src/
├── App.tsx              # Main application component
├── constants.ts         # Application-wide constants
├── DataForm.tsx         # Form for adding new entries
├── Message.tsx          # Message display component
├── VocabEntryCards.tsx  # Component to display vocabulary entries
├── main.tsx            # Application entry point
└── assets/             # Static assets
```

### Backend Structure

```
server/
├── models/              # Data models
│   ├── userModel.ts     # User model functions
│   └── vocabEntryModel.ts # Vocabulary entry model functions
├── types/               # TypeScript type definitions
│   └── index.ts         # Shared type definitions
├── tests/               # Test scripts and SQL queries
│   ├── test-login.js    # Login test script
│   ├── test-change-password.js # Change password test script
│   └── README.md        # Documentation for tests
├── CONTRIBUTING.md      # Contributing guidelines
├── db.ts                # Database connection setup
├── db-config.ts         # Database configuration
└── server.ts            # Main server file with API routes
```

## Contributing

Please refer to the `server/CONTRIBUTING.md` file for guidelines on contributing to this project, including:
- Where to place test scripts and SQL queries
- Code style guidelines
- How to run tests

## Database Schema

### Overview

A brief description of the database, its purpose, and the technology stack (e.g., Azure SQL Database with Node.js/Express backend).

### Connection Details

- **Database Type**: Azure SQL Database
- **Authentication Method**: [e.g., Azure Active Directory Service Principal]
- **Environment Variables Required**: found in .env file

### Tables

#### Users

| Column Name | Data Type        | Constraints | Nullable | Default           | Description                         |
| ----------- | ---------------- | ----------- | -------- | ----------------- | ----------------------------------- |
| id          | uniqueidentifier | PRIMARY KEY | NO       | newsequentialid() | Unique identifier for each user     |
| email       | varchar(255)     | NOT NULL    | NO       | NULL              | User's email address                |
| name        | varchar(100)     | NOT NULL    | NO       | NULL              | User's full name                    |
| createdAt   | datetime         |             | YES      | getdate()         | Timestamp when the user was created |

##### Indexes

- Primary Key: `id`
- Unique Index: `email` (recommended for login functionality)

##### Relationships

- [Describe any foreign key relationships with other tables]

#### VocabEntries

| Column Name  | Data Type        | Constraints | Nullable | Default   | Description                              |
| ------------ | ---------------- | ----------- | -------- | --------- | ---------------------------------------- |
| id           | int              | PRIMARY KEY | NO       | NULL      | Unique identifier for each entry         |
| userId       | uniqueidentifier | FOREIGN KEY | NO       | NULL      | Reference to the user who owns the entry |
| entryKey     | text             | NOT NULL    | NO       | NULL      | Key for the dictionary entry             |
| entryValue   | text             | NOT NULL    | NO       | NULL      | Value for the dictionary entry           |
| isCustomTag  | bit              |             | YES      | NULL      | Boolean tag indicating if entry is user-created |
| hskLevelTag  | varchar(10)      | CHECK       | YES      | NULL      | HSK difficulty level (HSK1-HSK6)        |
| createdAt    | datetime         |             | YES      | getdate() | Timestamp when the entry was created     |

##### Indexes

- Primary Key: `id`
- Foreign Key: `userId` references `Users(id)`
- Index: `entryKey` (for quick lookups by key)

##### Tag System

The VocabEntries table includes a tag system with the following design principles:

**Tag Types:**
- **isCustomTag**: Boolean tag indicating whether an entry was created by the user (true) or imported from a standard source (false/null)
- **hskLevelTag**: Enum tag for HSK (Hanyu Shuiping Kaoshi) difficulty levels with values: HSK1, HSK2, HSK3, HSK4, HSK5, HSK6

**Tag Naming Convention:**
- All tag column names must end with "Tag" suffix
- Tags are not customizable by users - they are system-defined with preset values
- Each tag type can have multiple preset variations (enums) or boolean values

**Tag Constraints:**
- `hskLevelTag` has a CHECK constraint to enforce valid HSK levels: `CHECK (hskLevelTag IN ('HSK1', 'HSK2', 'HSK3', 'HSK4', 'HSK5', 'HSK6'))`
- Both tag fields are nullable for backward compatibility with existing entries

**Tag Behavior:**
- New entries created via UI default to `isCustomTag = true`
- CSV imports set `isCustomTag = true`
- HSK levels can be assigned manually or via automated scripts
- Tags are displayed as badges in the UI (upper right corner of entry cards)

##### Relationships

- Each entry belongs to a user through the `userId` foreign key

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

## Navigation and Page Transitions

### Current Approach

The application currently uses a single-page approach without client-side routing. Navigation between different "views" is handled through component state and conditional rendering.

### Future Direction

We plan to move towards using React Router (v6+) for client-side routing. This will provide several benefits:

- URL-based navigation with each "page" having its own URL
- Browser history integration (back/forward buttons work as expected)
- Ability to bookmark specific pages
- Support for deep linking
- Better code organization with declarative route definitions
- Possibility for code splitting and lazy loading

### Proposed Route Structure

```
/                   # Home page with overview
/entries            # List of all vocabulary entries
/entries/:id        # Detailed view of a specific entry
/add                # Form to add a new entry
/edit/:id           # Form to edit an existing entry
/profile            # User profile page
``

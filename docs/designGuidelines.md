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
- **Work Points Calendar System** - Daily activity tracking with penalties and rewards
  - Real-time minute points accumulation during study sessions
  - Daily penalty system for missed activity (10 points per day)
  - Streak tracking with visual calendar display
  - Monthly calendar showing points earned (+15) or penalties applied (-10)
  - Automatic daily boundary sync and penalty calculation
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
- **Database**: PostgreSQL 15
- **Authentication**: JWT (JSON Web Tokens)

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
└── server.ts            # App bootstrap (routes live in server/routes/*)
```

## Contributing

Please refer to the `server/CONTRIBUTING.md` file for guidelines on contributing to this project, including:
- Where to place test scripts and SQL queries
- Code style guidelines
- How to run tests

## Database Schema

### Overview

PostgreSQL 15 database with Node.js/Express backend, managed via Docker Compose.

### Connection Details

- **Database Type**: PostgreSQL 15
- **Authentication Method**: Standard PostgreSQL user/password authentication
- **Environment Variables Required**: found in .env file

### Tables

> ⚠️ **Verify before trusting.** These tables drift. `\d <table>` in the local Postgres
> container is the source of truth:
> `docker exec cow-postgres-local psql -U cow_user -d cow_db -c '\d users'`.

#### Users

| Column Name | Data Type | Nullable | Default | Description |
| --- | --- | --- | --- | --- |
| id | uuid | NO | `uuid_generate_v4()` | Unique identifier for each user |
| email | varchar(255) | NO | — | User's email address (UNIQUE) |
| name | varchar(100) | NO | — | User's display name |
| password | varchar(255) | NO | — | bcrypt hash |
| selectedLanguage | varchar(10) | YES | `'zh'` | The learner's active language |
| lastMinutePointIncrement | timestamp | YES | — | Rate-limit anchor for minute-point increments |
| isPublic | boolean | YES | `true` | Leaderboard/profile visibility — see [PUBLIC_PRIVATE_USERS_IMPLEMENTATION.md](./PUBLIC_PRIVATE_USERS_IMPLEMENTATION.md) |
| createdAt | timestamp | YES | `now()` | Account creation |
| timezone | text | NO | `'UTC'` | IANA zone; resolves the 4 AM-bounded streak day |
| avatarIconId | text | YES | — | FK → `icons8("icons8Id")`, ON DELETE SET NULL |
| seenPacks | integer[] | NO | `'{}'` | Sort packs already shown |
| readingGoal | boolean | NO | `false` | Enables the Reading mastery bar |
| writingGoal | boolean | NO | `false` | Enables the Writing mastery bar |
| isValidator | boolean | NO | `false` | Grants the validator flow — see [DATA_VALIDATION_SYSTEM.md](./DATA_VALIDATION_SYSTEM.md) |
| isTemplateAuthor | boolean | NO | `false` | Grants the night-market template editor/sandbox |
| showSegmentSpaces | boolean | NO | `false` | Account-level est display toggle (zh only) |

**Not here any more:** the global minute-point counters (`totalMinutePoints`,
`currentStreak`, …) moved to **`user_languages`**, keyed `(userId, language)` —
migration 130, renamed by 145. See [PER_LANGUAGE_STREAKS.md](./PER_LANGUAGE_STREAKS.md).

##### Indexes

- Primary Key: `id`
- Unique: `email`; plus btree on `email`, `avatarIconId`, `lastMinutePointIncrement`

##### Relationships

- `avatarIconId` → `icons8("icons8Id")` (SET NULL)
- Referenced with ON DELETE CASCADE by essentially every per-user table:
  `user_languages`, `userminutepoints`, `vocabentries_zh` / `vocabentries_es`, `decks`,
  `friendships` (both sides), `texts`, `refresh_tokens`, `validations`, `weeklies`,
  `wins`, `discover_skips`, `category_promotions`, `gameprogress`,
  `writing_practice_completions`, the three `nightmarkettemplate*` tables,
  `nightmarketunlocks`, `community_layout_votes`.

#### VocabEntries — `vocabentries_zh` / `vocabentries_es`

> There is **no `vocabentries` table**. It was split per language; the two tables share
> one id sequence (`vocabentries_id_seq`). A card's identity is
> **(userId, entryKey, language)** — every query must be language-scoped. Enrichment
> (definitions, pronunciation, breakdown, …) is NOT stored here; it is LEFT JOINed from
> the det tables on `entryKey = word1 AND language`.

| Column Name | Data Type | Nullable | Default | Description |
| --- | --- | --- | --- | --- |
| id | integer | NO | `nextval('vocabentries_id_seq')` | PK, shared sequence across both tables |
| userId | uuid | NO | — | FK → `users(id)` CASCADE — the card's owner |
| entryKey | text | NO | — | The headword; joins to `dictionaryentries_*.word1` |
| language | varchar(10) | NO | `'zh'` / `'es'` | Redundant with the table but kept so the shared read path can union |
| starterPackBucket | varchar(20) | NO | — | `'library'` (shown as **Learn Now**), `'provisional'` (lent — see [PROVISIONAL_CARDS.md](./PROVISIONAL_CARDS.md)), etc. |
| createdAt | timestamp | YES | `now()` | When the card entered the library |
| typedMarkHistory | jsonb | NO | `'{}'` | The four typed mark tracks (Recognition / Production / Reading / Writing) that drive utcm — see [MASTERY_REWORK.md](./MASTERY_REWORK.md) |
| masteredAt | jsonb | YES | — | Per-bar mastery timestamps (migration 142) |
| selectedSense | text | YES | — | Which sense cluster this card is studying — see [DEFINITION_CLUSTERS.md](./DEFINITION_CLUSTERS.md) |
| iconLayout | jsonb | YES | — | Custom back-face icon arrangement — see [CARD_ICON_LAYOUT.md](./CARD_ICON_LAYOUT.md) |
| snapConfig / textColors / textLayout / cardColor | jsonb / jsonb / jsonb / text | YES | — | Per-card face styling |
| author | uuid | YES | — | FK → `users(id)` SET NULL; set for user-authored cards |

##### Indexes

- Primary Key: `id`
- btree: `entryKey`, `language`, `author`
- Foreign Keys: `userId` → `users(id)` CASCADE; `author` → `users(id)` SET NULL

##### Gone: the tag system

The `entryValue`, `isCustomTag` and `hskLevel` columns described in earlier revisions of
this document **no longer exist on the vet tables**, and neither does the
`CHECK (hskLevel IN ('HSK1'..'HSK6'))` constraint. Difficulty is a **det** concern now:
`dictionaryentries_zh.difficulty`, a `smallint` 1..6 (migration 76 renamed `hskLevel` →
`difficulty`, 79 stripped the `HSK` prefix, 92 retyped it). For zh the values still ARE
HSK levels, and the UI re-adds an HSK badge from them.

##### Relationships

- Each entry belongs to a user through the `userId` foreign key
- `deck_cards` references entries to build user-authored decks — see [DECKS_FEATURE.md](./DECKS_FEATURE.md)

#### UserMinutePoints

| Column Name | Data Type        | Constraints | Nullable | Default | Description                                                                |
| ----------- | ---------------- | ----------- | -------- | ------- | -------------------------------------------------------------------------- |
| userId      | uuid             | FOREIGN KEY | NO       | NULL    | Reference to the user who owns the row                                     |
| streakDate  | date             | NOT NULL    | NO       | NULL    | Streak day label (4 AM-bounded local day) in YYYY-MM-DD form               |
| language    | varchar(10)      | NOT NULL    | NO       | 'zh'    | The language the minutes were earned in (migration 130)                    |
| minutesEarned | int            | NOT NULL    | NO       | 0       | Total minute points earned across all of the user's devices on this day   |
| penaltyMinutes | int           | NOT NULL    | NO       | 0       | Minutes deducted by a streak break attributed to this missed day          |
| lastSyncTimestamp | datetime    |             | YES      | now()   | Timestamp of last sync update                                              |
| updatedAt   | datetime         |             | YES      | now()   | Timestamp when the record was last updated                                  |

##### Primary Key
- Composite Primary Key: `(userId, streakDate, language)` — one row per user per streak day **per language**, aggregating activity across all devices.

##### Minute Points System
- Each row represents a single 4 AM-bounded local day for a user, summed across devices.
- Minute points accrue at 60s = 1 point in the client and are committed to the server one at a time.
- Each consecutive missed day (below the threshold) stamps `penaltyMinutes` on that missed day (`today − 1`), resets `currentStreak` to 0, and debits an **escalating** amount (`STREAK_CONFIG.PENALTY_SCHEDULE_MINUTES` = `3, 15, 30, 60, 90, 120`, then the remainder on day 7+) from that language's `user_languages.totalMinutePoints` — **not** from `users`, which no longer holds a points counter. Applied only by the cron — see [STREAK_EXPIRATION_CRON.md](./STREAK_EXPIRATION_CRON.md).
- Streak retention requires `STREAK_CONFIG.RETENTION_MINUTES` (default 3) per day.

**Calendar Integration:**
- Data powers the monthly calendar display showing daily progress
- Green days: streak threshold met (+minutes displayed)
- Red days: penalty applied (-minutes displayed)
- Blank days: before tracking started or future dates

##### Relationships
- `userId` references `Users(id)` with CASCADE DELETE
- One row per user per streak day per language (no per-device split).

## API Endpoints

> This is an illustrative subset, not the full surface. The route files under
> `server/routes/` are the source of truth (one file per feature, registered in
> `server/routes/index.ts`); see [BACKEND_LAYERING.md](./BACKEND_LAYERING.md).

### Vocabulary Entries (`server/routes/vocabEntryRoutes.ts`)

- `GET /api/vocabEntries` - Get all vocabulary entries
- `GET /api/vocabEntries/paginated` - Paged listing
- `GET /api/vocabEntries/search` - Search the user's cards
- `GET /api/vocabEntries/:id` - Get a specific vocabulary entry by ID
- `POST /api/vocabEntries` - Create a new vocabulary entry
- `POST /api/vocabEntries/addToLibrary` - Add a discoverable det word as a Learn Now card
- `POST /api/vocabEntries/import` - CSV import (multipart)
- `POST /api/vocabEntries/byTokens` - Bulk lookup by headword tokens
- `PUT /api/vocabEntries/:id` - Update a vocabulary entry
- `PATCH /api/vocabEntries/:id/iconLayout` - Save the custom back-face icon layout
- `PATCH /api/vocabEntries/:id/selectedSense` - Change which sense cluster the card studies
- `DELETE /api/vocabEntries/:id` - Delete a vocabulary entry

### Users (`server/routes/userRoutes.ts`)

- `GET /api/users` - Get all users
- `GET /api/users/:id` - Get a specific user by ID
- `POST /api/users` - Create a new user (admin)
- `PUT /api/users/language` - Change the learner's active language
- `PUT /api/users/avatar` - Set/clear the icons8 avatar
- `PUT /api/users/goals` - Set the reading/writing mastery-goal flags
- `PUT /api/users/displaySettings` - Account display preferences (segment spacing)
- `GET /api/users/me/wins` - This week's badges + lifetime win counts
- `POST /api/users/me/wins` - Record one game win
- `GET /api/users/me/velocity` - 7-day utcm band-step rate, per language

### Minute Points & Streak

- `POST /api/users/minutePoints/increment` - Add 1 minute point. Body: `{ timestamp, tz }`. Server resolves the streak day from the timezone.
- `GET /api/users/minutePoints/calendar/:yearMonth` - Calendar data (per-day minutes earned + penalties) for the given YYYY-MM
- `GET /api/users/minutePoints/summary?language=…` - Per-language lifetime total + today's minutes + streak
- ⚠️ **`GET /api/users/:id/totalMinutePoints` was removed** by migration 130 — wallets are per-language, so there is no single total to return. Use the summary endpoint above.
- Streak breaks are detected server-side by the hourly Postgres cron at `database/cron/expire-stale-streaks.sql` (see [STREAK_EXPIRATION_CRON.md](./STREAK_EXPIRATION_CRON.md)). The client has no `/new-day` endpoint.

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

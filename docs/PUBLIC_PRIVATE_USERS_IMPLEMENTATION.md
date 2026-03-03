# Public/Private User Profile Implementation

## Overview

The vocabulary application supports user privacy controls allowing users to opt-in or opt-out of appearing on the public leaderboard. This feature is implemented using the `isPublic` boolean flag on user accounts.

## Purpose

- Allow users to study privately without appearing on leaderboards
- Default behavior supports opt-out privacy (new users are public by default)
- Enable competitive features (leaderboards) while respecting user preferences
- Track work points and streak data regardless of public/private status

## Database Implementation

### Schema

#### Users Table
```sql
CREATE TABLE Users (
    id UUID PRIMARY KEY,
    email VARCHAR UNIQUE NOT NULL,
    password VARCHAR NOT NULL,
    createdAt TIMESTAMP DEFAULT now(),
    updatedAt TIMESTAMP DEFAULT now(),
    "isPublic" BOOLEAN NOT NULL DEFAULT true,  -- ← Public/private flag
    -- ... other columns
);

CREATE INDEX idx_users_ispublic ON Users("isPublic");
```

### Default Behavior
- **New Users**: `isPublic = true` (publicly visible on leaderboard)
- **Existing Users** (migrated): `isPublic = false` (private by default for privacy)
- **Migration Path**: Applied in migration 07 and again in migration 12 for safety

## Type Definitions

```typescript
// From server/types/index.ts
export interface User {
    id: string;
    email: string;
    password?: string;
    createdAt?: Date;
    updatedAt?: Date;
    selectedLanguage?: Language;
    isPublic?: boolean;  // Leaderboard visibility flag
    // ... other properties
}
```

## API Endpoints

### Get Leaderboard
```
GET /api/leaderboard
```

**Response:**
```json
{
    "data": [
        {
            "rank": 1,
            "userId": "uuid",
            "workPoints": 15000,
            "streak": 45,
            "isCurrentUser": false
        },
        // ... filtered to only include users where isPublic = true
    ]
}
```

**Filtering**: Only returns users with `isPublic = true`

### Update User Public Status
```
PUT /api/users/public
Request: { isPublic: boolean }
```

**Response:**
```json
{
    "success": true,
    "message": "User privacy setting updated",
    "isPublic": true
}
```

## User Interface

### Account Settings
Users can control their public/private status in the account settings page:

- **Setting**: "Appear on Public Leaderboard"
- **Type**: Checkbox
- **Default**: Checked (visible) for new users
- **Effect**: Immediately removes/adds user from leaderboard when toggled

### Leaderboard Display
The leaderboard component displays only users with `isPublic = true`:

```typescript
// From hooks/useLeaderboard.ts
const [leaderboardData, setLeaderboardData] = useState<LeaderboardData | null>(null);

// Fetches from /api/leaderboard
// Server handles filtering by isPublic = true
```

### User Profile
When viewing user profiles:
- **Public Users**: Full profile visible (work points, streak, vocabulary stats)
- **Private Users**: Limited information, not listed on leaderboards

## Feature Integration

### Work Points System
- Work points accumulate for both public and private users
- Progress tracking works independently of leaderboard visibility
- Streak data stored and displayed regardless of public/private status

### Flashcard Study
- Study activity counts toward work points for all users
- Marks tracked for spaced repetition regardless of visibility
- Private study remains completely private

### Vocabulary Management
- Custom vocabulary entries remain private to user
- Personal vocabulary not shared on leaderboards
- Starter pack interactions tracked privately

## Migrations

### Migration 07: Initial Implementation
- File: `database/migrations/07-add-ispublic-column.sql`
- Adds `isPublic` column with default `true`
- Sets existing users to `false` (privacy-first for existing data)
- Creates index for efficient leaderboard queries

### Migration 12: Safety Redundancy
- File: `database/migrations/12-add-missing-columns-and-tables.sql`
- Adds `isPublic` column with `IF NOT EXISTS` check
- Ensures column exists even if migration 07 didn't run
- Adds index with `IF NOT EXISTS` for idempotency

## API Implementation

### Leaderboard Endpoint
```typescript
// From server/server.ts
app.get('/api/leaderboard', async (req: AuthRequest, res: Response) => {
    try {
        const client = await db.connect();
        try {
            // Fetch users ordered by work points, filtered by isPublic = true
            const result = await client.query(`
                SELECT
                    id,
                    email,
                    "workPoints",
                    "streak",
                    email = $1 as "isCurrentUser"
                FROM Users
                WHERE "isPublic" = true
                ORDER BY "workPoints" DESC
                LIMIT 100
            `, [userId]);

            const data = result.rows.map((row, index) => ({
                rank: index + 1,
                ...row
            }));

            res.json({ data });
        } finally {
            client.release();
        }
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch leaderboard' });
    }
});
```

### Update Public Status
```typescript
// From server/server.ts
app.put('/api/users/public', async (req: AuthRequest, res: Response) => {
    const { isPublic } = req.body;
    const userId = req.user?.id;

    try {
        const client = await db.connect();
        try {
            await client.query(
                'UPDATE Users SET "isPublic" = $1 WHERE id = $2',
                [isPublic, userId]
            );

            res.json({
                success: true,
                message: isPublic ? 'Now visible on leaderboard' : 'Now hidden from leaderboard',
                isPublic
            });
        } finally {
            client.release();
        }
    } catch (error) {
        res.status(500).json({ error: 'Failed to update privacy setting' });
    }
});
```

## Privacy Considerations

### Data Security
- Private setting is enforced at API level (database filtering)
- No personal data exposed in leaderboard queries
- User emails not displayed on leaderboards (only work points and streak)

### Default Behavior
- **New Users**: Public by default (explicit consent in UX flow recommended)
- **Existing Users**: Private by default (backward compatibility)
- **Transparency**: Users must be informed when toggling visibility

### GDPR Compliance
- Users can opt-out of public display anytime
- Changes take effect immediately
- Personal data (email, passwords) never exposed on leaderboard
- Only aggregate metrics (work points, streak) displayed publicly

## Testing

### Database Verification
```bash
# Check isPublic column exists
docker exec -i cow-postgres-local psql -U cow_user -d cow_db -c \
  "SELECT column_name FROM information_schema.columns WHERE table_name='users' AND column_name='isPublic';"

# Count public vs private users
docker exec -i cow-postgres-local psql -U cow_user -d cow_db -c \
  "SELECT \"isPublic\", COUNT(*) FROM Users GROUP BY \"isPublic\";"

# Check leaderboard index exists
docker exec -i cow-postgres-local psql -U cow_user -d cow_db -c \
  "SELECT indexname FROM pg_indexes WHERE tablename='Users' AND indexname LIKE '%ispublic%';"
```

### API Testing
```bash
# Test leaderboard endpoint
curl -H "Authorization: Bearer <token>" \
  http://localhost:3001/api/leaderboard

# Test updating privacy setting
curl -X PUT \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"isPublic": false}' \
  http://localhost:3001/api/users/public
```

### Frontend Testing Checklist
- [ ] Load account settings page
- [ ] Toggle "Appear on Public Leaderboard" checkbox
- [ ] Verify setting persists on refresh
- [ ] Check user appears/disappears from leaderboard
- [ ] Test with public user visibility toggle
- [ ] Verify private users don't see private users on leaderboard
- [ ] Confirm work points accumulate regardless of public/private status
- [ ] Test leaderboard ranking calculation with mixed public/private users

## Known Limitations

1. **Email Exposure**: User emails are currently returned in some API responses (could be improved)
2. **No Profile Pages**: Public profiles not yet implemented as standalone pages
3. **No Social Features**: Leaderboard is read-only, no messaging between users
4. **Limited Metrics**: Only work points and streak displayed (could add more stats)

## Future Enhancements

Potential improvements to public/private features:

- [ ] Public user profile pages with vocabulary statistics
- [ ] More granular privacy controls (hide work points, show only streak, etc.)
- [ ] Anonymous leaderboard mode (hide user identities)
- [ ] Regional/language-specific leaderboards
- [ ] Leaderboard filters (weekly, monthly, language-specific)
- [ ] Social features (follow users, send messages)
- [ ] Privacy audit log (track when profile was made public/private)
- [ ] Bulk privacy settings (make all users private with one setting)

## Related Documentation

- [WORK_POINTS_SYSTEM.md](./WORK_POINTS_SYSTEM.md) - Work points tracking system
- [WORK_POINTS_INCREMENT_IMPLEMENTATION.md](./WORK_POINTS_INCREMENT_IMPLEMENTATION.md) - How work points are earned
- [POSTGRES_QUERY_GUIDE.md](../POSTGRES_QUERY_GUIDE.md) - Database queries for user data

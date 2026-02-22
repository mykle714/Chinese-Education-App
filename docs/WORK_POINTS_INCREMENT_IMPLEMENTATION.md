# Work Points Increment System Implementation

## Overview

This document describes the secure work points increment system that replaced the old sync system. The new system prevents abuse by implementing server-side controls and rate limiting.

## What Changed

### Old System (DEPRECATED)
- **Endpoint:** `POST /api/users/work-points/sync`
- **Client could specify:** date, work points amount, device fingerprint
- **Problem:** Users could manipulate parameters to cheat the system

### New System (SECURE)
- **Endpoint:** `POST /api/users/work-points/increment`
- **Client specifies:** Only the date (in their local timezone)
- **Server controls:** Everything else (amount is always +1, rate limiting, timestamps)

## Security Features

### 1. Fixed Increment Amount
- Server always increments by exactly **1 point**
- Client cannot specify or manipulate the amount
- Code: `await userWorkPointsDAL.upsertWorkPoints(userId, date, deviceFingerprint, previousPointsForDate + 1)`

### 2. Rate Limiting (59 seconds)
- Minimum **59 seconds** between successful increments
- Enforced server-side using `lastWorkPointIncrement` timestamp in Users table
- Rate limit is checked BEFORE any database writes
- If operation fails, timestamp is NOT updated, allowing immediate retry

### 3. Server-Side Device Tracking
- Device fingerprint generated server-side
- Client cannot spoof device identity
- Uses server request metadata (User-Agent, timestamp, random)

### 4. Date Validation
- Date must be within ±7 days of current date
- Prevents backdating or future-dating abuse
- Client's date is validated but used (allows for timezone differences)

## API Specification

### New Increment Endpoint

**Request:**
```http
POST /api/users/work-points/increment
Authorization: Bearer <token>
Content-Type: application/json

{
  "date": "2025-01-05"  // YYYY-MM-DD format (client's local date)
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Work point incremented successfully for 2025-01-05",
  "workPointsAdded": 1,
  "date": "2025-01-05"
}
```

**Rate Limit Error (400):**
```json
{
  "error": "Please wait 45 more seconds before incrementing again",
  "code": "ERR_VALIDATION_FAILED"
}
```

**Date Validation Error (400):**
```json
{
  "error": "Date must be within 7 days of today",
  "code": "ERR_VALIDATION_FAILED"
}
```

### Deprecated Sync Endpoint

The old `/api/users/work-points/sync` endpoint still exists but is deprecated. It will log warnings and should not be used in new code.

## Database Schema

### New Column Added to Users Table
```sql
ALTER TABLE Users 
ADD COLUMN "lastWorkPointIncrement" TIMESTAMP DEFAULT NULL;

CREATE INDEX idx_users_last_work_point_increment ON Users("lastWorkPointIncrement");
```

**Purpose:** Tracks the timestamp of the last successful work point increment for rate limiting.

**Important:** This timestamp is ONLY updated after a completely successful operation. If any step fails, it remains unchanged, allowing the client to retry immediately.

## Implementation Flow

### Step-by-Step Process

1. **Authentication Check**
   - Verify user is authenticated via JWT token
   - Extract userId from token

2. **Rate Limit Check** (BEFORE any writes)
   - Query user's `lastWorkPointIncrement` timestamp
   - If exists, calculate seconds since last increment
   - If < 59 seconds, reject with error message
   - If ≥ 59 seconds or NULL, proceed

3. **Date Validation**
   - Validate YYYY-MM-DD format
   - Ensure date is within ±7 days of today
   - Prevent backdating abuse

4. **Generate Device Fingerprint**
   - Server generates fingerprint from request metadata
   - Client cannot manipulate this

5. **Database Operations (Transaction)**
   - Get current work points for the date
   - Increment by exactly 1
   - Update user's total work points (+1)

6. **Update Rate Limit Timestamp** (Only on success)
   - Set `lastWorkPointIncrement` to current timestamp
   - This step only happens if all previous steps succeeded

7. **Return Success Response**
   - Confirm 1 point was added
   - Include the date for client verification

## Error Handling

### Client Should Retry On:
- Network errors
- 500 Internal Server Error
- Database connection errors

### Client Should NOT Retry On:
- 400 Rate limit error (must wait)
- 400 Invalid date error (fix the date)
- 401 Authentication error (re-login required)

### Automatic Retry Safety
Because `lastWorkPointIncrement` is only updated on complete success, failed operations don't count against the rate limit. The client can retry immediately if an operation fails due to server issues.

## Files Modified

### Database
- `database/migrations/13-add-last-work-point-increment.sql` - NEW

### Type Definitions
- `server/types/index.ts` - Added `lastWorkPointIncrement` to User interface
- `server/types/workPoints.ts` - Added WorkPointsIncrementRequest/Response types

### Data Access Layer
- `server/dal/interfaces/IUserDAL.ts` - Added `updateLastWorkPointIncrement()` method
- `server/dal/implementations/UserDAL.ts` - Implemented the method

### Business Logic
- `server/services/UserWorkPointsService.ts` - Added `incrementWorkPoints()` method
- Implements rate limiting logic
- Implements date validation
- Orchestrates all the steps

### Controller
- `server/controllers/UserWorkPointsController.ts` - Added `incrementWorkPoints()` handler
- Handles HTTP request/response
- Validates request parameters
- Calls service layer

### Routes
- `server/server.ts` - Added new `/increment` route
- Kept old `/sync` route with deprecation notice

## Usage Example (Client-Side)

```typescript
// Call this function whenever user earns a work point
async function incrementWorkPoint() {
  // Get user's local date
  const localDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  
  try {
    const response = await fetch('/api/users/work-points/increment', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ date: localDate })
    });
    
    const data = await response.json();
    
    if (response.ok) {
      console.log(`✅ Work point added! Total for ${data.date}: ${data.workPointsAdded}`);
      return true;
    } else if (response.status === 400 && data.error.includes('wait')) {
      // Rate limited - client should wait
      console.log(`⏱️ ${data.error}`);
      return false;
    } else {
      // Other error - could retry
      console.error('❌ Error:', data.error);
      return false;
    }
  } catch (error) {
    // Network error - should retry
    console.error('❌ Network error:', error);
    return false;
  }
}
```

## Testing the Implementation

### Test 1: Normal Increment
```bash
curl -X POST http://localhost:5000/api/users/work-points/increment \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"date":"2025-01-05"}'
```

Expected: Success response with `workPointsAdded: 1`

### Test 2: Rate Limit
Call the same endpoint twice within 59 seconds.

Expected: Second call returns error "Please wait X more seconds"

### Test 3: Invalid Date
```bash
curl -X POST http://localhost:5000/api/users/work-points/increment \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"date":"2024-01-01"}'
```

Expected: Error "Date must be within 7 days of today"

### Test 4: Verify lastWorkPointIncrement Updated
```sql
SELECT id, email, "lastWorkPointIncrement", "totalWorkPoints" 
FROM Users 
WHERE email = 'your-test-user@example.com';
```

Expected: `lastWorkPointIncrement` should update after successful increment

## Migration Deployment

### Development Environment
```bash
# Run migration
docker exec -i cow-postgres-local psql -U cow_user -d cow_db < database/migrations/13-add-last-work-point-increment.sql

# Restart backend
docker-compose restart backend

# Verify
docker logs cow-backend-local --tail 50
```

### Production Environment
```bash
# Navigate to project
cd ~/vocabulary-app

# Run migration
docker exec -i cow-postgres-prod psql -U cow_user -d cow_db < database/migrations/13-add-last-work-point-increment.sql

# Rebuild and restart (if needed)
docker-compose -f docker-compose.prod.yml restart backend

# Verify
docker logs cow-backend-prod --tail 50
```

## Monitoring and Debugging

### Check Rate Limit Status for User
```sql
SELECT 
  email,
  "lastWorkPointIncrement",
  EXTRACT(EPOCH FROM (NOW() - "lastWorkPointIncrement")) as seconds_since_last,
  "totalWorkPoints"
FROM Users
WHERE email = 'user@example.com';
```

### View Recent Work Point Increments
```sql
SELECT 
  u.email,
  uw.date,
  uw."workPoints",
  uw."lastSyncTimestamp"
FROM UserWorkPoints uw
JOIN Users u ON u.id = uw."userId"
WHERE u.email = 'user@example.com'
ORDER BY uw.date DESC, uw."lastSyncTimestamp" DESC
LIMIT 10;
```

### Backend Logs to Watch
The backend logs key events with emoji prefixes:
- `➕` - Increment request received
- `⏱️` - Rate limit triggered
- `💾` - Database write successful
- `📈` - Total points updated
- `⏰` - Timestamp updated
- `✅` - Complete success
- `❌` - Error occurred

Example:
```bash
docker logs cow-backend-local -f | grep "WORK-POINTS"
```

## Future Enhancements

Consider implementing:

1. **User-specific rate limits** - Some users might have higher limits
2. **Activity-based increments** - Different activities worth different points
3. **Bulk operations** - For syncing offline work
4. **Audit trail** - Log all increment attempts for security analysis
5. **IP-based rate limiting** - Additional layer of protection
6. **Geolocation validation** - Verify timezone matches location

## Rollback Plan

If issues arise, you can rollback by:

1. **Switch client to old endpoint** - Change `/increment` to `/sync` in client code
2. **Keep database column** - No need to remove it, just stops being used
3. **Remove new route** - Comment out the `/increment` route in server.ts

The old sync endpoint remains functional as a fallback.

## Summary

The new increment system provides robust protection against abuse while maintaining a simple API for legitimate users. Key improvements:

✅ Server controls the amount (always +1)  
✅ Rate limiting prevents spam (59 seconds minimum)  
✅ Server generates device fingerprints  
✅ Date validation prevents backdating  
✅ Retry-safe error handling  
✅ Clear audit trail via logging  

The system is now production-ready and significantly more secure than the previous implementation.

# Work Points Sync System Implementation

## Overview

This document describes the complete implementation of the daily boundary sync system for the vocabulary learning application. The system synchronizes client-side work points with the server once per day when users start a new day, providing reliable data persistence and preventing data loss during daily resets.

## Design Pattern: Real-Time Sync with Daily Boundary Backup

### Sync Triggers
1. **Primary**: Real-time sync on every point earned (every 60 seconds of active work)
2. **Backup**: Daily boundary sync when user returns and new day is detected
3. **Automatic**: Sync previous day's work before resetting points to zero
4. **Data protection**: Prevents work points loss during daily reset

### Benefits
- **Real-time accuracy** - Server stays in sync as users earn points
- **Fire-and-forget** - No blocking, no retries, no user-facing delays
- **No data loss** - Daily boundary sync catches failed real-time syncs
- **Simple logic** - Sync on point increment, silent failures
- **Complete coverage** - Captures all activity with dual sync system
- **Multi-device support** - Additive accumulation across devices

### Time-to-Point Conversion
- **60 seconds of active work = 1 point**
- Defined in `src/constants.ts` as `WORK_POINTS_CONFIG.MILLISECONDS_PER_POINT: 60000`
- Used consistently across all client-side code

## Database Schema

### UserWorkPoints Table
```sql
CREATE TABLE UserWorkPoints (
    "userId" UUID NOT NULL REFERENCES Users(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    "deviceFingerprint" VARCHAR(255) NOT NULL,
    "workPoints" INTEGER NOT NULL DEFAULT 0,
    "lastSyncTimestamp" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT pk_userworkpoints PRIMARY KEY ("userId", date, "deviceFingerprint")
);
```

**Key Features:**
- **Composite primary key** - Supports one entry per user per day per device
- **Automatic timestamps** - Created/updated tracking with triggers
- **Upsert support** - Handles updates for late syncs

## API Endpoints

### Single Endpoint: POST /api/users/work-points/sync

**Supports both single and multiple date formats:**

#### Single Date Sync
```json
{
  "date": "2025-01-01",
  "workPoints": 10,
  "deviceFingerprint": "wp_abc123def456" // optional
}
```

#### Multiple Dates Sync
```json
{
  "entries": [
    {
      "date": "2025-01-01",
      "workPoints": 10,
      "deviceFingerprint": "wp_abc123def456"
    },
    {
      "date": "2025-01-02", 
      "workPoints": 15,
      "deviceFingerprint": "wp_abc123def456"
    }
  ]
}
```

**Response Format:**
```json
{
  "success": true,
  "message": "Work points synced successfully for 2025-01-01",
  "data": {
    "date": "2025-01-01",
    "workPoints": 10,
    "deviceFingerprint": "wp_abc123def456",
    "synced": true
  }
}
```

## Client-Side Implementation

### Device Fingerprinting
```javascript
// Located in: src/utils/deviceFingerprint.ts
export function getWorkPointsDeviceFingerprint(): string
```

**Fingerprint Components:**
- Navigator user agent (truncated for privacy)
- Browser language
- Screen resolution
- Timezone
- Platform

**Persistence Strategy:**
- Stored in localStorage as `workPointsDeviceId`
- Cached in memory for session performance
- Regenerated if localStorage is cleared
- Falls back to stable fingerprinting if persistence fails

### Daily Boundary Sync Utilities
```javascript
// Located in: src/utils/dailyBoundarySync.ts
export async function checkAndSyncDailyReset(
  userId: string,
  data: WorkPointsStorage
): Promise<{ shouldReset: boolean; syncResult?: WorkPointsSyncResponse }>
```

**Features:**
- Automatic daily reset detection
- Sync-before-reset to prevent data loss
- Automatic device fingerprint generation
- Error handling with graceful degradation

### Hook Integration
```javascript
// Located in: src/hooks/useWorkPoints.ts
export const useWorkPoints = (): UseWorkPointsReturn
```

**Enhanced Properties:**
- `isSyncing: boolean` - Indicates sync in progress
- `lastSyncResult: WorkPointsSyncResponse | null` - Last sync status

**Sync Flow:**
1. **App initialization** - Check for daily reset and sync if needed
2. **Automatic daily boundary** - Sync yesterday's work before resetting
3. **No manual triggers** - Fully automatic based on daily boundaries

## Usage Examples

### Basic Implementation in Components

```jsx
import { useWorkPoints } from '../hooks/useWorkPoints';

function MyComponent() {
  const { 
    currentPoints, 
    isSyncing, 
    lastSyncResult 
  } = useWorkPoints();

  return (
    <div>
      <div>Work Points: {currentPoints}</div>
      {isSyncing && <div>Syncing...</div>}
      {lastSyncResult && !lastSyncResult.success && (
        <div>Sync failed: {lastSyncResult.message}</div>
      )}
    </div>
  );
}
```

### Manual Sync Trigger

```javascript
import { performMilestoneSync } from '../utils/workPointsSync';

// Force sync current work points
const handleManualSync = async () => {
  if (user?.id) {
    const result = await performMilestoneSync(user.id, currentPoints);
    console.log('Manual sync result:', result);
  }
};
```

## Multi-Device Support

### How It Works
1. Each device generates its own fingerprint
2. Database stores separate entries per device per day
3. Analytics aggregate across all devices for daily totals
4. Users see combined work points regardless of device

### Example Scenario
```
User studies on Desktop: 10 points on 2025-01-01
User studies on Mobile:  5 points on 2025-01-01
Total for day: 15 points across 2 devices
```

### Database Entries
```sql
-- Desktop entry
INSERT INTO UserWorkPoints VALUES ('user123', '2025-01-01', 'wp_desktop123', 10, ...);

-- Mobile entry  
INSERT INTO UserWorkPoints VALUES ('user123', '2025-01-01', 'wp_mobile456', 5, ...);

-- Query for daily total
SELECT SUM("workPoints") FROM UserWorkPoints 
WHERE "userId" = 'user123' AND date = '2025-01-01';
-- Result: 15
```

## Testing

### Run Tests
```bash
cd server
node tests/test-work-points-sync.js
```

### Test Coverage
- ✅ Single date sync
- ✅ Same date updates (upsert functionality)
- ✅ Bulk sync multiple dates
- ✅ Multi-device sync
- ✅ User statistics
- ✅ Input validation
- ✅ Device fingerprint generation

## Performance Considerations

### Load Distribution
- **No scheduled sync times** - Prevents server overload
- **Engagement-based triggers** - Only active users sync
- **Milestone spacing** - Natural distribution based on study patterns

### Data Efficiency  
- **Client calculates points** - Server only stores final values
- **Minimal payload** - Only date, points, and device fingerprint
- **Batch operations** - Multiple dates in single request

### Error Handling
- **Graceful degradation** - Failed syncs don't break user experience
- **Retry logic** - Unsynced data attempts sync on next session
- **Partial success** - Bulk operations continue even if some entries fail

## Security Features

### Authentication
- **JWT token required** - All endpoints require authentication
- **User isolation** - Can only sync own work points
- **Input validation** - Comprehensive server-side validation

### Privacy
- **Minimal fingerprinting** - Only uses necessary browser characteristics
- **No sensitive data** - Device fingerprints don't contain personal info
- **Local storage respect** - Works even if localStorage is restricted

## Integration Checklist

### Required Components
- [x] Database migration: `server/migrations/create-user-work-points-table.sql`
- [x] TypeScript types: `server/types/workPoints.ts`
- [x] DAL interface: `server/dal/interfaces/IUserWorkPointsDAL.ts`
- [x] DAL implementation: `server/dal/implementations/UserWorkPointsDAL.ts`
- [x] Service layer: `server/services/UserWorkPointsService.ts`
- [x] Controller: `server/controllers/UserWorkPointsController.ts`
- [x] API endpoint: Added to `server/server.ts`
- [x] Device fingerprinting: `src/utils/deviceFingerprint.ts`
- [x] Sync utilities: `src/utils/workPointsSync.ts`
- [x] Hook integration: Updated `src/hooks/useWorkPoints.ts`
- [x] Test script: `server/tests/test-work-points-sync.js`

### Deployment Steps
1. Run database migration to create UserWorkPoints table
2. Deploy server with new API endpoint
3. Deploy client with updated useWorkPoints hook
4. Test with real user activity
5. Monitor sync success rates in server logs

## Future Enhancements

### Potential Additions
- **Real-time sync feedback** - Toast notifications for sync status
- **Offline queue** - Store failed syncs for retry when online
- **Analytics dashboard** - Admin interface for work points analytics
- **Cross-device notifications** - Alert when studying on multiple devices

### Performance Optimizations
- **Request coalescing** - Combine rapid sync requests
- **Exponential backoff** - Retry failed syncs with increasing delays
- **Background sync** - Service worker for offline sync attempts

The system is now complete and ready for production use!

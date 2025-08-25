# OnDeck Vocab Sets Feature

This document describes the implementation of the OnDeck Vocab Sets feature, which allows users to create and manage lists of vocabulary entries organized by feature name.

## Overview

The OnDeck feature provides a way for users to create curated lists of vocabulary entries that can be used by different parts of the application (e.g., flashcards, study sessions, review queues). Each list is identified by a combination of user ID and feature name.

## Database Schema

### Table: OnDeckVocabSets

```sql
CREATE TABLE OnDeckVocabSets (
    userId uniqueidentifier NOT NULL,
    featureName varchar(100) NOT NULL,
    vocabEntryIds nvarchar(max) NOT NULL, -- JSON array of vocab entry IDs
    updatedAt datetime DEFAULT getdate(),
    
    CONSTRAINT PK_OnDeckVocabSets PRIMARY KEY (userId, featureName),
    CONSTRAINT FK_OnDeckVocabSets_Users FOREIGN KEY (userId) REFERENCES Users(id) ON DELETE CASCADE,
    CONSTRAINT CK_OnDeckVocabSets_ValidJson CHECK (ISJSON(vocabEntryIds) = 1)
);
```

**Key Design Decisions:**
- **Composite Primary Key**: `(userId, featureName)` - no surrogate ID needed
- **JSON Storage**: Vocab entry IDs stored as JSON array for flexibility
- **User Isolation**: Each user can only access their own sets
- **Cascade Delete**: Sets are deleted when user is deleted

## API Endpoints

### GET /api/onDeckPage
Get all on-deck vocab sets for the authenticated user.

**Authentication**: Required (JWT token)

**Response**: Array of OnDeckVocabSet objects
```json
[
  {
    "userId": "user-guid",
    "featureName": "flashcards",
    "vocabEntryIds": [1, 2, 3, 4, 5],
    "updatedAt": "2025-01-01T12:00:00.000Z"
  }
]
```

### PUT /api/onDeckPage/:featureName
Create or update an on-deck vocab set for a specific feature.

**Authentication**: Required (JWT token)

**Parameters**:
- `featureName` (URL parameter): Name of the feature (e.g., "flashcards")

**Request Body**:
```json
{
  "vocabEntryIds": [1, 2, 3, 4, 5]
}
```

**Validation**:
- Maximum 30 vocab entry IDs per set
- All IDs must exist and belong to the authenticated user
- Feature name can be any string (no validation)

**Response**: OnDeckVocabSet object

### DELETE /api/onDeckPage/:featureName
Delete an on-deck vocab set for a specific feature.

**Authentication**: Required (JWT token)

**Parameters**:
- `featureName` (URL parameter): Name of the feature to delete

**Response**: 204 No Content (success) or 404 Not Found

## TypeScript Types

```typescript
interface OnDeckVocabSet {
  userId: string;
  featureName: string;
  vocabEntryIds: number[];
  updatedAt: Date;
}

interface OnDeckVocabSetCreateData {
  featureName: string;
  vocabEntryIds: number[];
}
```

## Model Functions

Located in `server/models/onDeckVocabModel.ts`:

- `getAllOnDeckSetsForUser(userId: string)`: Get all sets for a user
- `getOnDeckSet(userId: string, featureName: string)`: Get specific set
- `createOrUpdateOnDeckSet(userId: string, data: OnDeckVocabSetCreateData)`: Upsert operation
- `deleteOnDeckSet(userId: string, featureName: string)`: Delete set
- `validateVocabEntryIds(userId: string, entryIds: number[])`: Validate IDs belong to user

## Error Handling

The API provides comprehensive error handling with specific error codes:

- `ERR_MISSING_FEATURE_NAME`: Feature name is required
- `ERR_INVALID_VOCAB_ENTRY_IDS_FORMAT`: vocabEntryIds must be an array
- `ERR_TOO_MANY_ENTRIES`: Maximum 30 entries allowed
- `ERR_INVALID_VOCAB_ENTRY_IDS`: IDs don't exist or don't belong to user
- `ERR_ONDECK_SET_NOT_FOUND`: Set not found for deletion

## Usage Examples

### JavaScript/TypeScript Client

```typescript
// Get all on-deck sets
const response = await fetch('/api/onDeckPage', {
  headers: { 'Authorization': `Bearer ${token}` }
});
const sets = await response.json();

// Create/update a set
await fetch('/api/onDeckPage/flashcards', {
  method: 'PUT',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    vocabEntryIds: [1, 2, 3, 4, 5]
  })
});

// Delete a set
await fetch('/api/onDeckPage/flashcards', {
  method: 'DELETE',
  headers: { 'Authorization': `Bearer ${token}` }
});
```

## Testing

Run the test suite:
```bash
cd server
node tests/test-ondeck-functionality.js
```

The test script covers:
- Authentication
- CRUD operations
- Validation (empty arrays, too many entries, invalid data types)
- Error handling

## Database Setup

1. Run the table creation script:
```bash
cd server/tests
# Execute create-ondeck-table.sql in your Azure SQL Database
```

2. The table will be created with proper constraints and indexes.

## Security Considerations

- **User Isolation**: All operations are scoped to the authenticated user
- **Input Validation**: Comprehensive validation of all inputs
- **SQL Injection Prevention**: Parameterized queries used throughout
- **Authentication Required**: All endpoints require valid JWT token
- **ID Validation**: Ensures vocab entry IDs belong to the requesting user

## Performance Considerations

- **Composite Primary Key**: Optimized for the primary access pattern (userId, featureName)
- **JSON Storage**: Efficient for variable-length arrays
- **Batch Validation**: IDs validated in single query
- **Indexes**: Proper indexing for efficient queries

## Future Enhancements

Potential improvements:
- **Ordering**: Add support for ordered lists within sets
- **Metadata**: Additional metadata per set (description, created date, etc.)
- **Sharing**: Allow users to share sets with other users
- **Categories**: Hierarchical organization of feature names
- **Bulk Operations**: Import/export functionality for sets

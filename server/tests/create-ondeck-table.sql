-- Create OnDeckVocabSets table for storing user's on-deck vocabulary entry lists
-- This table stores lists of vocab entry IDs organized by user and feature name

CREATE TABLE OnDeckVocabSets (
    userId uniqueidentifier NOT NULL,
    featureName varchar(100) NOT NULL,
    vocabEntryIds nvarchar(max) NOT NULL, -- JSON array of vocab entry IDs, max 30 items
    updatedAt datetime DEFAULT getdate(),
    
    -- Composite primary key - no surrogate ID needed
    CONSTRAINT PK_OnDeckVocabSets 
        PRIMARY KEY (userId, featureName),
    
    -- Foreign key to Users table with cascade delete
    CONSTRAINT FK_OnDeckVocabSets_Users 
        FOREIGN KEY (userId) REFERENCES Users(id) ON DELETE CASCADE,
    
    -- Ensure vocabEntryIds is valid JSON
    CONSTRAINT CK_OnDeckVocabSets_ValidJson 
        CHECK (ISJSON(vocabEntryIds) = 1)
);

-- Create index for efficient userId-only queries (getting all sets for a user)
CREATE INDEX IX_OnDeckVocabSets_UserId 
    ON OnDeckVocabSets (userId);

-- Example usage:
-- INSERT INTO OnDeckVocabSets (userId, featureName, vocabEntryIds) 
-- VALUES ('user-guid-here', 'flashcards', '[1,2,3,4,5]');

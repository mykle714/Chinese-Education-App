-- Track which TTS voice was used to synthesize the cached MP3 for this entry.
-- NULL means no audio has been generated yet. The MP3 file itself lives on disk
-- (or object storage) at a deterministic path derived from voice + entryKey,
-- so changing voice naturally invalidates the cache by mismatch.
-- Format: 'provider:voiceName', e.g. 'azure:zh-CN-XiaoyiNeural'.
ALTER TABLE dictionaryentries ADD COLUMN IF NOT EXISTS "ttsVoice" TEXT;

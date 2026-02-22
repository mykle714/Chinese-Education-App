# AI Enrichment Test Script - What It Does

## Overview
The `test-ai-enrichment.js` script tests **3 different AI models** (Claude Haiku, GPT-4o Mini, and Claude Sonnet) on the **same 100 Chinese words** to compare the quality of their generated content.

## What It Generates

For each of the 100 words, each AI model creates:

### 1. **Synonyms** (3-5 words)
Chinese words with similar meanings
- Example: For "学习" → ["学", "念书", "读书", "攻读"]

### 2. **Example Sentences** (3 sentences)
Natural Chinese sentences showing the word in different contexts:
```json
{
  "chinese": "我每天学习两个小时。",
  "english": "I study for two hours every day.",
  "usage": "time_duration"
}
```

## How It Works

### Step 1: Load Test Words
- Reads the 100 words you approved from `test-sample-100-indexed.md`
- Queries your database to get full details (pinyin, definitions)

### Step 2: Process in Batches
- Groups words into batches of **10 words each** (10 batches total)
- Sends each batch to the AI model
- Waits 1 second between batches (rate limiting)

### Step 3: Test All 3 Models
Tests in this order:
1. **Claude 3.5 Haiku** (~$0.03 for 100 words)
2. **GPT-4o Mini** (~$0.005 for 100 words)
3. **Claude 3.5 Sonnet** (~$0.11 for 100 words)

Waits 5 seconds between models.

### Step 4: Save Results
Creates 3 separate JSON files in `/data`:
- `enrichment-test-haiku.json`
- `enrichment-test-mini.json`
- `enrichment-test-sonnet.json`

## Output File Structure

Each JSON file contains:

```json
{
  "model": "Claude 3.5 Haiku",
  "provider": "anthropic",
  "timestamp": "2026-02-18T22:30:00.000Z",
  "statistics": {
    "totalWords": 100,
    "inputTokens": 15000,
    "outputTokens": 85000,
    "totalCost": "0.0300",
    "totalDuration": "120.5s",
    "averageTimePerWord": "1205ms"
  },
  "entries": [
    {
      "word": "飞扬",
      "synonyms": ["飞舞", "飘扬", "扬起"],
      "exampleSentences": [
        {
          "chinese": "红旗在风中飞扬。",
          "english": "The red flag flies in the wind.",
          "usage": "descriptive"
        },
        // ... 2 more
      ]
    }
    // ... 99 more words
  ]
}
```

## What You Can Compare

After running, you'll have 3 files with the **same 100 words** but different AI-generated content. Compare:

1. **Quality of Synonyms**
   - Are they real Chinese words?
   - Are they actually synonyms?
   - How commonly used are they?

2. **Quality of Example Sentences**
   - Natural sounding?
   - Grammatically correct?
   - Show different uses?
   - Accurate translations?

3. **Cost vs Quality Trade-off**
   - Haiku: Medium quality, affordable
   - Mini: Lower quality, cheapest
   - Sonnet: Highest quality, expensive

## Usage

### Prerequisites
Install npm packages first:
```bash
docker exec cow-backend-local npm install @anthropic-ai/sdk openai
```

### Run the Script
```bash
docker exec cow-backend-local sh -c "ANTHROPIC_API_KEY=your_key OPENAI_API_KEY=your_key node server/scripts/test-ai-enrichment.js"
```

### Expected Runtime
- **Total time**: ~5-10 minutes
- Haiku: ~1-2 minutes
- Mini: ~1-2 minutes  
- Sonnet: ~2-3 minutes
- Plus 5-second delays between models

### Expected Cost
- **Total**: ~$0.145
- Haiku: ~$0.03
- Mini: ~$0.005
- Sonnet: ~$0.11

## What Happens Next?

1. Script runs and creates 3 JSON files
2. You open and compare the files
3. You decide which model produces the best quality
4. You tell me which model to use for the full 124,000 words

## Key Features

✅ **Same 100 words** for all models (fair comparison)
✅ **Tracks cost** for each model
✅ **Tracks time** for performance comparison
✅ **Error handling** - continues if one batch fails
✅ **Progress tracking** - shows which batch is processing
✅ **Detailed statistics** - tokens, cost, time per word

## Example Console Output

```
🚀 AI Enrichment Quality Test
Testing 100 Chinese words across 3 AI models

============================================================
🤖 Testing: Claude 3.5 Haiku
============================================================

📊 Loaded 100 words from database

Processing 10 batches...

  [1/10] Processing 10 words...
  ✓ Success (2450ms)
  [2/10] Processing 10 words...
  ✓ Success (2380ms)
  ...

✅ Completed! Results saved to: data/enrichment-test-haiku.json

📊 Statistics:
   Words processed: 100
   Input tokens: 14,523
   Output tokens: 84,234
   Total cost: $0.0298
   Total time: 120.5s

⏳ Waiting 5 seconds before next model...

============================================================
🤖 Testing: GPT-4o Mini
============================================================
...
```

---

## Summary

**This script helps you make an informed decision** about which AI model to use for enriching all 124,000 words in your dictionary by testing quality on a representative sample of 100 words first.

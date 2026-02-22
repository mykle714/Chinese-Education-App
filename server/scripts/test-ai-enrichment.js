/**
 * AI Enrichment Quality Test Script
 * 
 * Tests three AI models (Claude Haiku, GPT-4o Mini, Claude Sonnet) on the same 100 Chinese words
 * to compare quality of generated synonyms, expansions, and example sentences.
 * 
 * Usage: 
 *   ANTHROPIC_API_KEY=sk-ant-xxx OPENAI_API_KEY=sk-xxx node server/scripts/test-ai-enrichment.js
 */

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import db from '../db.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Model configurations
const MODELS = {
  haiku: {
    name: 'claude-3-5-haiku-20241022',
    provider: 'anthropic',
    displayName: 'Claude 3.5 Haiku',
    inputCostPer1M: 0.80,
    outputCostPer1M: 4.00
  },
  mini: {
    name: 'gpt-4o-mini',
    provider: 'openai',
    displayName: 'GPT-4o Mini',
    inputCostPer1M: 0.15,
    outputCostPer1M: 0.60
  },
  sonnet: {
    name: 'claude-sonnet-4-6',
    provider: 'anthropic',
    displayName: 'Claude Sonnet 4.6',
    inputCostPer1M: 3.00,
    outputCostPer1M: 15.00
  }
};

// Determine which models to run (MODEL env var filters to a single model key)
const modelFilter = process.env.MODEL; // e.g. MODEL=sonnet
const modelsToRun = modelFilter
  ? Object.keys(MODELS).filter(k => k === modelFilter)
  : Object.keys(MODELS);

// API Configuration
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_BACKFILL_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_BACKFILL_API_KEY;

// Only require OpenAI key if running an OpenAI model
const needsOpenAI = modelsToRun.some(k => MODELS[k].provider === 'openai');
if (!ANTHROPIC_API_KEY || (needsOpenAI && !OPENAI_API_KEY)) {
  console.error('❌ Error: Missing required API keys');
  if (!ANTHROPIC_API_KEY) console.error('  Set ANTHROPIC_BACKFILL_API_KEY');
  if (needsOpenAI && !OPENAI_API_KEY) console.error('  Set OPENAI_BACKFILL_API_KEY (required for OpenAI models)');
  process.exit(1);
}

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

// The 100 test words (from test-sample-100-indexed.md)
const TEST_WORDS = [
  '飞扬', '矮行星', '功勋', '电访', '宿豫', '偶见', '达官', '利', '飘渺', '巧家',
  '咔啦', '洗脸', '金针菜', '麻豆', '简练', '占据', '记性', '㑇', '至交', '督工',
  '结伴而行', '全南县', '龙潭区', '伦敦', '苹果手机', '妻离子散', '石河子', '嬿', '蛰', '鱼香肉丝',
  '巨鹿县', '街知巷闻', '红腹灰雀', '排查', '致', '同行', '馥郁', '绞痛', '信令', '结了',
  '钉死', '炸丸子', '平分', '袪', '諆', '狮子座', '顺带', '端点', '相好', '男人膝下有黄金',
  '青贮', '平行六面体', '跂', '舒坦', '山中圣训', '莱斯沃斯岛', '人文学', '幔子', '陆羽', '极端主义',
  '国土安全局', '跃', '精神训话', '和平县', '桃园市', '瓿', '弯道', '客家人', '佛教', '原平',
  '判别', '时运不济', '全新纪', '答', '旁系', '粒径', '嗷嗷待哺', '华', '碟子', '缳',
  '傻里傻气', '好了疮疤忘了痛', '正统', '酒不醉人人自醉，色不迷人人自迷', '仁化县', '汇映', '生日贺卡', '巡洋舰', '滋味', '牛百叶',
  '铁饭碗', '通用性', '薄暗', '普陀山', '褀', '抗药能力', '地标', '襁', '嘎', '政治部'
];

/**
 * Generate enrichment prompt for a batch of words
 */
function generatePrompt(wordsBatch) {
  const wordsSection = wordsBatch.map((w, i) => 
    `${i + 1}. ${w.word1} (${w.pronunciation}): ${w.definitions[0]}`
  ).join('\n');

  return `You are a Chinese language expert. For each word, provide:

1. **SYNONYMS** (1-3 words, ONLY if high quality):
   - Only include synonyms that are VERY close in meaning
   - Must be commonly used, natural Chinese words
   - If no high-quality synonyms exist, return an empty array []
   - Quality over quantity - better to have 0 synonyms than mediocre ones

2. **WORD EXPANSION** (1 expanded form):
   - Expand each morpheme/character by inserting additional characters to make it more explicit
   - CRITICAL: Every character from the original word must appear in the expansion, in their original order
   - You may ONLY add characters between or after the originals — never replace or omit any original character
   - Examples:
     * 不知不觉 → 不知道不觉得  (added 道 and 得)
     * 违规 → 违反规矩           (added 反 and 矩)
     * 早晚 → 早上晚上           (added 上 twice)
     * 傻里傻气 → 傻里面傻气质   (added 面 and 质)
   - WRONG: 傻里傻气 → 傻乎乎的样子  (replaces original characters — not allowed)
   - If the word cannot be meaningfully expanded while preserving all characters, return null

3. **EXAMPLE SENTENCES** (3 sentences):
   - Natural, realistic sentences (how a native speaker would use it)
   - Show different grammatical contexts
   - 8-15 characters in Chinese
   - Include English translation and usage context

Words to process:
${wordsSection}

Respond in this EXACT JSON format:
{
  "words": [
    {
      "word": "word1",
      "synonyms": ["synonym1", "synonym2"] or [],
      "expansion": "expanded form" or null,
      "exampleSentences": [
        {
          "chinese": "example sentence",
          "english": "translation",
          "usage": "context"
        },
        {
          "chinese": "example sentence",
          "english": "translation",
          "usage": "context"
        },
        {
          "chinese": "example sentence",
          "english": "translation",
          "usage": "context"
        }
      ]
    }
  ]
}

CRITICAL INSTRUCTIONS:
- For synonyms: Return empty array [] if no high-quality matches exist
- For expansion: Return null if word cannot be meaningfully expanded
- Be strict with quality - don't force synonyms/expansions that don't fit well`;
}

/**
 * Call Anthropic Claude models
 */
async function callAnthropic(model, prompt) {
  const startTime = Date.now();
  
  const response = await anthropic.messages.create({
    model: model.name,
    max_tokens: 4096,
    temperature: 0.7,
    messages: [{
      role: 'user',
      content: prompt
    }]
  });

  const duration = Date.now() - startTime;
  const content = response.content[0].text;
  
  return {
    content,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    duration
  };
}

/**
 * Call OpenAI models
 */
async function callOpenAI(model, prompt) {
  const startTime = Date.now();
  
  const response = await openai.chat.completions.create({
    model: model.name,
    messages: [{
      role: 'user',
      content: prompt
    }],
    temperature: 0.7,
    response_format: { type: 'json_object' }
  });

  const duration = Date.now() - startTime;
  const content = response.choices[0].message.content;
  
  return {
    content,
    inputTokens: response.usage.prompt_tokens,
    outputTokens: response.usage.completion_tokens,
    duration
  };
}

/**
 * Process a batch of words with a specific model
 */
async function processBatch(model, wordsBatch, batchNum, totalBatches) {
  console.log(`  [${batchNum}/${totalBatches}] Processing ${wordsBatch.length} words...`);
  
  const prompt = generatePrompt(wordsBatch);
  
  try {
    let result;
    if (model.provider === 'anthropic') {
      result = await callAnthropic(model, prompt);
    } else {
      result = await callOpenAI(model, prompt);
    }
    
    // Strip markdown code fences if present, then parse JSON
    const jsonText = result.content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
    const parsed = JSON.parse(jsonText);
    
    return {
      success: true,
      data: parsed.words,
      tokens: {
        input: result.inputTokens,
        output: result.outputTokens
      },
      duration: result.duration
    };
  } catch (error) {
    console.error(`  ❌ Error in batch ${batchNum}: ${error.message}`);
    return {
      success: false,
      error: error.message,
      data: []
    };
  }
}

/**
 * Test a single model on all 100 words
 */
async function testModel(modelKey) {
  const model = MODELS[modelKey];
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🤖 Testing: ${model.displayName}`);
  console.log(`${'='.repeat(60)}\n`);
  
  const client = await db.getClient();
  
  try {
    // Fetch full data for the 100 test words
    const placeholders = TEST_WORDS.map((_, i) => `$${i + 1}`).join(',');
    const query = `
      SELECT word1, pronunciation, definitions
      FROM dictionaryentries
      WHERE language = 'zh'
      AND word1 IN (${placeholders})
    `;
    
    const result = await client.query(query, TEST_WORDS);
    const wordsData = result.rows;
    
    console.log(`📊 Loaded ${wordsData.length} words from database\n`);
    
    // Process in batches of 10 words
    const BATCH_SIZE = 10;
    const batches = [];
    for (let i = 0; i < wordsData.length; i += BATCH_SIZE) {
      batches.push(wordsData.slice(i, i + BATCH_SIZE));
    }
    
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalDuration = 0;
    const allResults = [];
    
    console.log(`Processing ${batches.length} batches...\n`);
    
    for (let i = 0; i < batches.length; i++) {
      const batchResult = await processBatch(model, batches[i], i + 1, batches.length);
      
      if (batchResult.success) {
        allResults.push(...batchResult.data);
        totalInputTokens += batchResult.tokens.input;
        totalOutputTokens += batchResult.tokens.output;
        totalDuration += batchResult.duration;
        
        console.log(`  ✓ Success (${batchResult.duration}ms)`);
      }
      
      // Small delay between batches to respect rate limits
      if (i < batches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    // Calculate costs
    const inputCost = (totalInputTokens / 1_000_000) * model.inputCostPer1M;
    const outputCost = (totalOutputTokens / 1_000_000) * model.outputCostPer1M;
    const totalCost = inputCost + outputCost;
    
    // Prepare output
    const output = {
      model: model.displayName,
      modelId: model.name,
      provider: model.provider,
      timestamp: new Date().toISOString(),
      statistics: {
        totalWords: allResults.length,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        totalTokens: totalInputTokens + totalOutputTokens,
        inputCost: inputCost.toFixed(4),
        outputCost: outputCost.toFixed(4),
        totalCost: totalCost.toFixed(4),
        totalDuration: `${(totalDuration / 1000).toFixed(1)}s`,
        averageTimePerWord: `${(totalDuration / allResults.length).toFixed(0)}ms`
      },
      entries: allResults
    };
    
    // Save to file
    const outputPath = path.join(__dirname, '../../data', `enrichment-test-${modelKey}.json`);
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
    
    console.log(`\n✅ Completed! Results saved to: data/enrichment-test-${modelKey}.json`);
    console.log(`\n📊 Statistics:`);
    console.log(`   Words processed: ${allResults.length}`);
    console.log(`   Input tokens: ${totalInputTokens.toLocaleString()}`);
    console.log(`   Output tokens: ${totalOutputTokens.toLocaleString()}`);
    console.log(`   Total cost: $${totalCost.toFixed(4)}`);
    console.log(`   Total time: ${(totalDuration / 1000).toFixed(1)}s`);
    
    return output;
    
  } catch (error) {
    console.error(`\n❌ Fatal error testing ${model.displayName}:`, error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Main execution
 */
async function main() {
  console.log('\n🚀 AI Enrichment Quality Test');
  console.log('Testing 100 Chinese words across 3 AI models\n');
  
  const results = {};
  
  try {
    // Test each model
    for (const modelKey of modelsToRun) {
      results[modelKey] = await testModel(modelKey);
      
      // Delay between models
      if (modelKey !== 'sonnet') {
        console.log('\n⏳ Waiting 5 seconds before next model...\n');
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
    
    // Summary
    console.log(`\n\n${'='.repeat(60)}`);
    console.log('📊 FINAL SUMMARY');
    console.log(`${'='.repeat(60)}\n`);
    
    for (const [modelKey, result] of Object.entries(results)) {
      console.log(`${result.model}:`);
      console.log(`  Words: ${result.statistics.totalWords}`);
      console.log(`  Cost: $${result.statistics.totalCost}`);
      console.log(`  Time: ${result.statistics.totalDuration}`);
      console.log('');
    }
    
    console.log('✅ All tests complete!');
    console.log('\n📁 Output files:');
    console.log('   - data/enrichment-test-haiku.json');
    console.log('   - data/enrichment-test-mini.json');
    console.log('   - data/enrichment-test-sonnet.json');
    console.log('\nReview these files to compare quality across models.\n');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  } finally {
    await db.closePool();
  }
}

// Run the script
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

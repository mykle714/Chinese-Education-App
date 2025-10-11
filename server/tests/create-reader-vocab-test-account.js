// Script to create a test account with vocabulary entries from reader docs
import fetch from 'node-fetch';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const API_BASE_URL = 'http://localhost:3001';

// Comprehensive vocabulary with English translations from reader docs
const vocabularyEntries = [
  // Text 1: Coffee Shop Morning
  { chinese: "今天", english: "today" },
  { chinese: "早上", english: "morning" },
  { chinese: "来到", english: "to arrive at, to come to" },
  { chinese: "市中心", english: "city center, downtown" },
  { chinese: "一家", english: "one (classifier for businesses)" },
  { chinese: "小", english: "small" },
  { chinese: "咖啡店", english: "coffee shop" },
  { chinese: "这家", english: "this (business/shop)" },
  { chinese: "店", english: "shop, store" },
  { chinese: "很", english: "very" },
  { chinese: "温馨", english: "warm and cozy" },
  { chinese: "墙上", english: "on the wall" },
  { chinese: "挂着", english: "hanging" },
  { chinese: "许多", english: "many, a lot of" },
  { chinese: "艺术", english: "art" },
  { chinese: "画作", english: "paintings, artwork" },
  { chinese: "空气", english: "air" },
  { chinese: "中", english: "in, among" },
  { chinese: "弥漫", english: "to fill the air, to permeate" },
  { chinese: "浓郁", english: "rich, strong (aroma)" },
  { chinese: "咖啡", english: "coffee" },
  { chinese: "香味", english: "fragrance, aroma" },
  { chinese: "点了", english: "ordered" },
  { chinese: "一杯", english: "one cup" },
  { chinese: "拿铁", english: "latte" },
  { chinese: "一个", english: "one (classifier)" },
  { chinese: "牛角包", english: "croissant" },
  { chinese: "坐在", english: "sitting at" },
  { chinese: "靠窗", english: "by the window" },
  { chinese: "位置", english: "position, seat" },
  { chinese: "可以", english: "can, able to" },
  { chinese: "看到", english: "to see" },
  { chinese: "街上", english: "on the street" },
  { chinese: "来来往往", english: "coming and going" },
  { chinese: "人们", english: "people" },
  { chinese: "有些人", english: "some people" },
  { chinese: "匆匆忙忙", english: "hurriedly, in a rush" },
  { chinese: "赶去", english: "to rush to" },
  { chinese: "上班", english: "to go to work" },
  { chinese: "悠闲", english: "leisurely, relaxed" },
  { chinese: "散步", english: "to take a walk" },
  { chinese: "里", english: "inside" },
  { chinese: "播放", english: "to play (music)" },
  { chinese: "轻柔", english: "soft, gentle" },
  { chinese: "音乐", english: "music" },
  { chinese: "让人", english: "makes people" },
  { chinese: "感到", english: "to feel" },
  { chinese: "放松", english: "relaxed" },

  // Text 2: Spring Festival Preparation
  { chinese: "春节", english: "Spring Festival, Chinese New Year" },
  { chinese: "快到了", english: "is coming soon" },
  { chinese: "我们", english: "we, us" },
  { chinese: "全家", english: "whole family" },
  { chinese: "都在", english: "all are" },
  { chinese: "忙着", english: "busy with" },
  { chinese: "准备", english: "to prepare" },
  { chinese: "过年", english: "to celebrate New Year" },
  { chinese: "妈妈", english: "mom, mother" },
  { chinese: "早早", english: "early" },
  { chinese: "就", english: "already, then" },
  { chinese: "开始", english: "to start, to begin" },
  { chinese: "计划", english: "to plan" },
  { chinese: "年夜饭", english: "New Year's Eve dinner" },
  { chinese: "菜单", english: "menu" },
  { chinese: "她", english: "she" },
  { chinese: "说", english: "to say" },
  { chinese: "今年", english: "this year" },
  { chinese: "要", english: "to want, will" },
  { chinese: "做", english: "to make, to do" },
  { chinese: "十二道菜", english: "twelve dishes" },
  { chinese: "寓意", english: "to symbolize" },
  { chinese: "十二个月", english: "twelve months" },
  { chinese: "都", english: "all" },
  { chinese: "顺顺利利", english: "smoothly, successfully" },
  { chinese: "爸爸", english: "dad, father" },
  { chinese: "负责", english: "to be responsible for" },
  { chinese: "买", english: "to buy" },
  { chinese: "年货", english: "New Year goods" },
  { chinese: "他", english: "he" },
  { chinese: "列了", english: "made a list" },
  { chinese: "长长的", english: "long" },
  { chinese: "清单", english: "list" },
  { chinese: "瓜子", english: "sunflower seeds" },
  { chinese: "花生", english: "peanuts" },
  { chinese: "糖果", english: "candy, sweets" },
  { chinese: "水果", english: "fruit" },
  { chinese: "还有", english: "also, and" },
  { chinese: "各种", english: "various kinds of" },
  { chinese: "干货", english: "dried goods" },
  { chinese: "我", english: "I, me" },
  { chinese: "和", english: "and" },
  { chinese: "弟弟", english: "younger brother" },
  { chinese: "任务", english: "task" },
  { chinese: "是", english: "is, to be" },
  { chinese: "打扫", english: "to clean" },
  { chinese: "房子", english: "house" },
  { chinese: "贴", english: "to paste, to stick" },
  { chinese: "春联", english: "Spring Festival couplets" },

  // Text 3: Tai Chi in the Park
  { chinese: "每天", english: "every day" },
  { chinese: "六点", english: "six o'clock" },
  { chinese: "都会", english: "will always" },
  { chinese: "去", english: "to go" },
  { chinese: "附近", english: "nearby" },
  { chinese: "公园", english: "park" },
  { chinese: "有", english: "to have, there is/are" },
  { chinese: "一群", english: "a group of" },
  { chinese: "老人", english: "elderly people" },
  { chinese: "在", english: "at, in (location)" },
  { chinese: "练习", english: "to practice" },
  { chinese: "太极拳", english: "Tai Chi" },
  { chinese: "他们", english: "they, them" },
  { chinese: "动作", english: "movements, actions" },
  { chinese: "缓慢", english: "slow" },
  { chinese: "而", english: "and, but" },
  { chinese: "优雅", english: "elegant, graceful" },
  { chinese: "就像", english: "just like" },
  { chinese: "跳", english: "to dance, to jump" },
  { chinese: "一支", english: "one (classifier for songs/dances)" },
  { chinese: "无声", english: "silent" },
  { chinese: "舞蹈", english: "dance" },
  { chinese: "领头", english: "to lead" },
  { chinese: "一位", english: "one (polite classifier for people)" },
  { chinese: "七十多岁", english: "over seventy years old" },
  { chinese: "张爷爷", english: "Grandpa Zhang" },
  { chinese: "练", english: "to practice" },
  { chinese: "太极", english: "Tai Chi" },
  { chinese: "已经", english: "already" },
  { chinese: "三十多年", english: "over thirty years" },
  { chinese: "了", english: "particle indicating completion" },
  { chinese: "告诉", english: "to tell" },
  { chinese: "不仅", english: "not only" },
  { chinese: "能", english: "can, able to" },
  { chinese: "强身健体", english: "to strengthen the body" },
  { chinese: "还能", english: "also can" },
  { chinese: "心情", english: "mood" },
  { chinese: "平静", english: "calm, peaceful" }
];

async function createReaderVocabTestAccount() {
  try {
    console.log('Creating test account for reader vocabulary...\n');
    
    // Test user credentials
    const testUser = {
      email: 'reader-vocab-test@example.com',
      name: 'Reader Vocab Test User',
      password: 'TestPassword123!'
    };
    
    console.log(`Creating user: ${testUser.name} (${testUser.email})`);
    
    // Step 1: Register the user
    let authToken;
    try {
      const registerResponse = await fetch(`${API_BASE_URL}/api/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email: testUser.email,
          name: testUser.name,
          password: testUser.password
        })
      });
      
      const registerData = await registerResponse.json();
      
      if (registerResponse.ok) {
        console.log('✅ User registration successful!');
        console.log('Registration response:', JSON.stringify(registerData, null, 2));
        authToken = registerData.token;
      } else if (registerData.error && registerData.error.includes('already exists')) {
        console.log('ℹ️  User already exists, attempting login...');
        
        // Try to login instead
        const loginResponse = await fetch(`${API_BASE_URL}/api/auth/login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            email: testUser.email,
            password: testUser.password
          })
        });
        
        const loginData = await loginResponse.json();
        
        if (loginResponse.ok) {
          console.log('✅ Login successful!');
          authToken = loginData.token;
        } else {
          console.log(`❌ Login failed: ${loginData.error}`);
          return;
        }
      } else {
        console.log(`❌ Registration failed: ${registerData.error}`);
        return;
      }
    } catch (error) {
      console.log(`❌ Error during registration/login: ${error.message}`);
      return;
    }
    
    // Step 2: Get existing entries to clear them
    console.log('\nClearing existing vocabulary entries...');
    try {
      const getEntriesResponse = await fetch(`${API_BASE_URL}/api/vocabEntries`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (getEntriesResponse.ok) {
        const existingEntries = await getEntriesResponse.json();
        console.log(`Found ${existingEntries.length} existing entries to delete`);
        
        // Delete existing entries
        for (const entry of existingEntries) {
          await fetch(`${API_BASE_URL}/api/vocabEntries/${entry.id}`, {
            method: 'DELETE',
            headers: {
              'Authorization': `Bearer ${authToken}`,
              'Content-Type': 'application/json'
            }
          });
        }
        console.log('✅ Existing entries cleared');
      }
    } catch (error) {
      console.log(`⚠️  Warning: Could not clear existing entries: ${error.message}`);
    }
    
    // Step 3: Add vocabulary entries
    console.log(`\nAdding ${vocabularyEntries.length} vocabulary entries...`);
    
    let successCount = 0;
    let errorCount = 0;
    
    for (let i = 0; i < vocabularyEntries.length; i++) {
      const entry = vocabularyEntries[i];
      
      try {
        const response = await fetch(`${API_BASE_URL}/api/vocabEntries`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            entryKey: entry.chinese,
            entryValue: entry.english
          })
        });
        
        if (response.ok) {
          successCount++;
          if ((i + 1) % 20 === 0) {
            console.log(`   Progress: ${i + 1}/${vocabularyEntries.length} entries added`);
          }
        } else {
          const errorData = await response.json();
          console.log(`❌ Error adding entry ${entry.chinese}: ${errorData.error}`);
          errorCount++;
        }
      } catch (error) {
        console.log(`❌ Error adding entry ${entry.chinese}: ${error.message}`);
        errorCount++;
      }
    }
    
    // Step 4: Verify entries were created
    console.log('\nVerifying entries...');
    try {
      const verifyResponse = await fetch(`${API_BASE_URL}/api/vocabEntries`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (verifyResponse.ok) {
        const allEntries = await verifyResponse.json();
        
        console.log('\n=== READER VOCABULARY TEST ACCOUNT CREATED ===');
        console.log(`Email: ${testUser.email}`);
        console.log(`Password: ${testUser.password}`);
        console.log(`Vocabulary entries added: ${successCount}`);
        console.log(`Errors: ${errorCount}`);
        console.log(`Total entries in database: ${allEntries.length}`);
        console.log(`Total unique words from reader texts: ${vocabularyEntries.length}`);
        
        console.log('\n=== SAMPLE ENTRIES ===');
        const sampleEntries = allEntries.slice(0, 10);
        sampleEntries.forEach(entry => {
          // Try different possible property names
          const key = entry.entrykey || entry.entryKey || entry.key || entry.chinese;
          const value = entry.entryvalue || entry.entryValue || entry.value || entry.english;
          console.log(`${key} → ${value}`);
        });
        
        console.log('\n✅ Test account is ready for use!');
        console.log('You can now login with the credentials above and practice with vocabulary from the reader texts.');
        
      } else {
        console.log('❌ Could not verify entries');
      }
    } catch (error) {
      console.log(`❌ Error verifying entries: ${error.message}`);
    }
    
  } catch (error) {
    console.error('❌ Error creating reader vocab test account:', error);
  }
}

// Run the script
createReaderVocabTestAccount();

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import FormData from 'form-data';
import fetch from 'node-fetch';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testTimingAnalysis() {
    try {
        // First, login to get a token
        console.log('Logging in...');
        const loginResponse = await fetch('http://localhost:5000/api/auth/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                email: 'test@example.com',
                password: 'pw'
            }),
        });

        if (!loginResponse.ok) {
            throw new Error(`Login failed: ${loginResponse.status}`);
        }

        const loginData = await loginResponse.json();
        const token = loginData.token;
        console.log('Login successful!');

        // Create a medium-sized test CSV file (50 entries)
        let testCsvContent = 'front,back,hint,publishedAt\n';
        for (let i = 1; i <= 50; i++) {
            testCsvContent += `"测试${i}","test${i}","","2025-01-01T00:00:00.000Z"\n`;
        }

        const testCsvPath = path.join(__dirname, 'test-timing-analysis.csv');
        fs.writeFileSync(testCsvPath, testCsvContent);

        console.log('Testing timing analysis with 50 entries...');
        
        // Test the import endpoint
        const form = new FormData();
        form.append('file', fs.createReadStream(testCsvPath));

        const startTime = Date.now();
        const importResponse = await fetch('http://localhost:5000/api/vocabEntries/import', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
            },
            body: form,
        });

        const importResult = await importResponse.json();
        const endTime = Date.now();
        
        if (importResponse.ok) {
            console.log('\n=== TIMING ANALYSIS TEST COMPLETED ===');
            console.log('Client-side total time:', (endTime - startTime) + 'ms');
            console.log('Result:', importResult);
            console.log('\nCheck the server console for detailed timing breakdown!');
        } else {
            console.error('Import failed:', importResult);
        }

        // Clean up test file
        fs.unlinkSync(testCsvPath);

    } catch (error) {
        console.error('Test failed:', error.message);
    }
}

testTimingAnalysis();

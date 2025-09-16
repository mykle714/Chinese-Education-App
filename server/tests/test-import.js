import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import FormData from 'form-data';
import fetch from 'node-fetch';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testImport() {
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

        // Create a small test CSV file
        const testCsvContent = `front,back,hint,publishedAt
"测试","test","","2025-01-01T00:00:00.000Z"
"你好","hello","","2025-01-01T00:00:00.000Z"`;

        const testCsvPath = path.join(__dirname, 'test-import.csv');
        fs.writeFileSync(testCsvPath, testCsvContent);

        // Test the import endpoint
        console.log('Testing import...');
        const form = new FormData();
        form.append('file', fs.createReadStream(testCsvPath));

        const importResponse = await fetch('http://localhost:5000/api/vocabEntries/import', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
            },
            body: form,
        });

        const importResult = await importResponse.json();
        
        if (importResponse.ok) {
            console.log('Import successful!');
            console.log('Result:', importResult);
        } else {
            console.error('Import failed:', importResult);
        }

        // Clean up test file
        fs.unlinkSync(testCsvPath);

    } catch (error) {
        console.error('Test failed:', error.message);
    }
}

testImport();

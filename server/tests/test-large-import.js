import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import FormData from 'form-data';
import fetch from 'node-fetch';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testLargeImport() {
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

        // Use the existing large CSV file
        const csvPath = path.join(__dirname, '../../data/duo_cards_zh_export.csv');
        
        if (!fs.existsSync(csvPath)) {
            throw new Error('CSV file not found at: ' + csvPath);
        }

        console.log('Testing large CSV import (2000+ entries)...');
        console.log('This will show timing performance for each phase...');
        
        // Test the import endpoint
        const form = new FormData();
        form.append('file', fs.createReadStream(csvPath));

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
            console.log('\n=== IMPORT COMPLETED ===');
            console.log('Client-side total time:', (endTime - startTime) + 'ms');
            console.log('Result:', importResult);
        } else {
            console.error('Import failed:', importResult);
        }

    } catch (error) {
        console.error('Test failed:', error.message);
    }
}

testLargeImport();

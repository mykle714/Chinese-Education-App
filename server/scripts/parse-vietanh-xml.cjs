/**
 * Parse VietAnh StarDict XML and convert to tab-separated format
 * Usage: node parse-vietanh-xml.cjs input.txt output.txt
 */

const fs = require('fs');
const path = require('path');

function escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseXMLDictionary(inputFile, outputFile) {
    console.log('📖 Vietnamese Dictionary XML Parser');
    console.log('===================================\n');
    
    console.log('📄 Reading XML file:', inputFile);
    const content = fs.readFileSync(inputFile, 'utf-8');
    console.log(`   File size: ${(content.length / 1024 / 1024).toFixed(2)} MB\n`);
    
    console.log('🔍 Parsing entries...');
    const entries = [];
    let skipped = 0;
    
    // Match each <article> block
    const articleRegex = /<article>([\s\S]*?)<\/article>/g;
    let match;
    let count = 0;
    
    while ((match = articleRegex.exec(content)) !== null) {
        count++;
        if (count % 5000 === 0) {
            console.log(`   Processed ${count} articles...`);
        }
        
        const articleContent = match[1];
        
        // Extract key (Vietnamese word)
        const keyMatch = articleContent.match(/<key>(.*?)<\/key>/);
        if (!keyMatch) continue;
        
        const word = keyMatch[1].trim();
        
        // Skip metadata entries
        if (word.startsWith('00-database')) {
            skipped++;
            continue;
        }
        
        // Extract definition from CDATA
        const cdataMatch = articleContent.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
        if (!cdataMatch) {
            skipped++;
            continue;
        }
        
        let definition = cdataMatch[1].trim();
        
        // Remove the @word prefix (escape special regex characters)
        const escapedWord = escapeRegex(word);
        definition = definition.replace(new RegExp(`^@${escapedWord}\\s*`, 'i'), '');
        
        // Clean up the definition
        // Remove excessive newlines and normalize spacing
        definition = definition
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0)
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();
        
        // Skip if definition is empty or too short
        if (!definition || definition.length < 2) {
            skipped++;
            continue;
        }
        
        // Truncate very long definitions (keep first 500 chars)
        if (definition.length > 500) {
            definition = definition.substring(0, 500) + '...';
        }
        
        entries.push({ word, definition });
    }
    
    console.log(`✅ Parsed ${entries.length} valid entries`);
    console.log(`   Skipped ${skipped} entries (metadata or invalid)\n`);
    
    console.log('💾 Writing output file:', outputFile);
    const lines = entries.map(entry => `${entry.word}\t${entry.definition}`);
    fs.writeFileSync(outputFile, lines.join('\n'), 'utf-8');
    
    console.log(`✅ Output file created`);
    console.log(`   Total entries: ${entries.length}`);
    console.log(`   File size: ${(fs.statSync(outputFile).size / 1024 / 1024).toFixed(2)} MB\n`);
    
    // Show sample entries
    console.log('📝 Sample entries:');
    entries.slice(0, 5).forEach((entry, i) => {
        const shortDef = entry.definition.length > 80 
            ? entry.definition.substring(0, 80) + '...' 
            : entry.definition;
        console.log(`   ${i + 1}. ${entry.word} → ${shortDef}`);
    });
    
    console.log('\n🎉 Conversion complete!');
}

// Main execution
const inputFile = process.argv[2] || '/home/cow/data/dictionaries/VietAnh/vietanh-raw.txt';
const outputFile = process.argv[3] || '/home/cow/data/dictionaries/viet-dict-full.txt';

try {
    parseXMLDictionary(inputFile, outputFile);
} catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
}

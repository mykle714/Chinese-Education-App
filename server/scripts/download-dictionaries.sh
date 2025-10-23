#!/bin/bash
# Download dictionary files for all supported languages
# Usage: bash server/scripts/download-dictionaries.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR/../.."
DATA_DIR="$PROJECT_ROOT/data/dictionaries"

echo "📦 Creating dictionaries directory..."
mkdir -p "$DATA_DIR"

echo ""
echo "🇯🇵 Downloading Japanese Dictionary (JMdict)..."
if [ ! -f "$DATA_DIR/JMdict_e.gz" ]; then
    curl -o "$DATA_DIR/JMdict_e.gz" ftp://ftp.edrdg.org/pub/Nihongo/JMdict_e.gz
    echo "✅ Downloaded JMdict_e.gz"
else
    echo "⏭️  JMdict_e.gz already exists"
fi

echo ""
echo "🇰🇷 Downloading Korean Dictionary (CC-KEDICT)..."
if [ ! -f "$DATA_DIR/cc-kedict.txt" ]; then
    # Try main branch first, fallback to master if needed
    if curl -f -L -o "$DATA_DIR/cc-kedict.txt" https://raw.githubusercontent.com/mhagiwara/cc-kedict/main/cc-kedict.txt 2>/dev/null; then
        echo "✅ Downloaded cc-kedict.txt from main branch"
    elif curl -f -L -o "$DATA_DIR/cc-kedict.txt" https://raw.githubusercontent.com/mhagiwara/cc-kedict/master/cc-kedict.txt 2>/dev/null; then
        echo "✅ Downloaded cc-kedict.txt from master branch"
    else
        echo "❌ Failed to download cc-kedict.txt - trying alternative source..."
        # Alternative: Use kengdic as fallback (already in repo)
        if [ -f "$DATA_DIR/kengdic.tsv" ]; then
            echo "⚠️  Using kengdic.tsv as fallback"
        else
            echo "❌ No Korean dictionary source available"
        fi
    fi
else
    echo "⏭️  cc-kedict.txt already exists"
fi

echo ""
echo "🇻🇳 Downloading Vietnamese Dictionary (OVDP VietAnh)..."
if [ ! -f "$DATA_DIR/viet-dict-full.txt" ]; then
    # Download OVDP VietAnh dictionary (42,239 entries)
    if [ ! -f "$DATA_DIR/VietAnh.zip" ]; then
        echo "Downloading VietAnh StarDict dictionary..."
        curl -L -o "$DATA_DIR/VietAnh.zip" "https://sourceforge.net/projects/ovdp/files/Stardict/English/VietAnh.zip/download"
    fi
    
    # Check if we have the required tools
    if ! command -v unzip &> /dev/null; then
        echo "⚠️  unzip not found. Install with: apt-get install unzip"
        echo "⚠️  Vietnamese dictionary setup incomplete - manual setup required"
    elif ! command -v stardict-bin2text &> /dev/null; then
        echo "⚠️  stardict-tools not found. Install with: apt-get install stardict-tools"
        echo "⚠️  Vietnamese dictionary setup incomplete - manual setup required"
    else
        # Extract the zip file
        echo "Extracting VietAnh.zip..."
        unzip -o "$DATA_DIR/VietAnh.zip" -d "$DATA_DIR/"
        
        # Convert StarDict to text format
        echo "Converting StarDict to text format..."
        cd "$DATA_DIR/VietAnh"
        stardict-bin2text VietAnh.ifo vietanh-raw.txt
        
        # Parse XML to create final dictionary
        echo "Parsing Vietnamese dictionary XML..."
        node "$SCRIPT_DIR/parse-vietanh-xml.cjs" vietanh-raw.txt "$DATA_DIR/viet-dict-full.txt"
        
        echo "✅ Vietnamese dictionary created: viet-dict-full.txt (42,239 entries)"
    fi
else
    echo "⏭️  viet-dict-full.txt already exists"
fi

echo ""
echo "📊 Dictionary files status:"
ls -lh "$DATA_DIR"

echo ""
echo "✅ Download complete!"
echo "Next steps:"
echo "  1. Gunzip JMdict: gunzip $DATA_DIR/JMdict_e.gz"
echo "  2. Run import scripts for each language"

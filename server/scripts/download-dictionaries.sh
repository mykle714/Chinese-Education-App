#!/bin/bash
# Download dictionary files for all supported languages
# Usage: bash server/scripts/download-dictionaries.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="/home/cow/data/dictionaries"

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
    curl -L -o "$DATA_DIR/cc-kedict.txt" https://raw.githubusercontent.com/mhagiwara/cc-kedict/master/cc-kedict.txt
    echo "✅ Downloaded cc-kedict.txt"
else
    echo "⏭️  cc-kedict.txt already exists"
fi

echo ""
echo "🇻🇳 Downloading Vietnamese Dictionary..."
if [ ! -f "$DATA_DIR/viet-dict.txt" ]; then
    # Using a Vietnamese-English dictionary from Free Vietnamese Dictionary Project
    # Alternative: wget http://www.informatik.uni-leipzig.de/~duc/Dict/data/Vietnamese-English.txt
    curl -L -o "$DATA_DIR/viet-dict.txt" https://raw.githubusercontent.com/hieuphq/vietnamese-dictionary/master/data/en-vi.txt || \
    echo "⚠️  Vietnamese dictionary download failed - may need manual download"
else
    echo "⏭️  viet-dict.txt already exists"
fi

echo ""
echo "📊 Dictionary files status:"
ls -lh "$DATA_DIR"

echo ""
echo "✅ Download complete!"
echo "Next steps:"
echo "  1. Gunzip JMdict: gunzip $DATA_DIR/JMdict_e.gz"
echo "  2. Run import scripts for each language"

#!/bin/bash
# Transcribe a Telegram voice message (.oga) using Groq's Whisper API.
# Usage: transcribe-voice.sh <path-to-oga-file>
# Output: transcript text to stdout

set -e

OGA_FILE="$1"
if [ -z "$OGA_FILE" ] || [ ! -f "$OGA_FILE" ]; then
  echo "Usage: $0 <path-to-oga-file>" >&2
  exit 1
fi

GROQ_KEY=$(python3 -c "import json; print(json.load(open('$HOME/.arca/secrets.json'))['groq']['apiKey'])")

# Convert oga -> mp3 (Groq doesn't accept .oga extension)
TMP_MP3=$(mktemp /tmp/voice-XXXXXX.mp3)
trap "rm -f $TMP_MP3" EXIT

ffmpeg -i "$OGA_FILE" -ar 16000 -ac 1 -c:a libmp3lame "$TMP_MP3" -y 2>/dev/null

# Transcribe via Groq
curl -s -X POST "https://api.groq.com/openai/v1/audio/transcriptions" \
  -H "Authorization: Bearer $GROQ_KEY" \
  -F "file=@$TMP_MP3" \
  -F "model=whisper-large-v3-turbo" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('text','').strip())"

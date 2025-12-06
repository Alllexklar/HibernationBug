#!/bin/bash
set -e

echo "🔬 Hibernation Bug Test - Quick Start"
echo "======================================"
echo ""

# Check if we're in the right directory
if [ ! -d "raw-cloudflare" ] || [ ! -d "client" ]; then
    echo "❌ Error: Must run from HibernationBug root directory"
    exit 1
fi

# Install dependencies
echo "📦 Installing dependencies..."
echo ""

echo "→ Installing server dependencies..."
cd raw-cloudflare
npm install
cd ..

echo ""
echo "→ Installing client dependencies..."
cd client
npm install
cd ..

echo ""
echo "✅ Dependencies installed!"
echo ""
echo "🚀 Starting servers..."
echo ""
echo "📝 Server logs will appear in this terminal"
echo "📝 Client will open in browser at http://localhost:3000"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Start both servers (server in background, client in foreground)
cd raw-cloudflare
npm run dev &
SERVER_PID=$!

cd ../client
# Give server time to start
sleep 3
npm run dev

# Cleanup on exit
trap "kill $SERVER_PID" EXIT

#!/bin/bash

echo "🔬 Testing Cloudflare getWebSockets() API"
echo "=========================================="
echo ""
echo "Starting DO server in background..."

cd /home/jack/crack/Code/HibernationBug/raw-cloudflare

# Start wrangler in background and capture output
npx wrangler dev > /tmp/wrangler-test.log 2>&1 &
WRANGLER_PID=$!

# Wait for server to start
sleep 3

echo "✅ Server started (PID: $WRANGLER_PID)"
echo ""
echo "📡 Sending test WebSocket connection..."
echo ""

# Use wscat or curl to test WebSocket
# For now, show how to manually test
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "SERVER IS RUNNING - Check the logs for results:"
echo ""
echo "Look for this section in the output:"
echo ""
echo "  🔬 CRITICAL TEST: getWebSockets() immediately after accept:"
echo "  [AFTER-ACCEPT] getWebSockets(): {"
echo "    count: 0 or 1  ← THIS IS THE KEY TEST"
echo "    acceptedCount: 1"
echo "  }"
echo ""
echo "If count = 1: ✅ Cloudflare API works"
echo "If count = 0: ❌ Cloudflare API broken"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Press Ctrl+C to stop the server and see results"
echo ""

# Wait for user to stop
trap "kill $WRANGLER_PID 2>/dev/null; echo ''; echo '📋 Test logs saved to /tmp/wrangler-test.log'; echo ''; grep -A 10 'CRITICAL TEST' /tmp/wrangler-test.log | head -20; exit 0" EXIT INT TERM

tail -f /tmp/wrangler-test.log | grep --line-buffered -E '\[AFTER-ACCEPT\]|CRITICAL TEST|✅ WORKING|❌ BUG'

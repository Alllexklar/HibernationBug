#!/bin/bash
set -e

echo "🚀 Deploying Raw Cloudflare DO to Production"
echo "=============================================="
echo ""

cd /home/jack/crack/Code/HibernationBug/raw-cloudflare

# Check if logged in
echo "Checking Cloudflare authentication..."
if ! npx wrangler whoami > /dev/null 2>&1; then
    echo ""
    echo "❌ Not logged in to Cloudflare"
    echo "Run: npx wrangler login"
    exit 1
fi

echo "✅ Authenticated"
echo ""

# Deploy to Cloudflare
echo "📤 Deploying to Cloudflare Workers..."
npx wrangler deploy

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Deployment complete!"
echo ""
echo "Your worker URL will be shown above (*.workers.dev)"
echo ""
echo "To test with real hibernation:"
echo "1. Copy your worker URL from above"
echo "2. Update client/src/App.tsx line 36 with your URL:"
echo "   const wsUrl = 'wss://YOUR-WORKER.workers.dev'"
echo "3. Rebuild client: cd client && npm run build"
echo "4. Test hibernation by connecting, disconnecting, waiting 60s, reconnecting"
echo ""
echo "Check server logs in Cloudflare Dashboard:"
echo "https://dash.cloudflare.com > Workers & Pages > hibernation-test > Logs"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

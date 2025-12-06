# 🔬 Raw Cloudflare Durable Object Hibernation Test

This is a **minimal reproduction test** to determine if Cloudflare's `state.getWebSockets()` API has a bug that prevents tracking WebSocket connections correctly.

## 🎯 Purpose

To answer the question: **Does `state.getWebSockets()` return an empty array during the initial `fetch()` request where `acceptWebSocket()` is called?**

This is **Phase 1** of testing - testing the raw Cloudflare API **without PartyKit wrapper** to isolate whether the issue is:
- ❌ A Cloudflare platform limitation
- ✅ A PartyKit wrapper bug

## 📁 Structure

```
HibernationBug/
├── raw-cloudflare/          # This test - Raw Cloudflare DO
│   ├── src/
│   │   ├── test-do.ts       # Durable Object with comprehensive logging
│   │   └── index.ts         # Worker entry point
│   ├── wrangler.toml        # DO configuration with hibernation ENABLED
│   ├── package.json
│   └── tsconfig.json
└── client/                  # Test client
    ├── src/
    │   ├── App.tsx          # UI with Connect/Ping/Disconnect/Status
    │   └── main.tsx
    ├── index.html
    ├── vite.config.ts
    ├── package.json
    └── tsconfig.json
```

## 🚀 Quick Start

### 1. Install dependencies

```bash
# Server
cd raw-cloudflare
npm install

# Client (in another terminal)
cd client
npm install
```

### 2. Start the DO server

```bash
cd raw-cloudflare
npm run dev
```

This starts Wrangler dev server on `http://localhost:8787`

### 3. Start the test client

```bash
cd client
npm run dev
```

This starts Vite dev server on `http://localhost:3000`

### 4. Open browser and test

Open `http://localhost:3000` in your browser

## 🧪 Test Protocol

Follow these steps in the test client UI:

1. **Click "Connect"**
   - Check server console for `[AFTER-ACCEPT]` logs
   - **Expected if working:** Count should equal acceptedCount
   - **Expected if buggy:** Count will be 0

2. **Click "Send Ping"**
   - Verify message handling works
   - Check `[MESSAGE]` logs in server console

3. **Click "Get Status"**
   - Check if counts match in UI
   - **Expected if working:** "✅ Counts match - working correctly"
   - **Expected if buggy:** "❌ Counts mismatch - BUG DETECTED"

4. **Click "Disconnect"**
   - Check server console for `[CLOSE]` logs
   - **Expected if working:** Close event fires
   - **Expected if buggy:** Close event may not fire

5. **Wait 60+ seconds**
   - DO should hibernate (removed from memory)
   
6. **Click "Connect" again**
   - Check server console for `[CONSTRUCTOR]` logs
   - **Expected if working:** Constructor sees existing connections
   - **Expected if buggy:** Constructor sees no connections despite hibernation metadata

## 📊 What We're Testing

The DO server (`test-do.ts`) logs at these critical points:

### Constructor
```typescript
constructor(state: DurableObjectState, env: any) {
  const connections = state.getWebSockets();
  console.log('[CONSTRUCTOR] getWebSockets():', connections.length);
}
```

### Before/After Accept
```typescript
// Before
const before = state.getWebSockets();
console.log('[BEFORE-ACCEPT] count:', before.length);

// Accept
state.acceptWebSocket(server);

// After - THIS IS THE CRITICAL TEST
const after = state.getWebSockets();
console.log('[AFTER-ACCEPT] count:', after.length);
```

### Message Handler
```typescript
webSocketMessage(ws: WebSocket, message: string) {
  console.log('[MESSAGE] Received:', message);
}
```

### Close Handler
```typescript
webSocketClose(ws: WebSocket, code: number, reason: string) {
  console.log('[CLOSE] WebSocket closed');
}
```

## ✅ Expected Results (If Working Correctly)

| Event | getWebSockets() Count | acceptedCount | Match? |
|-------|----------------------|---------------|---------|
| Before accept | 0 | 0 | ✅ |
| **After accept** | **1** | **1** | **✅** |
| Send message | 1 | 1 | ✅ |
| After disconnect | 0 | 0 | ✅ |
| After hibernation + reconnect | 1 | 1 | ✅ |

## ❌ Expected Results (If Bug Exists)

| Event | getWebSockets() Count | acceptedCount | Match? |
|-------|----------------------|---------------|---------|
| Before accept | 0 | 0 | ✅ |
| **After accept** | **0** | **1** | **❌ BUG** |
| Send message | 0 | 1 | ❌ |
| After disconnect | 0 | 0 | ✅ (or event doesn't fire) |
| After hibernation + reconnect | **0** | **1** | **❌ BUG** |

## 🔍 Key Implementation Details

### Manual Tracking
```typescript
private acceptedCount = 0;

state.acceptWebSocket(server, ['test']);
this.acceptedCount++;
```

### Testing getWebSockets() Immediately After Accept
```typescript
const afterAccept = this.state.getWebSockets();
console.log('[AFTER-ACCEPT] getWebSockets():', {
  count: afterAccept.length,  // Should be 1, but might be 0 if bug exists
  acceptedCount: this.acceptedCount,  // Will be 1 (manual tracking)
  mismatch: afterAccept.length !== this.acceptedCount
});
```

### Status Endpoint
```typescript
if (url.pathname === '/status') {
  const sockets = this.state.getWebSockets();
  return new Response(JSON.stringify({
    acceptedCount: this.acceptedCount,
    getWebSocketsCount: sockets.length,
    mismatch: this.acceptedCount !== sockets.length,
    verdict: mismatch ? '❌ BUG DETECTED' : '✅ Working correctly'
  }));
}
```

## 📝 Configuration Notes

### Hibernation is ENABLED
```toml
[durable_objects.bindings]
name = "RAW_TEST_DO"
class_name = "RawTestDO"
script_name = "hibernation-test"
```

Hibernation is **enabled** to test the documented behavior:
- After ~10 seconds of idle, DO should be removed from memory
- On reconnect, constructor should rebuild state from hibernated metadata
- `getWebSockets()` should return existing connections

### CORS Headers
The worker adds CORS headers for development:
```typescript
'Access-Control-Allow-Origin': '*'
```

## 🎯 Success Criteria

### If Bug Does NOT Exist (Cloudflare API works)
- ✅ `[AFTER-ACCEPT]` count equals acceptedCount
- ✅ Status endpoint shows "Counts match"
- ✅ `[CLOSE]` event fires on disconnect
- ✅ Constructor can rebuild state from hibernated connections

**Conclusion:** Bug is in PartyKit wrapper, proceed to Phase 2 testing

### If Bug DOES Exist (Cloudflare API broken)
- ❌ `[AFTER-ACCEPT]` count is 0 while acceptedCount is 1
- ❌ Status endpoint shows "BUG DETECTED"
- ❌ `[CLOSE]` event may not fire
- ❌ Constructor sees no connections after hibernation

**Conclusion:** Cloudflare platform limitation, manual tracking required, no point testing PartyKit

## 🚨 Common Issues

### WebSocket connects but no logs
- Check Wrangler dev server is running on port 8787
- Check browser console for connection errors

### CORS errors
- Ensure worker adds CORS headers (already configured)
- Restart Wrangler dev server

### TypeScript errors
- Run `npm install` in both `raw-cloudflare/` and `client/`

## 📚 Next Steps

Based on results:

### If Cloudflare API works correctly
1. Create Phase 2 test with PartyKit wrapper
2. Compare behavior to identify where PartyKit breaks
3. File detailed bug report with PartyKit

### If Cloudflare API is broken
1. Document findings
2. Accept that manual tracking is the only solution
3. Update HolyGrail documentation with confirmed root cause
4. Consider advocating for Cloudflare to fix their API

## 📖 Related Documentation

- Original bug report: `/HolyGrail/docs/Partyserver-Hibernation-Bug.md`
- Original test suite: `/HolyGrail/tests/unit/party/hibernation-bug.spec.ts`
- HolyGrail server implementation: `/HolyGrail/src/party/server.ts`

---

**Built with:**
- Cloudflare Durable Objects with Hibernation API
- React + TypeScript + Vite
- Wrangler dev server

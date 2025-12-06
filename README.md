# 🔬 Hibernation Bug Reproduction Tests

Minimal reproduction tests to prove whether Cloudflare's `state.getWebSockets()` API has a bug that prevents tracking WebSocket connections correctly.

## 🎯 Goal

Determine if the bug is in:
- ❌ **Cloudflare's platform** - `state.getWebSockets()` returns [] when it shouldn't
- ✅ **PartyKit's wrapper** - PartyKit incorrectly wraps the Cloudflare API

## 📁 Test Structure

```
HibernationBug/
├── raw-cloudflare/     # Phase 1: Test raw Cloudflare DO API
│   └── src/
│       ├── test-do.ts  # Minimal DO with comprehensive logging
│       └── index.ts    # Worker entry
│
├── client/             # Shared test client for both phases
│   └── src/
│       └── App.tsx     # Connect/Ping/Disconnect/Status UI
│
└── partykit/          # Phase 2: Test with PartyKit wrapper (if Phase 1 passes)
    └── (to be created)
```

## 🚀 Quick Start

See **[TESTING.md](./TESTING.md)** for complete setup and test protocol.

```bash
# Terminal 1: Start DO server
cd raw-cloudflare
npm install
npm run dev

# Terminal 2: Start test client
cd client
npm install
npm run dev

# Open browser to http://localhost:3000
```

## 🧪 Test Protocol

1. **Connect** - Check if `getWebSockets()` returns correct count after `acceptWebSocket()`
2. **Send Ping** - Verify message handling works
3. **Get Status** - Compare manual tracking vs `getWebSockets()`
4. **Disconnect** - Verify close event fires
5. **Wait 60s + Reconnect** - Test hibernation behavior

## 📊 Critical Test: After Accept

The most important test happens immediately after `state.acceptWebSocket()`:

```typescript
// Accept the WebSocket
state.acceptWebSocket(server);
this.acceptedCount++;  // Manual tracking

// CRITICAL TEST: Does Cloudflare's API work?
const after = state.getWebSockets();
console.log('[AFTER-ACCEPT]', {
  getWebSocketsCount: after.length,      // Should be 1
  acceptedCount: this.acceptedCount,     // Will be 1
  mismatch: after.length !== this.acceptedCount
});
```

**Expected:** `after.length === 1`  
**If bug exists:** `after.length === 0`

## ✅ Success Criteria

### Phase 1 Results: Cloudflare API Works
- `[AFTER-ACCEPT]` count equals acceptedCount (1 === 1)
- Status endpoint shows "✅ Counts match"
- Close events fire correctly
- Constructor can rebuild from hibernated connections

**Next Step:** Create Phase 2 test with PartyKit wrapper to identify where it breaks

### Phase 1 Results: Cloudflare API Broken
- `[AFTER-ACCEPT]` count is 0 while acceptedCount is 1
- Status endpoint shows "❌ BUG DETECTED"
- Close events may not fire
- Constructor cannot rebuild state

**Next Step:** Accept manual tracking as the only solution, document root cause

## 📚 Background

This test was created after:
1. Discovering PartyKit's `ctx.getWebSockets()` returns `[]`
2. Finding `this.getConnections()` has timing issues
3. Implementing manual tracking as a workaround
4. Needing proof of whether bug is in Cloudflare or PartyKit

Original context:
- HolyGrail project: `/home/jack/crack/Code/HolyGrail`
- Bug documentation: `docs/Partyserver-Hibernation-Bug.md`
- Unit tests: `tests/unit/party/hibernation-bug.spec.ts`
- Working implementation: `src/party/server.ts` (manual tracking)

## 🎓 Key Learnings

### Manual Tracking (Current Working Solution)
```typescript
private connections = new Map<string, Connection>();

onConnect(conn: Connection) {
  this.connections.set(conn.id, conn);  // Add immediately
}

onClose(conn: Connection) {
  this.connections.delete(conn.id);  // Remove on close
}

getConnectionCount() {
  return this.connections.size;  // Always accurate
}
```

### Why This Test Matters
- **Without hibernation:** Rooms stay in memory forever (costs 10-30% more)
- **With hibernation:** Rooms removed when empty, $0 cost until reactivated
- **With hibernation bug:** Can't track connections correctly, forced to disable hibernation

---

**See [TESTING.md](./TESTING.md) for complete test instructions.**

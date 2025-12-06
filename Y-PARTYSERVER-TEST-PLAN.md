# Y-PartyServer Hibernation Test

## Overview

This test validates whether **Yjs CRDT state** survives Durable Object hibernation when using the `y-partyserver` library.

## Why This Test Matters

HolyGrail uses Y-PartyServer (Yjs CRDT) for collaborative editing. Before enabling hibernation in production:
- ✅ We proved `getConnections()` survives hibernation (partykit-test)
- ❓ We need to prove **Yjs document state** survives hibernation
- ❓ We need to verify **awareness/presence** works after hibernation
- ❓ We need to confirm **CRDT sync** works when DO wakes up

## Test Setup

### Server: `y-partykit-test`

**Location:** `/home/jack/crack/Code/HibernationBug/y-partykit-test`

**Key Features:**
- Extends `YServer` from `y-partyserver@^0.0.51`
- Hibernation ENABLED: `{ hibernate: true }`
- Uses same test patterns as `partykit-test`
- Logs Yjs document state on:
  - `onStart()` - Check if doc survived hibernation
  - `onConnect()` - Verify clients get correct state
  - `onMessage()` - Monitor Yjs sync messages

**Deployed:** https://y-partykit-test.cloudflare-manatee010.workers.dev/parties/y-party-kit-test-server/test-room

**Version:** 3d164001-52ee-44ae-b9a7-92813af09fa4

### Client Updates

**Location:** `/home/jack/crack/Code/HibernationBug/client`

**Changes:**
- Added radio button selector for 3 backends:
  - Raw Cloudflare DO
  - PartyServer (no Yjs)
  - Y-PartyServer (Yjs CRDT) ← NEW
- Added dependencies:
  - `partysocket@^1.0.2`
  - `y-partyserver@^0.0.51`
  - `yjs@^13.6.27`

## Critical Test Scenarios

### 1. Document State Persistence
```
1. Client A connects, edits Yjs document
2. Wait 60s for hibernation
3. Client B connects
4. Expected: Client B receives correct doc state
5. Check logs: [YJS] Document state size > 2 bytes
```

### 2. Multiple Clients + Hibernation
```
1. Clients A & B connected, both editing
2. Wait for hibernation
3. Both clients disconnect
4. Client C connects (fresh wake)
5. Expected: Client C gets latest merged state
```

### 3. CRDT Sync After Wake
```
1. Client A connects to hibernated room
2. Client A edits (triggers wake)
3. Client B connects
4. Expected: Both clients have synced state
```

### 4. Awareness/Presence
```
1. Multiple clients connected
2. Hibernation occurs
3. Check if awareness state survives
4. Monitor [YJS-CONNECT] logs
```

## Server Logging Patterns

### On Hibernation Wake

```
[HIBERNATION WAKE-UP DETECTED]
[HIBERNATION] Time since instance creation: 0 ms
[YJS] Document state size: X bytes
[YJS] Document has content? true/false
```

If document state survives:
```
[YJS] ✅ Yjs document survived hibernation with data!
[YJS] Content preview: {...}
```

### On Connect

```
[CONNECT] Current connections: N
[YJS-CONNECT] Document content: {...}
[YJS-CONNECT] Client will receive this state via Y-PartyServer sync
```

### On Message

```
[MESSAGE] Type: Yjs sync (binary) | Custom message
[MESSAGE] Yjs binary size: X bytes
```

## Testing Protocol

1. **Deploy y-partykit-test**
   ```bash
   cd y-partykit-test
   npx wrangler deploy
   ```

2. **Start client locally**
   ```bash
   cd client
   npm run dev
   ```

3. **Test Sequence**
   - Select "Y-PartyServer (Yjs)" backend
   - Connect first client
   - Send some messages (triggers Yjs updates)
   - Wait 60s for hibernation
   - Open second tab, connect
   - Check logs for:
     - `[HIBERNATION WAKE-UP DETECTED]`
     - `[YJS] Document state size: X bytes`
     - `[YJS] ✅ Yjs document survived hibernation`

4. **Verify**
   - Both clients show same connection count
   - Yjs document state is consistent
   - No CRDT conflicts after wake

## Success Criteria

✅ **Pass if:**
- Yjs document state survives hibernation (size > 2 bytes after wake)
- getConnections() continues to work (already proven)
- Clients can sync after hibernation
- No data loss or corruption

❌ **Fail if:**
- Yjs document resets to empty `{}` after hibernation
- Awareness state is lost
- CRDT sync fails after wake
- Connection counts mismatch

## Next Steps After Validation

### If Tests Pass ✅

Apply to HolyGrail:
1. Change `YRoom.options.hibernate = true`
2. Remove manual `connections` Map
3. Remove connection counting logic (use `getConnections()`)
4. Add broadcasting on connect/disconnect
5. Deploy and monitor

### If Tests Fail ❌

Investigate:
1. Check if Y-PartyServer needs special hibernation handling
2. Review y-partyserver source for instance variables
3. Test if Yjs doc is stored in DO storage vs memory
4. Consider Y-PartyServer library update
5. Document findings and limitations

## Key Differences from partykit-test

| Feature | partykit-test | y-partykit-test |
|---------|---------------|-----------------|
| Base Class | `Server` | `YServer` |
| Yjs Support | None | Full CRDT sync |
| Message Types | Text only | Binary (Yjs) + Text |
| State Tracking | Connections only | Connections + Yjs doc |
| Test Focus | Connection counting | Doc state persistence |

## Known from Previous Tests

✅ **Already Proven:**
- `getConnections()` survives hibernation
- Broadcasting works after hibernation
- Mode determination works after hibernation
- Logs are buffered (Cloudflare infrastructure)
- Disconnect takes ~10s (WebSocket close handshake)

❓ **Testing Now:**
- Yjs document state survives hibernation
- CRDT sync works after hibernation
- Awareness/presence works after hibernation

## References

- **HIBERNATION-LESSONS-LEARNED.md** - All hibernation patterns and best practices
- **partykit-test** - Reference implementation (basic PartyServer)
- **HolyGrail/src/party/server.ts** - Production server (awaiting hibernation)
- **HolyGrail/src/party/y-room.ts** - YRoom base class (hibernation disabled)

---

**Status:** 🔄 Ready for testing
**Created:** 2025-12-06
**Deployment Version:** 3d164001-52ee-44ae-b9a7-92813af09fa4

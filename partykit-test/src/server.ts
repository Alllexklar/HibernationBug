/**
 * PartyServer Test - Using partyserver library like HolyGrail
 * 
 * This uses the exact same partyserver infrastructure as HolyGrail
 * to test if hibernation works with PartyServer wrapper.
 */

import { Server, type Connection, type ConnectionContext } from "partyserver";

export class PartyKitTestServer extends Server {
  static options = {
    hibernate: true  // CRITICAL: Enable hibernation to test it
  };

  private acceptedCount = 0;
  private instanceCreatedAt = Date.now();
  private lastMessageAt = 0;

  async onStart() {
    const now = Date.now();
    const timeSinceCreation = now - this.instanceCreatedAt;
    const timeSinceLastMessage = this.lastMessageAt > 0 ? now - this.lastMessageAt : 0;
    
    // 🔍 TEST: onStart after hibernation wake-up
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔥🔥🔥 [HIBERNATION WAKE-UP DETECTED] 🔥🔥🔥');
    console.log('[HIBERNATION] Instance created at:', new Date(this.instanceCreatedAt).toISOString());
    console.log('[HIBERNATION] Current time:', new Date(now).toISOString());
    console.log('[HIBERNATION] Time since instance creation:', timeSinceCreation, 'ms');
    if (this.lastMessageAt > 0) {
      console.log('[HIBERNATION] Last message was at:', new Date(this.lastMessageAt).toISOString());
      console.log('[HIBERNATION] Time since last message:', timeSinceLastMessage, 'ms');
      console.log('[HIBERNATION] ✅ PROOF: Instance was destroyed and recreated (onStart called again)');
    }
    console.log('[ON-START] PartyServer onStart called');
    console.log('[ON-START] Server name:', this.name);
    console.log('[ON-START] Timestamp:', new Date().toISOString());
    console.log('[ON-START] ⚠️  acceptedCount will be 0 (instance vars don\'t survive hibernation)');
    console.log('[ON-START] Current acceptedCount:', this.acceptedCount);
    
    // Try to access connections in onStart (like raw Cloudflare constructor)
    console.log('\n[ON-START-TEST] Checking connection APIs:');
    try {
      const connections = Array.from(this.getConnections());
      console.log('[ON-START] getConnections() returned:', {
        count: connections.length,
        timestamp: new Date().toISOString(),
        hasConnections: connections.length > 0,
      });
      
      if (connections.length > 0) {
        console.log('[ON-START] ✅ Connections found after hibernation wake-up');
        connections.forEach((conn, i) => {
          console.log(`[ON-START] Connection ${i + 1}:`, {
            id: conn.id.substring(0, 12) + '...',
            server: conn.server
          });
        });
      } else {
        console.log('[ON-START] No connections (fresh start or all closed)');
      }
    } catch (err) {
      console.log('[ON-START] ❌ Could not access connections:', err);
    }
    
    // Try raw Cloudflare state.getWebSockets()
    console.log('\n[ON-START-RAW-API] Testing raw Cloudflare API:');
    try {
      const rawSockets = this.ctx.getWebSockets();
      console.log('[ON-START-RAW-API] ctx.state.getWebSockets():', {
        count: rawSockets.length,
        message: 'Raw Cloudflare API accessible!'
      });
    } catch (err) {
      console.log('[ON-START-RAW-API] Error:', err);
    }
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  }

  async onConnect(connection: Connection, ctx: ConnectionContext): Promise<void> {
    const timeSinceCreation = Date.now() - this.instanceCreatedAt;
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('[CONNECT] New WebSocket connection');
    console.log('[CONNECT] Connection ID:', connection.id.substring(0, 12) + '...');
    console.log('[CONNECT] Server:', this.name);
    console.log('[CONNECT] Timestamp:', new Date().toISOString());
    console.log('[CONNECT] Time since instance creation:', timeSinceCreation, 'ms');
    
    if (timeSinceCreation < 1000) {
      console.log('[CONNECT] 🔥 Instance is very new - possible hibernation wake-up!');
      console.log('[CONNECT] 🎯 CRITICAL TEST: Connecting to hibernated DO');
    }
    
    // 🔍 TEST 1: Check connections BEFORE incrementing
    console.log('\n[TEST 1] BEFORE tracking - Check getConnections():');
    const beforeAccept = Array.from(this.getConnections());
    console.log('[BEFORE-ACCEPT] getConnections():', {
      count: beforeAccept.length,
      expectedAfter: this.acceptedCount + 1,
    });
    
    // 🔍 Check for HIBERNATION + NEW CONNECTION scenario
    if (timeSinceCreation < 1000 && beforeAccept.length > 0) {
      console.log('[BEFORE-ACCEPT] 🔥🔥🔥 SCENARIO: Connecting to HIBERNATED DO with existing connections!');
      console.log('[BEFORE-ACCEPT] Existing connections:', beforeAccept.length);
      console.log('[BEFORE-ACCEPT] This tests if new connection can join hibernated room');
    }
    
    // 🔍 TEST 2: Check raw Cloudflare API
    console.log('\n[TEST 2] Raw Cloudflare ctx.getWebSockets():');
    try {
      const rawSockets = this.ctx.getWebSockets();
      console.log('[RAW-API] ctx.getWebSockets():', {
        count: rawSockets.length,
        message: 'Checking if connection visible yet'
      });
    } catch (err) {
      console.log('[RAW-API] Error:', err);
    }
    
    // Track the connection
    this.acceptedCount++;
    
    console.log('\n[TEST 3] AFTER incrementing acceptedCount');
    console.log('[AFTER-INCREMENT]   - acceptedCount:', this.acceptedCount);
    
    // 🔍 TEST 4: CRITICAL - Check getConnections() after accept
    console.log('\n[TEST 4] CRITICAL - getConnections() after connection:');
    const afterAccept = Array.from(this.getConnections());
    console.log('[AFTER-ACCEPT] count:', afterAccept.length);
    console.log('[AFTER-ACCEPT] Expected:', this.acceptedCount);
    console.log('[AFTER-ACCEPT] Includes current?', afterAccept.some(c => c.id === connection.id));
    
    // 🔍 MODE DETERMINATION TEST
    const connectionCount = afterAccept.length;
    const mode = connectionCount <= 1 ? 'solo' : 'multi';
    console.log('\n[MODE-DETERMINATION] Based on getConnections():');
    console.log('[MODE] Connection count:', connectionCount);
    console.log('[MODE] Determined mode:', mode);
    if (timeSinceCreation < 1000) {
      console.log('[MODE] ⚠️  Mode determined on fresh instance after hibernation wake');
      console.log('[MODE] ✅ This proves mode detection works after hibernation!');
    }
    
    // 🎯 BROADCAST CONNECTION COUNT TO ALL CLIENTS
    console.log('\n[BROADCAST] Broadcasting connection count to ALL clients:');
    const connectionInfo = {
      type: 'connection-count',
      connectionCount,
      mode,
      event: 'connect',
      connectionId: connection.id.substring(0, 12),
      hibernationWake: timeSinceCreation < 1000,
      timestamp: new Date().toISOString()
    };
    console.log('[BROADCAST] Message:', connectionInfo);
    this.broadcast(JSON.stringify(connectionInfo));
    console.log('[BROADCAST] ✅ Sent to all clients!');
    
    if (afterAccept.length === 0) {
      console.log('[AFTER-ACCEPT] ❌❌❌ BUG: getConnections() returned [] !');
      console.log('[AFTER-ACCEPT] PartyServer does NOT populate array during onConnect');
    } else if (!afterAccept.some(c => c.id === connection.id)) {
      console.log('[AFTER-ACCEPT] ❌❌❌ TIMING BUG: Current connection NOT in getConnections() yet!');
      console.log('[AFTER-ACCEPT] This is the bug - connection not visible until AFTER onConnect()');
    } else if (afterAccept.length === this.acceptedCount) {
      console.log('[AFTER-ACCEPT] ✅✅✅ WORKING: getConnections() includes current connection!');
      console.log('[AFTER-ACCEPT] Count matches accepted connections');
    } else {
      console.log('[AFTER-ACCEPT] ⚠️⚠️⚠️  UNEXPECTED: Count mismatch');
      console.log(`[AFTER-ACCEPT] Expected: ${this.acceptedCount}, Got: ${afterAccept.length}`);
    }
    
    // Show connection IDs
    if (afterAccept.length > 0) {
      console.log('\n[AFTER-ACCEPT] Connections in array:');
      afterAccept.forEach((c, i) => {
        console.log(`  ${i + 1}. ${c.id.substring(0, 12)}... ${c.id === connection.id ? '← CURRENT' : ''}`);
      });
    }
    
    // 🔍 TEST 5: Check raw API again
    console.log('\n[TEST 5] Raw Cloudflare API after accept:');
    try {
      const rawSockets = this.ctx.getWebSockets();
      console.log('[RAW-API-AFTER] state.getWebSockets():', {
        count: rawSockets.length,
        matchesPartyServer: rawSockets.length === afterAccept.length
      });
      if (rawSockets.length !== afterAccept.length) {
        console.log('[RAW-API-AFTER] ❌❌❌ PartyServer count differs from raw Cloudflare!');
      }
    } catch (err) {
      console.log('[RAW-API-AFTER] Error:', err);
    }
    
    // 🔍 TEST 6: Delayed check
    setTimeout(() => {
      console.log('\n[TEST 6] Delayed check after setTimeout(0):');
      const afterTimeout = Array.from(this.getConnections());
      console.log('[DELAYED-CHECK] getConnections():', {
        count: afterTimeout.length,
        includesConnection: afterTimeout.some(c => c.id === connection.id),
        nowMatches: afterTimeout.length === this.acceptedCount
      });
      if (afterTimeout.some(c => c.id === connection.id) && !afterAccept.some(c => c.id === connection.id)) {
        console.log('[DELAYED-CHECK] ⚠️⚠️⚠️  Connection appeared AFTER onConnect completed!');
        console.log('[DELAYED-CHECK] This confirms the timing bug');
      }
    }, 0);
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  }

  async onMessage(connection: Connection, message: string | ArrayBuffer): Promise<void> {
    const now = Date.now();
    const timeSinceLastMessage = this.lastMessageAt > 0 ? now - this.lastMessageAt : 0;
    const timeSinceCreation = now - this.instanceCreatedAt;
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('[MESSAGE] Received message');
    console.log('[MESSAGE] From:', connection.id.substring(0, 12) + '...');
    console.log('[MESSAGE] Content:', message);
    console.log('[MESSAGE] Timestamp:', new Date().toISOString());
    console.log('[MESSAGE] Time since instance creation:', timeSinceCreation, 'ms');
    console.log('[MESSAGE] Time since last message:', timeSinceLastMessage, 'ms');
    
    // Update last message time
    this.lastMessageAt = now;
    
    // Detect if we just woke from hibernation
    if (timeSinceCreation < 100 && timeSinceLastMessage === 0) {
      console.log('[MESSAGE] 🆕 First message on fresh instance');
    } else if (timeSinceCreation < 1000) {
      console.log('[MESSAGE] 🔥🔥🔥 HIBERNATION DETECTED: Instance just created but receiving message!');
      console.log('[MESSAGE] This means DO was evicted and woke up for this message');
    }
    
    console.log('\n[MESSAGE-COUNT-TEST] Testing connection count APIs:');
    const currentConnections = Array.from(this.getConnections());
    const apiCount = currentConnections.length;
    
    console.log('[MESSAGE-COUNT] Connection counts:');
    console.log('[MESSAGE-COUNT]   - acceptedCount (manual):', this.acceptedCount);
    console.log('[MESSAGE-COUNT]   - getConnections() (API):', apiCount);
    
    if (apiCount === this.acceptedCount) {
      console.log('[MESSAGE-COUNT]   - Match? ✅✅✅ MATCH');
    } else {
      console.log('[MESSAGE-COUNT]   - Match? ❌❌❌ MISMATCH (diff: ' + (apiCount - this.acceptedCount) + ')');
      if (this.acceptedCount === 0 && apiCount > 0) {
        console.log('[MESSAGE-COUNT]   - 🔥 LIKELY CAUSE: DO just woke from hibernation (acceptedCount reset to 0)');
        console.log('[MESSAGE-COUNT]   - ✅ BUT getConnections() still works! Connection survived hibernation!');
      }
    }
    
    // Show all connection IDs
    if (currentConnections.length > 0) {
      console.log('\n[MESSAGE-CONNECTIONS] Current connections:');
      currentConnections.forEach((conn, i) => {
        const isSender = conn.id === connection.id;
        console.log(`[MESSAGE-CONNECTIONS] ${i + 1}. ${conn.id.substring(0, 12)}... ${isSender ? '← SENDER' : ''}`);
      });
    }
    
    // Try raw Cloudflare API
    console.log('\n[MESSAGE-RAW-API] Testing raw Cloudflare API:');
    try {
      const rawSockets = this.ctx.getWebSockets();
      console.log('[MESSAGE-RAW-API] ctx.getWebSockets():', {
        count: rawSockets.length,
        matchesAccepted: rawSockets.length === this.acceptedCount,
        matchesPartyServer: rawSockets.length === apiCount
      });
      if (rawSockets.length !== apiCount) {
        console.log('[MESSAGE-RAW-API] ❌❌❌ Raw Cloudflare count differs from PartyServer!');
      }
    } catch (err) {
      console.log('[MESSAGE-RAW-API] Error:', err);
    }

    // Broadcast to ALL connections
    console.log('\n[MESSAGE-BROADCAST] Broadcasting to', apiCount, 'connections');
    const broadcastMsg = JSON.stringify({
      type: 'broadcast',
      originalMessage: typeof message === 'string' ? message : '<binary>',
      from: connection.id.substring(0, 8) + '...',
      serverTime: new Date().toISOString(),
      trackedConnections: apiCount,
      acceptedConnections: this.acceptedCount
    });
    
    this.broadcast(broadcastMsg);
    console.log('[MESSAGE-BROADCAST] Broadcast complete');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  }

  async onClose(connection: Connection): Promise<void> {
    const timeSinceCreation = Date.now() - this.instanceCreatedAt;
    
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('[CLOSE] ✅ onClose event FIRED!');
    console.log('[CLOSE] Timestamp:', new Date().toISOString());
    console.log('[CLOSE] Connection ID:', connection.id.substring(0, 12) + '...');
    console.log('[CLOSE] Time since instance creation:', timeSinceCreation, 'ms');
    
    if (timeSinceCreation < 1000) {
      console.log('[CLOSE] 🔥🔥🔥 CRITICAL: Disconnecting from FRESH instance after hibernation!');
      console.log('[CLOSE] This tests if onClose works correctly after hibernation wake');
    }
    
    console.log('\n[CLOSE-COUNT-TEST] Testing connection counts during onClose:');
    console.log('[CLOSE-COUNT]   - acceptedCount:', this.acceptedCount);
    
    // Check getConnections() DURING onClose
    const connectionsNow = Array.from(this.getConnections());
    const remainingCount = connectionsNow.length;
    console.log('[CLOSE-COUNT] getConnections() DURING onClose:', remainingCount);
    console.log('[CLOSE-COUNT] Still includes closing connection?', 
      connectionsNow.some(c => c.id === connection.id));
    
    // 🔍 MODE DETERMINATION AFTER CLOSE
    const modeAfterClose = remainingCount <= 1 ? 'will-be-solo' : 'will-be-multi';
    console.log('\n[MODE-AFTER-CLOSE] Mode after this disconnect:');
    console.log('[MODE-AFTER-CLOSE] Remaining connections:', remainingCount);
    console.log('[MODE-AFTER-CLOSE] Expected mode after close:', modeAfterClose);
    if (timeSinceCreation < 1000) {
      console.log('[MODE-AFTER-CLOSE] 🔥 Mode recalculation on fresh instance after hibernation');
    }
    
    // Try raw Cloudflare API
    console.log('\n[CLOSE-RAW-API] Testing raw Cloudflare API:');
    try {
      const rawSockets = this.ctx.getWebSockets();
      console.log('[CLOSE-RAW-API] ctx.getWebSockets():', {
        count: rawSockets.length,
        matchesPartyServer: rawSockets.length === connectionsNow.length
      });
      if (rawSockets.length !== remainingCount) {
        console.log('[CLOSE-RAW-API] ❌❌❌ MISMATCH between raw and PartyServer during close!');
      }
    } catch (err) {
      console.log('[CLOSE-RAW-API] Error:', err);
    }
    
    // Delayed check - see if connection is removed AFTER onClose
    setTimeout(() => {
      console.log('\n[CLOSE-DELAYED] Checking connections after onClose completed:');
      const afterClose = Array.from(this.getConnections());
      const finalCount = afterClose.length;
      console.log('[CLOSE-DELAYED] getConnections():', finalCount);
      
      if (afterClose.some(c => c.id === connection.id)) {
        console.log('[CLOSE-DELAYED] ❌❌❌ CRITICAL BUG: Closed connection STILL in array!');
      } else if (connectionsNow.some(c => c.id === connection.id)) {
        console.log('[CLOSE-DELAYED] ✅ Connection was removed after onClose');
      }
      
      // Final mode check
      const finalMode = finalCount <= 1 ? 'solo' : 'multi';
      console.log('[CLOSE-DELAYED] Final mode:', finalMode);
      console.log('[CLOSE-DELAYED] Mode matches expectation?', finalMode === (remainingCount - 1 <= 1 ? 'solo' : 'multi') ? '✅' : '❌');
      
      // 🎯 BROADCAST UPDATED CONNECTION COUNT TO ALL REMAINING CLIENTS
      console.log('\n[BROADCAST] Broadcasting updated connection count after disconnect:');
      const disconnectInfo = {
        type: 'connection-count',
        connectionCount: finalCount,
        mode: finalMode,
        event: 'disconnect',
        timestamp: new Date().toISOString()
      };
      console.log('[BROADCAST] Message:', disconnectInfo);
      this.broadcast(JSON.stringify(disconnectInfo));
      console.log('[BROADCAST] ✅ Sent to all remaining clients!');
      
      // Try raw API after close
      try {
        const rawAfterClose = this.ctx.getWebSockets();
        console.log('[CLOSE-DELAYED] ctx.getWebSockets() after close:', rawAfterClose.length);
        console.log('[CLOSE-DELAYED] Matches getConnections()?', rawAfterClose.length === finalCount ? '✅' : '❌');
      } catch (err) {
        console.log('[CLOSE-DELAYED] Error accessing raw API:', err);
      }
    }, 0);
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  }

  async onError(connection: Connection, error: unknown): Promise<void> {
    console.log('[ERROR] WebSocket error:', error);
  }

  async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    
    // Status endpoint - check if path ends with /status
    if (url.pathname.endsWith('/status')) {
      // getConnections() count (PartyServer API)
      const connections = Array.from(this.getConnections());
      const apiCount = connections.length;
      
      // Try raw Cloudflare API
      let rawCount = 0;
      try {
        const rawSockets = this.ctx.getWebSockets();
        rawCount = rawSockets.length;
      } catch (err) {
        console.log('[STATUS] ❌ Could not access ctx.getWebSockets:', err);
      }
      
      // Match raw DO status structure
      const status = {
        acceptedCount: this.acceptedCount,
        getWebSocketsCount: apiCount,  // Use PartyServer's getConnections() as equivalent
        mismatch: this.acceptedCount !== apiCount,
        timestamp: new Date().toISOString(),
        verdict: this.acceptedCount === apiCount
          ? '✅ Counts match - working correctly'
          : '❌ Counts mismatch - BUG DETECTED',
        // Extra PartyServer info
        rawCloudflareCount: rawCount,
        hibernationEnabled: true,
        serverName: this.name
      };
      
      console.log('[STATUS]', status);
      
      return new Response(JSON.stringify(status, null, 2), {
        headers: { 
          'Content-Type': 'application/json', 
          'Access-Control-Allow-Origin': '*' 
        }
      });
    }
    
    return new Response('PartyServer Test - Status available at /status', {
      headers: { 'Access-Control-Allow-Origin': '*' }
    });
  }
}

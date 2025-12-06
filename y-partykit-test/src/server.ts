/**
 * Y-PartyServer Test - Using y-partyserver library with Yjs CRDT
 * 
 * This tests if hibernation works with Y-PartyServer (Yjs integration).
 * Based on partykit-test but adds Yjs document synchronization.
 */

import type { Connection, ConnectionContext, WSMessage } from "partyserver";
import { YServer } from "y-partyserver";

export class YPartyKitTestServer extends YServer {
  static options = {
    hibernate: true  // CRITICAL: Enable hibernation to test it
  };

  private instanceCreatedAt = Date.now();
  private lastMessageAt = 0;

  async onStart() {
    const now = Date.now();
    const timeSinceCreation = now - this.instanceCreatedAt;
    const timeSinceLastMessage = this.lastMessageAt > 0 ? now - this.lastMessageAt : 0;
    
    // �🔥🔥 VERY EXPLICIT HIBERNATION DETECTION 🔥🔥🔥
    console.log('');
    console.log('🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥');
    console.log('🔥🔥🔥                                        🔥🔥🔥');
    console.log('🔥🔥🔥    DURABLE OBJECT WAKE-UP DETECTED     🔥🔥🔥');
    console.log('🔥🔥🔥         (onStart() called)              🔥🔥🔥');
    console.log('🔥🔥🔥                                        🔥🔥🔥');
    console.log('🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥');
    console.log('');
    
    console.log('⏰ Instance created at:', new Date(this.instanceCreatedAt).toISOString());
    console.log('⏰ Current time:', new Date(now).toISOString());
    console.log('⏰ Time since instance creation:', (timeSinceCreation / 1000).toFixed(1), 'seconds');
    
    if (this.lastMessageAt > 0) {
      console.log('');
      console.log('💤 Last message was at:', new Date(this.lastMessageAt).toISOString());
      console.log('💤 Time since last message:', (timeSinceLastMessage / 1000).toFixed(1), 'seconds');
      console.log('');
      console.log('✅ ✅ ✅ HIBERNATION CONFIRMED ✅ ✅ ✅');
      console.log('✅ Instance was destroyed and recreated!');
      console.log('✅ Durable Object hibernated for', (timeSinceLastMessage / 1000).toFixed(1), 'seconds');
      console.log('');
    }
    
    console.log('[ON-START] Y-PartyServer Details:');
    console.log('  - Server name:', this.name);
    console.log('  - Timestamp:', new Date().toISOString());
    console.log('');
    
    // 🔍 CRITICAL TEST: Check Yjs document state after hibernation
    console.log('📊 CHECKING YJS DOCUMENT STATE AFTER WAKE:');
    try {
      const docState = this.document.toJSON();
      const stateSize = JSON.stringify(docState).length;
      console.log('  - Document state size:', stateSize, 'bytes');
      console.log('  - Document has content?', stateSize > 2 ? '✅ YES' : '❌ NO (empty)');
      if (stateSize > 2) {
        console.log('  - 🎉 YJS DOCUMENT STATE SURVIVED HIBERNATION! 🎉');
      }
      if (stateSize > 2) {
        console.log('[YJS] ✅ Yjs document survived hibernation with data!');
        console.log('[YJS] Content preview:', JSON.stringify(docState).substring(0, 100));
      } else {
        console.log('[YJS] Document is empty (fresh start)');
      }
    } catch (err) {
      console.log('[YJS] ❌ Error accessing Yjs doc:', err);
    }
    
    // Try to access connections in onStart
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
    
    // Try raw Cloudflare API
    console.log('\n[ON-START-RAW-API] Testing raw Cloudflare API:');
    try {
      const rawSockets = this.ctx.getWebSockets();
      console.log('[ON-START-RAW-API] ctx.getWebSockets():', {
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
    console.log('[CONNECT] ✅ New WebSocket connection');
    console.log('[CONNECT] Connection ID:', connection.id.substring(0, 12) + '...');
    console.log('[CONNECT] Timestamp:', new Date().toISOString());
    console.log('[CONNECT] Time since instance creation:', timeSinceCreation, 'ms');
    
    if (timeSinceCreation < 1000) {
      console.log('[CONNECT] 🔥 HIBERNATION WAKE - Connecting to fresh instance after hibernation!');
    }
    
    // CRITICAL: Call parent onConnect FIRST to let Y-PartyServer set up the connection
    await super.onConnect(connection, ctx);
    
    // Get current connection count
    const connections = Array.from(this.getConnections());
    const connectionCount = connections.length;
    
    console.log('[CONNECT] Current connections:', connectionCount);
    console.log('[CONNECT] New connection is included?', connections.some(c => c.id === connection.id) ? '✅' : '❌');
    
    // Check for HIBERNATION + NEW CONNECTION scenario
    if (timeSinceCreation < 1000 && connectionCount > 1) {
      console.log('[CONNECT] 🔥🔥🔥 CRITICAL TEST: New client joining hibernated room with', connectionCount - 1, 'existing connections');
    }
    
    // Verify raw API matches
    try {
      const rawCount = this.ctx.getWebSockets().length;
      console.log('[CONNECT] Raw API count:', rawCount, rawCount === connectionCount ? '✅ matches' : '❌ mismatch');
    } catch (err) {
      console.log('[CONNECT] Raw API error:', err);
    }
    
    // Determine mode
    const mode = connectionCount <= 1 ? 'solo' : 'multi';
    console.log('[CONNECT] Mode:', mode);
    
    // 🔍 TEST: Yjs document state on connect
    console.log('\n[YJS-CONNECT] Yjs document state:');
    try {
      const docState = this.document.toJSON();
      console.log('[YJS-CONNECT] Document content:', JSON.stringify(docState).substring(0, 100));
      console.log('[YJS-CONNECT] Client will receive this state via Y-PartyServer sync');
    } catch (err) {
      console.log('[YJS-CONNECT] Error:', err);
    }
    
    // 🎯 BROADCAST CONNECTION COUNT TO ALL CLIENTS
    const connectionInfo = {
      type: 'connection-count',
      connectionCount,
      mode,
      event: 'connect',
      connectionId: connection.id.substring(0, 12),
      hibernationWake: timeSinceCreation < 1000,
      timestamp: new Date().toISOString()
    };
    console.log('[BROADCAST] Broadcasting to all clients:', connectionInfo);
    this.broadcast(JSON.stringify(connectionInfo));
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  }

  override handleMessage(connection: Connection, message: WSMessage): void {
    const now = Date.now();
    const timeSinceLastMessage = this.lastMessageAt > 0 ? now - this.lastMessageAt : 0;
    const timeSinceCreation = now - this.instanceCreatedAt;
    
    // Check if it's a Yjs sync message (binary) or custom message
    const isYjsMessage = message instanceof ArrayBuffer || ArrayBuffer.isView(message);
    
    // Detect awareness messages (they start with 0x01 and are small ~12 bytes)
    let messageType = 'unknown';
    if (isYjsMessage) {
      let bytes: Uint8Array;
      if (message instanceof ArrayBuffer) {
        bytes = new Uint8Array(message);
      } else {
        bytes = new Uint8Array(message.buffer, message.byteOffset, message.byteLength);
      }
      
      const size = bytes.length;
      const firstByte = bytes[0];
      
      // Yjs message types:
      // 0x00 = sync step 1 (state vector)
      // 0x01 = sync step 2 (update) or awareness
      // 0x02 = sync step 2 continuation
      
      if (firstByte === 0x01 && size < 20) {
        messageType = 'AWARENESS (heartbeat)';
      } else if (firstByte === 0x00) {
        messageType = 'YJS SYNC (state vector)';
      } else if (firstByte === 0x01 || firstByte === 0x02) {
        messageType = 'YJS UPDATE (content change)';
      } else {
        messageType = 'YJS (unknown type)';
      }
      
      console.log(`[${messageType}] ${size}B from ${connection.id.substring(0, 8)}... (${timeSinceCreation}ms since wake)`);
    } else {
      console.log('[CUSTOM MESSAGE]', message);
    }
    
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
    
    console.log('[MESSAGE-COUNT] Connection count:', apiCount);
    console.log('[MESSAGE-COUNT] ✅ Using getConnections() - the ONLY reliable method');
    
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
        matchesPartyServer: rawSockets.length === apiCount
      });
      if (rawSockets.length !== apiCount) {
        console.log('[MESSAGE-RAW-API] ❌❌❌ Raw Cloudflare count differs from PartyServer!');
      }
    } catch (err) {
      console.log('[MESSAGE-RAW-API] Error:', err);
    }
    
    console.log('\n[YJS-DEBUG] About to call YServer.handleMessage()...');
    console.log('[YJS-DEBUG] Current Yjs doc state before processing:');
    try {
      const docState = this.document.toJSON();
      console.log('[YJS-DEBUG] Doc content:', JSON.stringify(docState));
      console.log('[YJS-DEBUG] Doc size:', JSON.stringify(docState).length, 'bytes');
    } catch (err) {
      console.log('[YJS-DEBUG] Could not read doc:', err);
    }
    
    // Call parent handleMessage to handle Yjs sync
    console.log('[YJS-DEBUG] 🔄 Calling super.handleMessage()...');
    try {
      super.handleMessage(connection, message);
      console.log('[YJS-DEBUG] ✅ super.handleMessage() succeeded');
    } catch (err) {
      console.log('[YJS-DEBUG] ❌❌❌ super.handleMessage() FAILED:', err);
      console.log('[YJS-DEBUG] Error name:', (err as Error).name);
      console.log('[YJS-DEBUG] Error message:', (err as Error).message);
      console.log('[YJS-DEBUG] Error stack:', (err as Error).stack);
      throw err; // Re-throw to see full error
    }
    
    console.log('[YJS-DEBUG] Yjs doc state AFTER processing:');
    try {
      const docState = this.document.toJSON();
      console.log('[YJS-DEBUG] Doc content:', JSON.stringify(docState));
      console.log('[YJS-DEBUG] Doc size:', JSON.stringify(docState).length, 'bytes');
    } catch (err) {
      console.log('[YJS-DEBUG] Could not read doc:', err);
    }
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // For custom (non-Yjs) messages, broadcast to all
    if (!isYjsMessage) {
      console.log('\n[MESSAGE-BROADCAST] Broadcasting custom message to', apiCount, 'connections');
      const broadcastMsg = JSON.stringify({
        type: 'broadcast',
        originalMessage: typeof message === 'string' ? message : '<binary>',
        from: connection.id.substring(0, 8) + '...',
        serverTime: new Date().toISOString(),
        connectionCount: apiCount
      });
      
      this.broadcast(broadcastMsg);
      console.log('[MESSAGE-BROADCAST] Broadcast complete');
    }
  }

  async onClose(connection: Connection, code: number, reason: string, wasClean: boolean): Promise<void> {
    const timeSinceCreation = Date.now() - this.instanceCreatedAt;
    
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('[CLOSE] ❌ Connection closing');
    console.log('[CLOSE] Connection ID:', connection.id.substring(0, 12) + '...');
    console.log('[CLOSE] Timestamp:', new Date().toISOString());
    console.log('[CLOSE] Time since instance creation:', timeSinceCreation, 'ms');
    
    if (timeSinceCreation < 1000) {
      console.log('[CLOSE] 🔥 HIBERNATION - Disconnect on fresh instance after hibernation!');
    }
    
    // Delayed check to get accurate count after connection is removed
    setTimeout(() => {
      const connections = Array.from(this.getConnections());
      const connectionCount = connections.length;
      const mode = connectionCount <= 1 ? 'solo' : 'multi';
      
      console.log('[CLOSE-DELAYED] Final connection count:', connectionCount);
      console.log('[CLOSE-DELAYED] Mode:', mode);
      
      // Verify raw API
      try {
        const rawCount = this.ctx.getWebSockets().length;
        console.log('[CLOSE-DELAYED] Raw API count:', rawCount, rawCount === connectionCount ? '✅ matches' : '❌ mismatch');
      } catch (err) {
        console.log('[CLOSE-DELAYED] Raw API error:', err);
      }
      
      // 🎯 BROADCAST UPDATED CONNECTION COUNT
      const disconnectInfo = {
        type: 'connection-count',
        connectionCount,
        mode,
        event: 'disconnect',
        timestamp: new Date().toISOString()
      };
      console.log('[BROADCAST] Broadcasting to remaining clients:', disconnectInfo);
      this.broadcast(JSON.stringify(disconnectInfo));
    }, 0);
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    // Call parent onClose to handle Yjs cleanup
    await super.onClose(connection, code, reason, wasClean);
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
      
      // Get Yjs document state
      let yjsState = {};
      let yjsStateSize = 0;
      try {
        yjsState = this.document.toJSON();
        yjsStateSize = JSON.stringify(yjsState).length;
      } catch (err) {
        console.log('[STATUS] ❌ Could not access Yjs doc:', err);
      }
      
      const status = {
        connectionCount: apiCount,
        rawCloudflareCount: rawCount,
        match: rawCount === apiCount,
        timestamp: new Date().toISOString(),
        verdict: rawCount === apiCount
          ? '✅ PartyServer matches raw Cloudflare API'
          : '❌ API mismatch detected',
        hibernationEnabled: true,
        serverName: this.name,
        yjs: {
          documentStateSize: yjsStateSize,
          hasContent: yjsStateSize > 2,
          preview: JSON.stringify(yjsState).substring(0, 200)
        }
      };
      
      console.log('[STATUS]', status);
      
      return new Response(JSON.stringify(status, null, 2), {
        headers: { 
          'Content-Type': 'application/json', 
          'Access-Control-Allow-Origin': '*' 
        }
      });
    }
    
    return new Response('Y-PartyServer Test - Status available at /status', {
      headers: { 'Access-Control-Allow-Origin': '*' }
    });
  }
}

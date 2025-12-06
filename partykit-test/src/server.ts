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
    console.log('[CONNECT] ✅ New WebSocket connection');
    console.log('[CONNECT] Connection ID:', connection.id.substring(0, 12) + '...');
    console.log('[CONNECT] Timestamp:', new Date().toISOString());
    console.log('[CONNECT] Time since instance creation:', timeSinceCreation, 'ms');
    
    if (timeSinceCreation < 1000) {
      console.log('[CONNECT] 🔥 HIBERNATION WAKE - Connecting to fresh instance after hibernation!');
    }
    
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

    // Broadcast to ALL connections
    console.log('\n[MESSAGE-BROADCAST] Broadcasting to', apiCount, 'connections');
    const broadcastMsg = JSON.stringify({
      type: 'broadcast',
      originalMessage: typeof message === 'string' ? message : '<binary>',
      from: connection.id.substring(0, 8) + '...',
      serverTime: new Date().toISOString(),
      connectionCount: apiCount
    });
    
    this.broadcast(broadcastMsg);
    console.log('[MESSAGE-BROADCAST] Broadcast complete');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  }

  async onClose(connection: Connection): Promise<void> {
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
      
      const status = {
        connectionCount: apiCount,
        rawCloudflareCount: rawCount,
        match: rawCount === apiCount,
        timestamp: new Date().toISOString(),
        verdict: rawCount === apiCount
          ? '✅ PartyServer matches raw Cloudflare API'
          : '❌ API mismatch detected',
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

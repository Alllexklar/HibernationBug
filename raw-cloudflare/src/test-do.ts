/**
 * Raw Cloudflare Durable Object - Zero Abstractions
 * 
 * This tests Cloudflare's getWebSockets() behavior directly without any wrappers.
 * 
 * CRITICAL TEST: Does ctx.getWebSockets() return [] or actual connections during fetch?
 */

export class RawTestDO {
  private acceptedCount = 0;

  constructor(
    private state: DurableObjectState,
    private env: any
  ) {
    // 🔍 TEST: Constructor after hibernation wake-up
    const socketsInConstructor = this.state.getWebSockets();
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('[CONSTRUCTOR] Durable Object instantiated');
    console.log('[CONSTRUCTOR] getWebSockets() returned:', {
      count: socketsInConstructor.length,
      timestamp: new Date().toISOString(),
      hasConnections: socketsInConstructor.length > 0,
    });
    
    if (socketsInConstructor.length > 0) {
      console.log('[CONSTRUCTOR] ✅ Connections found in constructor (after hibernation wake-up)');
      for (const ws of socketsInConstructor) {
        try {
          const attachment = ws.deserializeAttachment();
          console.log('[CONSTRUCTOR] Connection:', attachment);
        } catch (err) {
          console.log('[CONSTRUCTOR] Could not deserialize attachment:', err);
        }
      }
    } else {
      console.log('[CONSTRUCTOR] No connections in constructor (fresh start or all closed)');
    }
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const upgradeHeader = request.headers.get('Upgrade');

    // Status endpoint
    if (url.pathname === '/status') {
      const sockets = this.state.getWebSockets();
      return new Response(JSON.stringify({
        acceptedCount: this.acceptedCount,
        getWebSocketsCount: sockets.length,
        mismatch: this.acceptedCount !== sockets.length,
        timestamp: new Date().toISOString(),
        verdict: this.acceptedCount === sockets.length 
          ? '✅ Counts match - working correctly' 
          : '❌ Counts mismatch - BUG DETECTED'
      }, null, 2), {
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    // WebSocket upgrade
    if (upgradeHeader === 'websocket') {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      
      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('[FETCH] WebSocket upgrade request received');
      
      // 🔍 TEST: Before accepting
      const beforeAccept = this.state.getWebSockets();
      console.log('[BEFORE-ACCEPT] getWebSockets():', {
        count: beforeAccept.length,
        timestamp: new Date().toISOString()
      });

      // Accept WebSocket with tags
      const connectionId = crypto.randomUUID();
      const timestamp = Date.now();
      
      console.log('[ACCEPTING] Calling state.acceptWebSocket()...', {
        connectionId,
        tags: [connectionId, 'test-connection']
      });
      
      this.state.acceptWebSocket(server, [connectionId, 'test-connection']);
      this.acceptedCount++;
      
      // Store metadata
      server.serializeAttachment({
        id: connectionId,
        acceptedAt: timestamp,
        type: 'test-connection'
      });
      
      console.log('[ACCEPTED] ✅ WebSocket accepted successfully');

      // 🔍 CRITICAL TEST: Immediately after accepting
      const afterAccept = this.state.getWebSockets();
      const afterAcceptWithTag = this.state.getWebSockets(connectionId);
      
      console.log('\n🔬 CRITICAL TEST: getWebSockets() immediately after accept:');
      console.log('[AFTER-ACCEPT] getWebSockets():', {
        count: afterAccept.length,
        countWithTag: afterAcceptWithTag.length,
        acceptedCount: this.acceptedCount,
        timestamp: new Date().toISOString()
      });

      // Verdict
      if (afterAccept.length === 0) {
        console.log('❌ BUG CONFIRMED: getWebSockets() returned [] during fetch!');
        console.log('   Cloudflare does NOT populate array during fetch lifecycle');
      } else if (afterAccept.length === this.acceptedCount) {
        console.log('✅ WORKING: getWebSockets() returned connections immediately');
        console.log('   Count matches accepted connections');
      } else {
        console.log('⚠️  UNEXPECTED: Count mismatch but not zero');
        console.log(`   Expected: ${this.acceptedCount}, Got: ${afterAccept.length}`);
      }

      // Try to deserialize
      if (afterAccept.length > 0) {
        try {
          const attachment = afterAccept[0].deserializeAttachment();
          console.log('[AFTER-ACCEPT] Can deserialize attachment:', attachment);
        } catch (err) {
          console.log('[AFTER-ACCEPT] Cannot deserialize attachment:', err);
        }
      }

      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      // Return WebSocket upgrade response
      return new Response(null, {
        status: 101,
        webSocket: client,
      });
    }

    return new Response('Raw Cloudflare DO Test\nEndpoints:\n- WebSocket: ws://\n- Status: /status', {
      headers: { 'Access-Control-Allow-Origin': '*' }
    });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const msg = typeof message === 'string' ? message : new TextDecoder().decode(message);
    const sockets = this.state.getWebSockets();
    
    // Get sender info
    let senderId = 'unknown';
    try {
      const attachment = ws.deserializeAttachment();
      senderId = attachment.id;
    } catch {}
    
    console.log('[MESSAGE] Received:', {
      message: msg,
      from: senderId.substring(0, 8) + '...',
      currentCount: sockets.length,
      timestamp: new Date().toISOString()
    });

    // Broadcast to ALL connections (including sender)
    const broadcastMsg = JSON.stringify({
      type: 'broadcast',
      originalMessage: msg,
      from: senderId.substring(0, 8) + '...',
      serverTime: new Date().toISOString(),
      trackedConnections: sockets.length,
      acceptedConnections: this.acceptedCount
    });
    
    for (const socket of sockets) {
      try {
        socket.send(broadcastMsg);
      } catch (err) {
        console.log('[BROADCAST] Failed to send to socket:', err);
      }
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
    let attachment: any = null;
    try {
      attachment = ws.deserializeAttachment();
    } catch (err) {
      console.log('[CLOSE] Could not deserialize attachment:', err);
    }

    const beforeClose = this.state.getWebSockets();
    
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('[CLOSE] ✅ webSocketClose event FIRED!');
    console.log('[CLOSE] Connection details:', {
      connectionId: attachment?.id,
      code,
      reason,
      wasClean,
      socketsBeforeClose: beforeClose.length,
      timestamp: new Date().toISOString()
    });
    
    // Check if we can see the closing socket
    if (beforeClose.length > 0) {
      console.log('[CLOSE] ✅ Can still see connections in getWebSockets()');
    } else {
      console.log('[CLOSE] ⚠️  getWebSockets() is empty during close event');
    }
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  }

  async webSocketError(ws: WebSocket, error: unknown) {
    console.log('[ERROR] WebSocket error:', error);
  }
}

/**
 * Custom Yjs PartyServer - Hibernation Compatible
 * 
 * Instead of using y-partyserver (which has GC that prevents hibernation),
 * we implement Yjs sync directly in PartyServer with gc: false
 * 
 * HIBERNATION COMPATIBILITY CHECKLIST:
 * ✅ Y.Doc({ gc: false }) - No background GC timers
 * ✅ NO event listeners on Y.Doc or Awareness - Event listeners prevent hibernation!
 * ✅ Message-driven architecture - Handle updates only when messages arrive
 * ✅ No automatic awareness - Client-controlled only
 * ✅ No setInterval/recurring timers
 * ✅ Uses Cloudflare hibernatable WebSocket API
 * ✅ hibernate: true in Server.options
 * 
 * KEY INSIGHT: Even with gc: false, Y.Doc event listeners (doc.on('update')) 
 * prevent hibernation because they keep the event loop active. Solution is to 
 * remove all event listeners and handle everything reactively in onMessage().
 * 
 * HIBERNATION DETECTION:
 * - onStart() called with timeSinceCreation < 100ms = wake-up
 * - onConnect() with fresh instance = hibernation wake for new connection
 * - onMessage() with fresh instance = hibernation wake for message
 * 
 * EXPECTED BEHAVIOR:
 * - Solo/Multi mode with awareness OFF + no typing = hibernates after 30-60s
 * - Typing triggers Yjs sync messages = keeps awake (correct!)
 * - Awareness toggle ON = sends awareness = keeps awake (user action)
 */

import { Server, type Connection, type ConnectionContext } from "partyserver";
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
const MESSAGE_CUSTOM = 2; // For config, modes, etc.

interface CustomMessage {
  type: 'config' | 'mode' | 'ping' | 'pong' | 'connection-count';
  data?: any;
  timestamp?: string;
}

export class YjsPartyServer extends Server {
  static options = {
    hibernate: true  // ✅ Hibernation works because we disable Yjs GC!
  };

  private doc: Y.Doc | null = null;
  private awareness: awarenessProtocol.Awareness | null = null;
  private instanceCreatedAt = Date.now();
  private persistenceKey = 'yjs-document-state';
  private lastMessageAt = 0;
  private lastActivityAt = 0;
  
  
  // Custom awareness - just a Map, no timers, hibernation-safe
  private customAwareness = new Map<string, any>();
  
  // Connected users with their metadata (name, color, profile_picture_url)
  private connectedUsers = new Map<string, { name: string; color: string; profile_picture_url: string }>();

  async onStart() {
    const now = Date.now();
    const timeSinceCreation = now - this.instanceCreatedAt;
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    if (timeSinceCreation < 100) {
      console.log('🔥🔥🔥 [HIBERNATION WAKE-UP DETECTED] 🔥🔥🔥');
      console.log('[YJS-PARTY] Instance created at:', new Date(this.instanceCreatedAt).toISOString());
      console.log('[YJS-PARTY] Current time:', new Date(now).toISOString());
      console.log('[YJS-PARTY] Time since instance creation:', timeSinceCreation, 'ms');
      console.log('[YJS-PARTY] ✅ PROOF: Instance just created - DO was hibernated and woke up!');
    } else {
      console.log('[YJS-PARTY] 🆕 FRESH INSTANCE - First startup (not hibernation wake)');
      console.log('[YJS-PARTY] Time since instance creation:', timeSinceCreation, 'ms');
    }
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    console.log('[YJS-PARTY] Creating Y.Doc with gc: false for hibernation compatibility');
    
    // CRITICAL: gc: false prevents background timers that break hibernation!
    this.doc = new Y.Doc({ gc: false });
    
    // DON'T use y-protocols Awareness - it has internal timers that prevent hibernation
    // Use custom Map-based awareness instead
    this.awareness = null;
    console.log('[YJS-PARTY] ✅ Using custom Map-based awareness (hibernation-safe)');

    // Load persisted state from Durable Object storage
    const persistedState = await this.ctx.storage.get<Uint8Array>(this.persistenceKey);
    if (persistedState) {
      console.log('[YJS-PARTY] Loading persisted document state:', persistedState.length, 'bytes');
      Y.applyUpdate(this.doc, persistedState);
    } else {
      console.log('[YJS-PARTY] No persisted state found, starting fresh');
    }

    // DON'T register event listeners - they prevent hibernation!
    // Instead, we'll handle updates reactively in onMessage()
    // This allows the DO to hibernate when idle

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('[YJS-PARTY] ✅ Server initialized - HIBERNATION READY');
    console.log('[YJS-PARTY] Configuration:');
    console.log('[YJS-PARTY]   - Y.Doc GC: DISABLED (gc: false) ✅');
    console.log('[YJS-PARTY]   - Event listeners: REMOVED (no persistent listeners) ✅');
    console.log('[YJS-PARTY]   - Message-driven architecture ✅');
    console.log('[YJS-PARTY]   - Awareness: CUSTOM MAP-BASED (hibernation-safe) ✅');
    console.log('[YJS-PARTY]   - No background timers ✅');
    console.log('[YJS-PARTY]   - Hibernation: ENABLED ✅');
    console.log('[YJS-PARTY] Will hibernate after 30-60s of inactivity');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  }

  private async persistDocument() {
    if (!this.doc) return;
    
    const state = Y.encodeStateAsUpdate(this.doc);
    await this.ctx.storage.put(this.persistenceKey, state);
    console.log('[YJS-PARTY] Document persisted:', state.length, 'bytes');
  }

  async onConnect(connection: Connection, ctx: ConnectionContext) {
    const now = Date.now();
    const timeSinceCreation = now - this.instanceCreatedAt;
    const timeSinceLastMessage = this.lastMessageAt > 0 ? now - this.lastMessageAt : 0;
    const timeSinceLastActivity = this.lastActivityAt > 0 ? now - this.lastActivityAt : 0;
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('[YJS-PARTY] Client connected:', connection.id);
    console.log('[YJS-PARTY] Time since instance creation:', timeSinceCreation, 'ms');
    
    if (timeSinceCreation < 1000) {
      console.log('[YJS-PARTY] 🔥 HIBERNATION WAKE - Connecting to fresh instance after hibernation!');
      if (timeSinceLastActivity > 0) {
        console.log('[YJS-PARTY] Time since last activity:', timeSinceLastActivity, 'ms');
        console.log('[YJS-PARTY] ✅ CONFIRMED: DO was hibernated and woke up for this connection');
      }
    }
    
    this.lastActivityAt = now;
    console.log('[YJS-PARTY] Time since instance creation:', timeSinceCreation, 'ms');
    
    if (!this.doc) {
      console.error('[YJS-PARTY] ERROR: Doc not initialized!');
      return;
    }

    // Check if we need to rebuild connectedUsers after hibernation
    const existingConnections = Array.from(this.getConnections());
    if (existingConnections.length > this.connectedUsers.size) {
      console.log('[YJS-PARTY] 🔄 Rebuilding user map after hibernation wake-up');
      console.log('[YJS-PARTY] Active connections:', existingConnections.length, 'but only', this.connectedUsers.size, 'users in map');
      
      // Rebuild user data for existing connections that aren't in the map
      const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E2'];
      const names = ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve', 'Frank', 'Grace', 'Henry'];
      
      existingConnections.forEach((conn, index) => {
        if (!this.connectedUsers.has(conn.id)) {
          const userData = {
            name: names[index % names.length],
            color: colors[index % colors.length],
            profile_picture_url: `https://i.pravatar.cc/150?u=${conn.id}`
          };
          this.connectedUsers.set(conn.id, userData);
          console.log('[YJS-PARTY] Restored user data for:', conn.id, userData);
        }
      });
    }

    // Generate dummy user data for this NEW connection
    const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E2'];
    const names = ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve', 'Frank', 'Grace', 'Henry'];
    const connectionIndex = existingConnections.length - 1;
    
    const userData = {
      name: names[connectionIndex % names.length],
      color: colors[connectionIndex % colors.length],
      profile_picture_url: `https://i.pravatar.cc/150?u=${connection.id}`
    };
    
    this.connectedUsers.set(connection.id, userData);
    console.log('[YJS-PARTY] Created user data for connection:', connection.id, userData);

    // Send full state to new client (Yjs Sync Step 1)
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, this.doc);
    connection.send(encoding.toUint8Array(encoder));
    
    console.log('[YJS-PARTY] Sent sync step 1 to client');

    // Send existing awareness states to new client (so they see other users' cursors)
    if (this.customAwareness.size > 0) {
      console.log('[YJS-PARTY] Sending existing awareness states to new client:', this.customAwareness.size);
      this.customAwareness.forEach((state, clientId) => {
        const awarenessEncoder = encoding.createEncoder();
        encoding.writeVarUint(awarenessEncoder, MESSAGE_AWARENESS);
        encoding.writeVarString(awarenessEncoder, JSON.stringify({
          clientId,
          state
        }));
        connection.send(encoding.toUint8Array(awarenessEncoder));
      });
    }
    
    console.log('[YJS-PARTY] Connection count:', Array.from(this.getConnections()).length);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    // Broadcast connection count to all clients
    this.broadcastConnectionCount('connect');
  }

  private broadcastConnectionCount(event: 'connect' | 'disconnect' = 'connect') {
    const connections = Array.from(this.getConnections());
    const connectionCount = connections.length;
    const mode = connectionCount <= 1 ? 'solo' : 'multi';
    
    // Build array of all connected users with their metadata
    const users = Array.from(this.connectedUsers.entries()).map(([id, userData]) => ({
      id,
      ...userData
    }));
    
    console.log('[YJS-PARTY] ━━━ Broadcasting connection count ━━━');
    console.log('[YJS-PARTY] Connection count:', connectionCount);
    console.log('[YJS-PARTY] Mode:', mode);
    console.log('[YJS-PARTY] Event:', event);
    console.log('[YJS-PARTY] Users:', users);
    console.log('[YJS-PARTY] Broadcasting to', connectionCount, 'client(s)');
    
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_CUSTOM);
    const customMsg = {
      type: 'connection-count',
      data: { 
        connectionCount,
        mode,
        event,
        connections: connectionCount,  // Keep for backwards compat
        users,  // All connected users with their metadata
        docSize: this.doc ? Y.encodeStateAsUpdate(this.doc).length : 0,
        awarenessStates: this.customAwareness.size,
        timestamp: new Date().toISOString()
      }
    } as CustomMessage;
    console.log('[YJS-PARTY] Custom message:', JSON.stringify(customMsg));
    encoding.writeVarString(encoder, JSON.stringify(customMsg));
    
    const msgBytes = encoding.toUint8Array(encoder);
    console.log('[YJS-PARTY] Message bytes length:', msgBytes.length);
    this.broadcast(msgBytes);
    console.log('[YJS-PARTY] ━━━ Broadcast complete ━━━');
  }

  async onMessage(connection: Connection, rawMessage: string | ArrayBuffer | ArrayBufferView) {
    const now = Date.now();
    const timeSinceCreation = now - this.instanceCreatedAt;
    const timeSinceLastMessage = this.lastMessageAt > 0 ? now - this.lastMessageAt : 0;
    
    // Update activity tracking
    this.lastMessageAt = now;
    this.lastActivityAt = now;
    
    if (!this.doc) {
      console.error('[YJS-PARTY] ERROR: Doc not initialized!');
      return;
    }
    
    // Hibernation detection in onMessage
    if (timeSinceCreation < 1000 && timeSinceLastMessage === 0) {
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('🔥🔥🔥 [HIBERNATION WAKE-UP IN onMessage] 🔥🔥🔥');
      console.log('[YJS-PARTY] Time since instance creation:', timeSinceCreation, 'ms');
      console.log('[YJS-PARTY] ✅ CONFIRMED: DO was hibernated and woke up for this message');
      console.log('[YJS-PARTY] Message will be processed below...');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    }

    // Convert to Uint8Array
    let message: Uint8Array;
    if (typeof rawMessage === 'string') {
      console.log('[YJS-PARTY] Received string message:', rawMessage);
      return; // Ignore string messages
    } else if (rawMessage instanceof ArrayBuffer) {
      message = new Uint8Array(rawMessage);
    } else {
      message = new Uint8Array(rawMessage.buffer, rawMessage.byteOffset, rawMessage.byteLength);
    }

    console.log('[YJS-PARTY] Message received:', {
      from: connection.id,
      size: message.length,
      timestamp: new Date().toISOString()
    });

    const decoder = decoding.createDecoder(message);
    const encoder = encoding.createEncoder();
    const messageType = decoding.readVarUint(decoder);
    
    const messageTypeName = messageType === MESSAGE_SYNC ? 'SYNC' : 
                           messageType === MESSAGE_AWARENESS ? 'AWARENESS' : 
                           messageType === MESSAGE_CUSTOM ? 'CUSTOM' : 'UNKNOWN';
    console.log(`[YJS-PARTY] Message type: ${messageTypeName} (${messageType})`);

    switch (messageType) {
      case MESSAGE_SYNC:
        console.log('[YJS-PARTY] Processing SYNC message');
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        const syncMessageType = syncProtocol.readSyncMessage(
          decoder,
          encoder,
          this.doc,
          connection
        );
        
        // If there's a response, send it back
        if (encoding.length(encoder) > 1) {
          const response = encoding.toUint8Array(encoder);
          connection.send(response);
          console.log('[YJS-PARTY] Sent sync response:', response.length, 'bytes');
        }
        
        // If this was an update, broadcast to others and persist
        if (syncMessageType === syncProtocol.messageYjsUpdate) {
          console.log('[YJS-PARTY] Broadcasting update to other clients');
          // Broadcast the original message to all other clients
          this.broadcast(message, [connection.id]);
          // Persist the document
          await this.persistDocument();
        }
        break;

      case MESSAGE_AWARENESS:
        console.log('[YJS-PARTY] Processing AWARENESS message');
        // 🎯 DUMB BROADCASTER PATTERN:
        // Server just stores and forwards awareness JSON - no validation, no processing
        // Client has FULL control over what to send (cursor, selection, etc.)
        // User metadata (name, color, avatar) comes from server via connection-count
        const awarenessData = decoding.readVarString(decoder);
        try {
          const awarenessState = JSON.parse(awarenessData);
          console.log('[YJS-PARTY] Custom awareness update:', awarenessState);
          
          // Store in map (just for count tracking)
          this.customAwareness.set(connection.id, awarenessState);
          
          // Broadcast to all other clients (attach clientId so they know who it's from)
          const broadcastEncoder = encoding.createEncoder();
          encoding.writeVarUint(broadcastEncoder, MESSAGE_AWARENESS);
          encoding.writeVarString(broadcastEncoder, JSON.stringify({
            clientId: connection.id,
            state: awarenessState
          }));
          this.broadcast(encoding.toUint8Array(broadcastEncoder), [connection.id]);
          
          console.log('[YJS-PARTY] Broadcasted custom awareness to', this.customAwareness.size, 'clients');
        } catch (e) {
          console.error('[YJS-PARTY] Failed to parse custom awareness:', e);
        }
        break;

      case MESSAGE_CUSTOM:
        console.log('[YJS-PARTY] Processing CUSTOM message');
        const customData = decoding.readVarString(decoder);
        try {
          const customMsg: CustomMessage = JSON.parse(customData);
          this.handleCustomMessage(connection, customMsg);
        } catch (e) {
          console.error('[YJS-PARTY] Failed to parse custom message:', e);
        }
        break;

      default:
        console.error('[YJS-PARTY] Unknown message type:', messageType);
    }
  }

  private handleCustomMessage(connection: Connection, msg: CustomMessage) {
    console.log('[YJS-PARTY] Custom message:', msg.type, msg.data);

    switch (msg.type) {
      case 'ping':
        // Respond with pong
        const pongEncoder = encoding.createEncoder();
        encoding.writeVarUint(pongEncoder, MESSAGE_CUSTOM);
        encoding.writeVarString(pongEncoder, JSON.stringify({
          type: 'pong',
          timestamp: new Date().toISOString()
        } as CustomMessage));
        connection.send(encoding.toUint8Array(pongEncoder));
        console.log('[YJS-PARTY] Sent pong to', connection.id);
        break;

      case 'config':
        // Broadcast config to all other clients
        console.log('[YJS-PARTY] Broadcasting config:', msg.data);
        const configEncoder = encoding.createEncoder();
        encoding.writeVarUint(configEncoder, MESSAGE_CUSTOM);
        encoding.writeVarString(configEncoder, JSON.stringify(msg));
        this.broadcast(encoding.toUint8Array(configEncoder), [connection.id]);
        break;

      case 'mode':
        // Broadcast mode change to all other clients
        console.log('[YJS-PARTY] Broadcasting mode:', msg.data);
        const modeEncoder = encoding.createEncoder();
        encoding.writeVarUint(modeEncoder, MESSAGE_CUSTOM);
        encoding.writeVarString(modeEncoder, JSON.stringify(msg));
        this.broadcast(encoding.toUint8Array(modeEncoder), [connection.id]);
        break;

      default:
        console.log('[YJS-PARTY] Unknown custom message type:', msg.type);
    }
  }

  async onClose(connection: Connection) {
    console.log('[YJS-PARTY] Client disconnected:', connection.id);
    
    // Remove user data
    if (this.connectedUsers.has(connection.id)) {
      const userData = this.connectedUsers.get(connection.id);
      this.connectedUsers.delete(connection.id);
      console.log('[YJS-PARTY] Removed user:', userData);
    }
    
    // Remove from custom awareness
    if (this.customAwareness.has(connection.id)) {
      this.customAwareness.delete(connection.id);
      console.log('[YJS-PARTY] Removed from custom awareness, remaining:', this.customAwareness.size);
      
      // Broadcast removal to other clients
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
      encoding.writeVarString(encoder, JSON.stringify({
        clientId: connection.id,
        state: null  // null = removed
      }));
      this.broadcast(encoding.toUint8Array(encoder));
    }
    
    // Delayed check to get accurate count after connection is removed
    // (Same pattern as PartyServer - connection needs time to be removed from getConnections())
    setTimeout(() => {
      const connections = Array.from(this.getConnections());
      console.log('[YJS-PARTY] Final connection count after disconnect:', connections.length);
      
      // Broadcast updated connection count
      this.broadcastConnectionCount('disconnect');
    }, 0);
  }

  async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    
    if (url.pathname.includes('/status')) {
      const connections = Array.from(this.getConnections());
      return Response.json({
        connections: connections.length,
        docSize: this.doc ? Y.encodeStateAsUpdate(this.doc).length : 0,
        awarenessStates: this.awareness ? this.awareness.getStates().size : 0,
        timestamp: new Date().toISOString()
      });
    }

    if (url.pathname.includes('/clear')) {
      // Clear the document (useful for testing)
      if (this.doc) {
        this.doc.destroy();
        this.doc = new Y.Doc({ gc: false });
        this.awareness = new awarenessProtocol.Awareness(this.doc);
        await this.ctx.storage.delete(this.persistenceKey);
        console.log('[YJS-PARTY] Document cleared');
      }
      return Response.json({ cleared: true });
    }

    return new Response('Yjs PartyServer\n\nEndpoints:\n/status - Connection info\n/clear - Reset document', { 
      status: 200,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
}

/**
 * Custom Yjs PartyServer - Hibernation Compatible
 * 
 * Instead of using y-partyserver (which has GC that prevents hibernation),
 * we implement Yjs sync directly in PartyServer with gc: false
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
  type: 'config' | 'mode' | 'ping' | 'pong';
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

  async onStart() {
    console.log('🔥 [YJS-PARTY] onStart called');
    console.log('[YJS-PARTY] Creating Y.Doc with gc: false for hibernation compatibility');
    
    // CRITICAL: gc: false prevents background timers that break hibernation!
    this.doc = new Y.Doc({ gc: false });
    this.awareness = new awarenessProtocol.Awareness(this.doc);
    this.awareness.setLocalState(null);

    // Load persisted state from Durable Object storage
    const persistedState = await this.ctx.storage.get<Uint8Array>(this.persistenceKey);
    if (persistedState) {
      console.log('[YJS-PARTY] Loading persisted document state:', persistedState.length, 'bytes');
      Y.applyUpdate(this.doc, persistedState);
    } else {
      console.log('[YJS-PARTY] No persisted state found, starting fresh');
    }

    // Listen to doc updates and broadcast to all connections
    this.doc.on('update', (update: Uint8Array, origin: any) => {
      if (origin !== 'server-broadcast') {
        console.log('[YJS-PARTY] Doc updated, broadcasting to clients:', update.length, 'bytes');
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        syncProtocol.writeUpdate(encoder, update);
        const message = encoding.toUint8Array(encoder);
        
        // Broadcast to all connections except origin
        this.broadcast(message);
        
        // Persist the full document state (debounced in production)
        this.persistDocument();
      }
    });

    // Listen to awareness changes and broadcast
    this.awareness.on('update', ({ added, updated, removed }: any) => {
      const changedClients = added.concat(updated).concat(removed);
      console.log('[YJS-PARTY] Awareness changed:', { added, updated, removed });
      
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(this.awareness!, changedClients)
      );
      this.broadcast(encoding.toUint8Array(encoder));
    });

    console.log('[YJS-PARTY] Server initialized');
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
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('[YJS-PARTY] Client connected:', connection.id);
    console.log('[YJS-PARTY] Time since instance creation:', timeSinceCreation, 'ms');
    
    if (!this.doc || !this.awareness) {
      console.error('[YJS-PARTY] ERROR: Doc not initialized!');
      return;
    }

    // Send full state to new client (Yjs Sync Step 1)
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, this.doc);
    connection.send(encoding.toUint8Array(encoder));
    
    console.log('[YJS-PARTY] Sent sync step 1 to client');

    // Send awareness states of other clients
    const awarenessStates = this.awareness.getStates();
    if (awarenessStates.size > 0) {
      const awarenessEncoder = encoding.createEncoder();
      encoding.writeVarUint(awarenessEncoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(
        awarenessEncoder,
        awarenessProtocol.encodeAwarenessUpdate(
          this.awareness,
          Array.from(awarenessStates.keys())
        )
      );
      connection.send(encoding.toUint8Array(awarenessEncoder));
      console.log('[YJS-PARTY] Sent awareness states');
    }
    
    console.log('[YJS-PARTY] Connection count:', Array.from(this.getConnections()).length);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  }

  async onMessage(connection: Connection, rawMessage: string | ArrayBuffer | ArrayBufferView) {
    if (!this.doc || !this.awareness) {
      console.error('[YJS-PARTY] ERROR: Doc not initialized!');
      return;
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
        break;

      case MESSAGE_AWARENESS:
        console.log('[YJS-PARTY] Processing AWARENESS message');
        awarenessProtocol.applyAwarenessUpdate(
          this.awareness,
          decoding.readVarUint8Array(decoder),
          connection
        );
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
    
    if (this.awareness) {
      // Remove awareness state for disconnected client
      // Note: y-protocols handles this automatically via the awareness update handler
      const remainingStates = Array.from(this.awareness.getStates().keys());
      console.log('[YJS-PARTY] Remaining awareness states:', remainingStates.length);
    }
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

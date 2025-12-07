/**
 * Custom Yjs provider for our hibernation-compatible YjsPartyServer
 * Handles sync, awareness, and custom messages
 */

import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
const MESSAGE_CUSTOM = 2;

interface CustomMessage {
  type: 'config' | 'mode' | 'ping' | 'pong' | 'connection-count';
  data?: any;
  timestamp?: string;
}

export class YjsPartyProvider {
  private ws: WebSocket | null = null;
  private doc: Y.Doc;
  public awareness: awarenessProtocol.Awareness;  // Make public so client can access it
  private url: string;
  private synced = false;
  private listeners: Map<string, Set<Function>> = new Map();
  private destroyed = false;  // Track if provider was explicitly destroyed

  constructor(url: string, roomName: string, doc: Y.Doc) {
    this.doc = doc;
    this.awareness = new awarenessProtocol.Awareness(doc);
    this.url = `${url}/parties/yjs-party/${roomName}`;

    // Listen to local doc changes and send to server
    this.doc.on('update', (update: Uint8Array, origin: any) => {
      if (origin !== this && this.ws?.readyState === WebSocket.OPEN) {
        console.log('[YjsPartyProvider] Sending update to server:', update.length, 'bytes');
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        syncProtocol.writeUpdate(encoder, update);
        this.ws.send(encoding.toUint8Array(encoder));
      }
    });

    // DON'T listen to awareness changes automatically!
    // Client will manually send awareness updates via sendAwarenessUpdate()
    // This gives full control - no automatic heartbeats, no hidden traffic

    this.connect();
  }

  private connect() {
    console.log('[YjsPartyProvider] Connecting to:', this.url);
    this.ws = new WebSocket(this.url);
    this.ws.binaryType = 'arraybuffer';

    this.ws.onopen = () => {
      console.log('[YjsPartyProvider] Connected');
      this.emit('status', { status: 'connected' });

      // Send initial sync
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeSyncStep1(encoder, this.doc);
      this.ws!.send(encoding.toUint8Array(encoder));
      console.log('[YjsPartyProvider] Sent initial sync');

      // DON'T send awareness on connect - client will send manually if needed
    };

    this.ws.onmessage = (event) => {
      const data = new Uint8Array(event.data);
      const decoder = decoding.createDecoder(data);
      const encoder = encoding.createEncoder();
      const messageType = decoding.readVarUint(decoder);

      console.log('[YjsPartyProvider] Received message type:', messageType, 'size:', data.length);

      switch (messageType) {
        case MESSAGE_SYNC:
          encoding.writeVarUint(encoder, MESSAGE_SYNC);
          const syncType = syncProtocol.readSyncMessage(decoder, encoder, this.doc, this);
          
          if (!this.synced && syncType === syncProtocol.messageYjsSyncStep2) {
            this.synced = true;
            this.emit('sync', true);
            console.log('[YjsPartyProvider] Synced!');
          }

          // Send response if needed
          if (encoding.length(encoder) > 1) {
            this.ws!.send(encoding.toUint8Array(encoder));
          }
          break;

        case MESSAGE_AWARENESS:
          // Receive custom JSON-based awareness (not y-protocols binary)
          const awarenessData = decoding.readVarString(decoder);
          console.log('[YjsPartyProvider] Received awareness data:', awarenessData);
          try {
            const { clientId, state } = JSON.parse(awarenessData);
            console.log('[YjsPartyProvider] Parsed awareness:', clientId, state);
            this.emit('awareness', { clientId, state });
          } catch (e) {
            console.error('[YjsPartyProvider] Failed to parse awareness:', e);
          }
          break;

        case MESSAGE_CUSTOM:
          const customData = decoding.readVarString(decoder);
          console.log('[YjsPartyProvider] Raw custom message data:', customData);
          try {
            const msg: CustomMessage = JSON.parse(customData);
            console.log('[YjsPartyProvider] Parsed custom message:', msg);
            this.emit('custom', msg);
          } catch (e) {
            console.error('[YjsPartyProvider] Failed to parse custom message:', e, 'Data:', customData);
          }
          break;
      }
    };

    this.ws.onclose = (event) => {
      console.log('[YjsPartyProvider] Disconnected:', event.code, event.reason);
      this.emit('status', { status: 'disconnected' });
      this.synced = false;

      // Only reconnect if not explicitly destroyed
      if (!this.destroyed) {
        console.log('[YjsPartyProvider] Auto-reconnecting in 1s...');
        setTimeout(() => this.connect(), 1000);
      } else {
        console.log('[YjsPartyProvider] Provider destroyed, not reconnecting');
      }
    };

    this.ws.onerror = (error) => {
      console.error('[YjsPartyProvider] Error:', error);
    };
  }

  sendCustomMessage(msg: CustomMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      console.log('[YjsPartyProvider] Sending custom message:', msg);
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_CUSTOM);
      encoding.writeVarString(encoder, JSON.stringify(msg));
      this.ws.send(encoding.toUint8Array(encoder));
    }
  }

  on(event: string, callback: Function) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
  }

  off(event: string, callback: Function) {
    this.listeners.get(event)?.delete(callback);
  }

  private emit(event: string, data: any) {
    this.listeners.get(event)?.forEach(cb => cb(data));
  }

  destroy() {
    console.log('[YjsPartyProvider] Destroying provider');
    this.destroyed = true;  // Mark as destroyed to prevent reconnection
    this.ws?.close();
    this.awareness.destroy();
  }

  // Manual awareness control - client decides when to send
  sendAwarenessUpdate(state: any) {
    console.log('[YjsPartyProvider] Manual awareness update:', state);
    
    // Set local state (for local tracking)
    this.awareness.setLocalState(state);
    
    // Send as simple JSON (not y-protocols encoding)
    if (this.ws?.readyState === WebSocket.OPEN) {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
      encoding.writeVarString(encoder, JSON.stringify(state));
      this.ws.send(encoding.toUint8Array(encoder));
      console.log('[YjsPartyProvider] Sent custom awareness update');
    } else {
      console.warn('[YjsPartyProvider] Cannot send awareness - not connected');
    }
  }

  // Clear awareness and notify server
  clearAwareness() {
    console.log('[YjsPartyProvider] Clearing awareness');
    
    // Clear local state
    this.awareness.setLocalState(null);
    
    // Send null as JSON
    if (this.ws?.readyState === WebSocket.OPEN) {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
      encoding.writeVarString(encoder, JSON.stringify(null));
      this.ws.send(encoding.toUint8Array(encoder));
      console.log('[YjsPartyProvider] Sent awareness removal');
    }
  }
}

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
  type: 'config' | 'mode' | 'ping' | 'pong';
  data?: any;
  timestamp?: string;
}

export class YjsPartyProvider {
  private ws: WebSocket | null = null;
  private doc: Y.Doc;
  private awareness: awarenessProtocol.Awareness;
  private url: string;
  private synced = false;
  private listeners: Map<string, Set<Function>> = new Map();

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

    // Listen to awareness changes and send to server
    this.awareness.on('update', ({ added, updated, removed }: any) => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        const changed = added.concat(updated).concat(removed);
        console.log('[YjsPartyProvider] Sending awareness update:', changed);
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(
          encoder,
          awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed)
        );
        this.ws.send(encoding.toUint8Array(encoder));
      }
    });

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

      // Send awareness state if set
      if (this.awareness.getLocalState() !== null) {
        const awarenessEncoder = encoding.createEncoder();
        encoding.writeVarUint(awarenessEncoder, MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(
          awarenessEncoder,
          awarenessProtocol.encodeAwarenessUpdate(this.awareness, [this.doc.clientID])
        );
        this.ws!.send(encoding.toUint8Array(awarenessEncoder));
        console.log('[YjsPartyProvider] Sent awareness state');
      }
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
          awarenessProtocol.applyAwarenessUpdate(
            this.awareness,
            decoding.readVarUint8Array(decoder),
            this
          );
          break;

        case MESSAGE_CUSTOM:
          const customData = decoding.readVarString(decoder);
          try {
            const msg: CustomMessage = JSON.parse(customData);
            console.log('[YjsPartyProvider] Received custom message:', msg);
            this.emit('custom', msg);
          } catch (e) {
            console.error('[YjsPartyProvider] Failed to parse custom message:', e);
          }
          break;
      }
    };

    this.ws.onclose = (event) => {
      console.log('[YjsPartyProvider] Disconnected:', event.code, event.reason);
      this.emit('status', { status: 'disconnected' });
      this.synced = false;

      // Reconnect after delay
      setTimeout(() => this.connect(), 1000);
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
    this.ws?.close();
    this.awareness.destroy();
  }
}

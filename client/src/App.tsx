import { useState, useRef, useEffect, useCallback } from 'react'
import './App.css'
import * as Y from 'yjs'
import YPartyKitProvider from 'y-partykit/provider'
import { YjsPartyProvider } from './YjsPartyProvider'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'

interface LogEntry {
  timestamp: string
  type: 'info' | 'success' | 'error' | 'warning'
  message: string
}

interface ServerStatus {
  acceptedCount?: number
  getWebSocketsCount?: number
  mismatch?: boolean
  verdict?: string
  timestamp: string
  // Custom Yjs fields
  connections?: number
  docSize?: number
  awarenessStates?: number
}

function App() {
  // Connection state machine
  const [actualState, setActualState] = useState<'disconnected' | 'connecting' | 'connected' | 'disconnecting'>('disconnected')
  const [intendedState, setIntendedState] = useState<'connected' | 'disconnected'>('disconnected')
  
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [status, setStatus] = useState<ServerStatus | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const heartbeatRef = useRef<number | null>(null)
  const [backend, setBackend] = useState<'raw' | 'partykit' | 'yjs' | 'custom-yjs'>('custom-yjs')
  const reconcileNeededRef = useRef(false)
  const yjsDocRef = useRef<Y.Doc | null>(null)
  const yjsFragRef = useRef<Y.XmlFragment | null>(null)
  const providerRef = useRef<YPartyKitProvider | null>(null)
  const customProviderRef = useRef<YjsPartyProvider | null>(null)
  const [fragReady, setFragReady] = useState(false)
  const [awarenessStates, setAwarenessStates] = useState<Map<number, any>>(new Map())
  const [testMessage, setTestMessage] = useState('')
  const [awarenessEnabled, setAwarenessEnabled] = useState(false)
  const awarenessEnabledRef = useRef(false)  // Use ref so event handler can access current value
  const [connectionCount, setConnectionCount] = useState<number | null>(null)
  const [currentMode, setCurrentMode] = useState<'solo' | 'multi'>('solo')
  const [connectedUsers, setConnectedUsers] = useState<Array<{ id: string; name: string; color: string; profile_picture_url: string }>>([])

  // Tiptap editor with Yjs collaboration - MUST use fragment like MindGame does
  const editor = useEditor({
    extensions: [
      StarterKit,
      ...(fragReady && yjsFragRef.current ? [Collaboration.configure({
        fragment: yjsFragRef.current,  // Pass fragment, not document
      })] : []),
    ],
    content: '<p>Connecting to Y-PartyServer...</p>',
    onUpdate: ({ editor }) => {
      console.log('[Tiptap] Content updated:', {
        html: editor.getHTML(),
        textLength: editor.getText().length,
        timestamp: new Date().toISOString()
      })
    }
  }, [fragReady])  // Recreate editor when fragment becomes ready

  const addLog = useCallback((type: LogEntry['type'], message: string) => {
    setLogs(prev => [...prev, {
      timestamp: new Date().toISOString(),
      type,
      message
    }])
  }, [])

  const connectWebSocket = useCallback(() => {
    // Switch between backends
    let wsUrl: string
    let backendName: string
    
    switch (backend) {
      case 'raw':
        wsUrl = 'wss://raw-cloudflare-test.cloudflare-manatee010.workers.dev'
        backendName = 'Raw Cloudflare'
        break
      case 'partykit':
        wsUrl = 'wss://partykit-test.cloudflare-manatee010.workers.dev/parties/partykit-test-party/test-room'
        backendName = 'PartyServer'
        break
      case 'yjs':
        wsUrl = 'wss://y-partykit-test.cloudflare-manatee010.workers.dev/parties/y-party-kit-test-server/test-room'
        backendName = 'Y-PartyServer (Yjs)'
        break
      case 'custom-yjs':
        wsUrl = 'wss://partykit-test.cloudflare-manatee010.workers.dev'
        backendName = 'Custom Yjs PartyServer (Hibernation Compatible)'
        break
    }
    
    addLog('info', `Connecting to ${backendName}: ${wsUrl}...`)
    
    // For custom-yjs, use our hibernation-compatible provider
    if (backend === 'custom-yjs') {
      const doc = new Y.Doc()
      yjsDocRef.current = doc
      
      const frag = doc.getXmlFragment('prosemirror')
      yjsFragRef.current = frag
      setFragReady(true)
      
      const provider = new YjsPartyProvider(wsUrl, 'test-room', doc)
      customProviderRef.current = provider
      
      // DON'T set initial awareness - we want to test hibernation!
      // User will manually send awareness via button
      
      // Track awareness changes (but only log if awareness is enabled)
      provider.awareness.on('change', () => {
        const states = new Map(provider.awareness.getStates())
        setAwarenessStates(states)
        // Only log awareness changes if user has explicitly enabled it
        if (awarenessEnabledRef.current && states.size > 0) {
          addLog('info', `👥 Awareness changed: ${states.size} user(s) active`)
        }
      })
      
      provider.on('status', async (event: { status: string }) => {
        console.log('[CustomYjs] Status:', event.status)
        addLog('info', `🔌 CustomYjs status: ${event.status}`)
        setActualState(event.status === 'connected' ? 'connected' : 'disconnected')
        
        // Fetch status when connected to show connection count
        if (event.status === 'connected') {
          try {
            const response = await fetch('https://partykit-test.cloudflare-manatee010.workers.dev/parties/yjs-party/test-room/status')
            const data = await response.json()
            addLog('success', `📊 Connected! ${data.connections} client(s), Doc: ${data.docSize}B, Awareness: ${data.awarenessStates}`)
          } catch (e) {
            // Silent fail
          }
        }
      })
      
      provider.on('sync', (isSynced: boolean) => {
        console.log('[CustomYjs] Synced:', isSynced)
        addLog('success', `✅ CustomYjs synced: ${isSynced}`)
      })
      
      provider.on('custom', (msg: any) => {
        console.log('[CustomYjs] Custom message received:', msg)
        if (msg.type === 'connection-count') {
          const data = msg.data;
          console.log('[CustomYjs] Status update:', data)
          
          const newConnectionCount = data.connectionCount || data.connections || 0;
          const newMode = data.mode || 'solo';
          const users = data.users || [];
          
          setConnectionCount(newConnectionCount)
          setConnectedUsers(users)  // Store all connected users
          addLog('info', `📊 ${JSON.stringify(data)}`)
          
          // React to mode changes for awareness
          setCurrentMode(prevMode => {
            if (prevMode !== newMode) {
              console.log(`[CustomYjs] Mode change: ${prevMode} → ${newMode}`);
              
              // Only auto-enable awareness if user had it on and mode changed to multi
              if (newMode === 'multi' && awarenessEnabledRef.current) {
                addLog('info', `🔄 Mode changed to multi - awareness already enabled`);
              } else if (newMode === 'solo' && awarenessEnabledRef.current) {
                // User had awareness on, but we're back to solo
                addLog('info', `🔄 Mode changed to solo - keeping awareness state`);
              }
            }
            return newMode;
          });
        } else {
          addLog('info', `CustomYjs custom: ${JSON.stringify(msg)}`)
        }
      })
      
      // Handle custom awareness events (server broadcasts awareness changes)
      provider.on('awareness', ({ clientId, state }: any) => {
        console.log('[CustomYjs] Awareness update:', clientId, state);
        if (awarenessEnabledRef.current) {
          if (state === null) {
            addLog('info', `👥 User ${clientId} left`);
          } else {
            addLog('info', `👥 Awareness from ${clientId}: ${JSON.stringify(state)}`);
          }
        }
      })
      
      addLog('success', 'Custom Yjs provider created')
      return
    }
    
    // For Y-PartyServer, use YPartyKitProvider
    if (backend === 'yjs') {
      const doc = new Y.Doc()
      yjsDocRef.current = doc
      
      // Get XmlFragment like MindGame does
      const frag = doc.getXmlFragment('prosemirror')
      yjsFragRef.current = frag
      setFragReady(true)  // Trigger editor recreation with Collaboration extension
      
      // Log doc updates
      doc.on('update', (update: Uint8Array, origin: any) => {
        console.log('[YJS-CLIENT] Doc update:', {
          updateSize: update.length,
          origin: origin,
          docSize: Y.encodeStateAsUpdate(doc).length,
          timestamp: new Date().toISOString()
        })
        addLog('info', `YJS update: ${update.length} bytes from ${origin || 'local'}`)
      })
      
      doc.on('updateV2', (update: Uint8Array, origin: any) => {
        console.log('[YJS-CLIENT] Doc updateV2:', {
          updateSize: update.length,
          origin: origin,
          timestamp: new Date().toISOString()
        })
      })
      
      // YPartyKitProvider connects to Y-PartyServer (not regular y-websocket!)
      const provider = new YPartyKitProvider(
        'y-partykit-test.cloudflare-manatee010.workers.dev',
        'test-room',
        doc,
        {
          party: 'y-party-kit-test-server' // CRITICAL: Must match our server name in wrangler.toml!
        }
      )
      providerRef.current = provider
      
      // BLOCK AWARENESS HEARTBEATS - only allow actual Yjs sync messages
      if (provider.awareness) {
        // Stop awareness from sending periodic updates
        provider.awareness.setLocalState(null)
        
        // Block any future awareness updates
        provider.awareness.setLocalState = () => {
          console.log('[YPartyKit] Awareness update BLOCKED')
          // Do nothing - no awareness updates sent
        }
        console.log('[YPartyKit] Awareness completely BLOCKED - no heartbeats will be sent')
      }
      
      provider.on('status', (event: { status: string }) => {
        console.log('[YPartyKit] Status change:', event.status)
        addLog('info', `YPartyKit status: ${event.status}`)
        setActualState(event.status === 'connected' ? 'connected' : 'disconnected')
      })
      
      provider.on('sync', (isSynced: boolean) => {
        console.log('[YPartyKit] Sync event:', isSynced)
        addLog('success', `YPartyKit synced: ${isSynced}`)
      })
      
      // Access internal ws to log raw messages
      const ws = (provider as any).ws
      if (ws) {
        const originalSend = ws.send.bind(ws)
        ws.send = (data: any) => {
          console.log('[YPartyKit-WS] Sending:', {
            type: data instanceof Uint8Array ? 'Uint8Array' : typeof data,
            size: data.length || data.byteLength || 0,
            timestamp: new Date().toISOString()
          })
          return originalSend(data)
        }
        
        ws.addEventListener('message', (event: MessageEvent) => {
          console.log('[YPartyKit-WS] Received:', {
            type: event.data instanceof Blob ? 'Blob' : typeof event.data,
            size: event.data.size || event.data.length || event.data.byteLength || 0,
            timestamp: new Date().toISOString()
          })
        })
      }
      
      addLog('success', 'YPartyKit provider created with document and debug logging')
      return
    }

    // For non-Yjs backends, manual WebSocket
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws
    
    ws.onopen = () => {
      setActualState('connected')
      addLog('success', '✅ WebSocket CONNECTED')
      reconcileNeededRef.current = true
    }

    ws.onmessage = (event) => {
      // For non-Yjs backends, handle text messages
      addLog('info', `📨 Received: ${event.data}`)
      try {
        const data = JSON.parse(event.data)
        console.log('Server response:', data)
      } catch {}
    }

    ws.onclose = (event) => {
      setActualState('disconnected')
      wsRef.current = null
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current)
        heartbeatRef.current = null
      }
      addLog('warning', `❌ WebSocket CLOSED: code=${event.code}, reason="${event.reason}"`)
      reconcileNeededRef.current = true
    }

    ws.onerror = (error) => {
      addLog('error', `❌ WebSocket ERROR: ${error}`)
    }
  }, [backend, addLog])

  // Toggle function - updates intended state
  const toggleConnection = () => {
    const newIntendedState = intendedState === 'connected' ? 'disconnected' : 'connected'
    setIntendedState(newIntendedState)
    addLog('info', `🎯 User wants to be: ${newIntendedState}`)
    reconcileNeededRef.current = true
  }

  // Effect to reconcile when needed
  useEffect(() => {
    if (!reconcileNeededRef.current) return
    reconcileNeededRef.current = false

    if (actualState === 'connected' && intendedState === 'disconnected') {
      // Need to disconnect
      addLog('info', '🔌 Reconciling: Disconnecting...')
      setActualState('disconnecting')
      
      // Handle different backend types
      if (backend === 'custom-yjs' && customProviderRef.current) {
        customProviderRef.current.destroy()
        customProviderRef.current = null
        yjsDocRef.current = null
        yjsFragRef.current = null
        setFragReady(false)
        // Immediately set to disconnected since we destroyed the provider
        setActualState('disconnected')
        addLog('success', '✅ Disconnected')
      } else if (wsRef.current) {
        wsRef.current.close(1000, 'client-initiated')
      }
    } else if (actualState === 'disconnected' && intendedState === 'connected') {
      // Need to connect
      addLog('info', '🔌 Reconciling: Connecting...')
      setActualState('connecting')
      connectWebSocket()
    }
  }, [actualState, intendedState, connectWebSocket])

  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close()
      }
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current)
      }
    }
  }, [])

  const sendPing = () => {
    // For custom-yjs, use custom message protocol
    if (backend === 'custom-yjs' && customProviderRef.current) {
      customProviderRef.current.sendCustomMessage({ type: 'ping' });
      addLog('info', '🏓 Sent ping via custom message');
      return;
    }

    // For other backends, use raw WebSocket
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      addLog('error', 'Not connected');
      return;
    }

    const message = `ping-${Date.now()}`;
    wsRef.current.send(message);
    addLog('info', `📤 Sent: ${message}`);
  };

  const sendTestMessage = () => {
    if (backend === 'custom-yjs' && customProviderRef.current) {
      customProviderRef.current.sendCustomMessage({ 
        type: 'config' as const, 
        data: { message: testMessage, timestamp: new Date().toISOString() }
      });
      addLog('info', `📨 Sent custom message: ${testMessage}`);
      setTestMessage('');
    }
  };

  const sendAwareness = () => {
    if (backend === 'custom-yjs' && customProviderRef.current) {
      // Find our user data from connectedUsers (server assigns this on connect)
      // For now, just send dummy cursor/selection data since the user object comes from server
      const awarenessData = {
        cursor: {
          line: Math.floor(Math.random() * 10),
          col: Math.floor(Math.random() * 50)
        },
        selection: {
          anchor: Math.floor(Math.random() * 100),
          head: Math.floor(Math.random() * 100)
        },
        timestamp: new Date().toISOString()
      };
      
      // Manually send awareness update (user data comes from server via connection-count)
      customProviderRef.current.sendAwarenessUpdate(awarenessData);
      addLog('success', `👋 Sent awareness: ${JSON.stringify(awarenessData)}`);
      setAwarenessEnabled(true);
      awarenessEnabledRef.current = true;
    }
  };

  const clearAwareness = () => {
    if (backend === 'custom-yjs' && customProviderRef.current) {
      customProviderRef.current.clearAwareness();
      addLog('info', '🚫 Cleared awareness state');
      setAwarenessEnabled(false);
      awarenessEnabledRef.current = false;
    }
  };

  const toggleAwareness = () => {
    if (awarenessEnabled) {
      clearAwareness();
    } else {
      sendAwareness();
    }
  };

  const fetchStatus = async () => {
    try {
      addLog('info', 'Fetching status...')
      
      let baseUrl: string
      switch (backend) {
        case 'raw':
          baseUrl = 'https://raw-cloudflare-test.cloudflare-manatee010.workers.dev'
          break
        case 'partykit':
          baseUrl = 'https://partykit-test.cloudflare-manatee010.workers.dev/parties/partykit-test-party/test-room'
          break
        case 'yjs':
          baseUrl = 'https://y-partykit-test.cloudflare-manatee010.workers.dev/parties/y-party-kit-test-server/test-room'
          break
        case 'custom-yjs':
          baseUrl = 'https://partykit-test.cloudflare-manatee010.workers.dev/parties/yjs-party/test-room'
          break
      }
      
      const response = await fetch(`${baseUrl}/status`)
      const data = await response.json()
      setStatus(data)
      
      // Add detailed log entry based on backend
      if (backend === 'custom-yjs') {
        addLog('success', `📊 Connections: ${data.connections}, Doc: ${data.docSize}B, Awareness: ${data.awarenessStates}`)
      } else {
        if (data.mismatch) {
          addLog('error', `❌ BUG DETECTED: accepted=${data.acceptedCount}, getWebSockets=${data.getWebSocketsCount || data.getConnectionsCount}`)
        } else {
          addLog('success', `✅ WORKING: Both counts match at ${data.acceptedCount}`)
        }
        addLog('success', `📊 Verdict: ${data.verdict}`)
      }
    } catch (error) {
      addLog('error', `Failed to fetch status: ${error}`)
    }
  }

  const clearLogs = () => {
    setLogs([])
    setStatus(null)
  }

  return (
    <div className="app">
      <h1>🔬 Hibernation API Test</h1>
      
      <div className="backend-toggle">
        <div style={{ marginBottom: '10px' }}>
          <strong>Select Backend:</strong>
        </div>
        <label style={{ display: 'block', marginBottom: '5px' }}>
          <input 
            type="radio" 
            name="backend"
            value="raw"
            checked={backend === 'raw'} 
            onChange={() => setBackend('raw')}
            disabled={actualState !== 'disconnected'}
          />
          {' '}Raw Cloudflare DO
        </label>
        <label style={{ display: 'block', marginBottom: '5px' }}>
          <input 
            type="radio" 
            name="backend"
            value="partykit"
            checked={backend === 'partykit'} 
            onChange={() => setBackend('partykit')}
            disabled={actualState !== 'disconnected'}
          />
          {' '}PartyServer (no Yjs)
        </label>
        <label style={{ display: 'block', marginBottom: '10px' }}>
          <input 
            type="radio" 
            name="backend"
            value="yjs"
            checked={backend === 'yjs'} 
            onChange={() => setBackend('yjs')}
            disabled={actualState !== 'disconnected'}
          />
          {' '}Y-PartyServer (breaks hibernation ❌)
        </label>
        <label style={{ display: 'block', marginBottom: '10px' }}>
          <input 
            type="radio" 
            name="backend"
            value="custom-yjs"
            checked={backend === 'custom-yjs'} 
            onChange={() => setBackend('custom-yjs')}
            disabled={actualState !== 'disconnected'}
          />
          {' '}Custom Yjs (hibernation compatible ✅)
        </label>
        <div className="backend-status">
          Currently testing: <strong>
            {backend === 'raw' && 'Raw Cloudflare'}
            {backend === 'partykit' && 'PartyServer'}
            {backend === 'yjs' && 'Y-PartyServer (Yjs)'}
            {backend === 'custom-yjs' && 'Custom Yjs (Hibernation Compatible)'}
          </strong>
        </div>
      </div>
      
      <div className="status-bar">
        <div className={`connection-status ${actualState === 'connected' ? 'connected' : 'disconnected'}`}>
          {actualState === 'connected' && '🟢 Connected'}
          {actualState === 'disconnected' && '🔴 Disconnected'}
          {actualState === 'connecting' && '🟡 Connecting...'}
          {actualState === 'disconnecting' && '🟠 Disconnecting...'}
        </div>
        <div className="intended-state" style={{ fontSize: '0.9em', opacity: 0.7, marginTop: '4px' }}>
          Intent: {intendedState === 'connected' ? '→ Connected' : '→ Disconnected'}
        </div>
      </div>

      <div className="controls">
        <button onClick={toggleConnection} className={intendedState === 'connected' ? 'btn-warning' : 'btn-primary'}>
          {intendedState === 'connected' ? 'Disconnect' : 'Connect'}
        </button>
        <button onClick={sendPing} disabled={actualState !== 'connected'} className="btn-secondary">
          Send Ping
        </button>
        <button onClick={fetchStatus} className="btn-info">
          Get Status
        </button>
        <button onClick={clearLogs} className="btn-clear">
          Clear Logs
        </button>
      </div>

      {(backend === 'yjs' || backend === 'custom-yjs') && (providerRef.current || customProviderRef.current) && (
        <div className="yjs-test-area" style={{ margin: '20px 0', padding: '15px', border: '2px solid #4CAF50', borderRadius: '8px', backgroundColor: '#f9f9f9' }}>
          <h3 style={{ marginTop: 0, color: '#4CAF50' }}>🔄 Tiptap with Yjs Collaboration</h3>
          <div style={{
            border: '1px solid #ddd',
            borderRadius: '4px',
            padding: '10px',
            minHeight: '120px',
            backgroundColor: 'white'
          }}>
            {editor ? (
              <EditorContent editor={editor} />
            ) : (
              <p style={{ color: '#999' }}>Loading editor...</p>
            )}
          </div>
          <div style={{ marginTop: '10px', fontSize: '12px', color: '#666' }}>
            💡 <strong>Tip:</strong> Open multiple tabs/browsers and type to see real-time CRDT sync!
          </div>
          
          {backend === 'custom-yjs' && customProviderRef.current && (
            <div style={{ marginTop: '15px', padding: '15px', border: '1px solid #ddd', borderRadius: '4px', backgroundColor: 'white' }}>
              <h4 style={{ marginTop: 0, marginBottom: '10px' }}>📊 Yjs + PartyServer Controls</h4>
              
              {awarenessEnabled && (
                <div style={{ marginBottom: '15px' }}>
                  <strong>Awareness States (Connected Users):</strong>
                  <div style={{ marginTop: '5px', padding: '10px', backgroundColor: '#f5f5f5', borderRadius: '4px' }}>
                    {awarenessStates.size === 0 ? (
                      <span style={{ color: '#999' }}>No users detected yet...</span>
                    ) : (
                      Array.from(awarenessStates.entries()).map(([clientId, state]) => (
                        <div key={clientId} style={{ marginBottom: '5px' }}>
                          <span style={{ 
                            display: 'inline-block', 
                            width: '12px', 
                            height: '12px', 
                            borderRadius: '50%', 
                            backgroundColor: state?.color || '#999',
                            marginRight: '8px'
                          }}></span>
                          <strong>{state?.user || `Client ${clientId}`}</strong>
                          {clientId === yjsDocRef.current?.clientID && ' (You)'}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
              
              <div style={{ marginBottom: '15px' }}>
                <strong>Send Custom Message:</strong>
                <div style={{ display: 'flex', gap: '10px', marginTop: '5px' }}>
                  <input 
                    type="text" 
                    value={testMessage}
                    onChange={(e) => setTestMessage(e.target.value)}
                    placeholder="Enter message..."
                    style={{ flex: 1, padding: '8px', borderRadius: '4px', border: '1px solid #ddd' }}
                    onKeyPress={(e) => e.key === 'Enter' && sendTestMessage()}
                  />
                  <button onClick={sendTestMessage} disabled={!testMessage} className="btn-secondary">
                    Send Config
                  </button>
                </div>
              </div>
              
              {connectionCount !== null && (
                <div style={{ marginBottom: '15px', padding: '10px', backgroundColor: '#e8f5e9', borderRadius: '4px' }}>
                  <div style={{ marginBottom: '10px' }}>
                    <strong>📊 Active Connections: {connectionCount}</strong>
                    <span style={{ marginLeft: '10px', padding: '2px 8px', borderRadius: '4px', backgroundColor: currentMode === 'solo' ? '#90caf9' : '#ffb74d', color: 'white', fontSize: '12px', fontWeight: 'bold' }}>
                      {currentMode.toUpperCase()}
                    </span>
                  </div>
                  
                  {connectedUsers.length > 0 && (
                    <div style={{ marginTop: '10px', padding: '10px', backgroundColor: 'white', borderRadius: '4px' }}>
                      <strong>👥 Connected Users:</strong>
                      <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {connectedUsers.map(user => (
                          <div key={user.id} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <img 
                              src={user.profile_picture_url} 
                              alt={user.name}
                              style={{ width: '32px', height: '32px', borderRadius: '50%', border: `2px solid ${user.color}` }}
                            />
                            <div style={{ flex: 1 }}>
                              <div style={{ fontWeight: 'bold' }}>{user.name}</div>
                              <div style={{ fontSize: '11px', color: '#666' }}>{user.id.slice(0, 8)}...</div>
                            </div>
                            <div 
                              style={{ 
                                width: '20px', 
                                height: '20px', 
                                borderRadius: '50%', 
                                backgroundColor: user.color,
                                border: '2px solid white',
                                boxShadow: '0 0 0 1px #ddd'
                              }}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
              
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                <button onClick={toggleAwareness} className="btn-secondary">
                  {awarenessEnabled ? '🟢 Awareness ON' : '⚫ Awareness OFF'}
                </button>
                <button 
                  onClick={sendAwareness} 
                  className="btn-primary"
                  disabled={!awarenessEnabled}
                  style={{ opacity: awarenessEnabled ? 1 : 0.5 }}
                >
                  👋 Send Awareness Ping
                </button>
                <button onClick={sendPing} className="btn-secondary">
                  🏓 Send Ping
                </button>
                <button onClick={fetchStatus} className="btn-info">
                  📊 Get Server Status
                </button>
              </div>
              
              <div style={{ marginTop: '15px', padding: '12px', backgroundColor: '#fff3cd', borderRadius: '4px', fontSize: '13px', lineHeight: '1.6' }}>
                <strong>🧪 Hibernation + Awareness Test Guide:</strong>
                <ol style={{ margin: '8px 0 0 0', paddingLeft: '20px' }}>
                  <li><strong>Test Awareness Works:</strong> Toggle ON → Click "Send Awareness Ping" → Open 2nd tab → Send ping → Verify logs show both users</li>
                  <li><strong>Test Hibernation Still Works:</strong> Send awareness ping once → Wait 60s idle → Type in editor → Check console for 🔥 hibernation wake-up</li>
                  <li><strong>Test Awareness Wakes Hibernated DO:</strong> Don't send awareness → Wait 60s → Click "Send Awareness Ping" → Check console for hibernation wake</li>
                </ol>
                <div style={{ marginTop: '8px', fontSize: '12px', color: '#856404' }}>
                  ✅ <strong>Success:</strong> If awareness works AND hibernation still happens after 60s idle, we've proven custom awareness is hibernation-safe!
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {status && (
        <div className={`status-card ${status.mismatch ? 'error' : 'success'}`}>
          <h3>Server Status</h3>
          <div className="status-grid">
            {backend === 'custom-yjs' ? (
              <>
                <div>
                  <strong>Connections:</strong> {status.connections}
                </div>
                <div>
                  <strong>Doc Size:</strong> {status.docSize} bytes
                </div>
                <div>
                  <strong>Awareness States:</strong> {status.awarenessStates}
                </div>
                <div>
                  <strong>Timestamp:</strong> {status.timestamp}
                </div>
              </>
            ) : (
              <>
                <div>
                  <strong>Accepted Count:</strong> {status.acceptedCount}
                </div>
                <div>
                  <strong>getWebSockets() Count:</strong> {status.getWebSocketsCount}
                </div>
                <div>
                  <strong>Mismatch:</strong> {status.mismatch ? '❌ YES' : '✅ NO'}
                </div>
                <div className="verdict">
                  <strong>Verdict:</strong> {status.verdict}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <div className="logs">
        <h2>Test Logs</h2>
        <div className="log-entries">
          {logs.map((log, index) => (
            <div key={index} className={`log-entry log-${log.type}`}>
              <span className="log-time">{new Date(log.timestamp).toLocaleTimeString()}</span>
              <span className="log-message">{log.message}</span>
            </div>
          ))}
          {logs.length === 0 && (
            <div className="log-entry log-empty">No logs yet. Click "Connect" to start.</div>
          )}
        </div>
      </div>

      <div className="instructions">
        <h3>Test Protocol</h3>
        <ol>
          <li>Click <strong>Connect</strong> - Check server console for [AFTER-ACCEPT] logs</li>
          <li>Click <strong>Send Ping</strong> - Verify message handling</li>
          <li>Click <strong>Get Status</strong> - Check if counts match</li>
          <li>Click <strong>Disconnect</strong> - Check server console for [CLOSE] logs</li>
          <li>Wait 60s for hibernation, then reconnect - Check [CONSTRUCTOR] logs</li>
        </ol>
        
        <div className="expectations">
          <h4>Expected Results:</h4>
          <p><strong>If Cloudflare works correctly:</strong></p>
          <ul>
            <li>✅ [AFTER-ACCEPT] count should equal acceptedCount</li>
            <li>✅ Status endpoint shows NO mismatch</li>
            <li>✅ [CLOSE] event fires when disconnecting</li>
          </ul>
          <p><strong>If Cloudflare has the bug:</strong></p>
          <ul>
            <li>❌ [AFTER-ACCEPT] count will be 0</li>
            <li>❌ Status endpoint shows MISMATCH</li>
            <li>❌ [CLOSE] event may not fire</li>
          </ul>
        </div>
      </div>
    </div>
  )
}

export default App

import { useState, useRef, useEffect } from 'react'
import './App.css'

interface LogEntry {
  timestamp: string
  type: 'info' | 'success' | 'error' | 'warning'
  message: string
}

interface ServerStatus {
  acceptedCount: number
  getWebSocketsCount: number
  mismatch: boolean
  verdict: string
  timestamp: string
}

function App() {
  const [connected, setConnected] = useState(false)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [status, setStatus] = useState<ServerStatus | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const heartbeatRef = useRef<number | null>(null)
  const [usePartyKit, setUsePartyKit] = useState(false)

  const addLog = (type: LogEntry['type'], message: string) => {
    setLogs(prev => [...prev, {
      timestamp: new Date().toISOString(),
      type,
      message
    }])
  }

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

  const connect = () => {
    if (wsRef.current) {
      addLog('warning', 'Already connected')
      return
    }

    // Switch between raw Cloudflare and PartyKit
    const wsUrl = usePartyKit 
      ? 'wss://partykit-test.cloudflare-manatee010.workers.dev/parties/partykit-test-party/test-room'
      : 'wss://raw-cloudflare-test.cloudflare-manatee010.workers.dev'
    
    addLog('info', `Connecting to ${usePartyKit ? 'PartyServer' : 'Raw Cloudflare'}: ${wsUrl}...`)
    
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      setConnected(true)
      addLog('success', '✅ WebSocket CONNECTED')
      
      // Let browser/server handle ping/pong automatically
      // No manual heartbeat needed with hibernation
    }

    ws.onmessage = (event) => {
      addLog('info', `📨 Received: ${event.data}`)
      try {
        const data = JSON.parse(event.data)
        console.log('Server response:', data)
      } catch {}
    }

    ws.onclose = (event) => {
      setConnected(false)
      wsRef.current = null
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current)
        heartbeatRef.current = null
      }
      addLog('warning', `❌ WebSocket CLOSED: code=${event.code}, reason="${event.reason}"`)
    }

    ws.onerror = (error) => {
      addLog('error', `❌ WebSocket ERROR: ${error}`)
    }
  }

  const sendPing = () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      addLog('error', 'Not connected')
      return
    }

    const message = `ping-${Date.now()}`
    wsRef.current.send(message)
    addLog('info', `📤 Sent: ${message}`)
  }

  const disconnect = () => {
    if (!wsRef.current) {
      addLog('warning', 'Not connected')
      return
    }

    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current)
      heartbeatRef.current = null
    }
    
    wsRef.current.close(1000, 'client-initiated')
    addLog('info', '🔌 Disconnect initiated')
  }

  const fetchStatus = async () => {
    try {
      addLog('info', 'Fetching status...')
      const baseUrl = usePartyKit
        ? 'https://partykit-test.cloudflare-manatee010.workers.dev/parties/partykit-test-party/test-room'
        : 'https://raw-cloudflare-test.cloudflare-manatee010.workers.dev'
      const response = await fetch(`${baseUrl}/status`)
      const data = await response.json()
      setStatus(data)
      
      // Add detailed log entry
      if (data.mismatch) {
        addLog('error', `❌ BUG DETECTED: accepted=${data.acceptedCount}, getWebSockets=${data.getWebSocketsCount || data.getConnectionsCount}`)
      } else {
        addLog('success', `✅ WORKING: Both counts match at ${data.acceptedCount}`)
      }
      
      addLog('success', `📊 Verdict: ${data.verdict}`)
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
        <label>
          <input 
            type="checkbox" 
            checked={usePartyKit} 
            onChange={(e) => setUsePartyKit(e.target.checked)}
            disabled={connected}
          />
          Use PartyKit (unchecked = Raw Cloudflare)
        </label>
        <div className="backend-status">
          Currently testing: <strong>{usePartyKit ? 'PartyKit Wrapper' : 'Raw Cloudflare'}</strong>
        </div>
      </div>
      
      <div className="status-bar">
        <div className={`connection-status ${connected ? 'connected' : 'disconnected'}`}>
          {connected ? '🟢 Connected' : '🔴 Disconnected'}
        </div>
      </div>

      <div className="controls">
        <button onClick={connect} disabled={connected} className="btn-primary">
          1. Connect
        </button>
        <button onClick={sendPing} disabled={!connected} className="btn-secondary">
          2. Send Ping
        </button>
        <button onClick={disconnect} disabled={!connected} className="btn-warning">
          3. Disconnect
        </button>
        <button onClick={fetchStatus} className="btn-info">
          4. Get Status
        </button>
        <button onClick={clearLogs} className="btn-clear">
          Clear Logs
        </button>
      </div>

      {status && (
        <div className={`status-card ${status.mismatch ? 'error' : 'success'}`}>
          <h3>Server Status</h3>
          <div className="status-grid">
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

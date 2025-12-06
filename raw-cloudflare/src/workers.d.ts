// Cloudflare Workers WebSocket Response types
// The webSocket property is not in standard ResponseInit but is valid in Cloudflare Workers

declare global {
  interface ResponseInit {
    webSocket?: WebSocket;
  }
}

export {};

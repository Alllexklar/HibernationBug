/**
 * Worker entry point for Y-PartyServer test
 * Uses routePartykitRequest for PartyKit-style routing
 */

/// <reference types="@cloudflare/workers-types" />

import { routePartykitRequest } from "partyserver";
import { YPartyKitTestServer } from './server';

export { YPartyKitTestServer };

interface Env {
  YPartyKitTestServer: DurableObjectNamespace<YPartyKitTestServer>;
  [key: string]: unknown;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return (
      (await routePartykitRequest(request, env)) ||
      new Response('Y-PartyKit Test Server\nUse /parties/y-party-kit-test-server/test-room to connect', { 
        headers: { 'Access-Control-Allow-Origin': '*' }
      })
    );
  },
};

/**
 * Worker entry point for PartyServer test
 * Uses routePartykitRequest for PartyKit-style routing
 */

import { routePartykitRequest } from "partyserver";
import { PartyKitTestServer } from './server';

export { PartyKitTestServer };

interface Env {
  PartyKitTestServer: DurableObjectNamespace<PartyKitTestServer>;
  [key: string]: unknown;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return (
      (await routePartykitRequest(request, env)) ||
      new Response('PartyKit Test Server\nUse /parties/party-kit-test-server/test-room to connect', { 
        status: 404,
        headers: { 'Access-Control-Allow-Origin': '*' }
      })
    );
  }
} satisfies ExportedHandler<Env>;

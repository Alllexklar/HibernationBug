import { RawTestDO } from './test-do';

export { RawTestDO };

export default {
  async fetch(request: Request, env: any): Promise<Response> {
    const url = new URL(request.url);
    
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Upgrade, Connection',
        }
      });
    }
    
    // Get or create DO instance
    const doId = env.RAW_TEST_DO.idFromName('test-room');
    const stub = env.RAW_TEST_DO.get(doId);
    
    // Forward request directly - don't modify WebSocket responses!
    return stub.fetch(request);
  }
};

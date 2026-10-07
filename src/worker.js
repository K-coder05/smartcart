// Workers entry point. Static files are served from the assets directory first
// (see wrangler.jsonc); only requests that match no asset reach this handler.
import { onRequestPost as generate } from '../functions/api/generate.js';

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/generate') {
      if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
      return generate({ request, env, ctx });
    }
    return new Response('Not Found', { status: 404 });
  },
};

import { Hono } from 'hono';
import { Bindings } from '../index';

const app = new Hono<{ Bindings: Bindings }>();

// Universal Audio Proxy for R2
app.get('/:channel/:message_id/:file_name', async (c) => {
  const channel = c.req.param('channel');
  const messageId = c.req.param('message_id');
  const fileName = c.req.param('file_name');

  const objectKey = `audio/${channel}-${messageId}-${fileName}`;
  
  try {
    const object = await c.env.AUDIO_BUCKET.get(objectKey);

    if (!object) {
      return c.text('Not Found', 404);
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    
    // Set Content-Type if not present in metadata
    if (!headers.has('Content-Type')) {
        headers.set('Content-Type', 'audio/ogg');
    }

    return new Response(object.body as ReadableStream, { headers });
  } catch (error) {
    console.error(`[Audio Proxy] Failed to get object ${objectKey}:`, error);
    return c.text('Internal Server Error', 500);
  }
});

export const audioProxyHandlers = app;

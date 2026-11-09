import type { Body, Headers, Message, Request, Response, ServerRequest } from '@chubbyts/chubbyts-http-types/message';
import type { ResponseFactory, ServerRequestFactory } from '@chubbyts/chubbyts-http-types/message-factory';
import type {
  MessageHelpers,
  RequestHelpers,
  ResponseHelpers,
  UriHelpers,
} from '@chubbyts/chubbyts-http-types/message-helper';

// the types of the fetch api, named apart from the ones of @chubbyts/chubbyts-http-types
type FetchHeaders = globalThis.Headers;
export type FetchRequest = globalThis.Request;
export type FetchResponse = globalThis.Response;

// the body of a GET or HEAD request gets ignored, a fetch request with one cannot be created, compared uppercased as
// the fetch api normalizes these methods (e.g. 'get' becomes 'GET')
const methodsWithoutBody: ReadonlySet<string> = new Set(['GET', 'HEAD']);

// a fetch response with one of these statuses cannot have a body (fetch allows the statuses 200-599 only)
const nullBodyStatuses: ReadonlySet<number> = new Set([204, 205, 304]);

// the fetch headers join the values of a header (with ', ', with '; ' for cookie): each header gets iterated once and
// replaces the one of the message, only set-cookie gets iterated value by value as its values cannot be joined
// (RFC 6265 3), these get added
const withFetchHeaders = <M extends Message>(
  message: M,
  fetchHeaders: FetchHeaders,
  messageHelpers: MessageHelpers,
): M =>
  [...fetchHeaders].reduce(
    (messageWithHeaders, [name, value]) =>
      name === 'set-cookie'
        ? messageHelpers.withAddedHeader(messageWithHeaders, name, value)
        : messageHelpers.withHeader(messageWithHeaders, name, value),
    message,
  );

const toFetchHeaders = (headers: Headers): FetchHeaders => {
  const fetchHeaders = new globalThis.Headers();

  for (const [name, values] of Object.entries(headers)) {
    for (const value of values) {
      fetchHeaders.append(name, value);
    }
  }

  return fetchHeaders;
};

// a not yet iterated body cannot be cancelled through its async iterator (returning an unstarted async generator skips
// its cleanup): node streams get destroyed, web streams cancelled
const cancelBody = (body: Body): void => {
  // cancelling is best effort: a failing body must neither mask the error which led to the cancelling nor fail it
  try {
    const cancellableBody = body as Partial<{ destroy: () => void; cancel: () => Promise<void> }>;

    if (typeof cancellableBody.destroy === 'function') {
      cancellableBody.destroy();

      return;
    }

    // Stryker disable next-line ConditionalExpression: equivalent, calling a missing cancel throws within the try
    if (typeof cancellableBody.cancel === 'function') {
      cancellableBody.cancel().catch(() => {});
    }
  } catch {
    // the body cannot be cancelled, nothing left to do
  }
};

const toReadableStream = (body: Body): ReadableStream<Uint8Array> => {
  if (body instanceof ReadableStream) {
    return body;
  }

  const iterator = body[Symbol.asyncIterator]();

  return new ReadableStream<Uint8Array>(
    {
      pull: async (controller) => {
        // a failing body rejects the pull, which errors the stream
        const { done, value } = await iterator.next();

        if (done) {
          controller.close();

          return;
        }

        controller.enqueue(value);
      },
      // e.g. the client disconnected: the body gets destroyed, the iterator not awaited as its return waits for a
      // pending next, called within an async function: a throwing return or one not returning a promise gets caught too
      cancel: () => {
        cancelBody(body);
        // Stryker disable next-line OptionalChaining: equivalent, calling a missing return rejects, which gets caught
        (async () => iterator.return?.())().catch(() => {});
      },
    },
    // read lazily: a chunk gets read once the consumer asks for it, not ahead
    { highWaterMark: 0 },
  );
};

export type FetchRequestToServerRequest = (fetchRequest: FetchRequest) => ServerRequest;

/**
 * To serve a handler on a fetch based runtime (e.g. Bun, Deno, Cloudflare Workers). The protocol version stays the one
 * of the factory (the fetch api does not know it), the signal is the one of the fetch request.
 */
export const createFetchRequestToServerRequestFactory = (
  serverRequestFactory: ServerRequestFactory,
  requestHelpers: RequestHelpers,
): FetchRequestToServerRequest => {
  return (fetchRequest: FetchRequest): ServerRequest => {
    // created and changed through the injected implementation only: the bridge works with any of them
    const serverRequest = withFetchHeaders(
      requestHelpers.withSignal(serverRequestFactory(fetchRequest.method, fetchRequest.url), fetchRequest.signal),
      fetchRequest.headers,
      requestHelpers,
    );

    // a web stream already is an AsyncIterable<Uint8Array>, a request without body keeps the (empty) one of the factory
    return fetchRequest.body ? requestHelpers.withBody(serverRequest, fetchRequest.body) : serverRequest;
  };
};

export type ResponseToFetchResponse = (response: Response) => FetchResponse;

/**
 * To serve a handler on a fetch based runtime. Throws an error for a response the fetch api cannot represent (e.g. a
 * status outside 200-599), the body gets cancelled then. The body of a 204, 205 or 304 response gets cancelled.
 */
export const createResponseToFetchResponseFactory = (): ResponseToFetchResponse => {
  return (response: Response): FetchResponse => {
    const hasBody = !nullBodyStatuses.has(response.status);

    try {
      const fetchResponse = new globalThis.Response(hasBody ? toReadableStream(response.body) : null, {
        status: response.status,
        statusText: response.reasonPhrase,
        headers: toFetchHeaders(response.headers),
      });

      if (!hasBody) {
        cancelBody(response.body);
      }

      return fetchResponse;
    } catch (error) {
      cancelBody(response.body);

      throw error;
    }
  };
};

export type RequestToFetchRequest = (request: Request) => FetchRequest;

/**
 * To pass a request on to a fetch based handler (e.g. tRPC, Hono) or to send it with `fetch`. The uri has to be absolute
 * (with scheme and host), the body is read once the consumer asks for it. The body of a GET or HEAD request gets
 * cancelled, as well as the body of a request the fetch api cannot represent (e.g. a relative uri), which throws an error.
 */
export const createRequestToFetchRequestFactory = (uriHelpers: UriHelpers): RequestToFetchRequest => {
  return (request: Request): FetchRequest => {
    const hasBody = !methodsWithoutBody.has(request.method.toUpperCase());

    try {
      const fetchRequest = new globalThis.Request(uriHelpers.toString(request.uri), {
        method: request.method,
        headers: toFetchHeaders(request.headers),
        signal: request.signal,
        // duplex is required for a stream body
        ...(hasBody ? { body: toReadableStream(request.body), duplex: 'half' as const } : {}),
      });

      // an unread body (e.g. a node stream of the connection) would otherwise never get released
      if (!hasBody) {
        cancelBody(request.body);
      }

      return fetchRequest;
    } catch (error) {
      cancelBody(request.body);

      throw error;
    }
  };
};

export type FetchResponseToResponse = (fetchResponse: FetchResponse) => Response;

/**
 * To use the response of a fetch based handler (e.g. tRPC, Hono) or of `fetch`. The reason phrase falls back to the one
 * of the factory, if the fetch response has none. Mind that `fetch` decodes a compressed body but keeps the
 * `content-encoding` and `content-length` headers.
 */
export const createFetchResponseToResponseFactory = (
  responseFactory: ResponseFactory,
  responseHelpers: ResponseHelpers,
): FetchResponseToResponse => {
  return (fetchResponse: FetchResponse): Response => {
    // created and changed through the injected implementation only: the bridge works with any of them
    const response = withFetchHeaders(
      responseFactory(fetchResponse.status, fetchResponse.statusText || undefined),
      fetchResponse.headers,
      responseHelpers,
    );

    // a web stream already is an AsyncIterable<Uint8Array>, passed on chunk by chunk (e.g. a streamed response)
    return fetchResponse.body ? responseHelpers.withBody(response, fetchResponse.body) : response;
  };
};

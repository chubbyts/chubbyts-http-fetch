import { Readable } from 'node:stream';
import { describe, expect, test } from 'vitest';
import type { FunctionMocks } from '@chubbyts/chubbyts-function-mock/function-mock';
import { useFunctionMock } from '@chubbyts/chubbyts-function-mock/function-mock';
import {
  createBodyFactory,
  createResponseFactory,
  createServerRequestFactory,
} from '@chubbyts/chubbyts-http/message-factory';
import {
  createResponseHelpers,
  createServerRequestHelpers,
  createUriHelpers,
} from '@chubbyts/chubbyts-http/message-helper';
import type { Handler } from '@chubbyts/chubbyts-http-types/handler';
import type { Body, Response, Uri } from '@chubbyts/chubbyts-http-types/message';
import {
  createFetchRequestToServerRequestFactory,
  createFetchResponseToResponseFactory,
  createRequestToFetchRequestFactory,
  createResponseToFetchResponseFactory,
} from '../src/fetch.js';

const bodyFactory = createBodyFactory();
const serverRequestFactory = createServerRequestFactory();
const serverRequestHelpers = createServerRequestHelpers();
const uriHelpers = createUriHelpers();
const responseFactory = createResponseFactory();
const responseHelpers = createResponseHelpers();

const fetchRequestToServerRequest = createFetchRequestToServerRequestFactory(
  serverRequestFactory,
  serverRequestHelpers,
);
const responseToFetchResponse = createResponseToFetchResponseFactory();
const requestToFetchRequest = createRequestToFetchRequestFactory(uriHelpers);
const fetchResponseToResponse = createFetchResponseToResponseFactory(responseFactory, responseHelpers);

const bodyToString = async (body: Body): Promise<string> => {
  const decoder = new TextDecoder();

  // oxlint-disable-next-line functional/no-let
  let content = '';

  for await (const chunk of body) {
    content += decoder.decode(chunk, { stream: true });
  }

  return content + decoder.decode();
};

const encode = (content: string): Uint8Array => new TextEncoder().encode(content);

const createResponse = (status: number, body: Body, reasonPhrase = 'Reason'): Response => ({
  status,
  reasonPhrase,
  protocolVersion: '1.1',
  headers: {},
  body,
});

// the cancel mocks are empty once the stream got cancelled (called with the reason, which is undefined)
const createReadableStream = (chunks: Array<string>) => {
  const [cancel, cancelMocks] = useFunctionMock<(reason?: unknown) => void>([{ parameters: [undefined] }]);

  const stream = new ReadableStream<Uint8Array>({
    start: (controller) => {
      for (const chunk of chunks) {
        controller.enqueue(encode(chunk));
      }

      controller.close();
    },
    cancel,
  });

  return { stream, cancelMocks };
};

const getBody = (fetchResponse: globalThis.Response): ReadableStream<Uint8Array> => {
  if (!fetchResponse.body) {
    throw new Error('Missing body');
  }

  return fetchResponse.body;
};

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

type IteratorReturn = () => Promise<IteratorResult<Uint8Array>>;

describe('createFetchRequestToServerRequestFactory', () => {
  test('without body', async () => {
    const abortController = new AbortController();

    const fetchRequest = new Request('https://example.com:8443/path/to?key=value#fragment', {
      headers: [
        ['accept', 'application/json'],
        ['x-custom', 'one'],
        ['x-custom', 'two'],
        ['cookie', 'a=1'],
        ['cookie', 'b=2'],
      ],
      signal: abortController.signal,
    });

    const serverRequest = fetchRequestToServerRequest(fetchRequest);

    expect(serverRequest.method).toBe('GET');
    expect(uriHelpers.toString(serverRequest.uri)).toBe('https://example.com:8443/path/to?key=value#fragment');
    expect(serverRequest.protocolVersion).toBe('1.1');
    expect(serverRequest.attributes).toEqual({});
    expect(serverRequest.headers).toEqual({
      accept: ['application/json'],
      cookie: ['a=1; b=2'],
      'x-custom': ['one, two'],
    });
    expect(await bodyToString(serverRequest.body)).toBe('');

    expect(serverRequest.signal).toBe(fetchRequest.signal);
    expect(serverRequest.signal.aborted).toBe(false);
    abortController.abort();
    expect(serverRequest.signal.aborted).toBe(true);
  });

  test('with a header named __proto__', () => {
    const serverRequest = fetchRequestToServerRequest(
      new Request('https://example.com/', { headers: [['__proto__', 'value']] }),
    );

    expect(serverRequestHelpers.getHeader(serverRequest, '__proto__')).toEqual(['value']);
    expect(Object.getPrototypeOf(serverRequest.headers)).toBe(Object.prototype);
  });

  test('with body', async () => {
    const fetchRequest = new Request('https://example.com/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"key":"value"}',
    });

    const serverRequest = fetchRequestToServerRequest(fetchRequest);

    expect(serverRequest.method).toBe('POST');
    expect(serverRequest.headers).toEqual({ 'content-type': ['application/json'] });
    expect(serverRequest.body).toBe(fetchRequest.body);
    expect(await bodyToString(serverRequest.body)).toBe('{"key":"value"}');
  });
});

describe('createResponseToFetchResponseFactory', () => {
  test('with headers and body', async () => {
    const response = responseHelpers.withBody(
      responseHelpers.withHeader(
        responseHelpers.withHeader(responseFactory(200), 'set-cookie', ['a=1; Path=/', 'b=2; Path=/']),
        'x-custom',
        ['one', 'two'],
      ),
      bodyFactory('content'),
    );

    const fetchResponse = responseToFetchResponse(response);

    expect(fetchResponse.status).toBe(200);
    expect(fetchResponse.statusText).toBe('OK');
    expect(fetchResponse.headers.getSetCookie()).toEqual(['a=1; Path=/', 'b=2; Path=/']);
    expect(fetchResponse.headers.get('x-custom')).toBe('one, two');
    expect(await fetchResponse.text()).toBe('content');
  });

  test('with a header named __proto__', () => {
    const fetchResponse = responseToFetchResponse(
      responseHelpers.withHeader(createResponse(200, bodyFactory('')), '__proto__', 'value'),
    );

    expect(fetchResponse.headers.get('__proto__')).toBe('value');
  });

  test('with reason phrase', () => {
    const fetchResponse = responseToFetchResponse(createResponse(418, bodyFactory(''), 'Custom'));

    expect(fetchResponse.status).toBe(418);
    expect(fetchResponse.statusText).toBe('Custom');
  });

  test('with web stream body', async () => {
    const { stream } = createReadableStream(['a', 'b']);

    const fetchResponse = responseToFetchResponse(createResponse(200, stream));

    expect(fetchResponse.body).toBe(stream);
    expect(await fetchResponse.text()).toBe('ab');
  });

  test('with node stream body', async () => {
    const fetchResponse = responseToFetchResponse(
      createResponse(200, Readable.from([Buffer.from('a'), Buffer.from('b')], { objectMode: false })),
    );

    expect(await fetchResponse.text()).toBe('ab');
  });

  test('reads the body lazily', async () => {
    const [read, readMocks] = useFunctionMock<(step: string) => void>([
      { parameters: ['first'] },
      { parameters: ['second'] },
    ]);

    const body = (async function* () {
      read('first');
      yield encode('a');
      read('second');
      yield encode('b');
    })();

    const fetchResponse = responseToFetchResponse(createResponse(200, body));

    await tick();

    expect(readMocks).toHaveLength(2);

    const reader = getBody(fetchResponse).getReader();

    expect(new TextDecoder().decode((await reader.read()).value)).toBe('a');
    expect(readMocks).toHaveLength(1);

    expect(new TextDecoder().decode((await reader.read()).value)).toBe('b');
    expect((await reader.read()).done).toBe(true);
    expect(readMocks).toHaveLength(0);
  });

  test('with failing body', async () => {
    const body = (async function* () {
      yield encode('a');
      throw new Error('Body failed');
    })();

    const fetchResponse = responseToFetchResponse(createResponse(200, body));

    await expect(fetchResponse.text()).rejects.toThrow('Body failed');
  });

  test('cancel destroys a node stream body', async () => {
    const body = new Readable({ read: () => {} });

    const fetchResponse = responseToFetchResponse(createResponse(200, body));

    await getBody(fetchResponse).cancel();

    expect(body.destroyed).toBe(true);
  });

  test('cancel returns the iterator of the body', async () => {
    const [iteratorReturn, iteratorReturnMocks] = useFunctionMock<IteratorReturn>([
      { parameters: [], return: Promise.resolve({ done: true, value: undefined }) },
    ]);

    const body: Body = {
      [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true, value: undefined }), return: iteratorReturn }),
    };

    const fetchResponse = responseToFetchResponse(createResponse(200, body));

    await getBody(fetchResponse).cancel();

    expect(iteratorReturnMocks).toHaveLength(0);
  });

  test('cancel does not wait for nor fail by the return of the iterator', async () => {
    const [pendingReturn, pendingReturnMocks] = useFunctionMock<IteratorReturn>([
      { parameters: [], return: new Promise<IteratorResult<Uint8Array>>(() => {}) },
    ]);

    const pendingBody: Body = {
      [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true, value: undefined }), return: pendingReturn }),
    };

    await expect(getBody(responseToFetchResponse(createResponse(200, pendingBody))).cancel()).resolves.toBeUndefined();

    expect(pendingReturnMocks).toHaveLength(0);

    const [failingReturn, failingReturnMocks] = useFunctionMock<IteratorReturn>([
      {
        callback: async () => {
          throw new Error('Return failed');
        },
      },
    ]);

    const failingBody: Body = {
      [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true, value: undefined }), return: failingReturn }),
    };

    await expect(getBody(responseToFetchResponse(createResponse(200, failingBody))).cancel()).resolves.toBeUndefined();

    expect(failingReturnMocks).toHaveLength(0);

    // a not caught rejection would fail the test run
    await tick();
  });

  test.each<[string, FunctionMocks<() => IteratorResult<Uint8Array>>]>([
    ['throwing', [{ parameters: [], error: new Error('Return failed') }]],
    ['not returning a promise', [{ parameters: [], return: { done: true, value: undefined } }]],
  ])('cancel with an iterator return %s', async (_, mocks) => {
    const [iteratorReturn, iteratorReturnMocks] = useFunctionMock(mocks);

    const body = {
      [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true, value: undefined }), return: iteratorReturn }),
    } as unknown as Body;

    await expect(getBody(responseToFetchResponse(createResponse(200, body))).cancel()).resolves.toBeUndefined();

    expect(iteratorReturnMocks).toHaveLength(0);

    // a not caught rejection would fail the test run
    await tick();
  });

  test('cancel with an iterator without return', async () => {
    const [next, nextMocks] = useFunctionMock<() => Promise<IteratorResult<Uint8Array>>>([
      { parameters: [], return: Promise.resolve({ done: true, value: undefined }) },
    ]);

    const body: Body = { [Symbol.asyncIterator]: () => ({ next }) };

    await expect(getBody(responseToFetchResponse(createResponse(200, body))).cancel()).resolves.toBeUndefined();

    expect(nextMocks).toHaveLength(1);
  });

  test.each([204, 205, 304])('status %s without body cancels a node stream body', async (status) => {
    const body = new Readable({ read: () => {} });

    const fetchResponse = responseToFetchResponse(createResponse(status, body));

    expect(fetchResponse.status).toBe(status);
    expect(fetchResponse.body).toBeNull();
    expect(body.destroyed).toBe(true);
  });

  test('status without body cancels a web stream body', async () => {
    const { stream, cancelMocks } = createReadableStream(['a']);

    const fetchResponse = responseToFetchResponse(createResponse(204, stream));

    expect(fetchResponse.body).toBeNull();

    await tick();

    expect(cancelMocks).toHaveLength(0);
  });

  test('status without body with a locked web stream body', async () => {
    const { stream, cancelMocks } = createReadableStream(['a']);

    stream.getReader();

    expect(responseToFetchResponse(createResponse(204, stream)).body).toBeNull();

    // cancelling a locked stream rejects, a not caught rejection would fail the test run
    await tick();

    expect(cancelMocks).toHaveLength(1);
  });

  test('status without body with a body which cannot be cancelled', () => {
    const body = (async function* () {})();

    expect(responseToFetchResponse(createResponse(204, body)).body).toBeNull();
  });

  test.each<[string, 'destroy' | 'cancel', FunctionMocks<() => void>]>([
    ['destroy', 'destroy', [{ parameters: [], error: new Error('Destroy failed') }]],
    ['cancel', 'cancel', [{ parameters: [], error: new Error('Cancel failed') }]],
    ['cancel not returning a promise', 'cancel', [{ parameters: [] }]],
  ])('status without body with a failing %s of the body', (_, name, mocks) => {
    const [cancellable, cancellableMocks] = useFunctionMock(mocks);

    const body = { [name]: cancellable, [Symbol.asyncIterator]: async function* () {} } as unknown as Body;

    expect(responseToFetchResponse(createResponse(204, body)).body).toBeNull();

    expect(cancellableMocks).toHaveLength(0);
  });

  test('invalid status with a failing destroy of the body throws the original error', () => {
    const [destroy, destroyMocks] = useFunctionMock<() => void>([
      { parameters: [], error: new Error('Destroy failed') },
    ]);

    const body = { destroy, [Symbol.asyncIterator]: async function* () {} } as unknown as Body;

    expect(() => responseToFetchResponse(createResponse(103, body))).toThrow(RangeError);

    expect(destroyMocks).toHaveLength(0);
  });

  test.each([103, 600])('invalid status %s cancels a node stream body', (status) => {
    const body = new Readable({ read: () => {} });

    expect(() => responseToFetchResponse(createResponse(status, body))).toThrow(RangeError);
    expect(body.destroyed).toBe(true);
  });

  test('invalid status cancels a web stream body', async () => {
    const { stream, cancelMocks } = createReadableStream(['a']);

    expect(() => responseToFetchResponse(createResponse(103, stream))).toThrow(RangeError);

    await tick();

    expect(cancelMocks).toHaveLength(0);
  });
});

describe('createRequestToFetchRequestFactory', () => {
  test.each(['GET', 'HEAD', 'get', 'Head'])('%s without body cancels the body', async (method) => {
    const abortController = new AbortController();

    const body = new Readable({ read: () => {} });

    const request = serverRequestHelpers.withSignal(
      serverRequestHelpers.withBody(
        serverRequestHelpers.withHeader(
          serverRequestHelpers.withHeader(
            serverRequestFactory(method, 'https://example.com:8443/path?key=value'),
            'x-custom',
            ['one', 'two'],
          ),
          'accept',
          'application/json',
        ),
        body,
      ),
      abortController.signal,
    );

    const fetchRequest = requestToFetchRequest(request);

    // the fetch api normalizes the method
    expect(fetchRequest.method).toBe(method.toUpperCase());
    expect(fetchRequest.url).toBe('https://example.com:8443/path?key=value');
    expect([...fetchRequest.headers]).toEqual([
      ['accept', 'application/json'],
      ['x-custom', 'one, two'],
    ]);
    expect(fetchRequest.body).toBeNull();
    expect(body.destroyed).toBe(true);

    expect(fetchRequest.signal.aborted).toBe(false);
    abortController.abort();
    expect(fetchRequest.signal.aborted).toBe(true);
  });

  test('with body', async () => {
    const request = serverRequestHelpers.withBody(
      serverRequestHelpers.withHeader(
        serverRequestFactory('POST', 'https://example.com/path'),
        'content-type',
        'application/json',
      ),
      bodyFactory('{"key":"value"}'),
    );

    const fetchRequest = requestToFetchRequest(request);

    expect(fetchRequest.method).toBe('POST');
    expect(fetchRequest.headers.get('content-type')).toBe('application/json');
    expect(await fetchRequest.text()).toBe('{"key":"value"}');
  });

  test('with web stream body', async () => {
    const { stream } = createReadableStream(['a', 'b']);

    const fetchRequest = requestToFetchRequest(
      serverRequestHelpers.withBody(serverRequestFactory('PUT', 'https://example.com/'), stream),
    );

    expect(fetchRequest.body).toBe(stream);
    expect(await fetchRequest.text()).toBe('ab');
  });

  test.each(['GET', 'POST'])('%s with relative uri cancels the body', (method) => {
    // a uri without scheme and host: a factory parsing a string would not create one
    const uri: Uri = { scheme: '', userInfo: '', host: '', port: undefined, path: '/path', query: '', fragment: '' };

    const body = new Readable({ read: () => {} });

    const request = serverRequestHelpers.withBody(serverRequestFactory(method, uri), body);

    expect(uriHelpers.toString(request.uri)).toBe('/path');
    expect(() => requestToFetchRequest(request)).toThrow(TypeError);
    expect(body.destroyed).toBe(true);
  });

  test('with a header named __proto__', () => {
    const fetchRequest = requestToFetchRequest(
      serverRequestHelpers.withHeader(serverRequestFactory('GET', 'https://example.com/'), '__proto__', 'value'),
    );

    expect(fetchRequest.headers.get('__proto__')).toBe('value');
  });
});

describe('createFetchResponseToResponseFactory', () => {
  test('with headers and body', async () => {
    const fetchResponse = new globalThis.Response('content', {
      status: 201,
      headers: [
        ['set-cookie', 'a=1; Path=/'],
        ['set-cookie', 'b=2; Path=/'],
        ['x-custom', 'one'],
        ['x-custom', 'two'],
      ],
    });

    const response = fetchResponseToResponse(fetchResponse);

    expect(response.status).toBe(201);
    expect(response.reasonPhrase).toBe('Created');
    expect(response.headers).toEqual({
      'content-type': ['text/plain;charset=UTF-8'],
      'set-cookie': ['a=1; Path=/', 'b=2; Path=/'],
      'x-custom': ['one, two'],
    });
    expect(response.body).toBe(fetchResponse.body);
    expect(await bodyToString(response.body)).toBe('content');
  });

  test('with status text', () => {
    const response = fetchResponseToResponse(new globalThis.Response(null, { status: 200, statusText: 'Custom' }));

    expect(response.reasonPhrase).toBe('Custom');
  });

  test('with a header named __proto__', () => {
    const response = fetchResponseToResponse(new globalThis.Response(null, { headers: [['__proto__', 'value']] }));

    expect(responseHelpers.getHeader(response, '__proto__')).toEqual(['value']);
    expect(Object.getPrototypeOf(response.headers)).toBe(Object.prototype);
  });

  test('replaces a header of the response factory', () => {
    const fetchResponseToResponseWithDefaults = createFetchResponseToResponseFactory(
      (status, reasonPhrase) =>
        responseHelpers.withHeader(responseFactory(status, reasonPhrase), 'x-custom', 'default'),
      responseHelpers,
    );

    const response = fetchResponseToResponseWithDefaults(
      new globalThis.Response(null, { headers: { 'x-custom': 'value' } }),
    );

    expect(response.headers).toEqual({ 'x-custom': ['value'] });
  });

  test('without body', async () => {
    const response = fetchResponseToResponse(new globalThis.Response(null, { status: 204 }));

    expect(response.status).toBe(204);
    expect(response.reasonPhrase).toBe('No Content');
    expect(response.headers).toEqual({});
    expect(await bodyToString(response.body)).toBe('');
  });
});

const echoHandler: Handler = async (request) =>
  responseHelpers.withBody(
    responseHelpers.withHeader(responseFactory(200), 'content-type', 'text/plain'),
    bodyFactory(`${request.method} ${request.uri.path}: ${await bodyToString(request.body)}`),
  );

const echoFetchHandler = async (fetchRequest: Request): Promise<globalThis.Response> =>
  new globalThis.Response(
    `${fetchRequest.method} ${new URL(fetchRequest.url).pathname}: ${await fetchRequest.text()}`,
    {
      headers: { 'content-type': 'text/plain' },
    },
  );

// serve a handler on a fetch based runtime
const echoHandlerAsFetchHandler = async (fetchRequest: Request): Promise<globalThis.Response> =>
  responseToFetchResponse(await echoHandler(fetchRequestToServerRequest(fetchRequest)));

// call a fetch based handler (e.g. tRPC, Hono) from a handler
const echoFetchHandlerAsHandler: Handler = async (request) =>
  fetchResponseToResponse(await echoFetchHandler(requestToFetchRequest(request)));

describe('round trip', () => {
  test('serve a handler with fetch', async () => {
    const fetchResponse = await echoHandlerAsFetchHandler(
      new Request('https://example.com/echo', { method: 'POST', body: 'content' }),
    );

    expect(fetchResponse.headers.get('content-type')).toBe('text/plain');
    expect(await fetchResponse.text()).toBe('POST /echo: content');
  });

  test('call a fetch handler', async () => {
    const response = await echoFetchHandlerAsHandler(
      serverRequestHelpers.withBody(serverRequestFactory('POST', 'https://example.com/echo'), bodyFactory('content')),
    );

    expect(responseHelpers.getHeaderLine(response, 'content-type')).toBe('text/plain');
    expect(await bodyToString(response.body)).toBe('POST /echo: content');
  });
});

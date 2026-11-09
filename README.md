# chubbyts-http-fetch

[![CI](https://github.com/chubbyts/chubbyts-http-fetch/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/chubbyts/chubbyts-http-fetch/actions/workflows/ci.yml)
[![Coverage Status](https://coveralls.io/repos/github/chubbyts/chubbyts-http-fetch/badge.svg?branch=master)](https://coveralls.io/github/chubbyts/chubbyts-http-fetch?branch=master)
[![Mutation testing badge](https://img.shields.io/endpoint?style=flat&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Fchubbyts%2Fchubbyts-http-fetch%2Fmaster)](https://dashboard.stryker-mutator.io/reports/github.com/chubbyts/chubbyts-http-fetch/master)
[![npm-version](https://img.shields.io/npm/v/@chubbyts/chubbyts-http-fetch.svg)](https://www.npmjs.com/package/@chubbyts/chubbyts-http-fetch)

[![bugs](https://sonarcloud.io/api/project_badges/measure?project=chubbyts_chubbyts-http-fetch&metric=bugs)](https://sonarcloud.io/dashboard?id=chubbyts_chubbyts-http-fetch)
[![code_smells](https://sonarcloud.io/api/project_badges/measure?project=chubbyts_chubbyts-http-fetch&metric=code_smells)](https://sonarcloud.io/dashboard?id=chubbyts_chubbyts-http-fetch)
[![coverage](https://sonarcloud.io/api/project_badges/measure?project=chubbyts_chubbyts-http-fetch&metric=coverage)](https://sonarcloud.io/dashboard?id=chubbyts_chubbyts-http-fetch)
[![duplicated_lines_density](https://sonarcloud.io/api/project_badges/measure?project=chubbyts_chubbyts-http-fetch&metric=duplicated_lines_density)](https://sonarcloud.io/dashboard?id=chubbyts_chubbyts-http-fetch)
[![ncloc](https://sonarcloud.io/api/project_badges/measure?project=chubbyts_chubbyts-http-fetch&metric=ncloc)](https://sonarcloud.io/dashboard?id=chubbyts_chubbyts-http-fetch)
[![sqale_rating](https://sonarcloud.io/api/project_badges/measure?project=chubbyts_chubbyts-http-fetch&metric=sqale_rating)](https://sonarcloud.io/dashboard?id=chubbyts_chubbyts-http-fetch)
[![alert_status](https://sonarcloud.io/api/project_badges/measure?project=chubbyts_chubbyts-http-fetch&metric=alert_status)](https://sonarcloud.io/dashboard?id=chubbyts_chubbyts-http-fetch)
[![reliability_rating](https://sonarcloud.io/api/project_badges/measure?project=chubbyts_chubbyts-http-fetch&metric=reliability_rating)](https://sonarcloud.io/dashboard?id=chubbyts_chubbyts-http-fetch)
[![security_rating](https://sonarcloud.io/api/project_badges/measure?project=chubbyts_chubbyts-http-fetch&metric=security_rating)](https://sonarcloud.io/dashboard?id=chubbyts_chubbyts-http-fetch)
[![sqale_index](https://sonarcloud.io/api/project_badges/measure?project=chubbyts_chubbyts-http-fetch&metric=sqale_index)](https://sonarcloud.io/dashboard?id=chubbyts_chubbyts-http-fetch)
[![vulnerabilities](https://sonarcloud.io/api/project_badges/measure?project=chubbyts_chubbyts-http-fetch&metric=vulnerabilities)](https://sonarcloud.io/dashboard?id=chubbyts_chubbyts-http-fetch)

## Description

Use [@chubbyts/chubbyts-http-types][2] with the fetch api (`Request`, `Response`), in both directions:

 * serve a handler on a fetch based runtime: [Cloudflare Workers](#cloudflare-workers), [Bun](#bun), [Deno](#deno),
   [srvx](#srvx)
 * call a fetch based handler from a handler: [Hono](#hono), or send a request with [`fetch`](#fetch)

It works with any implementation of the types (e.g. [@chubbyts/chubbyts-http][3]): the messages get created and changed
through the injected factories and helpers only. It uses the web standard globals only (no `node:` imports).

## Requirements

 * node: 22
 * [@chubbyts/chubbyts-http-types][2]: ^4.0.0

## Installation

Through [NPM](https://www.npmjs.com) as [@chubbyts/chubbyts-http-fetch][1].

```sh
npm i @chubbyts/chubbyts-http-fetch@^1.0.0
```

## Usage

### Serve a handler on a fetch based runtime

#### Cloudflare Workers

The bindings of the [worker][5] (e.g. KV, D1) get passed to the handler as attribute:

```ts
import { createServerRequestFactory } from '@chubbyts/chubbyts-http/message-factory';
import { createServerRequestHelpers } from '@chubbyts/chubbyts-http/message-helper';
import {
  createFetchRequestToServerRequestFactory,
  createResponseToFetchResponseFactory,
} from '@chubbyts/chubbyts-http-fetch/fetch';
import type { Handler } from '@chubbyts/chubbyts-http-types/handler';

type Env = { [binding: string]: unknown }; // the bindings of the worker, e.g. { DB: D1Database }

const handler: Handler = ...; // e.g. a chubbyts-framework application

const serverRequestHelpers = createServerRequestHelpers();

const fetchRequestToServerRequest = createFetchRequestToServerRequestFactory(
  createServerRequestFactory(),
  serverRequestHelpers,
);

const responseToFetchResponse = createResponseToFetchResponseFactory();

export default {
  fetch: async (request: Request, env: Env): Promise<Response> => {
    const serverRequest = serverRequestHelpers.withAttribute(fetchRequestToServerRequest(request), 'env', env);

    return responseToFetchResponse(await handler(serverRequest));
  },
};
```

The bridge itself uses the web standard globals only, [@chubbyts/chubbyts-http][3] imports node modules (`node:http`,
`node:stream`, `node:fs`): enable the `nodejs_compat` compatibility flag of the worker (`wrangler.toml`):

```toml
compatibility_flags = ["nodejs_compat"]
```

#### Bun

With `handler`, `fetchRequestToServerRequest` and `responseToFetchResponse` like above:

```ts
Bun.serve({
  port: 3000,
  // maxRequestBodySize: 1024 * 1024,
  fetch: async (request: Request): Promise<Response> =>
    responseToFetchResponse(await handler(fetchRequestToServerRequest(request))),
});
```

#### Deno

With `handler`, `fetchRequestToServerRequest` and `responseToFetchResponse` like above (the packages imported through a
`package.json`, or with `npm:` specifiers):

```ts
Deno.serve({ port: 3000 }, async (request: Request): Promise<Response> =>
  responseToFetchResponse(await handler(fetchRequestToServerRequest(request))),
);
```

#### srvx

With `handler`, `serverRequestHelpers`, `fetchRequestToServerRequest` and `responseToFetchResponse` like above, [srvx][7]
serves the same code on Node, Deno and Bun, the ip of the client gets passed to the handler as attribute:

```ts
import { serve } from 'srvx';
import type { ServerRequest as SrvxRequest } from 'srvx';

serve({
  port: 3000,
  maxRequestBodySize: 1024 * 1024,
  fetch: async (request: SrvxRequest): Promise<Response> => {
    const serverRequest = serverRequestHelpers.withAttribute(fetchRequestToServerRequest(request), 'ip', request.ip);

    return responseToFetchResponse(await handler(serverRequest));
  },
});
```

A body exceeding `maxRequestBodySize` rejects while the handler reads it, with an error having `status: 413`: map it to
a `413 Payload Too Large` response (e.g. within the error middleware), otherwise it ends as a `500`.

#### Notes

 * The signal of the server request is the one of the fetch request, the protocol version stays the one of the factory
   (the fetch api does not know it).
 * The fetch api joins the values of a header (with `, `, with `; ` for `cookie`): each header has one value.
 * The body gets limited by the runtime (e.g. by the plan on Cloudflare Workers, `maxRequestBodySize` on Bun and srvx),
   not by the bridge.
 * A response with a status the fetch api cannot represent (outside 200-599, e.g. `103 Early Hints`) throws an error,
   the body of it, and the one of a `204`, `205` or `304` response, gets cancelled.
 * The body gets read once the runtime asks for it, a cancelled body (e.g. the client disconnected) gets destroyed
   (node stream) or cancelled (web stream).

### Call a fetch based handler

#### Hono

The attributes of the server request (e.g. an authenticated user) get passed to [Hono][6] as bindings (`c.env`):

```ts
import { Hono } from 'hono';
import { createResponseFactory } from '@chubbyts/chubbyts-http/message-factory';
import { createResponseHelpers, createUriHelpers } from '@chubbyts/chubbyts-http/message-helper';
import {
  createFetchResponseToResponseFactory,
  createRequestToFetchRequestFactory,
} from '@chubbyts/chubbyts-http-fetch/fetch';
import type { Handler } from '@chubbyts/chubbyts-http-types/handler';

const requestToFetchRequest = createRequestToFetchRequestFactory(createUriHelpers());

const fetchResponseToResponse = createFetchResponseToResponseFactory(createResponseFactory(), createResponseHelpers());

const app = new Hono<{ Bindings: { attributes: { user?: string } } }>().basePath('/hono');

app.get('/hello/:name', (c) => c.json({ hello: c.req.param('name'), user: c.env.attributes.user }));

const handler: Handler = async (request) =>
  fetchResponseToResponse(await app.fetch(requestToFetchRequest(request), { attributes: request.attributes }));
```

#### fetch

With `requestToFetchRequest` and `fetchResponseToResponse` like above, as http client:

```ts
import { createRequestFactory } from '@chubbyts/chubbyts-http/message-factory';

const requestFactory = createRequestFactory();

const response = fetchResponseToResponse(await fetch(requestToFetchRequest(requestFactory('GET', 'https://example.com/'))));
```

`fetch` decodes a compressed body but keeps the `content-encoding` and `content-length` headers: remove them before
passing such a response on (e.g. as a proxy).

#### Notes

 * The uri has to be absolute (with scheme and host), like the ones created by [@chubbyts/chubbyts-http-node][4].
 * The body of a `GET` or `HEAD` request gets cancelled (the fetch api does not allow one), as well as the body of a
   request which cannot be converted (e.g. with a relative uri), the signal of the fetch request follows the one of the
   request.
 * A body is a stream, which can be read once: a converted request or response shares it with the original one.
 * A converted request or response which does not get read has to be cancelled (e.g. `fetchRequest.body?.cancel()`):
   the body of the original one gets read lazily, it would stay open otherwise.
 * The reason phrase falls back to the one of the response factory, if the fetch response has none.
 * The attributes of a server request cannot be part of a fetch request: pass them on through the context of the
   handler, like above.

## Copyright

2026 Dominik Zogg

[1]: https://www.npmjs.com/package/@chubbyts/chubbyts-http-fetch
[2]: https://www.npmjs.com/package/@chubbyts/chubbyts-http-types
[3]: https://www.npmjs.com/package/@chubbyts/chubbyts-http
[4]: https://www.npmjs.com/package/@chubbyts/chubbyts-http-node
[5]: https://developers.cloudflare.com/workers/
[6]: https://hono.dev
[7]: https://srvx.h3.dev

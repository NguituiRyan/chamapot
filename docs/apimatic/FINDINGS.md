# APIMatic context plugin findings

These observations were checked against the installed `@paypal/paypal-server-sdk` 2.5.0 source, compiled exports, and mock tests. No live PayPal calls were made.

## Guidance that matched the package

- `new Client({ ... })` takes a flat options object. Controllers are constructed separately; there is no client.orders accessor.
- Environment.Sandbox resolves to `https://api-m.sandbox.paypal.com`. Auth configuration is clientCredentialsAuthCredentials with oAuthClientId/oAuthClientSecret and optional oAuthClockSkew.
- The SDK's default timeout is **0**, and default retry count and wait budget are **0**. Explicit transport settings are necessary. Raising retry count alone leaves retries disabled when the wait budget is zero.
- Orders.createOrder/captureOrder/getOrder, Payments.getCapturedPayment and TransactionSearch.searchTransactions use one named options object plus requestOptions. Cancellation is passed as abortSignal.
- Results are wrapped in ApiResponse.result. Request/response model properties are camelCase, while error debug_id is snake_case.
- Separate type-only imports work with this repository's isolatedModules setting. This implementation uses them consistently.
- No SDK async pagination abstraction exists here; Transaction Search requires an explicit page loop.
- The Axios adapter at unstable_httpClientOptions is a working offline test seam. It must return raw serialized JSON. A seeded OAuth token avoids an extra token call. Our mocked createOrder sends the paypalMockResponse header and throws the real generated CustomError on 422.
- The source maps Orders error statuses to CustomError. The common ApiError branch also handles operations/statuses using a base error. A separate token exchange is not cancelled by the operation's requestOptions.

## Caveats and imprecision

- The statements “no operation is paginated” mean “no generated paginated iterator”; they must not be read as “list endpoints fit in one response.” Transaction Search explicitly exposes page/pageSize and totalPages.
- Several skill snippets intentionally contain placeholders. The useful instruction is to inspect installed source; substituting guessed controller/model names would fail. The installed package includes src, but not the referenced doc directory.
- The getting-started guidance suggests checking a pinned repository checkout, then also allows reading the installed package. Reading the installed 2.5.0 source avoided network/version drift and was sufficient here.
- Type-only imports are the safe repository convention. The claim that every mixed value/type import necessarily fails merely because isolatedModules is enabled is broader than TypeScript's actual behavior; verbatimModuleSyntax and export form also matter. We did not rely on mixed imports.
- The JSON factory warning, custom OAuth provider rejection behavior, enum collision warnings, and unknown-field handling were not exhaustively reproduced. They were not needed by the chosen integration; they should not be described as tested defects.

## Related Agent Toolkit findings (not Server SDK defects)

The installed `@paypal/agent-toolkit` 1.11.0 has a public getTools().send_invoice_reminder.execute. It returns JSON strings, including failures as `{ ok: false, status, code, message }`; some non-LlmError failures return `{ error: ... }`. Checking only thrown exceptions or only an error property would incorrectly report some reminders as sent.

Its reminder uses Axios directly, with no explicit timeout. Its client defaults to `api.sandbox.paypal.com`, and supplying context.access_token does not initialize the private token cache; the constructor accepts a separate accessToken argument that PayPalAgentToolkit does not forward. ChamaPot adapts the public client getBaseUrl/getHeaders methods to its required sandbox host and OAuth cache, wraps execute with a deadline, and avoids a duplicate fallback after uncertain delivery. Mock tests cover these adaptations and the structured-failure path.

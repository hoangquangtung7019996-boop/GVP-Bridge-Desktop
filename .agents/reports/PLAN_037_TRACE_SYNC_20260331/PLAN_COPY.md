# PLAN_037: Sentry Trace Synchronization Verification (PLAN_COPY)

## Goal
Achieve 1:1 header parity and bypass WAF 403 Forbidden errors by synchronizing Sentry traces in the delegated fetch flow.

## Steps
1. Capture `traceparent` and `baggage` from native Grok REST API calls in `gvpFetchInterceptor.js`.
2. Store the latest captured traces as page-level global variables.
3. Automatically apply captured `traceparent` and `baggage` to the headers of the `GVP_EXECUTE_DIRECT_GEN` delegated fetch.
4. Verify that the delegated request now matches the session context exactly (31 headers).

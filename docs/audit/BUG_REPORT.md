# BUG REPORT & ROOT CAUSE ANALYSIS: THE BUSINESS WORK DASHBOARD v14

**Audit Date:** October 19, 2026  
**Target:** Production Rebuild & Migration Audit

---

## Bug 1: "Failed to load reports: Authentication required. Please log in" while UI shows Admin

* **Severity:** Critical (Production Blocker)
* **Status:** Resolved
* **Symptom:** The user opens the dashboard or navigates to Reports (`#/reports`). A red toast appears: *"Failed to load reports: Authentication required. Please log in."* Simultaneously, the TopBar shows an "Admin" profile.
* **Root Cause Analysis:**
  1. In `src/App.jsx` line 143, the React `user` state was hardcoded to `seed.USER` (`{ name: 'Code XR', email: 'hello@codexr.studio', ... }`) on initial render.
  2. `signedOut` initialized to `!localStorage.getItem('tbw_token')`. If an expired token remained in localStorage, `signedOut` was `false`.
  3. `Reports.jsx` immediately initiated `Promise.all([api.get('/api/analytics/dashboard'), api.get('/api/finance/analytics')])`.
  4. The backend correctly rejected the expired or unauthenticated request with HTTP 401 (`UNAUTHORIZED`).
  5. `src/lib/api.js` had an overly restrictive check:
     ```javascript
     if (res.status === 401 && (data?.error?.code === 'SESSION_EXPIRED' || data?.error?.code === 'INVALID_SESSION'))
     ```
     Because the backend returned `code: 'UNAUTHORIZED'`, `api.js` did NOT clear `tbw_token` and did NOT dispatch `tbw_auth_expired`!
  6. The UI remained in an invalid state: rendering the fake Admin profile from `seed.js` while displaying the 401 toast.
* **Resolution:**
  1. Updated `src/lib/api.js` so that ANY 401 response immediately removes `tbw_token` and triggers `tbw_auth_expired`.
  2. Updated `src/App.jsx` to eliminate `seed.USER` as initial state, providing an authenticating spinner while `/api/auth/me` resolves.
  3. Cleanly renders `LoginForm` when unauthenticated.

---

## Bug 2: Vercel SPA Wildcard Rewrites Intercepting `/api/*` Requests

* **Severity:** Critical (Serverless Deployment Blocker)
* **Status:** Resolved
* **Symptom:** Deploying the dashboard to Vercel caused all `/api/*` requests to return `200 OK` with the HTML content of `dist/index.html`.
* **Root Cause Analysis:**
  In `vercel.json`, the only rewrite rule was:
  ```json
  "rewrites": [
    { "source": "/(.*)", "destination": "/index.html" }
  ]
  ```
  Vercel processed this rule first, routing all `/api/*` requests to the frontend single page app.
* **Resolution:**
  Added an explicit API rewrite rule preceding the SPA catch-all in [vercel.json](file:///c:/Users/amanr/Downloads/Dashboard%20v14/Dashboard%20v14/vercel.json):
  ```json
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/api/index.js" },
    { "source": "/(.*)", "destination": "/index.html" }
  ]
  ```
  Mirrored the Express router to mount on both `/api` and `/` so routes match regardless of whether Vercel strips the prefix.

---

## Bug 3: Long-Lived Server-Sent Events (SSE) Breaking in Serverless Functions

* **Severity:** High (Realtime Connection Failure)
* **Status:** Resolved
* **Symptom:** In `src/pages/Messages.jsx`, `new EventSource('/api/sse/events')` was used for incoming WhatsApp messages. On Vercel, the function terminated after 10-15 seconds with a 504 Gateway Timeout or execution limit error.
* **Root Cause Analysis:**
  Serverless functions are ephemeral and stateless. Long-lived streaming sockets cannot remain continuously open across serverless execution boundaries.
* **Resolution:**
  Replaced SSE in `src/pages/Messages.jsx` with an authenticated 4-second short-polling loop using `/api/conversations/:id/messages?since=ISO_TIMESTAMP`, which pauses when the browser tab is hidden and refreshes on tab visibility. Converted `api/routes/sse.js` to respond cleanly without hanging Lambda instances.

---

## Bug 4: Zod v4 Validation Error Mapping Failure

* **Severity:** Medium (Validation Exception)
* **Status:** Resolved
* **Symptom:** Invalid payloads to `/api/auth/login` threw `TypeError: Cannot read properties of undefined (reading 'map')`.
* **Root Cause Analysis:**
  `api/middleware/validate.js` attempted to read `err.errors.map()`. In Zod v4, the property was renamed to `err.issues`.
* **Resolution:**
  Updated `validate.js` to read `err.issues || err.errors || []`.

---

## Bug 5: Cartesian Product Multiplying Financial Totals

* **Severity:** Medium (Data Accuracy)
* **Status:** Resolved
* **Symptom:** In `finance.js`, querying client profitability with simultaneous `LEFT JOIN invoices` and `LEFT JOIN payments` multiplied totals if a client had multiple invoices and payments.
* **Root Cause Analysis:**
  A double left-join on non-aggregated child tables causes row multiplication (Cartesian product).
* **Resolution:**
  Aggregated `invoices` and `payments` in independent subqueries before joining with `clients`, ensuring strictly accurate collected and invoiced totals.

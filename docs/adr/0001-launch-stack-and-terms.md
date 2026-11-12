# 1. Launch stack, payments and commercial terms

Status: accepted (2026-11-13). Resolves issue #2.

## Decision

- **Backend: Supabase.** Postgres database, its auto-generated REST API, and Supabase Auth for email and mobile verification and login (#4).
- **Landing page: stays a static page on GitHub Pages.** It talks to Supabase's REST API directly with the project's public anon key; row-level security decides what that key may do.
- **Payments: Razorpay.** UPI, cards and subscriptions for fans; Razorpay Route to split each payment and pay creators' bank accounts.
- **Live streaming provider: not decided.** Deferred to #9; it does not block anything before it.
- **Commission:** 10% of every fan payment, including payment processing. 10% of brand deals booked through the platform.
- **Payouts:** weekly, all lines combined into one payout.
- **Joining:** free for creators.

## Consequences

- No server of our own to host at launch; Supabase is the only backend.
- Anything the anon key can reach is public, so every table needs row-level security and the narrowest grants that work.
- Commission and payout terms are product decisions and stay configurable in code, but the landing page now states them.
- Going live needs a Supabase project and a Razorpay account owned by the business.

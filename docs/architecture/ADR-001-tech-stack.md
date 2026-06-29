# ADR-001: Technology Stack Selection

**Status:** Accepted  
**Date:** 2026-06-26  
**Author:** Ukashatu (Intern ID: 493556B)

## Context

The BED-6C assessment requires a production-grade double-entry ledger system.
The stack must support strict financial correctness, immutability enforcement,
concurrent access control, and regulatory-grade audit trails.

## Decision

| Concern            | Choice                      | Rationale                                                                                                             |
| ------------------ | --------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Runtime            | Node.js 20 LTS              | Proven in fintech (Stripe, Monzo use Node); async I/O fits ledger's high-concurrency read pattern                     |
| Language           | TypeScript 5 strict mode    | `noImplicitAny`, `exactOptionalPropertyTypes`, `noUnusedLocals` catch financial logic errors at compile time          |
| Framework          | NestJS 10 + Fastify adapter | Module system enforces domain boundaries; Fastify is 35% faster than Express; DI makes services testable in isolation |
| Database           | PostgreSQL 15               | NUMERIC(19,4) for money; SERIALIZABLE isolation; advisory locks; range partitioning; triggers for immutability        |
| ORM                | Prisma 5                    | TypeScript-native; migration runner; raw SQL escape hatch via `$queryRaw` for locking and aggregation                 |
| Decimal arithmetic | decimal.js                  | Arbitrary-precision; ROUND_HALF_UP; eliminates IEEE 754 floating-point errors (Revolut incident defense)              |
| IDs                | UUID v7                     | Time-sortable; no sequential enumeration attacks; natural ordering in ledger_entries                                  |
| Hashing            | Node.js crypto (SHA-256)    | Built-in; no external dependency; standard for financial audit chains                                                 |
| Logging            | Pino via nestjs-pino        | Structured JSON; lowest overhead of any Node logger; redacts sensitive headers                                        |
| Metrics            | prom-client                 | Prometheus-compatible; standard for production observability                                                          |

## Alternatives Rejected

- **Express.js**: No module system — large financial codebases become unmaintainable without enforced boundaries.
- **TypeORM**: Active Record pattern couples domain objects to persistence; harder to test; less type-safe than Prisma.
- **Python/FastAPI**: Viable, but Node.js TypeScript offers better type safety for financial domain modelling.
- **MongoDB**: No ACID transactions spanning multiple documents; NUMERIC type unavailable; unsuitable for ledgers.

## Consequences

- NestJS module boundaries mean each financial domain (ledger, transactions, fx, audit) is independently deployable in a future microservices migration.
- Prisma raw SQL escape hatches allow `SELECT FOR UPDATE`, advisory locks, and window functions that the ORM cannot express.
- decimal.js adds ~50KB to the bundle but eliminates the class of bugs that caused Revolut's GBP 12,000/day rounding discrepancy.

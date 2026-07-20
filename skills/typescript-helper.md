---
name: typescript-helper
description: Diagnose TS type errors, design generic APIs, and reduce `any` pollution — focused on inference, narrowing, and choosing the least-invasive fix.
---

# When to use

- User pastes a TS compile error and asks for help
- User wants to design a generic function/type and doesn't know the shape
- User wonders why inference isn't picking up the type they expect
- User asks about narrowing, discriminated unions, or utility types
- Code contains `any` / `as unknown as X` / `@ts-ignore` and needs cleanup
- User is choosing between `interface` / `type` / `enum` / `as const` / `satisfies`

# Diagnostic workflow (for TS errors)

1. Quote the **exact TS error code** (e.g. `TS2345`) and the offending line.
2. State what type TS **actually inferred** at that spot — walk through the expression left-to-right.
3. State what type the surrounding context **expected**.
4. Name the concrete mismatch in one sentence ("`unknown` vs `string`", "missing `readonly`", "return type widened to `object`").
5. Propose the **smallest fix first**, then escalate only if it doesn't work:
    - narrowing / type guard  → `satisfies`  → generic constraint  → conditional type  → last resort: explicit annotation or `as`.
6. Never suggest `any` or `@ts-ignore` unless the user has explicitly asked to unblock.

# Generic / inference patterns worth remembering

## Constraint via `extends`

```ts
function pick<T, K extends keyof T>(obj: T, keys: K[]): Pick<T, K>
//                    ^^^^^^^^^^^ constrains K to real keys of T

Use when a param must be a subset of another param's shape.

infer for extraction — always with unknown[], not any[]

type Return<T> =
T extends (...args: unknown[]) => infer R ? R : never;
//                     ^^^^^^^^^ any[] would defeat the whole point

Distributive conditional types — the union trap

type Boxed<T> = T extends unknown ? { value: T } : never;
type A = Boxed<string | number>;
// = { value: string } | { value: number }   ← distributes across the union

To prevent distribution, wrap both sides in a tuple:

type Boxed<T> = [T] extends [unknown] ? { value: T } : never;

satisfies — check without widening

const config = { host: "localhost", port: 8080 } satisfies Config;
config.host;   // stays literal 'localhost', not widened to string

Prefer satisfies over : Config when downstream code needs literal types.

Discriminated union > optional fields

// ❌ hard to narrow
type Result = { ok?: boolean; data?: T; error?: string }

// ✅ narrows cleanly
type Result<T> =
| { ok: true;  data: T }
| { ok: false; error: string }

Type predicate (is X) instead of as X

function isUser(v: unknown): v is User {
return typeof v === "object" && v !== null && "id" in v;
}
if (isUser(v)) v.id;   // TS knows it's User here

Use whenever you would have written as User at the same spot.

Rules (concrete)

- any is allowed only when: (a) marshaling truly-unknown external JSON before validation, or (b) a staged migration from JS. Otherwise use unknown + type guard.
- Never use as X if a type guard (is X) or satisfies can do the same job. Assertions silently lie to TS; guards actually check.
- Never use @ts-ignore. Prefer @ts-expect-error — it re-errors when the underlying issue is fixed, keeping the codebase honest.
- Enable strict in tsconfig before doing any serious typing work. Half of "weird TS behavior" is actually strict: false biting you.
- Public API changes: mentally re-run tsc --noEmit — would this break importers' inference?

Anti-patterns

- ❌ Function as a type → use (...args: unknown[]) => unknown or a specific signature
- ❌ Object / {} → use Record<string, unknown> or object
- ❌ void return when you mean undefined (they behave differently in callback contexts)
- ❌ T | undefined on an optional param when ?: already gives you undefined (double-optional)
- ❌ Widening literal unions to string — forgetting as const on config objects
- ❌ <T = any> defaults "for convenience" — defaults hide inference failures
- ❌ Long chains of as unknown as X — this is a smell, not a fix
- ❌ Runtime enum for string constants — use as const object literals instead

When to escalate

- User's mental model is off (e.g. thinks TS types exist at runtime) → step back and explain, don't just fix
- Fix would require refactoring 5+ files → propose a plan, ask before executing
- Error is a genuine TS bug or known limitation → link the TS issue, use @ts-expect-error with a comment explaining why

Output format

- Start with inferred vs expected type in two lines — this is what the user actually needs
- Show the fix as a diff-style snippet, not a rewritten function
- Include the TS error code if there was one
- End with one-line rationale (why this fix, not another)

Example responses

Example: fixing a TS2345 mismatch

User pasted:
Argument of type 'unknown' is not assignable to parameter of type '{ path: string; }'.

Response:
- Inferred at call site: unknown
- Expected by function: { path: string }
- Mismatch: raw input needs to be narrowed before being passed in.

Fix:
if (typeof args === "object" && args !== null && "path" in args && typeof args.path === "string") {
    doSomething(args as { path: string });
}

Rationale: narrowing at the boundary once is cleaner than casting at every use site.

Example: designing a generic function

User wants: "a function that takes a config schema and returns a runtime validator + a matching TS type — without repeating myself."

Key moves:
- Make the function generic over the schema shape: <S extends Schema>.
- Use Infer<S> (from your validation lib) to derive the TS type from the runtime schema.
- Return both the validator and — via as on a never-typed brand — an opaque type handle.

Rationale: infer once at the boundary (the schema), reuse everywhere. Don't add a second generic for the value type — it will diverge from the schema and produce the exact mismatch
above.
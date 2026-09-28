// **What the node was actually asked, for one API call.**
//
// The check used to see only our answer, so "we said 15 contracts" could be compared against nothing. Half of
// the nine sentences need the other number — what the node handed us — and that half cannot be judged from a
// response alone.
//
// `send` is the sole path out to the ledger and `buildApp` takes it from outside (live/build-app.mjs), so one
// more wrapper is all this needs: **no product code changes.** The trace is cleared before each API call and
// taken after it, which is also what groups "the node calls that belong to this one request" — the router
// awaits its ledger calls in order (run-check.ts runs one address at a time), so nothing else is interleaved.
import type { LedgerSend } from "@canton-lens/core";

// One question put to the node and the answer that came back.
//
// **Only these five fields are copied.** The router adds the caller's bearer to the request object just before
// it goes out (auth/ledger-send-with-token.ts), so the object arriving here carries a credential — copying it
// wholesale would write a token into a failure message. Spreading the request is therefore not allowed, here
// or in anything built on this.
export type NodeCall = {
  method: string;
  path: string;
  /** The request body as it went out. null for a GET. */
  body: unknown;
  status: number;
  /** The JSON the node answered. Package bytes are not carried — see `bytes`. */
  answer: unknown;
  /** Set instead of `answer` when the answer was bytes (a package download): how many. */
  bytes?: number;
};

export type Tracer = {
  /** Hand this to `buildApp`. It passes everything through untouched. */
  send: LedgerSend;
  /** The calls since the last `take`, in the order they were made. Clears the list. */
  take: () => NodeCall[];
};

export function tracingSend(real: LedgerSend): Tracer {
  let calls: NodeCall[] = [];
  return {
    send: async (request) => {
      // The real call first — a question that threw is not a question the node answered, and inventing a
      // status for it here would put a fact in the trace that never happened.
      const result = await real(request);
      const call: NodeCall = {
        method: request.method,
        path: request.path,
        body: request.body ?? null,
        status: result.status,
        answer: result.body instanceof Uint8Array ? null : result.body,
      };
      if (result.body instanceof Uint8Array) call.bytes = result.body.length;
      calls.push(call);
      return result;
    },
    take: () => {
      const taken = calls;
      calls = [];
      return taken;
    },
  };
}

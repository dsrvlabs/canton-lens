// **The whole of home refreshes at one offset**. If each part had a different time, inconsistent combinations would appear within the screen.
// So the offset home gave is passed as is to the requests that follow. This context holds that read order (home → session → the rest) and
// the stamp and the error banner. No judgment — it stores the values the server answered and passes them on.
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { apiResponse, messageOf, SignInRequiredError, safeHttpUrl } from "../api/client.ts";
import type {
  HoldingsCache,
  HoldingsResponse,
  HomeResponse,
  NodeResponse,
  OffersResponse,
  PackagesResponse,
  PreapprovalsCache,
  PreapprovalsResponse,
  SessionResponse,
  TemplatesResponse,
} from "../api/types.ts";
import { useHash } from "../route/hash.ts";

// These two constants identify the standard interfaces the Explorer knows. The tokens card counts by the standard
// Holding interface (Splice token standard) — app tokens that do not implement the standard are not caught, and the card says so.
export const KNOWN_HOLDING_INTERFACE =
  "#splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding";
// The Splice token standard's TransferInstruction interface.
export const KNOWN_INTERFACE =
  "#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1:TransferInstruction";

export type Session = {
  myParties: string[];
  // The offset home decided — the screens that follow take it as is.
  lastOffset: number | null;
  // Re-reading everything from home to node — the screens read their own things only after this finishes,
  // so a half-filled session is never drawn as if it were empty.
  loading: boolean;
  // The generation of successful full reads — the screens re-read only when (generation + their own conditions) changed.
  // A failed read does not bump the generation, so a failure never passes for fresh data.
  generation: number;
  error: string | null;
  signInRequired: { entryUrl: string | null } | null;
  logoutUrl: string | null;
  home: HomeResponse | null;
  session: SessionResponse | null;
  offers: OffersResponse | null;
  holdings: HoldingsResponse | null;
  preapprovals: PreapprovalsResponse | null;
  templates: TemplatesResponse | null;
  packages: PackagesResponse | null;
  node: NodeResponse | null;
  holdingsCache: HoldingsCache;
  preapprovalsCache: PreapprovalsCache;
  fail: (message: string) => void;
  clearError: () => void;
  refresh: () => Promise<void>;
  api: <T>(path: string) => Promise<T>;
};

const Ctx = createContext<Session | null>(null);

export function useSession(): Session {
  const s = useContext(Ctx);
  if (s === null) throw new Error("useSession outside SessionProvider");
  return s;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const hash = useHash();
  const [lastOffset, setLastOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [generation, setGeneration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [signInRequired, setSignInRequired] = useState<{ entryUrl: string | null } | null>(null);
  const [logoutUrl, setLogoutUrl] = useState<string | null>(null);
  const [home, setHome] = useState<HomeResponse | null>(null);
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [offers, setOffers] = useState<OffersResponse | null>(null);
  const [holdings, setHoldings] = useState<HoldingsResponse | null>(null);
  const [preapprovals, setPreapprovals] = useState<PreapprovalsResponse | null>(null);
  const [templates, setTemplates] = useState<TemplatesResponse | null>(null);
  const [packages, setPackages] = useState<PackagesResponse | null>(null);
  const [node, setNode] = useState<NodeResponse | null>(null);
  // The previously seen node offset — the server does not store it, so the screen remembers.
  const lastNode = useRef<{ offset: number; at: number } | null>(null);

  const call = useCallback(
    async <T,>(path: string, observe?: (response: Response) => void): Promise<T> => {
      try {
        const result = await apiResponse<T>(path);
        observe?.(result.response);
        return result.body;
      } catch (error) {
        if (error instanceof SignInRequiredError) {
          setLogoutUrl(null);
          setSignInRequired({ entryUrl: error.entryUrl });
        }
        throw error;
      }
    },
    [],
  );

  // **Returns whether it failed.** Home comes first, and home decides the offset. One response holds the cards·sparkline·list all together,
  // and the screens that follow take that offset as is. The time (asOf) is measured by the browser and passed on — the server does not read the clock.
  // If the ledger end cannot be obtained, it throws here and the whole of home is "could not fetch".
  const load = useCallback(async (): Promise<boolean> => {
    setError(null);
    setSignInRequired(null);
    setLoading(true);
    try {
      const asOf = new Date().toISOString();
      const h = await call<HomeResponse>(
        `/api/home?asOf=${encodeURIComponent(asOf)}` +
          `&interfaceId=${encodeURIComponent(KNOWN_INTERFACE)}` +
          `&holdingInterfaceId=${encodeURIComponent(KNOWN_HOLDING_INTERFACE)}`,
      );
      setLastOffset(h.offset);
      setHome(h);
      const at = `offset=${h.offset}`;

      const s = await call<SessionResponse>("/api/session", (response) => {
        setLogoutUrl(safeHttpUrl(response.headers.get("x-canton-lens-logout")));
      });
      setSession(s);

      setOffers(
        await call<OffersResponse>(
          `/api/offers?${at}&interfaceId=${encodeURIComponent(KNOWN_INTERFACE)}&asOf=${encodeURIComponent(asOf)}`,
        ),
      );
      // Holdings are identified by the standard Holding interface view — the same technique as the home card.
      setHoldings(
        await call<HoldingsResponse>(
          `/api/holdings?${at}&holdingInterfaceId=${encodeURIComponent(KNOWN_HOLDING_INTERFACE)}`,
        ),
      );
      setPreapprovals(
        await call<PreapprovalsResponse>(
          `/api/preapprovals?${at}&asOf=${encodeURIComponent(asOf)}`,
        ),
      );
      setTemplates(await call<TemplatesResponse>(`/api/catalog/templates?${at}`));
      setPackages(await call<PackagesResponse>("/api/catalog/packages"));

      // If there is a previously seen offset, pass it along.
      const now = Date.now();
      const prior = lastNode.current
        ? `&priorOffset=${lastNode.current.offset}&priorObservedAtMs=${lastNode.current.at}`
        : "";
      const n = await call<NodeResponse>(`/api/node?currentObservedAtMs=${now}${prior}`);
      setNode(n);
      // The prior for the progress judgment must be the value this status call read — mixing in another read's offset makes one screen contradict itself.
      if (n.ledgerEnd.status === "ok") lastNode.current = { offset: n.ledgerEnd.offset, at: now };
      setGeneration((g) => g + 1);
      return true;
    } catch (e) {
      setError(messageOf(e));
      return false;
    } finally {
      setLoading(false);
    }
  }, [call]);

  // Browser OIDC gates mounting on Browser login. Institution BFF requests rely on BFF session checks;
  // shared-identity relies on operator admission, not individual login. This provider holds ledger UI data.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void load();
  }, [load]);

  // When the address changes, first clear the error banner. Why a layout effect: the new screen's
  // effects (the invalid address banner, etc.) must run **after** this one, and a child's passive effects run before the parent's.
  const clearedFor = useRef(hash);
  useLayoutEffect(() => {
    if (clearedFor.current === hash) return;
    clearedFor.current = hash;
    setError(null);
  }, [hash]);

  // Refresh re-reads home's values and **redraws the place being viewed as is.** If pressing it while viewing a contract
  // detail dropped you onto home, that would be navigation, not a refresh — the address is not touched.
  const refresh = useCallback(async () => {
    await load();
  }, [load]);

  const value = useMemo<Session>(() => {
    const myParties =
      session && session.outcome === "view" ? session.parties.map((p) => p.party) : [];
    const holdingsCache: HoldingsCache =
      holdings === null
        ? { groups: [] }
        : holdings.kind === "available"
          ? { groups: holdings.view.groups }
          : { groups: [], failed: holdings.reason ?? "reason unknown" };
    const preapprovalsCache: PreapprovalsCache =
      preapprovals === null
        ? { rows: [] }
        : preapprovals.kind === "available"
          ? { rows: preapprovals.view.rows }
          : { rows: [], failed: preapprovals.reason ?? "reason unknown" };
    return {
      myParties,
      lastOffset,
      loading,
      generation,
      error,
      signInRequired,
      logoutUrl,
      home,
      session,
      offers,
      holdings,
      preapprovals,
      templates,
      packages,
      node,
      holdingsCache,
      preapprovalsCache,
      fail: setError,
      clearError: () => setError(null),
      refresh,
      api: call,
    };
  }, [
    lastOffset,
    loading,
    generation,
    error,
    signInRequired,
    logoutUrl,
    home,
    session,
    offers,
    holdings,
    preapprovals,
    templates,
    packages,
    node,
    refresh,
    call,
  ]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { handleTxError, useFlapSdk, ZERO_ADDRESS } from "@/src/sdk";
import {
  AddressLink,
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CopyButton,
  Countdown,
  DataRow,
  ExternalLink,
  Input,
  Metric,
  StatusBadge,
  TxButton,
  type TxButtonState,
} from "@/src/ui";
import { BuilderBountiesAbi } from "./VaultABI";

const CHAIN_ID = 56;
const CONTRACT_ADDRESS = "0xa07c71d15b71c4575db9ce58a01c883b2ee8dd82" as const;
const IS_LIVE = CONTRACT_ADDRESS !== ZERO_ADDRESS;

const OFFICIAL_X_URL = "https://x.com/thebnbmascot";

const MAX_BOUNTY_DURATION_SECONDS = 30 * 24 * 3600;
const MIN_POST_DURATION_SECONDS = 48 * 3600;
const PAGE_SIZE = 25;
const REVIEW_TIMEOUT_SECONDS = 14 * 24 * 3600;
const MIN_SELECT_LEAD_TIME_SECONDS = 24 * 3600;

type Status = 0 | 1 | 2 | 3 | 4 | 5;
type BountyTuple = readonly [
  poster: `0x${string}`,
  builder: `0x${string}`,
  title: string,
  briefLink: string,
  rewardLabel: string,
  category: string,
  deadline: bigint,
  submittedAt: bigint,
  status: number,
  proofLink: string,
  nonPaymentReported: boolean,
];

interface Bounty {
  id: number;
  poster: `0x${string}`;
  builder: `0x${string}`;
  title: string;
  briefLink: string;
  rewardLabel: string;
  category: string;
  deadline: number;
  submittedAt: number;
  status: Status;
  proofLink: string;
  nonPaymentReported: boolean;
}

const STATUS_I18N_KEYS = ["status.open", "status.claimed", "status.submitted", "status.approved", "status.expired", "status.cancelled"] as const;
const STATUS_TONE: Array<"neutral" | "success" | "warning" | "danger"> = ["warning", "neutral", "neutral", "success", "danger", "neutral"];
const CATEGORIES = ["Dev", "Design", "Content", "Community"] as const;
const CATEGORY_I18N_KEYS: Record<(typeof CATEGORIES)[number], string> = {
  Dev: "categories.dev",
  Design: "categories.design",
  Content: "categories.content",
  Community: "categories.community",
};

function toBounty(id: number, tuple: BountyTuple): Bounty {
  return {
    id,
    poster: tuple[0],
    builder: tuple[1],
    title: tuple[2],
    briefLink: tuple[3],
    rewardLabel: tuple[4],
    category: tuple[5],
    deadline: Number(tuple[6]),
    submittedAt: Number(tuple[7]),
    status: tuple[8] as Status,
    proofLink: tuple[9],
    nonPaymentReported: tuple[10],
  };
}

function formatDeadline(unixSeconds: number) {
  if (!unixSeconds) return "-";
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

function isoDate(unixSeconds: number) {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

function isHttpsUrl(value: string) {
  if (!value) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/** Brief/proof links can be any URL a user typed in, or just plain text — never a raw clickable
 *  anchor either way. A URL goes through Flap's own "leaving FLAP" warning gate; plain text is
 *  just shown as-is. */
function LinkOrText({ value, label }: { value: string; label: string }) {
  if (!value) return null;
  if (isHttpsUrl(value)) {
    return (
      <DataRow
        label={label}
        value={
          <ExternalLink url={value}>
            {label} ↗
          </ExternalLink>
        }
      />
    );
  }
  return <DataRow label={label} value={<span className="break-words">{value}</span>} />;
}

/** A compact track-record line for an applicant or an already-selected builder — reuses the same
 *  i18n labels the Profile tab uses for its own stats, so no new keys are needed. */
function ReputationLine({
  rep,
  pointsLabel,
  completedLabel,
  strikesLabel,
  blacklistedLabel,
}: {
  rep?: { points: bigint; completed: bigint; strikes: bigint; blacklisted: boolean };
  pointsLabel: string;
  completedLabel: string;
  strikesLabel: string;
  blacklistedLabel: string;
}) {
  if (!rep) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-white/56">
      <span>
        {pointsLabel} {rep.points.toString()}
      </span>
      <span>
        {completedLabel} {rep.completed.toString()}
      </span>
      {rep.strikes > 0n ? (
        <span className="text-amber-400">
          {strikesLabel} {rep.strikes.toString()}
        </span>
      ) : null}
      {rep.blacklisted ? <StatusBadge tone="danger">{blacklistedLabel}</StatusBadge> : null}
    </div>
  );
}

/** X/Telegram rows for a poster, builder, or applicant — omitted entirely for a field nobody set. */
function ContactLinks({ contact, xLabel, tgLabel }: { contact?: { x: string; tg: string }; xLabel: string; tgLabel: string }) {
  if (!contact || (!contact.x && !contact.tg)) return null;
  return (
    <>
      {contact.x ? (
        <DataRow label={xLabel} value={<ExternalLink url={`https://x.com/${contact.x.replace(/^@/, "")}`}>{contact.x}</ExternalLink>} />
      ) : null}
      {contact.tg ? (
        <DataRow label={tgLabel} value={<ExternalLink url={`https://t.me/${contact.tg.replace(/^@/, "")}`}>{contact.tg}</ExternalLink>} />
      ) : null}
    </>
  );
}

export default function Component() {
  const sdk = useFlapSdk({ chainId: CHAIN_ID });
  const { wallet, i18n, context } = sdk;
  const t = i18n.t;

  const [tab, setTab] = useState<"browse" | "post" | "profile">("browse");
  const [browseView, setBrowseView] = useState<"bounties" | "builders">("bounties");
  const [bounties, setBounties] = useState<Bounty[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txState, setTxState] = useState<TxButtonState>("idle");
  const [activeId, setActiveId] = useState<number | null>(null);
  const [proofDraftId, setProofDraftId] = useState<number | null>(null);
  const [proofDraft, setProofDraft] = useState("");
  const [applicants, setApplicants] = useState<Record<number, `0x${string}`[]>>({});
  const [myApplied, setMyApplied] = useState<Record<number, boolean>>({});
  const [applicantsOpenId, setApplicantsOpenId] = useState<number | null>(null);
  const [expandedBountyId, setExpandedBountyId] = useState<number | null>(null);
  const [expandedBuilderKey, setExpandedBuilderKey] = useState<string | null>(null);
  const [applicantsLoading, setApplicantsLoading] = useState(false);
  // Keyed by lowercased address — fetched lazily and cached so the same poster/builder/applicant
  // appearing on multiple bounties only costs one read each.
  const [contacts, setContacts] = useState<Record<string, { x: string; tg: string }>>({});
  const [posterReports, setPosterReports] = useState<Record<string, bigint>>({});
  const [posterHistory, setPosterHistory] = useState<Record<string, { approved: number; rejected: number } | "unavailable">>({});
  const [reputations, setReputations] = useState<Record<string, { points: bigint; completed: bigint; strikes: bigint; blacklisted: boolean }>>({});
  const [categoryFilter, setCategoryFilter] = useState<"All" | (typeof CATEGORIES)[number]>("All");
  const [bountyLimit, setBountyLimit] = useState(PAGE_SIZE);
  const [bountyTotal, setBountyTotal] = useState(0);
  const [builderLimit, setBuilderLimit] = useState(PAGE_SIZE);
  const [builderTotal, setBuilderTotal] = useState(0);
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
  const [profileLoadedFor, setProfileLoadedFor] = useState<string | null>(null);
  const [rejectConfirmId, setRejectConfirmId] = useState<number | null>(null);
  const fetchedContactsRef = useRef<Set<string>>(new Set());
  const fetchedReportsRef = useRef<Set<string>>(new Set());
  const fetchedPosterHistoryRef = useRef<Set<string>>(new Set());
  const fetchedReputationRef = useRef<Set<string>>(new Set());

  const [builders, setBuilders] = useState<`0x${string}`[]>([]);
  const [buildersLoading, setBuildersLoading] = useState(false);
  const [openForWorkOnly, setOpenForWorkOnly] = useState(false);
  const [builderProfiles, setBuilderProfiles] = useState<
    Record<string, { available: boolean; rate: string; skills: string; github: string; portfolio: string }>
  >({});
  const fetchedBuilderProfileRef = useRef<Set<string>>(new Set());

  // Whether the connected wallet has X or Telegram set — null until checked. Needed outside the
  // Profile tab too, to gate Post/Apply with a friendly message instead of a raw contract revert.
  const [myHasContact, setMyHasContact] = useState<boolean | null>(null);

  const [postTitle, setPostTitle] = useState("");
  const [postBrief, setPostBrief] = useState("");
  const [postReward, setPostReward] = useState("");
  const [postCategory, setPostCategory] = useState<(typeof CATEGORIES)[number]>("Dev");
  const [postDeadline, setPostDeadline] = useState("");

  const [profile, setProfile] = useState<{
    points: bigint;
    completed: bigint;
    strikes: bigint;
    blacklisted: boolean;
  } | null>(null);
  const [profileAvailable, setProfileAvailable] = useState(false);
  const [profileRate, setProfileRate] = useState("");
  const [profileSkills, setProfileSkills] = useState("");
  const [profileX, setProfileX] = useState("");
  const [profileTg, setProfileTg] = useState("");
  const [profileGithub, setProfileGithub] = useState("");
  const [profilePortfolio, setProfilePortfolio] = useState("");

  const txErrorMessages = useMemo(
    () => ({
      userRejected: t("errors.userRejected"),
      walletDisconnected: t("errors.walletDisconnected"),
      wrongNetwork: t("errors.wrongNetwork"),
      insufficientFunds: t("errors.insufficientFunds"),
      simulationFailed: t("errors.simulationFailed"),
      reverted: t("errors.reverted"),
      unknown: t("errors.unknown"),
    }),
    [t],
  );

  const loadBounties = useCallback(async () => {
    if (!IS_LIVE) {
      setBounties([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const count = await sdk.readContract<bigint>({
        address: CONTRACT_ADDRESS,
        abi: BuilderBountiesAbi,
        functionName: "bountyCount",
      });
      const total = Number(count);
      setBountyTotal(total);
      const ids = Array.from({ length: total }, (_, index) => total - 1 - index).slice(0, bountyLimit);
      const rows = await Promise.all(
        ids.map(async (id) => {
          const tuple = await sdk.readContract<BountyTuple>({
            address: CONTRACT_ADDRESS,
            abi: BuilderBountiesAbi,
            functionName: "bounties",
            args: [BigInt(id)],
          });
          return toBounty(id, tuple);
        }),
      );
      setBounties(rows);
      const addresses = new Set<`0x${string}`>();
      rows.forEach((b) => {
        if (b.poster !== ZERO_ADDRESS) addresses.add(b.poster);
        if (b.builder !== ZERO_ADDRESS) addresses.add(b.builder);
      });
      addresses.forEach((addr) => {
        void ensureContact(addr);
        void ensurePosterReports(addr);
        void ensurePosterHistory(addr);
      });
      rows.forEach((b) => {
        if (b.builder !== ZERO_ADDRESS) void ensureReputation(b.builder);
      });
      if (wallet.address) {
        const openRows = rows.filter((b) => b.status === 0);
        const mine = wallet.address;
        const applied = await Promise.all(
          openRows.map((b) =>
            sdk.readContract<boolean>({ address: CONTRACT_ADDRESS, abi: BuilderBountiesAbi, functionName: "hasApplied", args: [BigInt(b.id), mine] }),
          ),
        );
        setMyApplied((prev) => {
          const next = { ...prev };
          openRows.forEach((b, i) => {
            next[b.id] = applied[i];
          });
          return next;
        });
      }
    } catch (nextError) {
      setError(handleTxError(nextError, txErrorMessages));
    } finally {
      setLoading(false);
    }
  }, [sdk, txErrorMessages, wallet.address, bountyLimit]);

  /** Fetches and caches an address's X/Telegram handles once — same address across many
   *  bounties costs one read, not one per appearance. */
  const ensureContact = useCallback(
    async (address: `0x${string}`) => {
      const key = address.toLowerCase();
      if (fetchedContactsRef.current.has(key)) return;
      fetchedContactsRef.current.add(key);
      try {
        const [x, tg] = await Promise.all([
          sdk.readContract<string>({ address: CONTRACT_ADDRESS, abi: BuilderBountiesAbi, functionName: "xHandle", args: [address] }),
          sdk.readContract<string>({ address: CONTRACT_ADDRESS, abi: BuilderBountiesAbi, functionName: "tgHandle", args: [address] }),
        ]);
        setContacts((prev) => ({ ...prev, [key]: { x, tg } }));
      } catch {
        fetchedContactsRef.current.delete(key);
      }
    },
    [sdk],
  );

  /** A poster's non-payment report count — shown so a builder can self-vet before applying. */
  const ensurePosterReports = useCallback(
    async (address: `0x${string}`) => {
      const key = address.toLowerCase();
      if (fetchedReportsRef.current.has(key)) return;
      fetchedReportsRef.current.add(key);
      try {
        const count = await sdk.readContract<bigint>({
          address: CONTRACT_ADDRESS,
          abi: BuilderBountiesAbi,
          functionName: "posterNonPaymentReports",
          args: [address],
        });
        setPosterReports((prev) => ({ ...prev, [key]: count }));
      } catch {
        fetchedReportsRef.current.delete(key);
      }
    },
    [sdk],
  );

  /** A poster's approved/rejected counts, read from FSI (ns="bounty", Template L) since the
   *  contract itself keeps no counter — approvals are rows where actor is the poster and data is
   *  "approved"; rejections are rows where related is the poster and data starts with "rejected".
   *  Shows "unavailable" rather than a false "0" if the FSI read fails — a missing record must
   *  never look like a clean one. */
  const ensurePosterHistory = useCallback(
    async (address: `0x${string}`) => {
      const key = address.toLowerCase();
      if (fetchedPosterHistoryRef.current.has(key)) return;
      fetchedPosterHistoryRef.current.add(key);
      try {
        const fsiPath = `${CONTRACT_ADDRESS}/L/bounty`;
        const approvedResponse = await sdk.readFsi(fsiPath, { actor: address, limit: "1000" });
        const rejectedResponse = await sdk.readFsi(fsiPath, { related: address, limit: "1000" });
        const approvedRows: unknown[] = (approvedResponse as { items?: unknown[] }).items ?? [];
        const rejectedRows: unknown[] = (rejectedResponse as { items?: unknown[] }).items ?? [];
        const fieldKey = "data";
        const approved = approvedRows.filter((row) => (row as Record<string, unknown>)[fieldKey] === "approved").length;
        const rejected = rejectedRows.filter((row) => String((row as Record<string, unknown>)[fieldKey] ?? "").startsWith("rejected")).length;
        setPosterHistory((prev) => ({ ...prev, [key]: { approved, rejected } }));
      } catch {
        setPosterHistory((prev) => ({ ...prev, [key]: "unavailable" }));
      }
    },
    [sdk],
  );

  /** A builder's track record (points/completed/strikes/blacklisted) — shown for applicants and a
   *  selected builder so a poster can actually judge reliability, not just see an address. */
  const ensureReputation = useCallback(
    async (address: `0x${string}`) => {
      const key = address.toLowerCase();
      if (fetchedReputationRef.current.has(key)) return;
      fetchedReputationRef.current.add(key);
      try {
        const [points, completed, strikes, blacklisted] = await Promise.all([
          sdk.readContract<bigint>({ address: CONTRACT_ADDRESS, abi: BuilderBountiesAbi, functionName: "builderPoints", args: [address] }),
          sdk.readContract<bigint>({ address: CONTRACT_ADDRESS, abi: BuilderBountiesAbi, functionName: "buildersCompleted", args: [address] }),
          sdk.readContract<bigint>({ address: CONTRACT_ADDRESS, abi: BuilderBountiesAbi, functionName: "builderMissedStrikes", args: [address] }),
          sdk.readContract<boolean>({ address: CONTRACT_ADDRESS, abi: BuilderBountiesAbi, functionName: "builderBlacklisted", args: [address] }),
        ]);
        setReputations((prev) => ({ ...prev, [key]: { points, completed, strikes, blacklisted } }));
      } catch {
        fetchedReputationRef.current.delete(key);
      }
    },
    [sdk],
  );

  const loadBuilders = useCallback(async () => {
    if (!IS_LIVE) {
      setBuilders([]);
      return;
    }
    setBuildersLoading(true);
    try {
      const count = await sdk.readContract<bigint>({
        address: CONTRACT_ADDRESS,
        abi: BuilderBountiesAbi,
        functionName: "registeredBuilderCount",
      });
      const total = Number(count);
      setBuilderTotal(total);
      const indexes = Array.from({ length: total }, (_, index) => total - 1 - index).slice(0, builderLimit);
      const addresses = await Promise.all(
        indexes.map((index) =>
          sdk.readContract<`0x${string}`>({
            address: CONTRACT_ADDRESS,
            abi: BuilderBountiesAbi,
            functionName: "registeredBuilderAt",
            args: [BigInt(index)],
          }),
        ),
      );
      setBuilders(addresses);
      addresses.forEach((addr) => {
        void ensureReputation(addr);
        void ensureContact(addr);
        void ensureBuilderProfile(addr);
      });
    } catch (nextError) {
      setError(handleTxError(nextError, txErrorMessages));
    } finally {
      setBuildersLoading(false);
    }
  }, [sdk, txErrorMessages, builderLimit]);

  /** The rest of a builder's listing beyond X/TG (already cached by ensureContact) and
   *  points/completed/strikes (already cached by ensureReputation) — kept separate since this
   *  data is only needed in the Builders directory, not on every bounty card. */
  const ensureBuilderProfile = useCallback(
    async (address: `0x${string}`) => {
      const key = address.toLowerCase();
      if (fetchedBuilderProfileRef.current.has(key)) return;
      fetchedBuilderProfileRef.current.add(key);
      try {
        const [available, rate, skills, github, portfolio] = await Promise.all([
          sdk.readContract<boolean>({ address: CONTRACT_ADDRESS, abi: BuilderBountiesAbi, functionName: "openForWork", args: [address] }),
          sdk.readContract<string>({ address: CONTRACT_ADDRESS, abi: BuilderBountiesAbi, functionName: "rateLabel", args: [address] }),
          sdk.readContract<string>({ address: CONTRACT_ADDRESS, abi: BuilderBountiesAbi, functionName: "skillsLabel", args: [address] }),
          sdk.readContract<string>({ address: CONTRACT_ADDRESS, abi: BuilderBountiesAbi, functionName: "githubHandle", args: [address] }),
          sdk.readContract<string>({ address: CONTRACT_ADDRESS, abi: BuilderBountiesAbi, functionName: "portfolioLink", args: [address] }),
        ]);
        setBuilderProfiles((prev) => ({ ...prev, [key]: { available, rate, skills, github, portfolio } }));
      } catch {
        fetchedBuilderProfileRef.current.delete(key);
      }
    },
    [sdk],
  );

  const loadProfile = useCallback(async () => {
    if (!IS_LIVE || !wallet.address) {
      setProfile(null);
      return;
    }
    try {
      const [points, completed, strikes, blacklisted, openWork, rate, skills, x, tg, github, portfolio] = await Promise.all([
        sdk.readContract<bigint>({ address: CONTRACT_ADDRESS, abi: BuilderBountiesAbi, functionName: "builderPoints", args: [wallet.address] }),
        sdk.readContract<bigint>({ address: CONTRACT_ADDRESS, abi: BuilderBountiesAbi, functionName: "buildersCompleted", args: [wallet.address] }),
        sdk.readContract<bigint>({ address: CONTRACT_ADDRESS, abi: BuilderBountiesAbi, functionName: "builderMissedStrikes", args: [wallet.address] }),
        sdk.readContract<boolean>({ address: CONTRACT_ADDRESS, abi: BuilderBountiesAbi, functionName: "builderBlacklisted", args: [wallet.address] }),
        sdk.readContract<boolean>({ address: CONTRACT_ADDRESS, abi: BuilderBountiesAbi, functionName: "openForWork", args: [wallet.address] }),
        sdk.readContract<string>({ address: CONTRACT_ADDRESS, abi: BuilderBountiesAbi, functionName: "rateLabel", args: [wallet.address] }),
        sdk.readContract<string>({ address: CONTRACT_ADDRESS, abi: BuilderBountiesAbi, functionName: "skillsLabel", args: [wallet.address] }),
        sdk.readContract<string>({ address: CONTRACT_ADDRESS, abi: BuilderBountiesAbi, functionName: "xHandle", args: [wallet.address] }),
        sdk.readContract<string>({ address: CONTRACT_ADDRESS, abi: BuilderBountiesAbi, functionName: "tgHandle", args: [wallet.address] }),
        sdk.readContract<string>({ address: CONTRACT_ADDRESS, abi: BuilderBountiesAbi, functionName: "githubHandle", args: [wallet.address] }),
        sdk.readContract<string>({ address: CONTRACT_ADDRESS, abi: BuilderBountiesAbi, functionName: "portfolioLink", args: [wallet.address] }),
      ]);
      setProfile({ points, completed, strikes, blacklisted });
      setProfileAvailable(openWork);
      setProfileRate(rate);
      setProfileSkills(skills);
      setProfileX(x);
      setProfileTg(tg);
      setProfileGithub(github);
      setProfilePortfolio(portfolio);
      setProfileLoadedFor(wallet.address.toLowerCase());
    } catch (nextError) {
      setError(handleTxError(nextError, txErrorMessages));
    }
  }, [sdk, txErrorMessages, wallet.address]);

  useEffect(() => {
    setProfileLoadedFor(null);
  }, [wallet.address]);

  useEffect(() => {
    void loadBounties();
  }, [loadBounties]);

  useEffect(() => {
    const timer = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (tab === "profile") void loadProfile();
  }, [tab, loadProfile]);

  useEffect(() => {
    if (tab === "browse" && browseView === "builders") void loadBuilders();
  }, [tab, browseView, loadBuilders]);

  useEffect(() => {
    if (!IS_LIVE || !wallet.address) {
      setMyHasContact(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const [x, tg] = await Promise.all([
          sdk.readContract<string>({ address: CONTRACT_ADDRESS, abi: BuilderBountiesAbi, functionName: "xHandle", args: [wallet.address as `0x${string}`] }),
          sdk.readContract<string>({ address: CONTRACT_ADDRESS, abi: BuilderBountiesAbi, functionName: "tgHandle", args: [wallet.address as `0x${string}`] }),
        ]);
        if (!cancelled) setMyHasContact(Boolean(x) || Boolean(tg));
      } catch {
        if (!cancelled) setMyHasContact(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sdk, wallet.address]);

  const openCount = bounties.filter((b) => b.status === 0).length;
  const completedCount = bounties.filter((b) => b.status === 3).length;
  const builderCount = useMemo(() => new Set(bounties.filter((b) => b.builder !== ZERO_ADDRESS).map((b) => b.builder)).size, [bounties]);
  // Expired/Cancelled listings are dead weight in the active list — everything else, including
  // Approved, stays visible (a builder still needs to see it to use the report-non-payment action).
  const visibleBounties = useMemo(() => bounties.filter((b) => b.status !== 4 && b.status !== 5), [bounties]);
  const filteredBounties = useMemo(
    () => (categoryFilter === "All" ? visibleBounties : visibleBounties.filter((b) => b.category === categoryFilter)),
    [visibleBounties, categoryFilter],
  );

  const canWrite = IS_LIVE && wallet.isConnected && !wallet.isWrongNetwork;

  async function runWrite(functionName: string, args: readonly unknown[], id: number, successMessage: string): Promise<boolean> {
    setActiveId(id);
    setError(null);
    try {
      setTxState("simulating");
      const simulation = await sdk.simulateContract({ address: CONTRACT_ADDRESS, abi: BuilderBountiesAbi, functionName, args });
      setTxState("writing");
      const hash = await sdk.writeContract(simulation.request);
      setTxState("confirming");
      await sdk.waitForTx(hash);
      setTxState("success");
      sdk.notify.success(successMessage);
      await loadBounties();
      if (tab === "profile") await loadProfile();
      return true;
    } catch (nextError) {
      setError(handleTxError(nextError, txErrorMessages));
      setTxState("failed");
      return false;
    } finally {
      setActiveId(null);
    }
  }

  async function submitPost() {
    if (!myHasContact) {
      setError(t("errors.contactRequired"));
      return;
    }
    if (!postTitle.trim()) {
      setError(t("errors.titleRequired"));
      return;
    }
    if (!postReward.trim()) {
      setError(t("errors.rewardRequired"));
      return;
    }
    const deadlineUnix = postDeadline ? Math.floor(new Date(`${postDeadline}T23:59:59Z`).getTime() / 1000) : 0;
    if (!deadlineUnix || deadlineUnix < nowSec + MIN_POST_DURATION_SECONDS) {
      setError(t("errors.deadlineTooSoon"));
      return;
    }
    if (deadlineUnix > nowSec + MAX_BOUNTY_DURATION_SECONDS) {
      setError(t("errors.deadlineTooFar"));
      return;
    }
    const ok = await runWrite(
      "postBounty",
      [postTitle.trim(), postBrief.trim(), postReward.trim(), postCategory, BigInt(deadlineUnix)],
      -1,
      t("messages.postSuccess"),
    );
    if (ok) {
      setPostTitle("");
      setPostBrief("");
      setPostReward("");
      setPostDeadline("");
    }
  }

  async function confirmProof(id: number) {
    if (!proofDraft.trim()) {
      setError(t("errors.proofRequired"));
      return;
    }
    const ok = await runWrite("submitProof", [BigInt(id), proofDraft.trim()], id, t("messages.submitSuccess"));
    if (ok) {
      setProofDraftId(null);
      setProofDraft("");
    }
  }

  async function saveProfile() {
    const ok = await runWrite(
      "setProfile",
      [
        {
          available: profileAvailable,
          rate: profileRate.trim(),
          skills: profileSkills.trim(),
          x: profileX.trim(),
          tg: profileTg.trim(),
          github: profileGithub.trim(),
          portfolio: profilePortfolio.trim(),
        },
      ],
      -2,
      t("messages.profileSaved"),
    );
    if (ok) setMyHasContact(Boolean(profileX.trim()) || Boolean(profileTg.trim()));
  }

  async function toggleApplicants(id: number) {
    if (applicantsOpenId === id) {
      setApplicantsOpenId(null);
      return;
    }
    setApplicantsOpenId(id);
    setApplicantsLoading(true);
    try {
      const list = await sdk.readContract<`0x${string}`[]>({
        address: CONTRACT_ADDRESS,
        abi: BuilderBountiesAbi,
        functionName: "getApplicants",
        args: [BigInt(id)],
      });
      // A released or rejected builder can reapply, adding a second entry for the same
      // address; dedupe here, keeping the first-seen (checksummed) casing.
      const seen = new Set<string>();
      const unique: `0x${string}`[] = [];
      for (const addr of list) {
        const key = addr.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          unique.push(addr);
        }
      }
      // getApplicants is a historical list — it never drops an address once added, even after
      // they release or get rejected, so confirm each one is still actively applied. Always
      // re-read on open (not cached) so a newly submitted application shows up right away.
      const stillApplied = await Promise.all(
        unique.map((addr) =>
          sdk.readContract<boolean>({
            address: CONTRACT_ADDRESS,
            abi: BuilderBountiesAbi,
            functionName: "hasApplied",
            args: [BigInt(id), addr],
          })
        )
      );
      const active = unique.filter((_, i) => stillApplied[i]);
      setApplicants((prev) => ({ ...prev, [id]: active }));
      active.forEach((addr) => {
        void ensureContact(addr);
        void ensureReputation(addr);
      });
    } catch (nextError) {
      setError(handleTxError(nextError, txErrorMessages));
    } finally {
      setApplicantsLoading(false);
    }
  }

  async function selectApplicant(id: number, applicant: `0x${string}`) {
    await runWrite("selectBuilder", [BigInt(id), applicant], id, t("messages.selectSuccess"));
    setApplicantsOpenId(null);
  }

  async function removeApplicant(id: number, applicant: `0x${string}`) {
    const ok = await runWrite("removeApplicant", [BigInt(id), applicant], id, t("messages.removeApplicantSuccess"));
    if (ok) {
      setApplicants((prev) => ({ ...prev, [id]: (prev[id] ?? []).filter((addr) => addr.toLowerCase() !== applicant.toLowerCase()) }));
    }
  }

  return (
    <div className="min-h-screen w-full space-y-4 p-4 sm:p-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="min-w-0">
                <CardTitle>{t("app.title")}</CardTitle>
                <p className="mt-2 max-w-xl text-sm font-medium leading-6 text-white/60">{t("app.subtitle")}</p>
                <ExternalLink url={OFFICIAL_X_URL} className="mt-1 inline-block text-xs text-white/42 underline">
                  {t("actions.followX")}
                </ExternalLink>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {wallet.isConnected ? (
                <StatusBadge tone={wallet.isWrongNetwork ? "warning" : "success"}>
                  <AddressLink address={wallet.address} explorerBaseUrl={context.explorerBaseUrl} />
                </StatusBadge>
              ) : (
                <Button size="sm" onClick={() => wallet.connect()}>
                  {t("states.connectWallet")}
                </Button>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            <Metric label={t("stats.open")} value={String(openCount)} tone="primary" />
            <Metric label={t("stats.builders")} value={String(builderCount)} />
            <Metric label={t("stats.completed")} value={String(completedCount)} tone="success" />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <Button variant={tab === "browse" ? "default" : "outline"} size="sm" onClick={() => setTab("browse")}>
              {t("tabs.browse")}
            </Button>
            <Button variant={tab === "post" ? "default" : "outline"} size="sm" onClick={() => setTab("post")}>
              {t("tabs.post")}
            </Button>
            <Button variant={tab === "profile" ? "default" : "outline"} size="sm" onClick={() => setTab("profile")}>
              {t("tabs.profile")}
            </Button>
          </div>

          {!IS_LIVE ? <Alert tone="warning">{t("states.notLiveYet")}</Alert> : null}
          {wallet.isConnected && wallet.isWrongNetwork ? (
            <Alert tone="warning">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>{t("errors.wrongNetwork")}</span>
                <Button size="sm" variant="outline" onClick={() => void wallet.switchChain()}>
                  {wallet.requiredChainLabel}
                </Button>
              </div>
            </Alert>
          ) : null}
          {error ? <Alert tone="danger">{error}</Alert> : null}

          {tab === "browse" ? (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <Button variant={browseView === "bounties" ? "default" : "outline"} size="sm" onClick={() => setBrowseView("bounties")}>
                  {t("labels.bounties")}
                </Button>
                <Button variant={browseView === "builders" ? "default" : "outline"} size="sm" onClick={() => setBrowseView("builders")}>
                  {t("tabs.builders")}
                </Button>
              </div>

              {browseView === "bounties" ? (
                <>
                  {wallet.isConnected && myHasContact === false ? (
                    <Alert tone="warning">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span>{t("errors.contactRequired")}</span>
                        <Button size="sm" variant="outline" onClick={() => setTab("profile")}>
                          {t("tabs.profile")}
                        </Button>
                      </div>
                    </Alert>
                  ) : null}
                  <div className="flex flex-wrap gap-1.5">
                    {(["All", ...CATEGORIES] as const).map((cat) => (
                      <Button
                        key={cat}
                        size="sm"
                        variant={categoryFilter === cat ? "default" : "outline"}
                        onClick={() => setCategoryFilter(cat)}
                      >
                        {cat === "All" ? t("categories.all") : t(CATEGORY_I18N_KEYS[cat])}
                      </Button>
                    ))}
                  </div>
                  {loading ? <Alert>{t("states.loading")}</Alert> : null}
                  {!loading && filteredBounties.length === 0 ? <Alert>{t("states.noBounties")}</Alert> : null}
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {filteredBounties.map((bounty) => {
                const mine = wallet.address?.toLowerCase();
                const isPoster = mine && bounty.poster.toLowerCase() === mine;
                const isBuilder = mine && bounty.builder.toLowerCase() === mine;
                const busy = activeId === bounty.id && txState !== "idle" && txState !== "failed";
                const applicantList = applicants[bounty.id] ?? [];
                const isExpanded = expandedBountyId === bounty.id;
                const nowUnix = nowSec;
                const claimableAtUnix = bounty.submittedAt + REVIEW_TIMEOUT_SECONDS;
                const canClaimAbandoned = nowUnix >= claimableAtUnix;
                const hasSelectLeadTime = bounty.deadline - nowUnix >= MIN_SELECT_LEAD_TIME_SECONDS;
                const deadlinePassed = nowUnix >= bounty.deadline;
                return (
                  <div key={bounty.id} className="rounded-[14px] border border-white/10 bg-black/25 p-3">
                    <div className="cursor-pointer" onClick={() => setExpandedBountyId(isExpanded ? null : bounty.id)}>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-white">{bounty.title}</div>
                          <div className="mt-1 text-xs text-white/42">{t(CATEGORY_I18N_KEYS[bounty.category as (typeof CATEGORIES)[number]] ?? "categories.dev")}</div>
                        </div>
                        <StatusBadge tone={STATUS_TONE[bounty.status]}>{t(STATUS_I18N_KEYS[bounty.status])}</StatusBadge>
                      </div>
                      <div className="mt-1.5 flex items-center justify-between gap-2 text-xs text-white/56">
                        <span className="truncate">{bounty.rewardLabel}</span>
                        {bounty.status === 0 || bounty.status === 1 || bounty.status === 2 ? (
                          <Countdown targetTimeMs={bounty.deadline * 1000} fallback={formatDeadline(bounty.deadline)} />
                        ) : (
                          <span>{formatDeadline(bounty.deadline)}</span>
                        )}
                      </div>
                    </div>
                    {!isExpanded ? null : (
                    <div className="mt-2 space-y-2 border-t border-white/10 pt-2">
                    <LinkOrText value={bounty.briefLink} label={t("labels.brief")} />
                    <DataRow label={t("labels.poster")} value={<AddressLink address={bounty.poster} explorerBaseUrl={context.explorerBaseUrl} />} />
                    <ContactLinks contact={contacts[bounty.poster.toLowerCase()]} xLabel={t("labels.x")} tgLabel={t("labels.telegram")} />
                    {(posterReports[bounty.poster.toLowerCase()] ?? 0n) > 0n ? (
                      <DataRow
                        label={t("labels.nonPaymentReports")}
                        value={<StatusBadge tone="danger">{posterReports[bounty.poster.toLowerCase()]!.toString()}</StatusBadge>}
                      />
                    ) : null}
                    {posterHistory[bounty.poster.toLowerCase()] === "unavailable" ? (
                      <p className="text-xs text-white/42">{t("states.posterHistoryUnavailable")}</p>
                    ) : posterHistory[bounty.poster.toLowerCase()] ? (
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-white/56">
                        <span>
                          {t("labels.approved")} {(posterHistory[bounty.poster.toLowerCase()] as { approved: number; rejected: number }).approved}
                        </span>
                        <span>
                          {t("labels.rejected")} {(posterHistory[bounty.poster.toLowerCase()] as { approved: number; rejected: number }).rejected}
                        </span>
                      </div>
                    ) : null}
                    {bounty.builder !== ZERO_ADDRESS ? (
                      <>
                        <DataRow label={t("labels.builder")} value={<AddressLink address={bounty.builder} explorerBaseUrl={context.explorerBaseUrl} />} />
                        <ReputationLine
                          rep={reputations[bounty.builder.toLowerCase()]}
                          pointsLabel={t("labels.points")}
                          completedLabel={t("labels.completedCount")}
                          strikesLabel={t("labels.strikes")}
                          blacklistedLabel={t("status.blacklisted")}
                        />
                        <ContactLinks contact={contacts[bounty.builder.toLowerCase()]} xLabel={t("labels.x")} tgLabel={t("labels.telegram")} />
                      </>
                    ) : null}
                    {bounty.status >= 2 ? <LinkOrText value={bounty.proofLink} label={t("labels.proof")} /> : null}

                    {(bounty.status === 0 || bounty.status === 1) && deadlinePassed ? (
                      <TxButton
                        className="mt-2 w-full"
                        idleLabel={t("actions.markExpired")}
                        state={activeId === bounty.id ? txState : "idle"}
                        onClick={() => void runWrite("markExpired", [BigInt(bounty.id)], bounty.id, t("messages.markExpiredSuccess"))}
                        disabled={!canWrite || busy}
                      />
                    ) : null}
                    {bounty.status === 1 && deadlinePassed ? <p className="text-xs text-white/42">{t("states.markExpiredStrikes")}</p> : null}

                    {bounty.status === 0 && isPoster ? (
                      <div className="mt-2 space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                          <Button size="sm" variant="outline" onClick={() => void toggleApplicants(bounty.id)}>
                            {t("actions.viewApplicants")}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void runWrite("cancelBounty", [BigInt(bounty.id)], bounty.id, t("messages.cancelSuccess"))}
                            disabled={!canWrite || busy}
                          >
                            {t("actions.cancel")}
                          </Button>
                        </div>
                        {!hasSelectLeadTime && !deadlinePassed ? <p className="text-xs text-white/42">{t("states.tooCloseToSelect")}</p> : null}
                        {applicantsOpenId === bounty.id ? (
                          <div className="space-y-1.5 rounded-[10px] border border-white/10 bg-black/30 p-2">
                            {applicantsLoading ? <div className="text-xs text-white/56">{t("states.loading")}</div> : null}
                            {!applicantsLoading && applicantList.length === 0 ? <div className="text-xs text-white/42">{t("states.noApplicants")}</div> : null}
                            {applicantList.map((applicant) => {
                              const c = contacts[applicant.toLowerCase()];
                              return (
                                <div key={applicant} className="space-y-1 border-b border-white/5 pb-1.5 last:border-0 last:pb-0">
                                  <div className="flex items-center justify-between gap-2">
                                    <AddressLink address={applicant} explorerBaseUrl={context.explorerBaseUrl} />
                                    <div className="flex gap-1.5">
                                      <Button size="sm" variant="outline" onClick={() => void removeApplicant(bounty.id, applicant)} disabled={!canWrite || busy}>
                                        {t("actions.removeApplicant")}
                                      </Button>
                                      <Button size="sm" onClick={() => void selectApplicant(bounty.id, applicant)} disabled={!canWrite || busy || !hasSelectLeadTime}>
                                        {t("actions.select")}
                                      </Button>
                                    </div>
                                  </div>
                                  {c?.x ? (
                                    <div className="text-xs">
                                      <ExternalLink url={`https://x.com/${c.x.replace(/^@/, "")}`}>{c.x}</ExternalLink>
                                    </div>
                                  ) : null}
                                  {c?.tg ? (
                                    <div className="text-xs">
                                      <ExternalLink url={`https://t.me/${c.tg.replace(/^@/, "")}`}>{c.tg}</ExternalLink>
                                    </div>
                                  ) : null}
                                  <ReputationLine
                                    rep={reputations[applicant.toLowerCase()]}
                                    pointsLabel={t("labels.points")}
                                    completedLabel={t("labels.completedCount")}
                                    strikesLabel={t("labels.strikes")}
                                    blacklistedLabel={t("status.blacklisted")}
                                  />
                                </div>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {bounty.status === 0 && !isPoster ? (
                      myApplied[bounty.id] ? (
                        <TxButton
                          className="mt-2 w-full"
                          idleLabel={t("actions.withdraw")}
                          state={activeId === bounty.id ? txState : "idle"}
                          onClick={() => void runWrite("withdrawApplication", [BigInt(bounty.id)], bounty.id, t("messages.withdrawSuccess"))}
                          disabled={!canWrite || busy}
                        />
                      ) : hasSelectLeadTime ? (
                        <TxButton
                          className="mt-2 w-full"
                          idleLabel={t("actions.apply")}
                          state={activeId === bounty.id ? txState : "idle"}
                          onClick={() => {
                            if (!myHasContact) {
                              setError(t("errors.contactRequired"));
                              return;
                            }
                            void runWrite("applyToBounty", [BigInt(bounty.id)], bounty.id, t("messages.applySuccess"));
                          }}
                          disabled={!canWrite || busy}
                        />
                      ) : !deadlinePassed ? (
                        <p className="mt-2 text-xs text-white/42">{t("states.tooCloseToApply")}</p>
                      ) : null
                    ) : null}

                    {bounty.status === 1 && isBuilder ? (
                      <div className="mt-2 space-y-2">
                        {deadlinePassed ? (
                          <p className="text-xs text-white/42">{t("states.submitDeadlinePassed")}</p>
                        ) : proofDraftId === bounty.id ? (
                          <div className="space-y-2">
                            <Input value={proofDraft} placeholder={t("placeholders.proofLink")} onChange={(event) => setProofDraft(event.target.value)} />
                            <TxButton
                              className="w-full"
                              idleLabel={t("actions.submitProof")}
                              state={activeId === bounty.id ? txState : "idle"}
                              onClick={() => void confirmProof(bounty.id)}
                              disabled={!canWrite || busy}
                            />
                          </div>
                        ) : (
                          <Button className="w-full" size="sm" variant="outline" onClick={() => setProofDraftId(bounty.id)} disabled={!canWrite}>
                            {t("actions.submitProof")}
                          </Button>
                        )}
                        <Button
                          className="w-full"
                          size="sm"
                          variant="outline"
                          onClick={() => void runWrite("releaseBounty", [BigInt(bounty.id)], bounty.id, t("messages.releaseSuccess"))}
                          disabled={!canWrite || busy || !hasSelectLeadTime}
                        >
                          {t("actions.release")}
                        </Button>
                        {!hasSelectLeadTime && !deadlinePassed ? <p className="text-xs text-white/42">{t("states.tooCloseToRelease")}</p> : null}
                      </div>
                    ) : null}

                    {bounty.status === 2 && isPoster ? (
                      <div className="mt-2 space-y-2">
                        <p className="text-xs text-white/42">
                          {canClaimAbandoned ? (
                            t("states.reviewWindowClosed")
                          ) : (
                            <>
                              {t("states.posterReviewDue")} <Countdown targetTimeMs={claimableAtUnix * 1000} fallback="" />
                            </>
                          )}
                        </p>
                        <div className={canClaimAbandoned ? "" : "grid grid-cols-2 gap-2"}>
                          <TxButton
                            idleLabel={t("actions.approve")}
                            state={activeId === bounty.id ? txState : "idle"}
                            onClick={() => void runWrite("approveBounty", [BigInt(bounty.id)], bounty.id, t("messages.approveSuccess"))}
                            disabled={!canWrite || busy}
                          />
                          {!canClaimAbandoned ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setRejectConfirmId(bounty.id)}
                              disabled={!canWrite || busy}
                            >
                              {t("actions.reject")}
                            </Button>
                          ) : null}
                        </div>
                        {rejectConfirmId === bounty.id ? (
                          <div className="space-y-2 rounded-[10px] border border-white/10 bg-black/30 p-2">
                            <p className="text-xs text-white/56">{t("confirm.reject")}</p>
                            <div className="grid grid-cols-2 gap-2">
                              <Button size="sm" variant="outline" onClick={() => setRejectConfirmId(null)} disabled={busy}>
                                {t("actions.cancel")}
                              </Button>
                              <TxButton
                                idleLabel={t("actions.confirmReject")}
                                state={activeId === bounty.id ? txState : "idle"}
                                onClick={() => {
                                  const msg = deadlinePassed
                                    ? t("messages.rejectSuccessExpired")
                                    : hasSelectLeadTime
                                      ? t("messages.rejectSuccessReopened")
                                      : t("messages.rejectSuccessReopenedLate");
                                  setRejectConfirmId(null);
                                  void runWrite("rejectProof", [BigInt(bounty.id)], bounty.id, msg);
                                }}
                                disabled={!canWrite || busy}
                              />
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : bounty.status === 2 && isBuilder ? (
                      canClaimAbandoned ? (
                        <TxButton
                          className="mt-2 w-full"
                          idleLabel={t("actions.claimAbandoned")}
                          state={activeId === bounty.id ? txState : "idle"}
                          onClick={() => void runWrite("claimAbandonedSubmission", [BigInt(bounty.id)], bounty.id, t("messages.claimAbandonedSuccess"))}
                          disabled={!canWrite || busy}
                        />
                      ) : (
                        <p className="mt-2 text-xs text-white/42">
                          {t("states.reviewWindowOpen")} <Countdown targetTimeMs={claimableAtUnix * 1000} fallback="" />
                        </p>
                      )
                    ) : null}

                    {bounty.status === 3 && isBuilder ? (
                      bounty.nonPaymentReported ? (
                        <div className="mt-2 text-xs text-white/42">{t("states.alreadyReported")}</div>
                      ) : (
                        <Button
                          className="mt-2 w-full"
                          size="sm"
                          variant="outline"
                          onClick={() => void runWrite("reportNonPayment", [BigInt(bounty.id)], bounty.id, t("messages.reportSuccess"))}
                          disabled={!canWrite || busy}
                        >
                          {t("actions.report")}
                        </Button>
                      )
                    ) : null}
                    </div>
                    )}
                  </div>
                );
              })}
                  </div>
                  {bountyLimit < bountyTotal ? (
                    <Button className="w-full" size="sm" variant="outline" onClick={() => setBountyLimit((limit) => limit + PAGE_SIZE)}>
                      {t("actions.loadMore")}
                    </Button>
                  ) : null}
                </>
              ) : (
                <>
                  <div className="flex flex-wrap gap-1.5">
                    <Button size="sm" variant={!openForWorkOnly ? "default" : "outline"} onClick={() => setOpenForWorkOnly(false)}>
                      {t("categories.all")}
                    </Button>
                    <Button size="sm" variant={openForWorkOnly ? "default" : "outline"} onClick={() => setOpenForWorkOnly(true)}>
                      {t("labels.openForWork")}
                    </Button>
                  </div>
                  <p className="text-xs text-white/42">{t("states.pointsUnverified")}</p>
                  {buildersLoading ? <Alert>{t("states.loading")}</Alert> : null}
                  {(() => {
                    const visible = builders.filter((addr) => {
                      const key = addr.toLowerCase();
                      if (reputations[key]?.blacklisted) return false;
                      if (openForWorkOnly && !builderProfiles[key]?.available) return false;
                      return true;
                    });
                    if (!buildersLoading && visible.length === 0) return <Alert>{t("states.noBuilders")}</Alert>;
                    return (
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {visible.map((addr) => {
                      const key = addr.toLowerCase();
                      const prof = builderProfiles[key];
                      const isExpanded = expandedBuilderKey === key;
                      return (
                        <div key={addr} className="rounded-[14px] border border-white/10 bg-black/25 p-3">
                          <div className="cursor-pointer" onClick={() => setExpandedBuilderKey(isExpanded ? null : key)}>
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <AddressLink address={addr} explorerBaseUrl={context.explorerBaseUrl} />
                              {prof?.available ? <StatusBadge tone="success">{t("labels.openForWork")}</StatusBadge> : null}
                            </div>
                            <ReputationLine
                              rep={reputations[key]}
                              pointsLabel={t("labels.points")}
                              completedLabel={t("labels.completedCount")}
                              strikesLabel={t("labels.strikes")}
                              blacklistedLabel={t("status.blacklisted")}
                            />
                          </div>
                          {!isExpanded ? null : (
                          <div className="mt-2 space-y-2 border-t border-white/10 pt-2">
                          {prof?.rate ? <DataRow label={t("labels.rate")} value={prof.rate} /> : null}
                          {prof?.skills ? <DataRow label={t("labels.skills")} value={prof.skills} /> : null}
                          <ContactLinks contact={contacts[key]} xLabel={t("labels.x")} tgLabel={t("labels.telegram")} />
                          {prof?.github ? (
                            <DataRow label={t("labels.github")} value={<ExternalLink url={`https://github.com/${prof.github.replace(/^@/, "")}`}>{prof.github}</ExternalLink>} />
                          ) : null}
                          <LinkOrText value={prof?.portfolio ?? ""} label={t("labels.portfolio")} />
                          </div>
                          )}
                        </div>
                      );
                      })}
                      </div>
                    );
                  })()}
                  {builderLimit < builderTotal ? (
                    <Button className="w-full" size="sm" variant="outline" onClick={() => setBuilderLimit((limit) => limit + PAGE_SIZE)}>
                      {t("actions.loadMore")}
                    </Button>
                  ) : null}
                </>
              )}
            </div>
          ) : null}

          {tab === "post" ? (
            <div className="space-y-3">
              {wallet.isConnected && myHasContact === false ? (
                <Alert tone="warning">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>{t("errors.contactRequired")}</span>
                    <Button size="sm" variant="outline" onClick={() => setTab("profile")}>
                      {t("tabs.profile")}
                    </Button>
                  </div>
                </Alert>
              ) : null}
              <label className="block space-y-2">
                <span className="text-sm text-white/56">{t("labels.title")}</span>
                <Input value={postTitle} placeholder={t("placeholders.title")} onChange={(event) => setPostTitle(event.target.value)} />
              </label>
              <label className="block space-y-2">
                <span className="text-sm text-white/56">{t("labels.briefLink")}</span>
                <Input value={postBrief} placeholder={t("placeholders.briefLink")} onChange={(event) => setPostBrief(event.target.value)} />
                <p className="text-xs text-white/42">{t("states.briefLinkCanChange")}</p>
              </label>
              <label className="block space-y-2">
                <span className="text-sm text-white/56">{t("labels.reward")}</span>
                <Input value={postReward} placeholder={t("placeholders.reward")} onChange={(event) => setPostReward(event.target.value)} />
                <p className="text-xs text-white/42">{t("states.rewardIsPromise")}</p>
              </label>
              <div className="space-y-2">
                <span className="text-sm text-white/56">{t("labels.category")}</span>
                <div className="grid grid-cols-4 gap-2">
                  {CATEGORIES.map((category) => (
                    <Button key={category} size="sm" variant={postCategory === category ? "default" : "outline"} onClick={() => setPostCategory(category)}>
                      {t(CATEGORY_I18N_KEYS[category])}
                    </Button>
                  ))}
                </div>
              </div>
              <label className="block space-y-2">
                <span className="text-sm text-white/56">{t("labels.deadline")}</span>
                <Input
                  type="date"
                  value={postDeadline}
                  min={isoDate(nowSec + 3 * 86400)}
                  max={isoDate(nowSec + 29 * 86400)}
                  onChange={(event) => setPostDeadline(event.target.value)}
                />
              </label>
              <TxButton
                className="w-full"
                idleLabel={t("actions.post")}
                state={activeId === -1 ? txState : "idle"}
                onClick={() => void submitPost()}
                disabled={!canWrite}
              />
            </div>
          ) : null}

          {tab === "profile" ? (
            <div className="space-y-3">
              {!wallet.isConnected ? (
                <Alert>{t("states.connectWallet")}</Alert>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Metric label={t("labels.points")} value={String(profile?.points ?? 0n)} tone="primary" />
                    <Metric label={t("labels.completedCount")} value={String(profile?.completed ?? 0n)} tone="success" />
                    <Metric label={t("labels.strikes")} value={String(profile?.strikes ?? 0n)} tone={profile?.strikes ? "warning" : "default"} />
                    <Metric label={t("labels.status")} value={profile?.blacklisted ? t("status.blacklisted") : t("status.ok")} tone={profile?.blacklisted ? "warning" : "success"} />
                  </div>
                  <p className="text-xs text-white/42">{t("states.pointsUnverified")}</p>

                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm text-white/56">{wallet.address}</span>
                    <CopyButton value={wallet.address ?? ""} />
                  </div>

                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={profileAvailable} onChange={(event) => setProfileAvailable(event.target.checked)} />
                    <span className="text-sm text-white/56">{t("labels.openForWork")}</span>
                  </label>
                  <label className="block space-y-2">
                    <span className="text-sm text-white/56">{t("labels.rate")}</span>
                    <Input value={profileRate} placeholder={t("placeholders.rate")} onChange={(event) => setProfileRate(event.target.value)} />
                  </label>
                  <label className="block space-y-2">
                    <span className="text-sm text-white/56">{t("labels.skills")}</span>
                    <Input value={profileSkills} placeholder={t("placeholders.skills")} onChange={(event) => setProfileSkills(event.target.value)} />
                  </label>
                  <p className="text-xs text-white/42">{t("states.handlesUnverified")}</p>
                  <label className="block space-y-2">
                    <span className="text-sm text-white/56">{t("labels.x")}</span>
                    <Input value={profileX} placeholder={t("placeholders.x")} onChange={(event) => setProfileX(event.target.value)} />
                  </label>
                  <label className="block space-y-2">
                    <span className="text-sm text-white/56">{t("labels.telegram")}</span>
                    <Input value={profileTg} placeholder={t("placeholders.telegram")} onChange={(event) => setProfileTg(event.target.value)} />
                  </label>
                  <label className="block space-y-2">
                    <span className="text-sm text-white/56">{t("labels.github")}</span>
                    <Input value={profileGithub} placeholder={t("placeholders.github")} onChange={(event) => setProfileGithub(event.target.value)} />
                  </label>
                  <label className="block space-y-2">
                    <span className="text-sm text-white/56">{t("labels.portfolio")}</span>
                    <Input value={profilePortfolio} placeholder={t("placeholders.portfolio")} onChange={(event) => setProfilePortfolio(event.target.value)} />
                  </label>
                  <TxButton
                    className="w-full"
                    idleLabel={t("actions.save")}
                    state={activeId === -2 ? txState : "idle"}
                    onClick={() => void saveProfile()}
                    disabled={!canWrite || profileLoadedFor !== (wallet.address?.toLowerCase() ?? null)}
                  />
                  {wallet.isConnected && profileLoadedFor !== (wallet.address?.toLowerCase() ?? null) ? (
                    <Button className="w-full" size="sm" variant="outline" onClick={() => void loadProfile()}>
                      {t("actions.retry")}
                    </Button>
                  ) : null}
                </>
              )}
            </div>
          ) : null}

          <Alert tone="info">{t("notices.rules")}</Alert>
          <Alert tone="info">{t("notices.reviewTimeout")}</Alert>
          <Alert tone="info">{t("notices.moderation")}</Alert>
        </CardContent>
      </Card>
    </div>
  );
}

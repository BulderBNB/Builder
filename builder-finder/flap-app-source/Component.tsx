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
  IpfsImage,
  Metric,
  StatusBadge,
  TxButton,
  type TxButtonState,
} from "@/src/ui";
import { BuilderBountiesAbi } from "./VaultABI";

const CHAIN_ID = 97;
// Pending the v2 redeploy — paste the new BuilderBounties.sol address here once it's live on
// BSC Testnet again. Until then every read returns an empty list and every write stays disabled.
const CONTRACT_ADDRESS = "0x3db14f0fd0bbf21b8a0fb14fe5c24fb3e613dae6" as const;
const IS_LIVE = CONTRACT_ADDRESS !== ZERO_ADDRESS;

const OFFICIAL_X_URL = "https://x.com/thebnbmascot";
// Set once the logo is pinned to IPFS — the header just omits it until then.
const LOGO_CID = "";

const MAX_BOUNTY_DURATION_SECONDS = 30 * 24 * 3600;

type Status = 0 | 1 | 2 | 3 | 4 | 5;
type BountyTuple = readonly [
  poster: `0x${string}`,
  builder: `0x${string}`,
  title: string,
  briefLink: string,
  rewardLabel: string,
  category: string,
  deadline: bigint,
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
    status: tuple[7] as Status,
    proofLink: tuple[8],
    nonPaymentReported: tuple[9],
  };
}

function formatDeadline(unixSeconds: number) {
  if (!unixSeconds) return "-";
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
  const [bounties, setBounties] = useState<Bounty[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txState, setTxState] = useState<TxButtonState>("idle");
  const [activeId, setActiveId] = useState<number | null>(null);
  const [proofDraftId, setProofDraftId] = useState<number | null>(null);
  const [proofDraft, setProofDraft] = useState("");
  const [applicants, setApplicants] = useState<Record<number, `0x${string}`[]>>({});
  const [applicantsOpenId, setApplicantsOpenId] = useState<number | null>(null);
  const [applicantsLoading, setApplicantsLoading] = useState(false);
  // Keyed by lowercased address — fetched lazily and cached so the same poster/builder/applicant
  // appearing on multiple bounties only costs one read each.
  const [contacts, setContacts] = useState<Record<string, { x: string; tg: string }>>({});
  const [posterReports, setPosterReports] = useState<Record<string, bigint>>({});
  const [categoryFilter, setCategoryFilter] = useState<"All" | (typeof CATEGORIES)[number]>("All");
  const fetchedContactsRef = useRef<Set<string>>(new Set());
  const fetchedReportsRef = useRef<Set<string>>(new Set());

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
      const ids = Array.from({ length: total }, (_, index) => total - 1 - index).slice(0, 25);
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
      });
    } catch (nextError) {
      setError(handleTxError(nextError, txErrorMessages));
    } finally {
      setLoading(false);
    }
  }, [sdk, txErrorMessages]);

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
    } catch (nextError) {
      setError(handleTxError(nextError, txErrorMessages));
    }
  }, [sdk, txErrorMessages, wallet.address]);

  useEffect(() => {
    void loadBounties();
  }, [loadBounties]);

  useEffect(() => {
    if (tab === "profile") void loadProfile();
  }, [tab, loadProfile]);

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

  async function runWrite(functionName: string, args: readonly unknown[], id: number, successMessage: string) {
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
    } catch (nextError) {
      setError(handleTxError(nextError, txErrorMessages));
      setTxState("failed");
    } finally {
      setActiveId(null);
    }
  }

  async function submitPost() {
    if (!postTitle.trim()) {
      setError(t("errors.titleRequired"));
      return;
    }
    if (!postReward.trim()) {
      setError(t("errors.rewardRequired"));
      return;
    }
    const deadlineUnix = postDeadline ? Math.floor(new Date(`${postDeadline}T00:00:00Z`).getTime() / 1000) : 0;
    if (!deadlineUnix || deadlineUnix - Math.floor(Date.now() / 1000) > MAX_BOUNTY_DURATION_SECONDS) {
      setError(t("errors.deadlineTooFar"));
      return;
    }
    await runWrite(
      "postBounty",
      [postTitle.trim(), postBrief.trim(), postReward.trim(), postCategory, BigInt(deadlineUnix)],
      -1,
      t("messages.postSuccess"),
    );
    setPostTitle("");
    setPostBrief("");
    setPostReward("");
    setPostDeadline("");
  }

  async function confirmProof(id: number) {
    if (!proofDraft.trim()) {
      setError(t("errors.proofRequired"));
      return;
    }
    await runWrite("submitProof", [BigInt(id), proofDraft.trim()], id, t("messages.submitSuccess"));
    setProofDraftId(null);
    setProofDraft("");
  }

  async function saveProfile() {
    await runWrite(
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
  }

  async function toggleApplicants(id: number) {
    if (applicantsOpenId === id) {
      setApplicantsOpenId(null);
      return;
    }
    setApplicantsOpenId(id);
    if (!applicants[id]) {
      setApplicantsLoading(true);
      try {
        const list = await sdk.readContract<`0x${string}`[]>({
          address: CONTRACT_ADDRESS,
          abi: BuilderBountiesAbi,
          functionName: "getApplicants",
          args: [BigInt(id)],
        });
        setApplicants((prev) => ({ ...prev, [id]: list }));
        list.forEach((addr) => void ensureContact(addr));
      } catch (nextError) {
        setError(handleTxError(nextError, txErrorMessages));
      } finally {
        setApplicantsLoading(false);
      }
    }
  }

  async function selectApplicant(id: number, applicant: `0x${string}`) {
    await runWrite("selectBuilder", [BigInt(id), applicant], id, t("messages.selectSuccess"));
    setApplicantsOpenId(null);
  }

  return (
    <div className="min-h-screen w-full space-y-4 p-4 sm:p-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              {LOGO_CID ? <IpfsImage cid={LOGO_CID} alt="Builder Finder" className="h-8 w-8 flex-shrink-0 rounded-full" /> : null}
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
              {filteredBounties.map((bounty) => {
                const mine = wallet.address?.toLowerCase();
                const isPoster = mine && bounty.poster.toLowerCase() === mine;
                const isBuilder = mine && bounty.builder.toLowerCase() === mine;
                const busy = activeId === bounty.id && txState !== "idle" && txState !== "failed";
                const applicantList = applicants[bounty.id] ?? [];
                return (
                  <div key={bounty.id} className="rounded-[14px] border border-white/10 bg-black/25 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-white">{bounty.title}</div>
                        <div className="mt-1 text-xs text-white/42">{t(CATEGORY_I18N_KEYS[bounty.category as (typeof CATEGORIES)[number]] ?? "categories.dev")}</div>
                      </div>
                      <StatusBadge tone={STATUS_TONE[bounty.status]}>{t(STATUS_I18N_KEYS[bounty.status])}</StatusBadge>
                    </div>
                    <DataRow label={t("labels.reward")} value={bounty.rewardLabel} />
                    <DataRow
                      label={t("labels.deadline")}
                      value={
                        bounty.status === 0 || bounty.status === 1 || bounty.status === 2 ? (
                          <Countdown targetTimeMs={bounty.deadline * 1000} fallback={formatDeadline(bounty.deadline)} />
                        ) : (
                          formatDeadline(bounty.deadline)
                        )
                      }
                    />
                    <LinkOrText value={bounty.briefLink} label={t("labels.brief")} />
                    <DataRow label={t("labels.poster")} value={<AddressLink address={bounty.poster} explorerBaseUrl={context.explorerBaseUrl} />} />
                    <ContactLinks contact={contacts[bounty.poster.toLowerCase()]} xLabel={t("labels.x")} tgLabel={t("labels.telegram")} />
                    {(posterReports[bounty.poster.toLowerCase()] ?? 0n) > 0n ? (
                      <DataRow
                        label={t("labels.nonPaymentReports")}
                        value={<StatusBadge tone="danger">{posterReports[bounty.poster.toLowerCase()]!.toString()}</StatusBadge>}
                      />
                    ) : null}
                    {bounty.builder !== ZERO_ADDRESS ? (
                      <>
                        <DataRow label={t("labels.builder")} value={<AddressLink address={bounty.builder} explorerBaseUrl={context.explorerBaseUrl} />} />
                        <ContactLinks contact={contacts[bounty.builder.toLowerCase()]} xLabel={t("labels.x")} tgLabel={t("labels.telegram")} />
                      </>
                    ) : null}
                    {bounty.status >= 2 ? <LinkOrText value={bounty.proofLink} label={t("labels.proof")} /> : null}

                    {bounty.status === 0 && isPoster ? (
                      <div className="mt-2 space-y-2">
                        <Button className="w-full" size="sm" variant="outline" onClick={() => void toggleApplicants(bounty.id)}>
                          {t("actions.viewApplicants")}
                        </Button>
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
                                    <Button size="sm" onClick={() => void selectApplicant(bounty.id, applicant)} disabled={!canWrite || busy}>
                                      {t("actions.select")}
                                    </Button>
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
                                </div>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {bounty.status === 0 && !isPoster ? (
                      <TxButton
                        className="mt-2 w-full"
                        idleLabel={t("actions.apply")}
                        state={activeId === bounty.id ? txState : "idle"}
                        onClick={() => void runWrite("applyToBounty", [BigInt(bounty.id)], bounty.id, t("messages.applySuccess"))}
                        disabled={!canWrite || busy}
                      />
                    ) : null}

                    {bounty.status === 1 && isBuilder ? (
                      <div className="mt-2 space-y-2">
                        {proofDraftId === bounty.id ? (
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
                          disabled={!canWrite || busy}
                        >
                          {t("actions.release")}
                        </Button>
                      </div>
                    ) : null}

                    {bounty.status === 2 && isPoster ? (
                      <TxButton
                        className="mt-2 w-full"
                        idleLabel={t("actions.approve")}
                        state={activeId === bounty.id ? txState : "idle"}
                        onClick={() => void runWrite("approveBounty", [BigInt(bounty.id)], bounty.id, t("messages.approveSuccess"))}
                        disabled={!canWrite || busy}
                      />
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
                );
              })}
            </div>
          ) : null}

          {tab === "post" ? (
            <div className="space-y-3">
              <label className="block space-y-2">
                <span className="text-sm text-white/56">{t("labels.title")}</span>
                <Input value={postTitle} placeholder={t("placeholders.title")} onChange={(event) => setPostTitle(event.target.value)} />
              </label>
              <label className="block space-y-2">
                <span className="text-sm text-white/56">{t("labels.briefLink")}</span>
                <Input value={postBrief} placeholder={t("placeholders.briefLink")} onChange={(event) => setPostBrief(event.target.value)} />
              </label>
              <label className="block space-y-2">
                <span className="text-sm text-white/56">{t("labels.reward")}</span>
                <Input value={postReward} placeholder={t("placeholders.reward")} onChange={(event) => setPostReward(event.target.value)} />
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
                <Input type="date" value={postDeadline} onChange={(event) => setPostDeadline(event.target.value)} />
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
                    <Metric label={t("labels.status")} value={profile?.blacklisted ? t("status.cancelled") : "OK"} tone={profile?.blacklisted ? "warning" : "success"} />
                  </div>

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
                    disabled={!canWrite}
                  />
                </>
              )}
            </div>
          ) : null}

          <Alert tone="info">{t("notices.rules")}</Alert>
        </CardContent>
      </Card>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  DataRow,
  Input,
  Metric,
  StatusBadge,
  TxButton,
  type TxButtonState,
} from "@/src/ui";
import { BuilderBountiesAbi } from "./VaultABI";

const CHAIN_ID = 97;
// Paste the deployed BuilderBounties.sol address here once it is live on BSC Testnet.
// Until then every read returns an empty list and every write stays disabled.
const CONTRACT_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
const IS_LIVE = CONTRACT_ADDRESS !== ZERO_ADDRESS;

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
  };
}

function formatDeadline(unixSeconds: number) {
  if (!unixSeconds) return "-";
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
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
    openForWork: boolean;
    rateLabel: string;
    skillsLabel: string;
  } | null>(null);
  const [profileAvailable, setProfileAvailable] = useState(false);
  const [profileRate, setProfileRate] = useState("");
  const [profileSkills, setProfileSkills] = useState("");

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
    } catch (nextError) {
      setError(handleTxError(nextError, txErrorMessages));
    } finally {
      setLoading(false);
    }
  }, [sdk, txErrorMessages]);

  const loadProfile = useCallback(async () => {
    if (!IS_LIVE || !wallet.address) {
      setProfile(null);
      return;
    }
    try {
      const [points, completed, strikes, blacklisted, openForWork, rate, skills] = await Promise.all([
        sdk.readContract<bigint>({ address: CONTRACT_ADDRESS, abi: BuilderBountiesAbi, functionName: "builderPoints", args: [wallet.address] }),
        sdk.readContract<bigint>({ address: CONTRACT_ADDRESS, abi: BuilderBountiesAbi, functionName: "buildersCompleted", args: [wallet.address] }),
        sdk.readContract<bigint>({ address: CONTRACT_ADDRESS, abi: BuilderBountiesAbi, functionName: "builderMissedStrikes", args: [wallet.address] }),
        sdk.readContract<boolean>({ address: CONTRACT_ADDRESS, abi: BuilderBountiesAbi, functionName: "builderBlacklisted", args: [wallet.address] }),
        sdk.readContract<boolean>({ address: CONTRACT_ADDRESS, abi: BuilderBountiesAbi, functionName: "openForWork", args: [wallet.address] }),
        sdk.readContract<string>({ address: CONTRACT_ADDRESS, abi: BuilderBountiesAbi, functionName: "rateLabel", args: [wallet.address] }),
        sdk.readContract<string>({ address: CONTRACT_ADDRESS, abi: BuilderBountiesAbi, functionName: "skillsLabel", args: [wallet.address] }),
      ]);
      setProfile({ points, completed, strikes, blacklisted, openForWork, rateLabel: rate, skillsLabel: skills });
      setProfileAvailable(openForWork);
      setProfileRate(rate);
      setProfileSkills(skills);
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
    await runWrite("setBuilderProfile", [profileAvailable, profileRate.trim(), profileSkills.trim()], -2, t("messages.profileSaved"));
  }

  return (
    <div className="min-h-screen w-full space-y-4 p-4 sm:p-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle>{t("app.title")}</CardTitle>
              <p className="mt-2 max-w-xl text-sm font-medium leading-6 text-white/60">{t("app.subtitle")}</p>
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
              {loading ? <Alert>{t("states.loading")}</Alert> : null}
              {!loading && bounties.length === 0 ? <Alert>{t("states.noBounties")}</Alert> : null}
              {bounties.map((bounty) => {
                const mine = wallet.address?.toLowerCase();
                const isPoster = mine && bounty.poster.toLowerCase() === mine;
                const isBuilder = mine && bounty.builder.toLowerCase() === mine;
                const busy = activeId === bounty.id && txState !== "idle" && txState !== "failed";
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
                    <DataRow label={t("labels.deadline")} value={formatDeadline(bounty.deadline)} />
                    <DataRow label={t("labels.poster")} value={<AddressLink address={bounty.poster} explorerBaseUrl={context.explorerBaseUrl} />} />
                    {bounty.builder !== ZERO_ADDRESS ? (
                      <DataRow label={t("labels.builder")} value={<AddressLink address={bounty.builder} explorerBaseUrl={context.explorerBaseUrl} />} />
                    ) : null}

                    {bounty.status === 0 && !isPoster ? (
                      <TxButton
                        className="mt-2 w-full"
                        idleLabel={t("actions.claim")}
                        state={activeId === bounty.id ? txState : "idle"}
                        onClick={() => void runWrite("claimBounty", [BigInt(bounty.id)], bounty.id, t("messages.claimSuccess"))}
                        disabled={!canWrite || busy}
                      />
                    ) : null}

                    {bounty.status === 1 && isBuilder ? (
                      proofDraftId === bounty.id ? (
                        <div className="mt-2 space-y-2">
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
                        <Button className="mt-2 w-full" size="sm" variant="outline" onClick={() => setProofDraftId(bounty.id)} disabled={!canWrite}>
                          {t("actions.submitProof")}
                        </Button>
                      )
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
                      <Button
                        className="mt-2 w-full"
                        size="sm"
                        variant="outline"
                        onClick={() => void runWrite("reportNonPayment", [BigInt(bounty.id)], bounty.id, t("messages.reportSuccess"))}
                        disabled={!canWrite || busy}
                      >
                        {t("actions.report")}
                      </Button>
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

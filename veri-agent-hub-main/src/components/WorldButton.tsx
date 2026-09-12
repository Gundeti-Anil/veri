/**
 * WorldButton — triggers the World IDKit Orb ("proof of human") verification flow.
 *
 * Uses orbLegacy(), not selfieCheckLegacy() — Selfie Check is a Beta credential
 * that World must explicitly enable per app_id (request access via
 * developers@toolsforhumanity.com); until that's granted, the World App shows
 * it as "Coming soon" and every verify call fails. orbLegacy() works in Sandbox
 * today with no access request needed.
 *
 * Flow:
 *   1. User clicks → frontend fetches RP signature from backend (/rp-signature).
 *      The signing key never leaves the server.
 *   2. useIDKitRequest() opens the World App connector with an orbLegacy preset.
 *      This produces a `connectorURI` — a deep link / QR target, NOT something that
 *      auto-launches World App by itself. We must render it:
 *        - On mobile (isInWorldApp === false, but on a phone): show it as a tappable
 *          link, since tapping a `worldapp://` (or https bridge) link on the same
 *          device opens World App directly.
 *        - On desktop: render it as a QR code so a phone can scan it.
 *   3. User completes "Proof of human" verification in World App (Sandbox simulates
 *      this — no physical Orb hardware needed for testing).
 *   4. IDKit reports isSuccess + result (World ID v3 legacy shape:
 *      { responses: [{ identifier, proof, merkle_root, nullifier, signal_hash }], ... }).
 *      identifier is "proof_of_human" for this preset.
 *   5. Frontend flattens result.responses[0] and posts to /verify-proof.
 *   6. Backend verifies, checks nullifier replay, signs EIP-712 attestation.
 *   7. onVerified({ humanId, attestation, deadline }) is called.
 *
 * @worldcoin/idkit v4.2.3 does NOT export `IDKitWidget`/`ISuccessResult` (that was the
 * v1/v2 API). The real API is hook-based: `useIDKitRequest(config)` returns
 * { open, isSuccess, result, isError, errorCode, reset, connectorURI, isInWorldApp, ... }.
 * Config needs a `preset` (e.g. `orbLegacy()`) rather than a bare `action` string,
 * and `rp_context` is a required field, not a free-form prop.
 */
import { ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useAccount } from "wagmi";
import { useIDKitRequest, orbLegacy, type RpContext, type IDKitResult } from "@worldcoin/idkit";
import QRCode from "qrcode";
import { WORLD_APP_ID, getRpSignature, verifyProof, type Verification } from "@/lib/api";

// Placeholder RpContext used only before the real one is fetched from the backend —
// useIDKitRequest's config must always be a valid shape, but `open()` is never called
// until `rpContext` state below is set for real.
const EMPTY_RP_CONTEXT: RpContext = {
  rp_id: "",
  nonce: "",
  created_at: 0,
  expires_at: 0,
  signature: "",
};

export function WorldButton({
  onVerified,
  label = "Verify you're human",
}: {
  onVerified: (verification: Verification) => void;
  label?: string;
}) {
  const { address } = useAccount();
  const [phase, setPhase] = useState<"idle" | "fetching-rp" | "ready">("idle");
  const [rpContext, setRpContext] = useState<RpContext | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const handledResult = useRef<unknown>(null);

  const { open, isSuccess, isError, errorCode, result, reset, connectorURI, isInWorldApp, getDebugReport } =
    useIDKitRequest({
      app_id: WORLD_APP_ID as `app_${string}`,
      action: "register-agent",
      rp_context: rpContext ?? EMPTY_RP_CONTEXT,
      allow_legacy_proofs: true,
      // Orb ("proof of human") — works today in Sandbox without Beta access,
      // unlike selfieCheckLegacy() which requires World to enable Selfie Check
      // Beta for this app_id first.
      preset: orbLegacy({ signal: address ?? "" }),
      // Must match whichever World app build is actually installed on the test phone —
      // "staging" generates a link for the production World App package, which a phone
      // running the separate Sandbox/developer "World ID" app won't recognize (shows
      // "install this other app" instead of opening it). This tester has the Sandbox
      // build installed, so use "sandbox" here. Switch to "production" once launched.
      environment: "sandbox",
    });

  // Auto-open once the real RP context has landed
  useEffect(() => {
    if (phase === "ready" && rpContext) {
      open();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, rpContext]);

  // If we're already inside World App's in-app browser, jump straight there —
  // no QR code needed, there's nothing to scan on the same device.
  useEffect(() => {
    if (connectorURI && isInWorldApp) {
      window.location.href = connectorURI;
    }
  }, [connectorURI, isInWorldApp]);

  // Render the connector link as a QR code for cross-device (desktop → phone) use.
  useEffect(() => {
    if (!connectorURI || isInWorldApp) {
      setQrDataUrl(null);
      return;
    }
    QRCode.toDataURL(connectorURI, { width: 220, margin: 1 })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(null));
  }, [connectorURI, isInWorldApp]);

  // React to World App completing the flow
  useEffect(() => {
    if (isSuccess && result && result !== handledResult.current) {
      handledResult.current = result;
      handleSuccess(result);
    }
    if (isError) {
      // eslint-disable-next-line no-console
      const details = { errorCode, debugReport: getDebugReport() };
      console.error("[World IDKit] verification failed", details);
      // For easy copy/paste when reporting a bug — type `copy(window.__lastWorldError)`
      // in the browser console, then paste.
      (window as unknown as { __lastWorldError?: unknown }).__lastWorldError = details;
      toast.error(`Verification failed${errorCode ? `: ${errorCode}` : ""}`);
      setPhase("idle");
      setRpContext(null);
      reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess, isError, result, errorCode]);

  async function handleClick() {
    if (!address) {
      toast.error("Connect your wallet first");
      return;
    }
    setPhase("fetching-rp");
    try {
      const ctx = await getRpSignature();
      // created_at/expires_at are already Unix-second numbers from the backend
      // (via @worldcoin/idkit-server's signRequest()) — no conversion needed.
      setRpContext({
        rp_id: ctx.rp_id,
        nonce: ctx.nonce,
        created_at: ctx.created_at,
        expires_at: ctx.expires_at,
        signature: ctx.signature,
      });
      setPhase("ready");
    } catch (e) {
      toast.error("Could not start verification — try again");
      setPhase("idle");
    }
  }

  function cancel() {
    setPhase("idle");
    setRpContext(null);
    setQrDataUrl(null);
    reset();
  }

  async function handleSuccess(idkitResult: IDKitResult) {
    if (!address) return;
    // selfieCheckLegacy() always yields a v3-protocol result — narrow before reading `responses`.
    if (idkitResult.protocol_version !== "3.0") {
      toast.error("Unexpected verification result — please try again");
      cancel();
      return;
    }
    const credential = idkitResult.responses?.[0];
    if (!credential) {
      toast.error("No credential returned by World App");
      cancel();
      return;
    }
    try {
      const verification = await verifyProof(
        {
          proof: credential.proof,
          merkle_root: credential.merkle_root,
          nullifier_hash: credential.nullifier,
          verification_level: credential.identifier,
          protocol_version: idkitResult.protocol_version,
          signal: address,
          // world.js's verifyWorldProof() forwards this to World's real verify API —
          // without it the backend sends rp_context: undefined and World rejects with 400.
          rp_context: rpContext,
        },
        address,
      );
      onVerified(verification);
      toast.success("Selfie check passed — you're verified");
      cancel();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Verification failed";
      toast.error(msg);
      cancel();
    }
  }

  const busy = phase !== "idle";

  return (
    <div className="flex flex-col items-start gap-3">
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
      >
        <ShieldCheck size={16} />
        {phase === "fetching-rp" ? "Preparing…" : busy ? "Waiting for World App…" : label}
      </button>

      {/* On the same device as World App: a tappable deep link. */}
      {connectorURI && isInWorldApp && (
        <a
          href={connectorURI}
          className="text-xs font-mono text-primary underline underline-offset-2"
        >
          Tap to open World App
        </a>
      )}

      {/* Cross-device: scan with the World App on your phone. */}
      {connectorURI && !isInWorldApp && (
        <div className="flex flex-col items-center gap-2 rounded-md border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Scan with World App on your phone</p>
          {qrDataUrl ? (
            <img src={qrDataUrl} alt="Scan with World App" width={220} height={220} />
          ) : (
            <p className="text-xs text-muted-foreground">Generating QR code…</p>
          )}
          <a
            href={connectorURI}
            className="text-[11px] font-mono text-primary underline underline-offset-2"
          >
            or open the link directly on your phone
          </a>
          <button
            type="button"
            onClick={cancel}
            className="text-[11px] text-muted-foreground underline underline-offset-2"
          >
            cancel
          </button>
        </div>
      )}
    </div>
  );
}

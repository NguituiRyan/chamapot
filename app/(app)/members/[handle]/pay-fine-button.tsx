'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { CircleAlert, CircleCheck, LoaderCircle, Lock } from 'lucide-react';

// PayPal JS SDK v6 (web-sdk/v6/core) one-time payment for a late fine. The order is created and captured
// on our server (Orders v2 via the PayPal Server SDK); the browser never sends an amount.

interface PayPalSession {
  start(options: { presentationMode: 'auto' | 'popup' | 'modal' | 'redirect' }, order: Promise<{ orderId: string }>): Promise<void>;
}
interface PayPalSdkInstance {
  findEligibleMethods(options?: Record<string, unknown>): Promise<{ isEligible(method: string): boolean }>;
  createPayPalOneTimePaymentSession(options: {
    onApprove: (data: { orderId: string }) => Promise<void> | void;
    onCancel?: (data?: unknown) => void;
    onError?: (error: Error) => void;
  }): PayPalSession | Promise<PayPalSession>;
}
declare global {
  interface Window {
    paypal?: { createInstance(options: { clientId: string; components: string[]; pageType?: string }): Promise<PayPalSdkInstance> };
  }
}

const SDK_URL = 'https://www.sandbox.paypal.com/web-sdk/v6/core';
let sdkPromise: Promise<void> | null = null;

function loadSdk(): Promise<void> {
  if (window.paypal) return Promise.resolve();
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SDK_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      sdkPromise = null;
      reject(new Error('Could not load PayPal. Check your connection and try again.'));
    };
    document.head.appendChild(script);
  });
  return sdkPromise;
}

const friendly = (message: string) =>
  /INSTRUMENT_DECLINED/.test(message)
    ? 'PayPal declined that payment method. Try another card or your PayPal balance.'
    : /INSUFFICIENT_FUNDS/.test(message)
      ? 'There are not enough funds for this payment.'
      : message || 'The payment did not go through.';

type State = 'loading' | 'ready' | 'paying' | 'paid' | 'ineligible' | 'error';

export function PayFineButton({
  contributionId,
  clientId,
  amountLabel,
}: {
  contributionId: string;
  clientId: string | null;
  amountLabel: string;
}) {
  const router = useRouter();
  const container = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<State>(clientId ? 'loading' : 'error');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    let button: HTMLElement | null = null;

    async function createOrder(): Promise<{ orderId: string }> {
      const res = await fetch('/api/chama/fines/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contributionId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.orderId) throw new Error(body?.error ?? 'Could not start the PayPal payment');
      return { orderId: body.orderId as string };
    }

    async function setup() {
      try {
        await loadSdk();
        if (!window.paypal) throw new Error('PayPal did not load');
        const sdk = await window.paypal.createInstance({ clientId: clientId!, components: ['paypal-payments'] });
        const eligibility = await sdk.findEligibleMethods();
        if (cancelled) return;
        if (!eligibility.isEligible('paypal')) {
          setState('ineligible');
          return;
        }
        const session = await sdk.createPayPalOneTimePaymentSession({
          async onApprove({ orderId }) {
            setState('paying');
            try {
              const res = await fetch(`/api/chama/fines/orders/${encodeURIComponent(orderId)}/capture`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contributionId }),
              });
              const body = await res.json().catch(() => ({}));
              if (!res.ok) throw new Error(body?.error ?? 'PayPal approved, but we could not confirm the payment');
              setState('paid');
              setMessage(null);
              router.refresh();
            } catch (err) {
              setState('ready');
              setMessage(err instanceof Error ? err.message : 'Capturing the payment failed');
            }
          },
          onCancel() {
            setState('ready');
            setMessage('Payment cancelled. The fine is still open.');
          },
          onError(err) {
            setState('ready');
            setMessage(friendly(err?.message ?? ''));
          },
        });
        if (cancelled || !container.current) return;
        button = document.createElement('paypal-button');
        button.addEventListener('click', async () => {
          setMessage(null);
          try {
            // Do not await createOrder before start(): it must run inside the click's user activation.
            await session.start({ presentationMode: 'auto' }, createOrder());
          } catch (err) {
            setMessage(friendly(err instanceof Error ? err.message : ''));
          }
        });
        container.current.replaceChildren(button);
        setState('ready');
      } catch (err) {
        if (cancelled) return;
        setState('error');
        setMessage(err instanceof Error ? err.message : 'PayPal is unavailable right now');
      }
    }

    void setup();
    return () => {
      cancelled = true;
      button?.remove();
    };
  }, [clientId, contributionId, router]);

  if (!clientId) {
    return (
      <div>
        <button
          type="button"
          disabled
          className="inline-flex h-12 w-full max-w-sm cursor-not-allowed items-center justify-center gap-2 rounded-[10px] bg-[#FFC439]/50 text-sm font-bold text-[#003087]/60"
        >
          <Lock className="size-4" aria-hidden />
          Pay {amountLabel} with PayPal
        </button>
        <p className="mt-2 text-xs text-muted">
          PayPal checkout is not configured in this build (NEXT_PUBLIC_PAYPAL_CLIENT_ID is blank), so the button is switched off.
        </p>
      </div>
    );
  }

  if (state === 'paid') {
    return (
      <p className="flex items-center gap-2 rounded-[10px] bg-success-soft px-3 py-2.5 text-sm font-semibold text-success" role="status">
        <CircleCheck className="size-5" aria-hidden />
        Fine paid with PayPal. Thank you.
      </p>
    );
  }

  return (
    <div className="max-w-sm">
      {state === 'loading' ? (
        <div className="h-12 w-full animate-pulse rounded-[10px] bg-sunken" aria-label="Loading PayPal" role="status" />
      ) : null}
      <div ref={container} className={state === 'loading' || state === 'ineligible' ? 'hidden' : ''} />
      {state === 'paying' ? (
        <p className="mt-2 flex items-center gap-2 text-sm text-muted" role="status">
          <LoaderCircle className="size-4 animate-spin" aria-hidden /> Confirming with PayPal…
        </p>
      ) : null}
      {state === 'ineligible' ? (
        <p className="text-sm text-muted">PayPal is not available for this payment in your region. Pay the treasurer at the meeting instead.</p>
      ) : null}
      {message ? (
        <p role="alert" className="mt-2 flex gap-1.5 text-sm text-ink">
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-clay" aria-hidden />
          {message}
        </p>
      ) : null}
    </div>
  );
}

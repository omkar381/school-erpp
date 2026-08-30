'use client';

/**
 * Razorpay Checkout, loaded on demand.
 *
 * The widget is a third-party script, so it is fetched the first time a parent
 * actually opens a payment rather than on every page load — most sessions
 * never pay anything.
 */

const CHECKOUT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

export interface RazorpayOrder {
  orderId: string;
  paymentId: string;
  receiptNumber: string;
  amount: number;
  amountInPaise: number;
  currency: string;
  keyId: string;
  schoolName: string;
  studentName: string;
  prefill: { name?: string; email?: string; contact?: string };
  invoices: Array<{ id: string; invoiceNumber: string; amount: number }>;
}

export interface CheckoutResult {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}

interface RazorpayInstance {
  open: () => void;
  on: (event: string, handler: (payload: unknown) => void) => void;
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance;
  }
}

let loader: Promise<boolean> | null = null;

/** Resolves false when the script cannot be reached, so the caller can explain. */
export function loadRazorpay(): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);
  if (window.Razorpay) return Promise.resolve(true);
  if (loader) return loader;

  loader = new Promise<boolean>((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${CHECKOUT_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(Boolean(window.Razorpay)));
      existing.addEventListener('error', () => resolve(false));
      return;
    }

    const script = document.createElement('script');
    script.src = CHECKOUT_SRC;
    script.async = true;
    script.onload = () => resolve(Boolean(window.Razorpay));
    script.onerror = () => {
      // A failed load must not be cached as a permanent no; the parent may
      // simply have lost connectivity for a moment.
      loader = null;
      resolve(false);
    };
    document.body.append(script);
  });

  return loader;
}

/**
 * Opens the checkout and resolves with what the server needs to verify.
 *
 * Resolves null when the parent dismisses the sheet, which is a normal
 * outcome rather than an error — the pending payment simply stays pending and
 * is reconciled later.
 */
export async function openCheckout(order: RazorpayOrder): Promise<CheckoutResult | null> {
  const ready = await loadRazorpay();
  if (!ready || !window.Razorpay) {
    throw new Error(
      'The payment window could not be loaded. Check your connection and try again.',
    );
  }

  return new Promise<CheckoutResult | null>((resolve, reject) => {
    let settled = false;

    const checkout = new window.Razorpay!({
      key: order.keyId,
      order_id: order.orderId,
      amount: order.amountInPaise,
      currency: order.currency,
      name: order.schoolName,
      description: `Fees for ${order.studentName}`,
      prefill: order.prefill,
      notes: { receiptNumber: order.receiptNumber },
      theme: { color: '#2563EB' },
      handler: (response: Record<string, string>) => {
        settled = true;
        resolve({
          razorpayOrderId: response.razorpay_order_id ?? order.orderId,
          razorpayPaymentId: response.razorpay_payment_id ?? '',
          razorpaySignature: response.razorpay_signature ?? '',
        });
      },
      modal: {
        ondismiss: () => {
          if (!settled) resolve(null);
        },
      },
    });

    checkout.on('payment.failed', (payload: unknown) => {
      settled = true;
      const description = (payload as { error?: { description?: string } })?.error?.description;
      reject(new Error(description ?? 'The payment was declined. No money has been taken.'));
    });

    checkout.open();
  });
}

/**
 * All user-facing copy for the Tuma payment-authentication flow.
 * STANDARD ENGLISH ONLY. No Swahili, no Sheng — that differentiation comes later.
 *
 * Rule: speak in outcomes and next steps, never in machine codes.
 * reasonCode is logged, never pasted into a message.
 */

export interface OrderSummary {
  orderRef: string;
  description: string;
  amount: number;
  till: string;
}

const ksh = (n: number) => `KSh ${n.toLocaleString("en-KE")}`;

export const copy = {
  /** Order confirmed in chat: offer the two payment paths. */
  orderConfirmed: (o: OrderSummary) =>
    `Your order ${o.orderRef} is confirmed: ${o.description}. Total: ${ksh(o.amount)}.\n\n` +
    `Reply 1 and we will send a payment request to your phone now.\n` +
    `Reply 2 if you will pay manually to till ${o.till}.`,

  /** STK push dispatched to the buyer's phone. */
  stkSent: (amount: number, phoneMasked: string) =>
    `A payment request for ${ksh(amount)} has been sent to ${phoneMasked}. ` +
    `Enter your M-Pesa PIN to complete the payment.`,

  /** STK push failed to dispatch. */
  stkFailed: () =>
    `We could not send the payment request to your phone. ` +
    `Please pay manually to the till number you were given, then reply with the M-Pesa transaction code.`,

  /** Manual payment instructions. */
  manualInstructions: (amount: number, till: string) =>
    `Please pay ${ksh(amount)} to till ${till} using M-Pesa, ` +
    `then reply here with the transaction code from your confirmation message (for example: QHX7ABC123).`,

  /** Buyer verified: paid and matched. */
  buyerVerified: (orderRef: string) =>
    `Payment verified for order ${orderRef}. Thank you for your purchase.`,

  /** Vendor verified: release the goods. */
  vendorVerified: (o: OrderSummary) =>
    `Payment verified for order ${o.orderRef}: ${ksh(o.amount)} received. ` +
    `Please release the goods to the buyer.`,

  /** Failure outcomes — always give the next step, never the machine code. */
  buyerFailed: (reasonCode: string, expected: number, received?: number) => {
    switch (reasonCode) {
      case "AMOUNT_MISMATCH":
        return (
          `We received ${received != null ? ksh(received) : "a different amount"}, ` +
          `but this order total is ${ksh(expected)}. ` +
          `Please top up the difference or contact the vendor to resolve this.`
        );
      case "RECIPIENT_MISMATCH":
        return (
          `The payment went to a different till than the vendor's. ` +
          `Please confirm the correct till number with the vendor and pay again to that till.`
        );
      case "CODE_NOT_FOUND":
        return (
          `We could not find that transaction code. ` +
          `Please check the code and send it again exactly as it appears in your M-Pesa message.`
        );
      case "STALE":
        return (
          `That transaction is older than 24 hours and can no longer be used for this order. ` +
          `Please make a fresh payment and send the new transaction code.`
        );
      case "DUPLICATE":
        return (
          `That transaction code has already been used for another order. ` +
          `Please send the code for this payment only.`
        );
      case "PENDING_CALLBACK":
        return (
          `Your payment is on its way. We are waiting for confirmation from M-Pesa ` +
          `and will message you the moment it arrives.`
        );
      default:
        return (
          `We could not verify this payment. ` +
          `Please check the transaction code and try again, or contact the vendor for help.`
        );
    }
  },

  vendorFailed: (orderRef: string) =>
    `Payment for order ${orderRef} could not be verified. ` +
    `Do not release the goods yet. The buyer has been told what to do next.`,

  /** We could not understand the reply at all. */
  unrecognized: () =>
    `Sorry, I did not understand that. ` +
    `Reply 1 to pay now on your phone, or 2 to pay manually and send the transaction code.`,
};

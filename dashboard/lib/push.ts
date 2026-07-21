import webpush from "web-push";
import { getPushSubscriptionsForOwner, removePushSubscription } from "@/lib/mongodb";

const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const privateKey = process.env.VAPID_PRIVATE_KEY;
const subject = process.env.VAPID_SUBJECT;

if (publicKey && privateKey && subject) {
  webpush.setVapidDetails(subject, publicKey, privateKey);
}

const RETRY_DELAYS_MS = [500, 2000]; // ponytail: fixed backoff, good enough for a push service blip

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendWithRetry(sub: { endpoint: string; keys: { p256dh: string; auth: string } }, body: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, body);
      return;
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        // subscription expired or was revoked by the browser — stop trying it
        await removePushSubscription(sub.endpoint);
        return;
      }
      if (statusCode !== undefined && statusCode < 500) return; // bad request/payload, retrying won't help
      if (attempt >= RETRY_DELAYS_MS.length) {
        console.error("Push send failed after retries:", err);
        return;
      }
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
}

export async function notifyOwner(ownerId: string, payload: { title: string; body: string }) {
  if (!publicKey || !privateKey) return; // push not configured, skip silently

  const subs = await getPushSubscriptionsForOwner(ownerId);
  const body = JSON.stringify(payload);
  await Promise.all(subs.map((sub) => sendWithRetry(sub, body)));
}

import webpush from "web-push";
import { getPushSubscriptionsForOwner, removePushSubscription } from "@/lib/mongodb";

const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const privateKey = process.env.VAPID_PRIVATE_KEY;
const subject = process.env.VAPID_SUBJECT;

if (publicKey && privateKey && subject) {
  webpush.setVapidDetails(subject, publicKey, privateKey);
}

export async function notifyOwner(ownerId: string, payload: { title: string; body: string }) {
  if (!publicKey || !privateKey) return; // push not configured, skip silently

  const subs = await getPushSubscriptionsForOwner(ownerId);
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: sub.keys },
          JSON.stringify(payload)
        );
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          // subscription expired or was revoked by the browser — stop trying it
          await removePushSubscription(sub.endpoint);
        } else {
          console.error("Push send failed:", err);
        }
      }
    })
  );
}

import { MongoClient, ObjectId } from "mongodb";

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error("Missing MONGODB_URI env var");

// ponytail: module-level singleton so dev hot-reload and serverless invocations reuse one connection
const globalForMongo = globalThis as unknown as { _mongoClientPromise?: Promise<MongoClient> };

const clientPromise =
  globalForMongo._mongoClientPromise ?? new MongoClient(uri).connect();

if (process.env.NODE_ENV !== "production") {
  globalForMongo._mongoClientPromise = clientPromise;
}

export default clientPromise;

async function getDb() {
  const client = await clientPromise;
  return client.db(process.env.MONGODB_DB ?? "smartdoor");
}

// ---- users ----

export interface UserDoc {
  _id: ObjectId;
  email: string;
  passwordHash: string;
  name?: string;
}

export async function findUserByEmail(email: string) {
  const db = await getDb();
  return db.collection<UserDoc>("users").findOne({ email: email.toLowerCase() });
}

export async function createUser(email: string, passwordHash: string, name?: string) {
  const db = await getDb();
  const result = await db.collection<UserDoc>("users").insertOne({
    _id: new ObjectId(),
    email: email.toLowerCase(),
    passwordHash,
    name,
  });
  return result.insertedId;
}

// ---- devices ----

// A recurring weekly window during which the device should be DISARMED.
// day: 0=Sunday..6=Saturday (matches Date#getDay()). start/end are "HH:MM" in the
// owner's chosen timezone offset (minutes east of UTC, so schedules stay correct
// regardless of where the server or device physically are).
export interface ScheduleRule {
  day: number;
  start: string;
  end: string;
}

export interface DeviceDoc {
  _id: ObjectId;
  deviceId: string; // stable ESP32 chip id, e.g. "esp32-a1b2c3"
  ownerId: string; // NextAuth user id (stringified ObjectId)
  name: string;
  claimCode?: string; // pending pairing code, cleared once claimed
  token?: string; // per-device secret the ESP32 generates itself, set once at claim time
  createdAt: string;
  armed: boolean; // manual base state, used when no schedule/override applies
  timezoneOffsetMinutes: number; // minutes east of UTC, for evaluating scheduleRules
  scheduleRules: ScheduleRule[]; // recurring weekly disarm windows
  tempOverrideUntil?: string; // ISO time; while now < this, tempOverrideArmed wins over schedule/manual
  tempOverrideArmed?: boolean;
  lastSeenAt?: string; // ISO time, bumped on every /api/devices/state poll from the device
}

// Device polls /api/devices/state every STATE_POLL_MS (5s in firmware); missing a
// couple of cycles before calling it offline avoids flapping on one dropped request.
export const ONLINE_THRESHOLD_MS = 15_000;

export function isDeviceOnline(device: DeviceDoc, now: Date = new Date()): boolean {
  if (!device.lastSeenAt) return false;
  return now.getTime() - new Date(device.lastSeenAt).getTime() < ONLINE_THRESHOLD_MS;
}

// Resolves whether a device should currently be armed, in priority order:
// 1. An active one-off override ("disarm until 6pm") — wins until it expires
// 2. A matching recurring weekly schedule rule — always disarms during its window
// 3. The manual base `armed` flag
export function computeArmedState(device: DeviceDoc, now: Date = new Date()): boolean {
  if (device.tempOverrideUntil && new Date(device.tempOverrideUntil) > now) {
    return device.tempOverrideArmed ?? device.armed;
  }

  const offsetMs = (device.timezoneOffsetMinutes ?? 0) * 60_000;
  const local = new Date(now.getTime() + offsetMs);
  const day = local.getUTCDay();
  const minutesNow = local.getUTCHours() * 60 + local.getUTCMinutes();

  for (const rule of device.scheduleRules ?? []) {
    if (rule.day !== day) continue;
    const [sh, sm] = rule.start.split(":").map(Number);
    const [eh, em] = rule.end.split(":").map(Number);
    const startMin = sh * 60 + sm;
    const endMin = eh * 60 + em;
    if (minutesNow >= startMin && minutesNow < endMin) return false; // disarmed during this window
  }

  return device.armed;
}

export async function getDevicesForOwner(ownerId: string): Promise<DeviceDoc[]> {
  const db = await getDb();
  const docs = await db
    .collection<DeviceDoc>("devices")
    .find({ ownerId })
    .sort({ createdAt: -1 })
    .toArray();
  return JSON.parse(JSON.stringify(docs));
}

export async function markDeviceSeen(deviceId: string) {
  const db = await getDb();
  await db
    .collection<DeviceDoc>("devices")
    .updateOne({ deviceId }, { $set: { lastSeenAt: new Date().toISOString() } });
}

export async function getDeviceByDeviceId(deviceId: string) {
  const db = await getDb();
  return db.collection<DeviceDoc>("devices").findOne({ deviceId });
}

// Used to authenticate every non-claim request from a device: the deviceId must
// exist and its stored token must match what the device sent.
export async function verifyDeviceToken(deviceId: string, token: string): Promise<boolean> {
  if (!deviceId || !token) return false;
  const db = await getDb();
  const device = await db.collection<DeviceDoc>("devices").findOne({ deviceId });
  return !!device && device.token === token;
}

// Owner clicks "Add device" in the dashboard: generates a short code, stores a
// placeholder device row awaiting the ESP32 to claim it with that code
// (see app/api/devices/claim/route.ts, called by the device itself).
export async function createPendingDevice(ownerId: string, claimCode: string, name: string) {
  const db = await getDb();
  const _id = new ObjectId();
  await db.collection<DeviceDoc>("devices").insertOne({
    _id,
    deviceId: "", // filled in once the ESP32 claims it
    ownerId,
    claimCode,
    name,
    createdAt: new Date().toISOString(),
    armed: true,
    timezoneOffsetMinutes: 0,
    scheduleRules: [],
  });
  return _id;
}

export async function renameDevice(ownerId: string, deviceObjectId: string, name: string) {
  const db = await getDb();
  const result = await db.collection<DeviceDoc>("devices").updateOne(
    { _id: new ObjectId(deviceObjectId), ownerId },
    { $set: { name } }
  );
  return result.matchedCount > 0;
}

export async function setDeviceArmed(ownerId: string, deviceObjectId: string, armed: boolean) {
  const db = await getDb();
  const result = await db.collection<DeviceDoc>("devices").updateOne(
    { _id: new ObjectId(deviceObjectId), ownerId },
    { $set: { armed }, $unset: { tempOverrideUntil: "", tempOverrideArmed: "" } }
  );
  return result.matchedCount > 0;
}

export async function setDeviceOverride(
  ownerId: string,
  deviceObjectId: string,
  armed: boolean,
  until: string
) {
  const db = await getDb();
  const result = await db.collection<DeviceDoc>("devices").updateOne(
    { _id: new ObjectId(deviceObjectId), ownerId },
    { $set: { tempOverrideArmed: armed, tempOverrideUntil: until } }
  );
  return result.matchedCount > 0;
}

export async function clearDeviceOverride(ownerId: string, deviceObjectId: string) {
  const db = await getDb();
  const result = await db.collection<DeviceDoc>("devices").updateOne(
    { _id: new ObjectId(deviceObjectId), ownerId },
    { $unset: { tempOverrideUntil: "", tempOverrideArmed: "" } }
  );
  return result.matchedCount > 0;
}

export async function setDeviceSchedule(
  ownerId: string,
  deviceObjectId: string,
  scheduleRules: ScheduleRule[],
  timezoneOffsetMinutes: number
) {
  const db = await getDb();
  const result = await db.collection<DeviceDoc>("devices").updateOne(
    { _id: new ObjectId(deviceObjectId), ownerId },
    { $set: { scheduleRules, timezoneOffsetMinutes } }
  );
  return result.matchedCount > 0;
}

// ---- logs ----

export interface DoorLog {
  _id: string;
  time: string;
  event: string;
  alarm: boolean;
  deviceId: string;
  deviceName: string;
}

export async function getLogsForOwner(
  ownerId: string,
  page = 1,
  pageSize = 25
): Promise<{ logs: DoorLog[]; total: number }> {
  const db = await getDb();
  const devices = await db
    .collection<DeviceDoc>("devices")
    .find({ ownerId })
    .project({ deviceId: 1, name: 1 })
    .toArray();
  const nameByDeviceId = new Map(devices.map((d) => [d.deviceId, d.name]));
  const deviceIds = [...nameByDeviceId.keys()].filter(Boolean);
  if (deviceIds.length === 0) return { logs: [], total: 0 };

  const filter = { deviceId: { $in: deviceIds } };
  const logsCollection = db.collection("logs");

  const [docs, total] = await Promise.all([
    logsCollection
      .find(filter)
      .sort({ time: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .toArray(),
    logsCollection.countDocuments(filter),
  ]);

  const withNames = docs.map((d) => ({ ...d, deviceName: nameByDeviceId.get(d.deviceId) ?? d.deviceId }));
  return { logs: JSON.parse(JSON.stringify(withNames)), total };
}

export async function insertLog(doc: {
  event: string;
  alarm: boolean;
  deviceId: string;
  time?: string;
}) {
  const db = await getDb();
  await db.collection("logs").insertOne({
    ...doc,
    time: doc.time ?? new Date().toISOString(),
  });
}

// ---- push subscriptions ----

export interface PushSubscriptionDoc {
  _id: ObjectId;
  ownerId: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export async function savePushSubscription(
  ownerId: string,
  sub: { endpoint: string; keys: { p256dh: string; auth: string } }
) {
  const db = await getDb();
  await db.collection<PushSubscriptionDoc>("pushSubscriptions").updateOne(
    { endpoint: sub.endpoint },
    { $set: { ownerId, endpoint: sub.endpoint, keys: sub.keys } },
    { upsert: true }
  );
}

export async function removePushSubscription(endpoint: string) {
  const db = await getDb();
  await db.collection("pushSubscriptions").deleteOne({ endpoint });
}

export async function getPushSubscriptionsForOwner(ownerId: string) {
  const db = await getDb();
  return db.collection<PushSubscriptionDoc>("pushSubscriptions").find({ ownerId }).toArray();
}

export async function getOwnerIdForDevice(deviceId: string): Promise<string | null> {
  const db = await getDb();
  const device = await db.collection<DeviceDoc>("devices").findOne({ deviceId });
  return device?.ownerId ?? null;
}

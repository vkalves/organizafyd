export const buckets = {
  "instagram-publisher": {
    public: false,
    max: 104857600,
    types: ["image/jpeg", "video/mp4"],
    delete: true,
  },
  "x-media": {
    public: false,
    max: 20971520,
    types: ["image/jpeg", "image/png", "video/mp4"],
    delete: false,
  },
  "tiktok-media": {
    public: true,
    max: 4194304,
    types: ["image/jpeg", "image/webp"],
    delete: false,
  },
  media: { public: true, max: 104857600, types: [] as string[], delete: true },
} as const;
export type Bucket = keyof typeof buckets;
export function validBucket(value: unknown): value is Bucket {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(buckets, value);
}
export function validPath(value: unknown): value is string {
  return typeof value === "string" && value.length <= 900 &&
    /^[0-9a-f-]{36}\/.+/i.test(value) && !/[\\\x00-\x1f\x7f]/.test(value) &&
    !value.split("/").some((p) => !p || p === "." || p === "..");
}
export function ownsPath(user: string, path: string) {
  return path.startsWith(user + "/");
}
export function uploadAllowed(bucket: Bucket, type: string, size: number) {
  const policy = buckets[bucket];
  return Number.isSafeInteger(size) && size > 0 && size <= policy.max &&
    /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(type) &&
    (!policy.types.length ||
      (policy.types as readonly string[]).includes(type));
}

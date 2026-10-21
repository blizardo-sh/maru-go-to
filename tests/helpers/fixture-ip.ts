let client = 0;
// Fixture-only headers isolate clients while keeping Better Auth's real limiter active.
export function nextFixtureIp(): string {
  const id = ++client;
  return `198.18.${(id >>> 8) & 255}.${id & 255}`;
}

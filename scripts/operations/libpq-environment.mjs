const LOOPBACK_HOSTS = new Set(["127.0.0.1", "[::1]", "localhost"]);

export function libpqEnvironment(value) {
  let databaseUrl;
  try {
    databaseUrl = new URL(value);
  } catch {
    throw new Error("invalid_database_url");
  }
  const loopback = LOOPBACK_HOSTS.has(databaseUrl.hostname);
  const sslmode =
    databaseUrl.searchParams.get("sslmode") ?? (loopback ? "disable" : "require");
  const database = decodeURIComponent(databaseUrl.pathname.slice(1));
  if (
    !["postgres:", "postgresql:"].includes(databaseUrl.protocol) ||
    !databaseUrl.hostname ||
    !databaseUrl.username ||
    !databaseUrl.password ||
    !database ||
    !(
      ["require", "verify-ca", "verify-full"].includes(sslmode) ||
      (loopback && sslmode === "disable")
    )
  ) {
    throw new Error("invalid_database_url");
  }
  return {
    PGDATABASE: database,
    PGHOST: databaseUrl.hostname,
    PGPASSWORD: decodeURIComponent(databaseUrl.password),
    PGPORT: databaseUrl.port || "5432",
    PGSSLMODE: sslmode,
    PGUSER: decodeURIComponent(databaseUrl.username),
  };
}

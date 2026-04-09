/**
 * D1 auto-setup: token만으로 account_id + database_id 자동 조회/생성
 */

export interface D1AutoSetupResult {
  accountId: string;
  accountName: string;
  databaseId: string;
  databaseName: string;
  created: boolean;  // true if DB was newly created
}

/**
 * Given a Cloudflare API token, auto-detect account and D1 database.
 * Creates "sincenety" database if not found.
 * If knownAccountId is provided, skip /accounts lookup (useful when token lacks Account read permission).
 */
export async function autoSetupD1(apiToken: string, knownAccountId?: string): Promise<D1AutoSetupResult> {
  // 1. Get account ID
  let accountId: string;
  let accountName: string;

  if (knownAccountId) {
    accountId = knownAccountId;
    accountName = knownAccountId.slice(0, 8) + "...";
  } else {
    const accountsRes = await fetch("https://api.cloudflare.com/client/v4/accounts?page=1&per_page=5", {
      headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
    });
    if (!accountsRes.ok) throw new Error(`Cloudflare API auth failed (${accountsRes.status})`);
    const accountsJson = await accountsRes.json() as any;
    if (!accountsJson.success || !accountsJson.result?.length) {
      throw new Error(
        "No Cloudflare account found. The token may lack Account read permission.\n" +
        "  → Fix: run sincenety config --d1-account <ACCOUNT_ID> first, then retry --d1-token.\n" +
        "  → Account ID can be found in the Cloudflare dashboard URL: dash.cloudflare.com/<ACCOUNT_ID>/..."
      );
    }
    const account = accountsJson.result[0];
    accountId = account.id;
    accountName = account.name;
  }

  // 2. List D1 databases, look for "sincenety"
  const dbListRes = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database?name=sincenety`,
    { headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" } },
  );
  if (!dbListRes.ok) throw new Error(`D1 database query failed (${dbListRes.status})`);
  const dbListJson = await dbListRes.json() as any;

  // Check if "sincenety" database exists
  const existing = dbListJson.result?.find((db: any) => db.name === "sincenety");
  if (existing) {
    return {
      accountId,
      accountName,
      databaseId: existing.uuid,
      databaseName: existing.name,
      created: false,
    };
  }

  // 3. Create "sincenety" database
  const createRes = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "sincenety" }),
    },
  );
  if (!createRes.ok) {
    const text = await createRes.text();
    throw new Error(`D1 database creation failed: ${text}`);
  }
  const createJson = await createRes.json() as any;

  return {
    accountId,
    accountName,
    databaseId: createJson.result.uuid,
    databaseName: createJson.result.name,
    created: true,
  };
}

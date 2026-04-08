/**
 * Cloudflare D1 REST API wrapper — native fetch 기반
 */

export interface D1QueryResult<T = Record<string, unknown>> {
  success: boolean;
  results: T[];
  meta: {
    duration: number;
    rows_read: number;
    rows_written: number;
    changes: number;
    last_row_id: number;
  };
}

export class D1Client {
  private baseUrl: string;
  private apiToken: string;

  constructor(accountId: string, databaseId: string, apiToken: string) {
    this.baseUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}`;
    this.apiToken = apiToken;
  }

  async query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<D1QueryResult<T>> {
    const res = await fetch(`${this.baseUrl}/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql, params: params ?? [] }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`D1 API error ${res.status}: ${text}`);
    }

    const json = (await res.json()) as {
      success: boolean;
      errors?: unknown[];
      result: D1QueryResult<T>[];
    };

    if (!json.success) {
      throw new Error(`D1 query error: ${JSON.stringify(json.errors)}`);
    }

    return json.result[0] as D1QueryResult<T>;
  }

  async batch(
    statements: Array<{ sql: string; params?: unknown[] }>,
  ): Promise<D1QueryResult[]> {
    // D1 REST API에는 네이티브 batch 엔드포인트가 없으므로 순차 실행
    const results: D1QueryResult[] = [];
    for (const stmt of statements) {
      results.push(await this.query(stmt.sql, stmt.params));
    }
    return results;
  }

  async ping(): Promise<boolean> {
    try {
      await this.query("SELECT 1 as ok");
      return true;
    } catch {
      return false;
    }
  }
}

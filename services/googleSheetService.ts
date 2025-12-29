
// services/googleSheetService.ts
import { FinderResponse, FinderResult } from "../types.ts";

/**
 * 取得有效的 Apps Script URL
 */
const getAppsScriptUrl = () => {
  const envUrl = (typeof process !== 'undefined' && process.env?.APPS_SCRIPT_URL);
  if (envUrl) return envUrl;
  
  if (typeof window !== 'undefined') {
    return window.sessionStorage.getItem('OVERRIDE_APPS_SCRIPT_URL') || "";
  }
  return "";
};

export async function appendCard(data: {
  id: string;
  topic_name: string;
  brand: string;
  domain: string;
  content: string;
  summary: string;
  keywords: string | string[];
  meta_json: string;
  status: string;
  tab?: string;
  approved_by?: string;
  approved_at?: string;
}) {
  const url = getAppsScriptUrl();
  if (!url) {
    console.error("APPS_SCRIPT_URL is missing.");
    return { result: "no_url" };
  }

  try {
    // 確保關鍵字為字串格式
    const keywordsStr = Array.isArray(data.keywords) ? data.keywords.join(', ') : (data.keywords || "");

    const payload = {
      action: "append",
      tab: data.tab || "主題知識卡",
      id: data.id,
      topic_name: data.topic_name,
      brand: data.brand,
      domain: data.domain,
      content: data.content,
      summary: data.summary,
      keywords: keywordsStr,
      meta_json: data.meta_json,
      status: data.status,
      approved_by: data.approved_by || "HQ",
      approved_at: data.approved_at || new Date().toISOString()
    };

    // 使用 text/plain 繞過 CORS preflight
    await fetch(url, {
      method: "POST",
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
    });
    
    return { result: "success", status: "success" };
  } catch (e) {
    console.error("[googleSheetService] Append Error:", e);
    return { result: "error", message: String(e) };
  }
}

export async function queryCards(params: {
  source: string;
  brand: string;
  domain: string;
  input?: string;
  onlyVerified?: boolean;
}): Promise<FinderResponse> {
  const { source, brand, domain, input = "", onlyVerified = false } = params;
  const timestamp = new Date().toISOString();
  const url = getAppsScriptUrl();

  if (!url) {
    return { results: [], total_count: 0, evidence: { sheet_id: "hidden", tab_name: source, range: "remote", rows_returned: 0, query_used: "config_missing", timestamp } };
  }

  try {
    const queryParams = new URLSearchParams({
      action: "query",
      tab: source,
      brand: brand,
      domain: domain,
      input: input
    });

    const res = await fetch(`${url}?${queryParams.toString()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    
    const data = await res.json();
    const rows: string[][] = data.values ?? [];
    
    const results: FinderResult[] = rows.map(r => ({
      id: r[0] || "N/A",
      topic_name: r[1] || "",
      brand: r[2] || "",
      domain: r[3] || "",
      status: "已審定",
      content: r[4] || "", 
      summary: r[5] || "",
      keywords: (r[6] || "").split(',').map(k => k.trim()).filter(k => k),
      meta_json: r[7] || "",
      updated_at: r[9] || "", 
      raw_row: r
    }));

    const finalResults = onlyVerified ? results.filter(r => r.status === "已審定") : results;

    return { 
      results: finalResults, 
      total_count: finalResults.length,
      evidence: { 
        sheet_id: "secured", 
        tab_name: source, 
        range: "managed_by_apps_script", 
        rows_returned: rows.length, 
        query_used: input, 
        timestamp 
      }
    };
  } catch (error: any) {
    console.error("[googleSheetService] Query Error:", error);
    return { results: [], total_count: 0, evidence: { sheet_id: "error", tab_name: source, range: "none", rows_returned: 0, query_used: "error", timestamp } };
  }
}

export async function fetchKnowledgeCards(params: { brand: string, domain: string, tab?: string }): Promise<any[]> {
  const res = await queryCards({
    source: params.tab || "主題知識卡",
    brand: params.brand,
    domain: params.domain
  });
  return res.results;
}

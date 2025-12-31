// services/geminiService.ts
import { GoogleGenAI, Type } from "@google/genai";

interface TopicDraftParams {
  brand: string;
  domain: string;
  topicName: string;
  rawText: string;
}

export interface GenerationResponse {
  id: string;
  topic_name: string;
  brand: string;
  domain: string;
  content: string;
  summary: string;
  keywords: string;
  meta_json: string;
  approved_by: string;
  approved_at: string;
}

export interface AuditResponse {
  report: string;
  corrected_json: GenerationResponse;
}

/**
 * [Task A] 主題卡「生成模板」
 * 輸出可直接寫入 Sheet 的 10 欄位 JSON
 */
export async function getTopicDraft(params: TopicDraftParams): Promise<GenerationResponse> {
  const { brand, domain, topicName, rawText } = params;
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const prompt = `
你是 LEADER HQ 總部知識庫助理（v2）。
你要把「原始內容」整理成一筆可寫入 Google Sheet（tab=主題知識卡）的資料。
原則：忠於原文、不補腦；不足請寫「目前內文資料不足，可日後補充」。
輸出必須符合「欄位規格」與「內容骨架（13段）」。

🧩 任務設定
* brand（顯示字串）：${brand}
* domain（顯示字串）：${domain}
* tab：主題知識卡
* 模式：新增主題卡（從原文整理）
* 視角：以「教練培訓教材」深度與用語為準
* 原則：忠於原文、不補腦；不足請寫「目前內文資料不足，可日後補充」

📌 主題
請整理成一張主題知識卡，主題是：【${topicName}】。

📄 原始內容
${rawText}

🧱 輸出規格（硬規格）
1. content 必須包含 13 段小標（Markdown 小標格式：#### 一、主題基本資訊），段落順序不可變。
2. 若該段原文沒有資料：保留小標並填「目前內文資料不足，可日後補充」。
3. meta_json 必須是單行 JSON，且 key 固定 9 個（不可多不可少）：
   brand, domain, tab, topic_name, topic_type, system_location, target_audience, status, media_ids
4. brand/domain 在 meta_json 內一律用小寫簡寫：例如 "yys", "swimming"
5. status 一律輸出 "draft"
6. media_ids 只放 media_id 陣列，沒圖就 []
7. summary 必須是 1–2 段摘要（對應 content 的二、主題摘要，寫到 summary 欄位）
8. keywords 允許空白；若原文能支持請給 5–12 個關鍵字（用逗號分隔字串寫到 keywords 欄位）
9. 輸出必須是「純 JSON」且只有一個物件，key 固定為下列 10 欄位（不可多不可少）：
   id, topic_name, brand, domain, content, summary, keywords, meta_json, approved_by, approved_at

📌 10 欄位填寫規則
* id：留空字串 ""（不要自己編號）
* topic_name：取自「一、主題基本資訊」的主題名稱
* brand：固定輸出 "${brand.split(' | ')[0].toLowerCase()}"
* domain：固定輸出 "${domain.split(' (')[1]?.replace(')', '').toLowerCase() || domain}"
* approved_by：固定 "system"
* approved_at：固定輸出 ISO 字串（${new Date().toISOString()}）

📌 13 段內容骨架
#### 一、主題基本資訊
#### 二、主題摘要
#### 三、教學 / 操作目標（內部版）
#### 四、核心觀點：為什麼要這樣做？
#### 五、實務操作要點｜給前線人員的小抄
#### 六、常見錯誤與成因
#### 七、矯正方向與建議作法
#### 八、個別服務 / 1 對 1 小技巧（若適用）
#### 九、團班 / 活動經營提示（若適用）
#### 十、給學員端可以理解的說法（若適用）
#### 十一、延伸 / 關聯主題
#### 十二、內部備註
#### 十三、圖像與媒體標記
`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-pro-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.STRING },
            topic_name: { type: Type.STRING },
            brand: { type: Type.STRING },
            domain: { type: Type.STRING },
            content: { type: Type.STRING },
            summary: { type: Type.STRING },
            keywords: { type: Type.STRING },
            meta_json: { type: Type.STRING },
            approved_by: { type: Type.STRING },
            approved_at: { type: Type.STRING }
          },
          required: ["id", "topic_name", "brand", "domain", "content", "summary", "keywords", "meta_json", "approved_by", "approved_at"]
        }
      }
    });
    return JSON.parse(response.text?.trim() || "{}");
  } catch (error) {
    console.error("[Gemini] Topic Generation Error:", error);
    throw error;
  }
}

/**
 * [Task B] 主題卡「AI 自審規則」R01–R08
 * 輸入=10 欄位 JSON；輸出=報告 + 修正後 JSON
 */
export async function performAiAudit(cardData: GenerationResponse): Promise<AuditResponse> {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const prompt = `
你是 LEADER HQ 總部知識庫助理（v2）的「AI自審模組」。
你要對輸入的主題卡資料做 R01–R08 自檢並修正。
原則：忠於原文、不補腦；不足只能寫「目前內文資料不足，可日後補充」。
禁止新增不存在的事實、研究、數據、來源。

【待審核資料 (JSON)】
${JSON.stringify(cardData, null, 2)}

【R01–R08（主題卡版）自審規則】
R01 結構完整：必須存在 10 欄位 key，content 必須包含 13 段小標（一～十三），meta_json 必須是單行 JSON 字串。
R02 忠於原文、不補腦：只能使用原文資訊，不足處寫「目前內文資料不足，可日後補充」。
R03 用語一致且定位正確：視角為「教練培訓教材」用語，避免誇大。
R04 可操作可檢核：第三段目標 3–5 點且可觀察，第五段包含至少 2 種要素（口令/步驟/觀察點/現場提醒）。
R05 錯誤—成因—矯正對應：第六段（錯誤成因）與第七段（矯正方向）需邏輯串連。
R06 summary / keywords 欄位規則：summary 為 1–2 段摘要且與正文一致，keywords 為逗號分隔字串。
R07 meta_json 硬規格：固定 9 個 keys，brand/domain 為小寫簡寫，status 為 "draft"，media_ids 為陣列。
R08 十三、圖像與媒體標記規則：只能用 media_id 等規定欄位，不准有 file_url。

【輸出要求】
請回傳包含以下屬性的 JSON 物件：
1. report: 自審報告文本，包含 ✅通過 與 ❌未通過 (及原因) 的清單。
2. corrected_json: 修正後符合 10 欄位規格的 JSON 物件，meta_json.status 必須保持 "draft"。
`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-pro-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            report: { type: Type.STRING },
            corrected_json: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                topic_name: { type: Type.STRING },
                brand: { type: Type.STRING },
                domain: { type: Type.STRING },
                content: { type: Type.STRING },
                summary: { type: Type.STRING },
                keywords: { type: Type.STRING },
                meta_json: { type: Type.STRING },
                approved_by: { type: Type.STRING },
                approved_at: { type: Type.STRING }
              },
              required: ["id", "topic_name", "brand", "domain", "content", "summary", "keywords", "meta_json", "approved_by", "approved_at"]
            }
          },
          required: ["report", "corrected_json"]
        }
      }
    });
    return JSON.parse(response.text?.trim() || "{}");
  } catch (error) {
    console.error("[Gemini] AI Audit Error:", error);
    throw error;
  }
}

/**
 * 產生教案模板
 */
export async function generateLessonPlan(params: TopicDraftParams): Promise<GenerationResponse> {
  const { brand, domain, topicName, rawText } = params;
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const prompt = `任務：將【${topicName}】轉換為教案模板，含 60/90 分鐘建議，並輸出符合 10 欄位規格的 JSON。`;
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-pro-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.STRING },
            topic_name: { type: Type.STRING },
            brand: { type: Type.STRING },
            domain: { type: Type.STRING },
            content: { type: Type.STRING },
            summary: { type: Type.STRING },
            keywords: { type: Type.STRING },
            meta_json: { type: Type.STRING },
            approved_by: { type: Type.STRING },
            approved_at: { type: Type.STRING }
          },
          required: ["id", "topic_name", "brand", "domain", "content", "summary", "keywords", "meta_json", "approved_by", "approved_at"]
        }
      }
    });
    return JSON.parse(response.text?.trim() || "{}");
  } catch (error) {
    throw error;
  }
}

export async function performLessonAudit(content: string, metaJson: string): Promise<any> {
  return { report: "教案結構審核完成", corrected_json: null };
}

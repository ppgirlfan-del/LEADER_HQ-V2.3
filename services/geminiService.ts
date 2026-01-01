
// services/geminiService.ts
import { GoogleGenAI, Type } from "@google/genai";

interface TopicDraftParams {
  brand: string;
  domain: string;
  topicName: string;
  rawText: string;
  topicId?: string; 
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
* brand：${brand}
* domain：${domain}
* tab：主題知識卡
* 視角：以「教練培訓教材」深度與用語為準

📌 主題：【${topicName}】
📄 原始內容：${rawText}

🧱 輸出規格：純 JSON，包含 id, topic_name, brand, domain, content, summary, keywords, meta_json, approved_by, approved_at。
content 必須包含 #### 一、... 到 #### 十三、... 共 13 段小標。
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
    throw error;
  }
}

/**
 * [Task B] 主題卡「AI 自審」
 */
export async function performAiAudit(cardData: GenerationResponse): Promise<AuditResponse> {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const prompt = `你是 AI 自審模組。請對主題卡進行 R01-R08 檢查並修正。資料：${JSON.stringify(cardData)}`;
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-pro-preview",
      contents: prompt,
      config: { responseMimeType: "application/json" }
    });
    return JSON.parse(response.text?.trim() || "{}");
  } catch (error) {
    throw error;
  }
}

/**
 * [Task C] 教案模板生成（60/90 雙版本 + 九段結構）
 */
export async function generateLessonPlan(params: TopicDraftParams): Promise<GenerationResponse> {
  const { brand, domain, topicName, rawText, topicId = "" } = params;
  const brandCode = brand.split(' | ')[0].trim().toLowerCase();
  const domainCode = domain.split(' (')[1]?.replace(')', '').toLowerCase() || domain;
  
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const prompt = `
你是 LEADER HQ 總部知識庫助理（v2）。
任務：將知識卡素材【${topicName}】轉換為「教案模板」。
目標：輸出 **60 分鐘版 + 90 分鐘版** 兩份教案。

🧱 每份教案必須嚴格遵循以下九段骨架（Markdown 小標）：
#### 一、主題基本資訊
#### 二、課程摘要
#### 三、教學目標（可檢核）
#### 四、課程流程（時間切分）
#### 五、教練口令與引導語（現場可直接念，至少 3 句）
#### 六、常見錯誤與矯正（至少 2 組）
#### 七、課後作業（回家功課）
#### 八、本堂課完成判準（5 勾）
* 必須剛好 5 個勾選清單，格式：- [ ] ...
#### 九、圖像與媒體素材
* 若無則寫「目前尚未設定影像素材」。

📌 每份教案末尾必須單獨輸出一行 lesson_meta_json（單行 JSON）：
包含 10 個 key：brand, domain, tab, topic_id, topic_name, lesson_version, lesson_type, status, media_ids, keyword_policy。
keyword_policy 必須含：allow_empty, ai_autofill_when_empty, max_keywords, source。

請輸出符合 10 欄位規格的 JSON。content 欄位請將 60 分鐘與 90 分鐘教案內容以 "---" 分隔合併顯示。
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
    throw error;
  }
}

/**
 * [Task D] 教案「AI 自審規則」HQ 30 秒審核卡 (ReviewCard v1)
 */
export async function performLessonAudit(content: string, metaJson: string): Promise<any> {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const prompt = `
你是 LEADER HQ 總部教案審核專家。
請根據以下「教案全文」與「meta_json」輸出「HQ 審核卡」（ReviewCard v1）。

判定邏輯：
1. Hard Fail (❌)：缺少九段小標、第八段非 5 勾、第九段缺失/含 file_url、第四段沒時間切分、第五段少於 3 句、第六段少於 2 組、meta_json 格式錯/非 10 key、雙版本缺失。
2. Need Fix (🔁)：腦補數據/原理、用語不一、抽象不可執行。
3. Pass (✅)：以上皆無。

must_fix 規則：動詞開頭、可操作指令、最多 7 條。資料不足請填「目前內文資料不足，可日後補充」。

【教案內容】
${content}

【meta_json】
${metaJson}
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
            result: { type: Type.STRING, description: "✅/🔁/❌" },
            must_fix: { type: Type.ARRAY, items: { type: Type.STRING }, description: "最多 7 條必修清單" },
            quick_notes: { type: Type.STRING, description: "一句話原因 (<=25字)" },
            approved_fields: {
              type: Type.OBJECT,
              properties: {
                approved_by: { type: Type.STRING },
                approved_at: { type: Type.STRING }
              }
            }
          },
          required: ["result", "must_fix", "quick_notes", "approved_fields"]
        }
      }
    });
    return JSON.parse(response.text?.trim() || "{}");
  } catch (error) {
    return { result: "❌", must_fix: ["審核系統連線失敗"], quick_notes: "連線異常", approved_fields: {} };
  }
}

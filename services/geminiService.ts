
import { GoogleGenAI, Type } from "@google/genai";

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

interface TopicDraftParams {
  brand: string;
  domain: string;
  topicName: string;
  rawText: string;
  topicId?: string;
}

/**
 * [Task A] 主題知識卡生成
 * 使用 flash 模型降低配額限制風險
 */
export async function getTopicDraft(params: TopicDraftParams): Promise<GenerationResponse> {
  const { brand, domain, topicName, rawText } = params;
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const prompt = `
你是 LEADER HQ 總部知識庫助理（v2）。
任務：將原始內容整理為「主題知識卡」。
原則：忠於原文、不補腦；不足請寫「目前內文資料不足，可日後補充」。
內容骨架：必須包含 #### 一、... 到 #### 十三、... 共 13 段小標。

📌 主題：【${topicName}】
🏢 品牌：${brand}
🛠️ 領域：${domain}
📄 原始內容：${rawText}
`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
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
    console.error("Gemini getTopicDraft error:", error);
    throw error;
  }
}

/**
 * [Task B] 主題卡 AI 自審
 */
export async function performAiAudit(cardData: GenerationResponse): Promise<AuditResponse> {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const prompt = `你是 AI 自審模組。請對主題卡進行檢查並修正。資料：${JSON.stringify(cardData)}`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
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
              }
            }
          },
          required: ["report", "corrected_json"]
        }
      }
    });
    return JSON.parse(response.text?.trim() || "{}");
  } catch (error) {
    console.error("Gemini performAiAudit error:", error);
    throw error;
  }
}

/**
 * [Task C] 教案模板生成 (60/90 雙版本)
 * 為避免 429 錯誤，切換為 gemini-3-flash-preview
 */
export async function generateLessonPlan(params: TopicDraftParams): Promise<GenerationResponse> {
  const { brand, domain, topicName, rawText, topicId = "" } = params;
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const prompt = `
你是 LEADER HQ 總部知識庫助理（v2）。
任務：同一份原文/主題卡，輸出 **60 分鐘版 + 90 分鐘版** 兩份教案。
每份教案必須包含九段結構（#### 一、... 到 #### 九、...）。

📌 硬規格：
1. 第八段：必須剛好 5 個勾選框（- [ ] ...）。
2. 第九段：必須存在（無素材寫「目前尚未設定影像素材」）。
3. lesson_meta_json：必須單獨一行，包含 10 個 Key（brand, domain, tab, topic_id, topic_name, lesson_version, lesson_type, status, media_ids, keyword_policy）。
   - keyword_policy 須含 4 key: allow_empty, ai_autofill_when_empty, max_keywords, source。

📌 主題：【${topicName}】
📄 原始素材：${rawText}
`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
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
    console.error("Gemini generateLessonPlan error:", error);
    throw error;
  }
}

/**
 * [Task D] HQ 審核助理 (內部用語版)
 */
export async function performLessonAudit(content: string, metaJson: string): Promise<any> {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const prompt = `
你是「HQ 審核助理」。你只做檢查與產出審核清單，禁止重寫教案，禁止自行補內容。

【判定邏輯】
1. Hard Fail (❌)：hard_spec 任一 pass=false。
2. Need Fix (🔁)：hard_spec 全過，但 content 任一 pass=false。
3. Pass (✅)：兩區全過。

【檢查清單項目】
A) 可寫入門檻 (hard_spec):
1. 可寫入門檻｜60/90版本與一～九段
2. 可寫入門檻｜第八段完成判準5勾
3. 可寫入門檻｜第九段媒體段合規
4. 可寫入門檻｜現場可帶最低數量
5. 可寫入門檻｜meta單行可parse
6. 可寫入門檻｜meta欄位/值域正確

B) 教務可上線 (content):
1. 教務可上線｜忠於主題卡/原文
2. 教務可上線｜口令可直接念
3. 教務可上線｜流程可上課含安全回復
4. 教務可上線｜品牌語氣一致

【教案全文與 META】
${content}
${metaJson}
`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            result: { type: Type.STRING },
            checklist: {
              type: Type.OBJECT,
              properties: {
                hard_spec: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      item: { type: Type.STRING },
                      pass: { type: Type.BOOLEAN },
                      note: { type: Type.STRING }
                    }
                  }
                },
                content: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      item: { type: Type.STRING },
                      pass: { type: Type.BOOLEAN },
                      note: { type: Type.STRING }
                    }
                  }
                }
              },
              required: ["hard_spec", "content"]
            },
            must_fix: { type: Type.ARRAY, items: { type: Type.STRING } },
            quick_notes: { type: Type.STRING },
            approved_fields: { 
              type: Type.OBJECT,
              properties: {
                approved_by: { type: Type.STRING },
                approved_at: { type: Type.STRING }
              }
            }
          },
          required: ["result", "checklist", "must_fix", "quick_notes", "approved_fields"]
        }
      }
    });
    return JSON.parse(response.text?.trim() || "{}");
  } catch (error) {
    console.error("Gemini performLessonAudit error:", error);
    return { 
      result: "❌", 
      must_fix: ["API 配額限制或連線異常"], 
      quick_notes: "請稍候再試", 
      checklist: { hard_spec: [], content: [] }, 
      approved_fields: {} 
    };
  }
}

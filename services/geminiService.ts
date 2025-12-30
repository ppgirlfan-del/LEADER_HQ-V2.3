
// services/geminiService.ts
import { GoogleGenAI, Type } from "@google/genai";

interface TopicDraftParams {
  brand: string;
  domain: string;
  topicName: string;
  rawText: string;
}

export interface GenerationResponse {
  content: string;
  summary: string;
  keywords: string[];
  meta_json?: string;
}

export interface AuditItem {
  code: string;
  name: string;
  status: 'pass' | 'fail';
  reason: string;
  type: '必過' | '建議';
}

/**
 * 產生「主題知識卡草稿」
 */
export async function getTopicDraft(params: TopicDraftParams): Promise<GenerationResponse> {
  const { brand, domain, topicName, rawText } = params;
  const apiKey = process.env.API_KEY;
  if (!apiKey) throw new Error("API_KEY is missing in environment");

  const ai = new GoogleGenAI({ apiKey });
  
  const prompt = `
🧩 任務設定
你現在在 LEADER HQ 總部知識庫助理（v2） 裡面。
• brand：${brand}
• domain：${domain}
• 模式：新增主題卡（從原文整理）

請幫我把下面內容整理成主題知識卡，主題：【${topicName}】。

📄 原始內容
${rawText}

🧱 格式要求（13 段小標全保留，使用 Markdown ####）
每段標題與內容之間、以及不同段落之間，必須使用「雙換行符號」分隔，確保排版清晰。

一、主題基本資訊
二、主題摘要
三、教學 / 操作目標（內部版）
四、核心觀點：為什麼要這樣做？
五、實務操作要點｜給前線人員的小抄
六、常見錯誤與成因
七、矯正方向與建議作法
八、個別服務 / 1 對 1 小技巧
九、團班 / 活動經營提示
十、給學員端可以理解的說法
十一、延伸 / 關聯主題
十二、內部備註
十三、圖像與媒體標記

🧾 F 欄 meta（單行 JSON）
{"brand":"${brand}","domain":"${domain}","tab":"主題知識卡","topic_name":"【${topicName}】","status":"draft"}

【輸出要求】
回傳 JSON：content (包含清晰換行與 Markdown 標題), summary (30-40字), keywords (3-5個), meta_json (String, 單行)。
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
            content: { type: Type.STRING },
            summary: { type: Type.STRING },
            keywords: { type: Type.ARRAY, items: { type: Type.STRING } },
            meta_json: { type: Type.STRING }
          },
          required: ["content", "summary", "keywords", "meta_json"]
        }
      }
    });
    return JSON.parse(response.text || "{}");
  } catch (error) {
    console.error("[Gemini] Topic Generation Error:", error);
    throw error;
  }
}

/**
 * 產生「教案模板 (60+90分鐘)」
 */
export async function generateLessonPlan(params: TopicDraftParams): Promise<GenerationResponse> {
  const { brand, domain, topicName, rawText } = params;
  const apiKey = process.env.API_KEY;
  if (!apiKey) throw new Error("API_KEY is missing in environment");

  const ai = new GoogleGenAI({ apiKey });

  const prompt = `
你現在在 LEADER HQ 總部知識庫助理（v2）裡面。
任務：將主題知識卡【${topicName}】轉換為教案模板（含 60 分鐘與 90 分鐘版）。

📄 輸入內容：
${rawText}

---

### A) 教案輸出模板（固定骨架）
請產出同一份內容，內含 60 分鐘與 90 分鐘兩份教案。
重要：每個標題（####）前必須有雙換行，內容段落之間也必須有換行。禁止所有文字黏在一起。

#### 一、主題基本資訊
#### 二、課程摘要
#### 三、教學目標（可檢核）
#### 四、課程流程（時間切分）
#### 五、教練口令與引導語
#### 六、常見錯誤與矯正
#### 七、課後作業
#### 八、本堂課完成判準（5 勾）
#### 九、圖像與媒體素材

---

### B) lesson_meta_json 硬規格（單行 JSON）
必須包含正確的 meta 資料。

【輸出要求】
請回傳 JSON：content (字串格式，請確保章節標題使用 #### 並有明顯換行分隔), summary, keywords (Array), meta_json (單行 JSON 字串)。
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
            content: { type: Type.STRING },
            summary: { type: Type.STRING },
            keywords: { type: Type.ARRAY, items: { type: Type.STRING } },
            meta_json: { type: Type.STRING }
          },
          required: ["content", "summary", "keywords", "meta_json"]
        }
      }
    });
    return JSON.parse(response.text || "{}");
  } catch (error) {
    console.error("[Gemini] Lesson Generation Error:", error);
    throw error;
  }
}

/**
 * 針對教案進行 R01-R08 AI 自審
 */
export async function performLessonAudit(content: string, metaJson: string): Promise<AuditItem[]> {
  const apiKey = process.env.API_KEY;
  if (!apiKey) return [];
  const ai = new GoogleGenAI({ apiKey });
  
  const prompt = `針對以下教案內容與 meta_json 進行 R01-R08 審核：\n\n內容：${content}\n\nMeta:${metaJson}`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              code: { type: Type.STRING },
              name: { type: Type.STRING },
              status: { type: Type.STRING },
              reason: { type: Type.STRING },
              type: { type: Type.STRING }
            },
            required: ["code", "name", "status", "reason", "type"]
          }
        }
      }
    });
    return JSON.parse(response.text || "[]");
  } catch (error) { return []; }
}

/**
 * 針對知識卡進行 R01-R08 AI 自審
 */
export async function performAiAudit(content: string, brand: string, domain: string): Promise<AuditItem[]> {
  const apiKey = process.env.API_KEY;
  if (!apiKey) return [];
  const ai = new GoogleGenAI({ apiKey });
  const prompt = `針對主題知識卡進行 R01-R08 審核：\n${content}`;
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              code: { type: Type.STRING },
              name: { type: Type.STRING },
              status: { type: Type.STRING },
              reason: { type: Type.STRING },
              type: { type: Type.STRING }
            },
            required: ["code", "name", "status", "reason", "type"]
          }
        }
      }
    });
    return JSON.parse(response.text || "[]");
  } catch (error) { return []; }
}

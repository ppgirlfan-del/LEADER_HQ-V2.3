
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
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
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
回傳 JSON：content, summary (30-40字), keywords (3-5個), meta_json (String, 單行)。
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
    console.error(error);
    return { content: rawText, summary: "", keywords: [] };
  }
}

/**
 * 產生「教案模板 (60+90分鐘)」
 * 遵循 v2 規格：9 段骨架 + 10 Key meta_json
 */
export async function generateLessonPlan(params: TopicDraftParams): Promise<GenerationResponse> {
  const { brand, domain, topicName, rawText } = params;
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  // 轉換 brand/domain 為小寫代碼
  const brandCode = brand.toLowerCase().includes('yys') ? 'yys' : 'leader';
  const domainCode = domain.toLowerCase().split(' ')[0] || 'swimming';

  const prompt = `
你現在在 LEADER HQ 總部知識庫助理（v2）裡面。
任務：將主題知識卡【${topicName}】轉換為教案模板（含 60 分鐘與 90 分鐘版）。

📄 輸入內容：
${rawText}

---

### A) 教案輸出模板（固定骨架）
請產出同一份內容，內含 60 分鐘與 90 分鐘兩份教案。每份教案必須嚴格遵守以下九段標題編號：

#### 一、主題基本資訊
#### 二、課程摘要
#### 三、教學目標（可檢核）
#### 四、課程流程（時間切分）
#### 五、教練口令與引導語（現場可直接念）
#### 六、常見錯誤與矯正
#### 七、課後作業（回家功課）
#### 八、本堂課完成判準（5 勾）
* 必須包含 5 個 - [ ] 格式。
#### 九、圖像與媒體素材
* 若無則寫「目前尚未設定圖像素材，可日後補充。」，禁止出現 file_url。

---

### B) lesson_meta_json 硬規格（單行 JSON）
必須包含以下 10 個 key，不可多不可少：
1. brand (固定為 "${brandCode}")
2. domain (固定為 "${domainCode}")
3. tab (固定為 "教案")
4. topic_id (請生成一個 ID，如 "${brandCode.toUpperCase()}-TOPIC-001")
5. topic_name (主題卡名稱原樣)
6. lesson_version (固定為 "60+90")
7. lesson_type (依內容判斷，如 "60分鐘讓你體驗")
8. status (固定為 "draft")
9. media_ids (陣列，無則 [])
10. keyword_policy (固定物件結構：allow_empty(bool), ai_autofill_when_empty(bool), max_keywords(int), source(string))

【輸出要求】
請回傳 JSON：content (包含 60 與 90 分鐘兩套完整的九段教案), summary (30字摘要), keywords (Array), meta_json (單行 JSON 字串)。
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
    console.error(error);
    return { content: "教案生成失敗", summary: "", keywords: [] };
  }
}

/**
 * 針對教案進行 R01-R08 AI 自審 (專用規則)
 */
export async function performLessonAudit(content: string, metaJson: string): Promise<AuditItem[]> {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const prompt = `
你現在是 LEADER HQ 總部品質審核員。請針對以下「教案內容」與「meta_json」進行 R01-R08 品質審核。

教案內容：
${content}

meta_json:
${metaJson}

## 自審規則 (R01-R08) - 僅適用於教案
R01 結構完整性：必須包含「一～九」段完整小標，且第八段有 5 勾清單，第九段必須存在。
R02 忠於原文：不得新增原文未出現的數據或建議。不足請填「目前內文資料不足」。
R03 可執行性：第四段流程需有時間切分，第五段至少 3 句口令，第六段至少 2 條矯正。
R04 用語一致：術語需與主題卡一致。
R05 欄位不混寫：正文不含 JSON，meta_json 必須為單行且可 parse。
R06 完成判準格式：第八段必須是「精確 5 個」checkbox 格式 (- [ ] ...)。
R07 媒體段格式：第九段僅允許 media_id / relates_to / caption / alt_text / key_point，禁止 file_url。
R08 meta_json 硬規格：必須「精確包含 10 個 key」：brand, domain, tab, topic_id, topic_name, lesson_version, lesson_type, status, media_ids, keyword_policy。

回傳 JSON 陣列，物件包含：code (R01-R08), name, status (pass/fail), reason, type (必過/建議)。
`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-pro-preview",
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
  } catch (error) {
    console.error(error);
    return [];
  }
}

/**
 * 針對知識卡進行 R01-R08 AI 自審
 */
export async function performAiAudit(content: string, brand: string, domain: string): Promise<AuditItem[]> {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const prompt = `
你現在是 LEADER HQ 總部品質審核員。請針對以下「主題知識卡」進行 R01-R08 品質審核。
內容：
${content}

## 自審規則 (R01-R08) - 僅適用於知識卡
R01 結構完整性：必須包含「一～十三」段完整小標。
R02 忠於原文：不得腦補。
R03 可執行性：第五段至少 3 條操作要點。
R04 用語一致：符合品牌調性。
R05 欄位不混寫：正文不含 JSON。
R06-R08：檢查格式與標籤邏輯。

回傳 JSON 陣列。
`;
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-pro-preview",
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

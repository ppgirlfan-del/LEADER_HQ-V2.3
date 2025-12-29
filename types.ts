
export enum ToolType {
  KNOWLEDGE_CARD = 'KNOWLEDGE_CARD',
  LESSON_PLAN = 'LESSON_PLAN',
  FEEDBACK = 'FEEDBACK',
  SKILL_TIP = 'SKILL_TIP',
  CARD_FINDER = 'CARD_FINDER'
}

export interface SearchEvidence {
  sheet_id: string;
  tab_name: string;
  range: string;
  rows_returned: number;
  query_used: string;
  timestamp: string;
}

export interface FinderResult {
  id: string;
  topic_name: string;
  status: string;
  brand: string;
  domain: string;
  content?: string;
  summary?: string;
  keywords?: string[];
  meta_json?: string; // 新增此欄位以對應 H 欄
  updated_at?: string;
  raw_row?: string[]; 
}

export interface FinderResponse {
  results: FinderResult[];
  evidence: SearchEvidence;
  total_count: number;
}

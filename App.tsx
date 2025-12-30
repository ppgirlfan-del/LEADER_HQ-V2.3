
import React, { useState, useEffect, useMemo } from 'react';
import { getTopicDraft, generateLessonPlan, performAiAudit, performLessonAudit, AuditItem } from './services/geminiService.ts';
import { queryCards, appendCard } from './services/googleSheetService.ts';
import { FinderResult, ToolType } from './types.ts';

type MainTabId = 'finder' | 'creator';
type CreatorTool = 'KNOWLEDGE_CARD' | 'LESSON_PLAN';

const DOMAINS = ['游泳 (Swimming)', '鐵人三項 (Triathlon)', '體能 (Fitness)', '行銷經營 (Marketing)', '教育訓練 (Training)'];

// 教案專用審查定義
const LESSON_HQ_GROUPS = {
  A: { title: "A. 結構與欄位完整", items: ["A1 章節齊（含第8五勾＋第9媒體）", "A2 meta_json key 正確（必勾）", "A3 步驟清楚可照做", "A4 用語是教練教材", "A5 欄位可正確落庫（必勾）"], codes: ["A1", "A2", "A3", "A4", "A5"] },
  B: { title: "B. 忠於原文／不補腦", items: ["B1 不加戲（無原文就不寫）", "B2 不足有寫「目前內文資料不足…」", "B3 不杜撰器材/場地/流程", "B4 名詞/章節名與原文一致", "B5 不虛構圖像內容"], codes: ["B1", "B2", "B3", "B4", "B5"] },
  C: { title: "C. 可上課與可操作", items: ["C1 有口令/提醒語", "C2 有觀察/檢核點", "C3 60/90 分鐘能跑完（合理）", "C4 錯誤→矯正有對應且可做", "C5 有安全/風險提醒"], codes: ["C1", "C2", "C3", "C4", "C5"] },
  D: { title: "D. 第八段「完成判準」品質", items: ["D1 五勾都可觀察/可勾", "D2 用語不模糊", "D3 與本堂課主題一致", "D4 能判定完成/未完成", "D5 不新增原文沒有的標準"], codes: ["D1", "D2", "D3", "D4", "D5"] },
  E: { title: "E. 資料落庫與檢索一致", items: ["E1 keywords 寫入正確（必勾）", "E2 summary 有值且可用", "E3 meta_json 單行可 parse", "E4 id/topic/brand/domain 一致", "E5 可回寫 approved_by（必勾）"], codes: ["E1", "E2", "E3", "E4", "E5"] }
};

export default function App() {
  const [activeTab, setActiveTab] = useState<MainTabId>('finder');
  const [creatorTool, setCreatorTool] = useState<CreatorTool>('KNOWLEDGE_CARD');

  // 連線檢查
  const [isConfigured, setIsConfigured] = useState(false);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [tempUrlInput, setTempUrlInput] = useState('');

  useEffect(() => {
    const checkConfig = () => {
      const hasEnv = !!(typeof process !== 'undefined' && process.env?.APPS_SCRIPT_URL);
      const hasSession = !!window.sessionStorage.getItem('OVER_APPS_SCRIPT_URL');
      setIsConfigured(hasEnv || hasSession);
    };
    checkConfig();
    const interval = setInterval(checkConfig, 2000);
    return () => clearInterval(interval);
  }, []);

  const saveConfig = () => {
    if (tempUrlInput.startsWith('https://script.google.com')) {
      window.sessionStorage.setItem('OVER_APPS_SCRIPT_URL', tempUrlInput);
      setShowConfigModal(false);
      alert('連線設定已儲存！');
    } else {
      alert('請輸入有效的 Google Apps Script 網址');
    }
  };

  // 狀態管理
  const [selectedBrand, setSelectedBrand] = useState('YYS｜燿宇的游泳學校');
  const [selectedDomain, setSelectedDomain] = useState('游泳 (Swimming)');
  const [localCards, setLocalCards] = useState<FinderResult[]>([]);
  const [topicNameInput, setTopicNameInput] = useState('');
  const [inputText, setInputText] = useState('');
  const [currentId, setCurrentId] = useState<string>(''); 
  
  // 編輯模式專用狀態
  const [isEditingGenerated, setIsEditingGenerated] = useState(false);
  const [editFields, setEditFields] = useState({
    topic_name: '',
    summary: '',
    keywords: '',
    content: '',
    meta_json: ''
  });

  // 詳情/編輯狀態
  const [selectedCard, setSelectedCard] = useState<FinderResult | null>(null);
  const [showHqModal, setShowHqModal] = useState(false);
  const [hqCardId, setHqCardId] = useState<string>('');
  const [hqChecks, setHqChecks] = useState<Record<string, boolean>>({});

  // 查詢
  const [searchQuery, setSearchQuery] = useState('');
  const [sheetResults, setSheetResults] = useState<FinderResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSavingToSheet, setIsSavingToSheet] = useState(false);

  // AI 自審
  const [isAuditing, setIsAuditing] = useState(false);
  const [auditResults, setAuditResults] = useState<AuditItem[]>([]);

  // 當開啟 HQ Modal 時初始化勾選
  useEffect(() => {
    if (showHqModal) {
      if (creatorTool === 'LESSON_PLAN') {
        setHqChecks({ A2: true, A5: true, E1: true, E5: true });
      } else {
        setHqChecks({ R01: false, R02: false, R03: false, R04: false, R05: false, R06: false, R07: false, R08: false });
      }
    }
  }, [showHqModal, creatorTool]);

  const isLessonHqPassed = useMemo(() => {
    if (creatorTool !== 'LESSON_PLAN') return false;
    const mustPass = ["A2", "A5", "E1", "E5"].every(code => hqChecks[code]);
    if (!mustPass) return false;
    const groups = Object.keys(LESSON_HQ_GROUPS) as Array<keyof typeof LESSON_HQ_GROUPS>;
    return groups.every(gKey => LESSON_HQ_GROUPS[gKey].codes.filter(c => hqChecks[c]).length >= 3);
  }, [hqChecks, creatorTool]);

  const isKnowledgeCardHqPassed = useMemo(() => {
    if (creatorTool !== 'KNOWLEDGE_CARD') return false;
    return ["R01", "R02", "R03", "R04", "R05", "R06", "R07", "R08"].every(c => hqChecks[c]);
  }, [hqChecks, creatorTool]);

  const displayResults = useMemo(() => {
    const filteredLocal = localCards.filter(c => 
      c.brand === selectedBrand && 
      c.domain === selectedDomain &&
      (searchQuery ? (c.topic_name.toLowerCase().includes(searchQuery.toLowerCase()) || (c.id && c.id.toLowerCase().includes(searchQuery.toLowerCase()))) : true)
    );
    const cloudIds = new Set(filteredLocal.map(l => l.id));
    const filteredCloud = sheetResults.filter(s => !cloudIds.has(s.id));
    return [...filteredLocal, ...filteredCloud];
  }, [localCards, sheetResults, selectedBrand, selectedDomain, searchQuery]);

  const handleFinderSearch = async () => {
    if (!isConfigured) return;
    setIsLoading(true);
    try {
      const resp = await queryCards({
        // 修正：統一搜尋目標分頁名稱為「教案模板」
        source: (creatorTool === 'LESSON_PLAN' || activeTab === 'creator') ? '教案模板' : '主題知識卡',
        brand: selectedBrand, domain: selectedDomain, input: searchQuery
      });
      setSheetResults(resp.results);
    } catch (e) { console.error(e); } finally { setIsLoading(false); }
  };

  useEffect(() => { if (isConfigured) handleFinderSearch(); }, [selectedBrand, selectedDomain, isConfigured]);

  const updateLocalCard = (id: string, cardData: Partial<FinderResult>) => {
    setLocalCards(prev => {
      const index = prev.findIndex(c => c.id === id);
      if (index > -1) {
        const next = [...prev];
        next[index] = { ...next[index], ...cardData };
        return next;
      }
      const fromCloud = sheetResults.find(s => s.id === id);
      if (fromCloud) return [{ ...fromCloud, ...cardData }, ...prev];
      return prev;
    });
    if (selectedCard?.id === id) { setSelectedCard(prev => prev ? ({ ...prev, ...cardData }) : null); }
  };

  const handleGenerate = async () => {
    if (!topicNameInput.trim() || !inputText.trim()) { alert('請填寫完整資訊。'); return; }
    setIsLoading(true);
    setAuditResults([]);
    setIsEditingGenerated(false);
    try {
      let res;
      if (creatorTool === 'KNOWLEDGE_CARD') {
        res = await getTopicDraft({ brand: selectedBrand, domain: selectedDomain, topicName: topicNameInput, rawText: inputText });
      } else {
        res = await generateLessonPlan({ brand: selectedBrand, domain: selectedDomain, topicName: topicNameInput, rawText: inputText });
      }
      const brandCode = selectedBrand.split('｜')[0].trim();
      const tempId = `${brandCode}-${Math.floor(Math.random() * 900000 + 100000)}`;
      setCurrentId(tempId);
      const newCard: FinderResult = {
        id: tempId, topic_name: topicNameInput, brand: selectedBrand, domain: selectedDomain,
        content: res.content, summary: res.summary || "", keywords: res.keywords || [],
        meta_json: res.meta_json, status: '草稿'
      };
      setLocalCards(prev => [newCard, ...prev]);
    } catch (e: any) { 
      console.error(e);
      alert(`🤖 生成失敗：\n${e?.message || 'Gemini API 暫時無法回應，請檢查 API Key 權限或稍後再試。'}`); 
    } finally { setIsLoading(false); }
  };

  const handleAudit = async () => {
    const card = localCards.find(c => c.id === currentId);
    if (!card || !card.content) return;
    setIsAuditing(true);
    try {
      let results = creatorTool === 'LESSON_PLAN' 
        ? await performLessonAudit(card.content, card.meta_json || '')
        : await performAiAudit(card.content, selectedBrand, selectedDomain);
      setAuditResults(results);
    } catch (e) { alert('審核失敗'); } finally { setIsAuditing(false); }
  };

  const toggleEditMode = () => {
    const card = localCards.find(c => c.id === currentId);
    if (!card) return;
    if (isEditingGenerated) {
      updateLocalCard(currentId, { 
        topic_name: editFields.topic_name, summary: editFields.summary,
        keywords: editFields.keywords.split(',').map(k => k.trim()).filter(k => k),
        content: editFields.content, meta_json: editFields.meta_json
      });
      setIsEditingGenerated(false);
    } else {
      setEditFields({
        topic_name: card.topic_name, summary: card.summary || "",
        keywords: Array.isArray(card.keywords) ? card.keywords.join(', ') : (card.keywords || ""),
        content: card.content || '', meta_json: card.meta_json || ''
      });
      setIsEditingGenerated(true);
    }
  };

  const finalizeHqReview = async () => {
    const cardId = hqCardId || currentId;
    const card = localCards.find(c => c.id === cardId);
    if (!card) { alert('找不到對應資料'); return; }
    
    setIsSavingToSheet(true);
    try {
      // 修正：寫入目標分頁名稱統一改為「教案模板」
      const tabName = creatorTool === 'LESSON_PLAN' ? '教案模板' : '主題知識卡';
      const result = await appendCard({
        ...card, 
        tab: tabName, 
        status: '已審定',
        approved_by: "HQ-ASSISTANT-V2", 
        approved_at: new Date().toISOString()
      });

      if (result.result === "success") {
        updateLocalCard(card.id, { status: '已審定' });
        alert(`✅ ${tabName} 審定完成並成功寫入雲端資料庫！`);
        setShowHqModal(false);
      } else {
        throw new Error(result.message || "發送失敗，雲端資料庫未回應。");
      }
    } catch (e) { 
      console.error(e);
      alert(`❌ 寫入失敗\n原因：${e instanceof Error ? e.message : '連線異常，請確認雲端網址與網路狀態。'}`); 
    } finally {
      setIsSavingToSheet(false);
    }
  };

  const currentCardForOutput = useMemo(() => localCards.find(c => c.id === currentId), [localCards, currentId]);

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900 font-sans">
      
      {/* 詳情彈窗 */}
      {selectedCard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" onClick={() => setSelectedCard(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="p-6 border-b bg-slate-50 flex flex-col gap-4">
              <div className="flex justify-between items-start">
                <div>
                  <div className="flex items-center gap-3">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${selectedCard.status === '已審定' ? 'bg-green-100 text-green-800' : 'bg-slate-200 text-slate-600'}`}>{selectedCard.status}</span>
                    <span className="text-xs text-slate-400 font-mono">{selectedCard.id}</span>
                  </div>
                  <h2 className="text-2xl font-bold mt-1">{selectedCard.topic_name}</h2>
                </div>
                <button onClick={() => setSelectedCard(null)} className="text-slate-400 hover:text-slate-600 text-2xl">✕</button>
              </div>
              <div className="flex flex-col gap-3">
                {selectedCard.summary && (
                  <div className="p-3 bg-blue-50/50 border border-blue-100 rounded-xl text-xs italic text-slate-600">
                    <span className="font-bold text-blue-600 not-italic mr-2">摘要：</span>{selectedCard.summary}
                  </div>
                )}
                {selectedCard.keywords && selectedCard.keywords.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {selectedCard.keywords.map(k => (
                      <span key={k} className="px-2 py-0.5 bg-slate-100 text-slate-500 rounded text-[10px] font-bold">#{k}</span>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <button 
                  onClick={() => {
                    setCreatorTool('LESSON_PLAN');
                    setActiveTab('creator');
                    setTopicNameInput(selectedCard.topic_name);
                    setInputText(selectedCard.content || '');
                    setSelectedCard(null);
                  }}
                  className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-bold shadow-lg">🚀 生成教案</button>
                <button disabled={selectedCard.status === '已審定'} onClick={() => { setHqCardId(selectedCard.id); setShowHqModal(true); }} className="px-4 py-2 border rounded-xl text-sm font-bold hover:bg-slate-50">🛡️ 總部審核</button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-8 text-sm leading-relaxed whitespace-pre-wrap text-slate-900">
              {selectedCard.content}
              {selectedCard.meta_json && (
                <div className="mt-10 p-4 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                  <div className="text-[10px] font-bold text-slate-400 uppercase mb-2">Meta JSON</div>
                  <div className="font-mono text-[11px] text-slate-500 break-all">{selectedCard.meta_json}</div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 側邊欄 */}
      <aside className="w-[280px] bg-slate-900 text-white p-6 flex flex-col gap-6 fixed h-full z-40 shadow-2xl">
        <div className="mb-4">
          <div className="text-xl font-bold">LEADER HQ <span className="text-blue-500">v2</span></div>
          <div className="text-[10px] opacity-40 uppercase tracking-widest font-bold">總部知識開發系統</div>
        </div>
        <div className="flex flex-col gap-1">
          <button onClick={() => setActiveTab('finder')} className={`text-left p-3 rounded-xl text-sm transition-all ${activeTab === 'finder' ? 'bg-blue-600 text-white font-bold shadow-lg' : 'text-slate-400 hover:bg-slate-800'}`}>🔍 查卡助手</button>
          <div className="mt-4 text-[10px] font-bold text-slate-500 mb-2 tracking-widest uppercase px-3">生卡模組</div>
          <button onClick={() => { setActiveTab('creator'); setCreatorTool('KNOWLEDGE_CARD'); }} className={`text-left p-3 rounded-xl text-sm transition-all ${activeTab === 'creator' && creatorTool === 'KNOWLEDGE_CARD' ? 'bg-blue-600 text-white font-bold' : 'text-slate-400 hover:bg-slate-800'}`}>🧩 主題知識卡</button>
          <button onClick={() => { setActiveTab('creator'); setCreatorTool('LESSON_PLAN'); }} className={`text-left p-3 rounded-xl text-sm transition-all ${activeTab === 'creator' && creatorTool === 'LESSON_PLAN' ? 'bg-blue-600 text-white font-bold' : 'text-slate-400 hover:bg-slate-800'}`}>📅 教案模板 (60/90)</button>
        </div>
        <div className="mt-auto pt-6 border-t border-slate-800 flex flex-col gap-3">
          <select value={selectedBrand} onChange={(e) => setSelectedBrand(e.target.value)} className="w-full p-2.5 bg-slate-800 text-white border-none rounded-xl text-xs outline-none">
            <option>YYS｜燿宇的游泳學校</option>
            <option>LEADER 鐵人</option>
          </select>
          <select value={selectedDomain} onChange={(e) => setSelectedDomain(e.target.value)} className="w-full p-2.5 bg-slate-800 text-white border-none rounded-xl text-xs outline-none">
            {DOMAINS.map(d => <option key={d}>{d}</option>)}
          </select>
          <button onClick={() => setShowConfigModal(true)} className={`flex items-center gap-3 w-full p-3 rounded-xl text-[10px] font-bold transition-all ${isConfigured ? 'bg-slate-800 text-green-400 border border-slate-700' : 'bg-red-500/20 text-red-400 border border-red-500/30 animate-pulse'}`}>
            <div className={`w-1.5 h-1.5 rounded-full ${isConfigured ? 'bg-green-400' : 'bg-red-400'}`}></div>
            {isConfigured ? '雲端已連線' : '未連線 (請設定)'}
          </button>
        </div>
      </aside>

      <main className="flex-1 ml-[280px] p-10 overflow-y-auto min-h-screen">
        <header className="mb-10 flex justify-between items-center">
          <h1 className="text-3xl font-bold text-slate-900">{activeTab === 'finder' ? '查卡助手' : (creatorTool === 'KNOWLEDGE_CARD' ? '知識卡生成' : '教案生成')}</h1>
        </header>

        {activeTab === 'finder' ? (
          <div className="bg-white rounded-[2rem] p-8 shadow-sm border border-slate-100">
            <div className="flex gap-4 mb-8">
              <input type="text" placeholder="搜尋主題名稱或 ID..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleFinderSearch()} className="flex-1 p-4 bg-slate-100 rounded-2xl text-sm outline-none border-2 border-transparent focus:border-blue-500 transition-all" />
              <button onClick={handleFinderSearch} className="px-8 bg-slate-900 text-white font-bold rounded-2xl hover:bg-slate-800 transition-colors">搜尋</button>
            </div>
            <div className="overflow-hidden rounded-xl border border-slate-50">
              <table className="w-full text-left text-sm border-collapse">
                <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-100">
                  <tr><th className="py-4 px-6">ID</th><th className="py-4 px-6">主題名稱</th><th className="py-4 px-6">狀態</th></tr>
                </thead>
                <tbody className="text-slate-900">
                  {displayResults.map(res => (
                    <tr key={res.id} onClick={() => setSelectedCard(res)} className="border-b border-slate-50 hover:bg-blue-50/50 cursor-pointer transition-colors group">
                      <td className="py-5 px-6 font-mono text-blue-600 font-bold">{res.id}</td>
                      <td className="py-5 px-6 font-bold group-hover:text-blue-700">{res.topic_name}</td>
                      <td className="py-5 px-6"><span className={`px-2 py-1 rounded-full text-[10px] font-bold ${res.status === '已審定' ? 'bg-green-100 text-green-700' : 'bg-slate-200 text-slate-600'}`}>{res.status}</span></td>
                    </tr>
                  ))}
                  {displayResults.length === 0 && !isLoading && <tr><td colSpan={3} className="py-10 text-center text-slate-400 italic">無匹配資料</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-8 h-[calc(100vh-200px)]">
            <div className="flex flex-col gap-6">
              <div className="flex flex-col gap-2">
                <label className="text-[10px] font-bold text-slate-400 uppercase px-1">主題名稱</label>
                <input type="text" value={topicNameInput} onChange={(e) => setTopicNameInput(e.target.value)} className="p-4 bg-white border border-slate-200 rounded-2xl font-bold shadow-sm outline-none focus:ring-2 focus:ring-blue-500" placeholder="例如：自由式基礎 - 漂浮..." />
              </div>
              <div className="flex-1 flex flex-col gap-2">
                <label className="text-[10px] font-bold text-slate-400 uppercase px-1">原始素材內容</label>
                <textarea value={inputText} onChange={(e) => setInputText(e.target.value)} className="flex-1 p-6 bg-white border border-slate-200 rounded-[2rem] shadow-sm resize-none outline-none leading-relaxed focus:ring-2 focus:ring-blue-500" placeholder="請貼上內容..." />
              </div>
              <button onClick={handleGenerate} disabled={isLoading} className="py-4 bg-blue-600 text-white font-bold rounded-2xl shadow-xl disabled:opacity-50 transition-all active:scale-[0.98]">
                {isLoading ? '🤖 AI 正在構思中...' : (creatorTool === 'LESSON_PLAN' ? '✨ 生成教案內容' : '✨ 整理為主題知識卡')}
              </button>
            </div>
            <div className="flex flex-col h-full overflow-hidden">
                {currentCardForOutput ? (
                    <div className="flex flex-col h-full">
                        <div className="mb-4 flex justify-between items-center">
                          <span className="text-[10px] font-bold text-slate-400 uppercase">生成結果預覽</span>
                          <div className="flex gap-2">
                             <button onClick={handleAudit} disabled={isAuditing} className="px-4 py-1.5 bg-slate-800 text-white rounded-lg text-xs font-bold hover:bg-slate-700 transition-colors">{isAuditing ? '⌛ 審核中...' : '📋 AI 自審'}</button>
                             <button onClick={toggleEditMode} className={`px-4 py-1.5 border rounded-lg text-xs font-bold transition-colors ${isEditingGenerated ? 'bg-orange-500 text-white border-orange-500 shadow-lg shadow-orange-500/20' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>{isEditingGenerated ? '💾 儲存修改' : '✎ 編輯'}</button>
                             <button onClick={() => { setHqCardId(''); setShowHqModal(true); }} className="px-4 py-1.5 bg-green-600 text-white rounded-lg text-xs font-bold shadow-lg hover:bg-green-700 transition-all">🛡️ 總部審核儲存</button>
                          </div>
                        </div>
                        <div className="flex-1 p-8 rounded-[2rem] bg-white border border-slate-200 shadow-inner overflow-y-auto text-sm text-slate-900 leading-relaxed">
                           {isEditingGenerated ? (
                             <div className="flex flex-col gap-6">
                               <div className="grid grid-cols-1 gap-4">
                                 <div><label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">主題名稱</label><input type="text" value={editFields.topic_name} onChange={(e) => setEditFields({...editFields, topic_name: e.target.value})} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-bold" /></div>
                                 <div><label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">核心摘要</label><input type="text" value={editFields.summary} onChange={(e) => setEditFields({...editFields, summary: e.target.value})} className="w-full p-3 bg-blue-50/50 border border-blue-100 rounded-xl text-sm italic" /></div>
                                 <div><label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">關鍵字標籤</label><input type="text" value={editFields.keywords} onChange={(e) => setEditFields({...editFields, keywords: e.target.value})} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs" /></div>
                                 <div><label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block text-blue-600">Meta JSON</label><input type="text" value={editFields.meta_json} onChange={(e) => setEditFields({...editFields, meta_json: e.target.value})} className="w-full p-3 bg-slate-100 border border-slate-200 rounded-xl text-[10px] font-mono" /></div>
                                 <div><label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">正文內容</label><textarea value={editFields.content} onChange={(e) => setEditFields({...editFields, content: e.target.value})} className="w-full h-[450px] p-4 bg-white border border-slate-200 rounded-xl text-sm outline-none resize-none leading-relaxed" /></div>
                               </div>
                             </div>
                           ) : (
                             <>
                               <div className="mb-8 flex flex-col gap-4">
                                  {currentCardForOutput.summary && (<div className="p-5 bg-blue-50/50 border border-blue-100 rounded-2xl relative shadow-sm"><div className="absolute top-[-8px] left-4 bg-blue-600 text-white text-[9px] font-bold px-2 py-0.5 rounded">AI 核心摘要</div><p className="text-xs text-slate-600 italic">"{currentCardForOutput.summary}"</p></div>)}
                                  {currentCardForOutput.keywords && currentCardForOutput.keywords.length > 0 && (<div className="flex flex-wrap gap-2">{currentCardForOutput.keywords.map(k => (<span key={k} className="px-3 py-1 bg-slate-900 text-white rounded-full text-[10px] font-bold shadow-sm">#{k}</span>))}</div>)}
                               </div>
                               
                               {/* AI 自審報告完整顯示 */}
                               {auditResults.length > 0 && (
                                 <div className="mb-8 p-5 bg-blue-50/50 rounded-2xl border border-blue-100 shadow-sm">
                                   <div className="text-[10px] font-bold text-blue-600 uppercase mb-4 tracking-widest flex justify-between items-center px-1">
                                     <span>AI 自審報告</span>
                                     <button onClick={() => setAuditResults([])} className="text-blue-400 hover:text-blue-600 transition-colors">✕</button>
                                   </div>
                                   <div className="flex flex-col gap-3">
                                     {auditResults.map((r, i) => (
                                       <div key={i} className="text-xs flex items-start gap-3 p-2 rounded-xl bg-white/60 border border-white transition-all hover:shadow-md hover:scale-[1.01]">
                                         <span className={`px-2 py-1 rounded-lg font-bold shrink-0 min-w-[50px] text-center shadow-sm ${r.status === 'pass' ? 'bg-green-500 text-white' : 'bg-red-500 text-white'}`}>
                                           {r.code} {r.status === 'pass' ? '✔' : '✘'}
                                         </span>
                                         <div className="flex-1">
                                           <div className={`font-bold ${r.status === 'pass' ? 'text-slate-800' : 'text-red-600'}`}>{r.name}</div>
                                           {r.reason && (
                                             <p className="text-slate-500 mt-1 leading-relaxed text-[10px] font-normal italic">
                                               {r.reason}
                                             </p>
                                           )}
                                         </div>
                                       </div>
                                     ))}
                                   </div>
                                 </div>
                               )}

                               <div className="whitespace-pre-wrap">{currentCardForOutput.content}</div>
                               {currentCardForOutput.meta_json && (<div className="mt-10 p-4 bg-slate-50 rounded-xl border border-dashed border-slate-200"><div className="text-[10px] font-bold text-slate-400 uppercase mb-2 px-1">Meta JSON</div><div className="font-mono text-[11px] text-slate-500 break-all leading-normal">{currentCardForOutput.meta_json}</div></div>)}
                             </>
                           )}
                        </div>
                    </div>
                ) : (
                    <div className="h-full flex flex-col items-center justify-center text-slate-300 border-2 border-dashed border-slate-200 rounded-[2rem] bg-white/50"><div className="text-5xl mb-4 opacity-50">🪄</div><p className="text-sm font-medium">填寫左側資訊並點擊生成</p></div>
                )}
            </div>
          </div>
        )}

        {/* 設定彈窗 */}
        {showConfigModal && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-md">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8 text-black">
              <h3 className="text-xl font-bold mb-2 text-slate-900">⚙️ 連線設定</h3>
              <p className="text-sm text-slate-500 mb-6">請輸入 Google Apps Script 佈署網址以連線總部資料庫。</p>
              <input type="text" placeholder="https://script.google.com/macros/s/..." className="w-full p-4 bg-slate-100 rounded-xl mb-6 text-sm font-mono" value={tempUrlInput} onChange={(e) => setTempUrlInput(e.target.value)} />
              <div className="flex gap-3">
                <button onClick={() => setShowConfigModal(false)} className="flex-1 py-3 bg-slate-100 rounded-xl font-bold">取消</button>
                <button onClick={saveConfig} className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-bold">確認儲存</button>
              </div>
            </div>
          </div>
        )}

        {/* 總部審核面板 */}
        {showHqModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-md">
            <div className={`bg-white rounded-2xl shadow-2xl w-full ${creatorTool === 'LESSON_PLAN' ? 'max-w-4xl' : 'max-w-md'} p-6 flex flex-col max-h-[90vh]`}>
              <div className="mb-4">
                <h3 className="text-xl font-bold text-slate-900 flex items-center gap-2">🛡️ 總部審核面板 {creatorTool === 'LESSON_PLAN' && <span className="text-xs bg-blue-100 text-blue-600 px-2 py-0.5 rounded">教案模組</span>}</h3>
                <p className="text-xs text-slate-500 mt-1">{creatorTool === 'LESSON_PLAN' ? '符合「硬門檻」且各組勾選 3 項以上方可核准發布。' : '請勾選確認符合規範。'}</p>
              </div>
              <div className="flex-1 overflow-y-auto pr-2">
                {creatorTool === 'LESSON_PLAN' ? (
                  <div className="grid grid-cols-2 gap-6 mb-6">
                    {(Object.keys(LESSON_HQ_GROUPS) as Array<keyof typeof LESSON_HQ_GROUPS>).map(gKey => {
                      const group = LESSON_HQ_GROUPS[gKey];
                      const checkedCount = group.codes.filter(c => hqChecks[c]).length;
                      return (
                        <div key={gKey} className={`p-4 rounded-2xl border-2 transition-all ${checkedCount >= 3 ? 'border-green-100 bg-green-50/20' : 'border-slate-100 bg-slate-50/50'}`}>
                          <div className="flex justify-between items-center mb-3">
                            <span className="text-sm font-bold text-slate-800">{group.title}</span>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${checkedCount >= 3 ? 'bg-green-500 text-white' : 'bg-slate-200'}`}>{checkedCount} / 5</span>
                          </div>
                          <div className="flex flex-col gap-2">
                            {group.codes.map((code, idx) => {
                              const isMust = ["A2", "A5", "E1", "E5"].includes(code);
                              return (
                                <label key={code} className="flex items-start gap-3 p-2 rounded-lg hover:bg-white cursor-pointer group">
                                  <input type="checkbox" checked={hqChecks[code] || false} onChange={() => setHqChecks(prev => ({...prev, [code]: !prev[code]}))} className={`mt-0.5 w-4 h-4 rounded ${isMust ? 'text-blue-600 ring-2 ring-blue-500/20' : ''}`} />
                                  <div className="flex flex-col">
                                    <span className={`text-[11px] leading-tight ${hqChecks[code] ? 'text-slate-900 font-medium' : 'text-slate-500'}`}>{group.items[idx]}</span>
                                    {isMust && <span className="text-[9px] text-blue-500 font-bold">※ 必勾</span>}
                                  </div>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2 mb-6">
                    {['R01','R02','R03','R04','R05','R06','R07','R08'].map((code) => (
                      <label key={code} className="flex items-center gap-3 p-3 rounded-xl border border-slate-100 hover:bg-slate-50 cursor-pointer">
                        <input type="checkbox" checked={hqChecks[code] || false} onChange={() => setHqChecks(prev => ({...prev, [code]: !prev[code]}))} className="w-5 h-5 rounded" />
                        <span className="text-xs font-bold text-slate-700">{code} 標準</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
              <div className="pt-6 border-t flex flex-col gap-4">
                {creatorTool === 'LESSON_PLAN' && (
                   <div className="flex gap-4">
                      <div className={`flex-1 p-2 rounded-lg text-center text-[10px] font-bold ${["A2", "A5", "E1", "E5"].every(c => hqChecks[c]) ? 'bg-green-100 text-green-700' : 'bg-red-50 text-red-600'}`}>{["A2", "A5", "E1", "E5"].every(c => hqChecks[c]) ? '✅ 硬門檻已過' : '❌ 缺硬門檻'}</div>
                      <div className={`flex-1 p-2 rounded-lg text-center text-[10px] font-bold ${(Object.keys(LESSON_HQ_GROUPS) as Array<keyof typeof LESSON_HQ_GROUPS>).every(g => LESSON_HQ_GROUPS[g].codes.filter(c => hqChecks[c]).length >= 3) ? 'bg-green-100 text-green-700' : 'bg-red-50 text-red-600'}`}>{(Object.keys(LESSON_HQ_GROUPS) as Array<keyof typeof LESSON_HQ_GROUPS>).every(g => LESSON_HQ_GROUPS[g].codes.filter(c => hqChecks[c]).length >= 3) ? '✅ 各組門檻已過' : '❌ 分組不足 3 項'}</div>
                   </div>
                )}
                <div className="flex gap-3">
                  <button onClick={() => setShowHqModal(false)} className="flex-1 py-3 bg-slate-100 rounded-xl font-bold">取消</button>
                  <button disabled={!(creatorTool === 'LESSON_PLAN' ? isLessonHqPassed : isKnowledgeCardHqPassed) || isSavingToSheet} onClick={finalizeHqReview} className="flex-1 py-3 bg-green-600 text-white rounded-xl font-bold shadow-lg disabled:opacity-30">
                    {isSavingToSheet ? '寫入中...' : '核准發布並存檔'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

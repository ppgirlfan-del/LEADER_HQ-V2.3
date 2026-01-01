
import React, { useState, useEffect, useMemo } from 'react';
import { getTopicDraft, generateLessonPlan, performAiAudit, performLessonAudit, GenerationResponse } from './services/geminiService.ts';
import { queryCards, appendCard } from './services/googleSheetService.ts';
import { FinderResult, ToolType } from './types.ts';

type MainTabId = 'finder' | 'creator';
type CreatorTool = 'KNOWLEDGE_CARD' | 'LESSON_PLAN';
type FinderSource = '主題知識卡' | '教案模板';

const DOMAINS = ['游泳 (Swimming)', '鐵人三項 (Triathlon)', '體能 (Fitness)', '行銷經營 (Marketing)', '教育訓練 (Training)'];
const BRANDS = ['YYS | 燿宇的游泳學校', 'LEADER | 鐵人'];

export default function App() {
  const [activeTab, setActiveTab] = useState<MainTabId>('finder');
  const [creatorTool, setCreatorTool] = useState<CreatorTool>('KNOWLEDGE_CARD');
  const [finderSource, setFinderSource] = useState<FinderSource>('主題知識卡');

  const [isConfigured, setIsConfigured] = useState(false);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [tempUrlInput, setTempUrlInput] = useState('');
  
  const [relatedTopicId, setRelatedTopicId] = useState('');

  const [isEditingPreview, setIsEditingPreview] = useState(false);
  const [editedContent, setEditedContent] = useState('');
  const [editedSummary, setEditedSummary] = useState('');
  const [editedKeywords, setEditedKeywords] = useState('');
  const [editedMetaJson, setEditedMetaJson] = useState('');

  useEffect(() => {
    const checkConfig = () => {
      const envUrl = process.env.APPS_SCRIPT_URL;
      const sessionUrl = window.sessionStorage.getItem('OVER_APPS_SCRIPT_URL');
      const hasValidConfig = !!(envUrl || sessionUrl);
      setIsConfigured(hasValidConfig);
      if (hasValidConfig && !tempUrlInput) setTempUrlInput(sessionUrl || envUrl || '');
    };
    checkConfig();
    const interval = setInterval(checkConfig, 2000);
    return () => clearInterval(interval);
  }, [tempUrlInput]);

  const saveConfig = () => {
    if (tempUrlInput.includes('script.google.com')) {
      window.sessionStorage.setItem('OVER_APPS_SCRIPT_URL', tempUrlInput);
      setShowConfigModal(false);
      setIsConfigured(true);
      alert('連線設定已儲存！');
      handleFinderSearch();
    } else {
      alert('請輸入有效的 Google Apps Script 網址');
    }
  };

  const [selectedBrand, setSelectedBrand] = useState(BRANDS[0]);
  const [selectedDomain, setSelectedDomain] = useState(DOMAINS[0]);
  const [localCards, setLocalCards] = useState<FinderResult[]>([]);
  const [topicNameInput, setTopicNameInput] = useState('');
  const [inputText, setInputText] = useState('');
  const [currentId, setCurrentId] = useState<string>(''); 
  
  const [selectedCard, setSelectedCard] = useState<FinderResult | null>(null);
  const [showHqModal, setShowHqModal] = useState(false);
  const [hqCardId, setHqCardId] = useState<string>('');

  const [searchQuery, setSearchQuery] = useState('');
  const [sheetResults, setSheetResults] = useState<FinderResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSavingToSheet, setIsSavingToSheet] = useState(false);

  const [isAuditing, setIsAuditing] = useState(false);
  const [auditReport, setAuditReport] = useState<string>('');

  const displayResults = useMemo(() => {
    const brandPrefix = selectedBrand.split('|')[0].trim().toLowerCase();
    const domainPartZh = selectedDomain.split(' (')[0].trim().toLowerCase();
    const domainPartEn = selectedDomain.match(/\((.*?)\)/)?.[1]?.toLowerCase() || "";
    const currentTargetSource = activeTab === 'finder' ? finderSource : (creatorTool === 'LESSON_PLAN' ? '教案模板' : '主題知識卡');

    const matchesFilter = (item: FinderResult) => {
      const itemBrand = (item.brand || "").toLowerCase();
      const itemDomain = (item.domain || "").toLowerCase();
      const bMatch = !selectedBrand || itemBrand.includes(brandPrefix) || brandPrefix.includes(itemBrand);
      const dMatch = !selectedDomain || itemDomain.includes(domainPartZh) || domainPartZh.includes(itemDomain) || (domainPartEn && itemDomain.includes(domainPartEn));
      const sMatch = !searchQuery || (item.topic_name || "").toLowerCase().includes(searchQuery.toLowerCase()) || (item.id && item.id.toLowerCase().includes(searchQuery.toLowerCase()));
      const sourceMatch = (currentTargetSource === '主題知識卡' && item.id.toUpperCase().includes('-TOPIC-')) || (currentTargetSource === '教案模板' && item.id.toUpperCase().includes('-LESSON-'));
      return bMatch && dMatch && sMatch && sourceMatch;
    };
    const filteredLocal = localCards.filter(matchesFilter);
    const cloudIds = new Set(filteredLocal.map(l => l.id));
    const filteredCloud = sheetResults.filter(matchesFilter).filter(s => !cloudIds.has(s.id));
    return [...filteredLocal, ...filteredCloud];
  }, [localCards, sheetResults, selectedBrand, selectedDomain, searchQuery, activeTab, finderSource, creatorTool]);

  const handleFinderSearch = async () => {
    if (!isConfigured) return;
    setIsLoading(true);
    setSheetResults([]);
    try {
      const resp = await queryCards({ source: activeTab === 'finder' ? finderSource : (creatorTool === 'LESSON_PLAN' ? '教案模板' : '主題知識卡'), brand: "", domain: "", input: searchQuery });
      setSheetResults(resp.results);
    } catch (e) { console.error(e); } finally { setIsLoading(false); }
  };

  useEffect(() => { if (isConfigured) handleFinderSearch(); }, [selectedBrand, selectedDomain, isConfigured, finderSource, activeTab, creatorTool]);

  const currentCardForOutput = useMemo(() => localCards.find(c => c.id === currentId), [localCards, currentId]);

  useEffect(() => {
    if (currentCardForOutput && !isEditingPreview) {
      setEditedContent(currentCardForOutput.content || '');
      setEditedSummary(currentCardForOutput.summary || '');
      setEditedKeywords(currentCardForOutput.keywords?.join(', ') || '');
      setEditedMetaJson(currentCardForOutput.meta_json || '');
    }
  }, [currentId, currentCardForOutput, isEditingPreview]);

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

  /**
   * 強化 ID 生成規則：[BRAND]-[TAG]-[NNN]
   * 類別 TAG：LESSON 或 TOPIC
   */
  const getNextSerialNumberId = (brand: string, cards: FinderResult[], tool: CreatorTool) => {
    const brandCode = brand.split('|')[0].trim().toUpperCase(); 
    const targetTag = tool === 'LESSON_PLAN' ? 'LESSON' : 'TOPIC';
    const idealPrefix = `${brandCode}-${targetTag}-`;
    
    let maxNum = 0;
    // 遍歷所有卡片，尋找匹配前綴且序號最大的
    for (const card of cards) {
      const upperId = card.id ? card.id.toUpperCase() : "";
      if (upperId.startsWith(idealPrefix)) {
        const numPart = upperId.replace(idealPrefix, "");
        const num = parseInt(numPart, 10);
        if (!isNaN(num) && num > maxNum) {
          maxNum = num;
        }
      }
    }
    
    // 生成下一號，補零至三位
    return `${idealPrefix}${(maxNum + 1).toString().padStart(3, '0')}`;
  };

  const handleGenerate = async () => {
    if (!topicNameInput.trim() || !inputText.trim()) { alert('請填寫完整資訊。'); return; }
    setIsLoading(true);
    setAuditReport('');
    setIsEditingPreview(false);
    try {
      const sourceTab = creatorTool === 'LESSON_PLAN' ? '教案模板' : '主題知識卡';
      
      // 1. 先抓取最新資料以計算正確 ID
      const latestResp = await queryCards({ source: sourceTab, brand: selectedBrand, domain: "", input: "" });
      const nextId = getNextSerialNumberId(selectedBrand, [...latestResp.results, ...localCards], creatorTool);
      
      // 2. 呼叫 AI 生成
      let res: GenerationResponse;
      if (creatorTool === 'KNOWLEDGE_CARD') {
        res = await getTopicDraft({ brand: selectedBrand, domain: selectedDomain, topicName: topicNameInput, rawText: inputText });
      } else {
        res = await generateLessonPlan({ brand: selectedBrand, domain: selectedDomain, topicName: topicNameInput, rawText: inputText, topicId: relatedTopicId });
      }

      // 3. 組裝新物件，強制使用前端計算出的 nextId，確保規則統一
      const newCard: FinderResult = {
        id: nextId, 
        topic_name: res.topic_name, 
        brand: selectedBrand, 
        domain: selectedDomain,
        content: res.content, 
        summary: res.summary, 
        keywords: res.keywords.split(',').map(k => k.trim()).filter(k => k),
        meta_json: res.meta_json, 
        status: '草稿'
      };
      
      setCurrentId(newCard.id);
      setLocalCards(prev => [newCard, ...prev]);
    } catch (e: any) { 
      const errMsg = e.message?.includes('429') ? '🤖 配額暫時用盡，請稍候 30 秒再試。' : '🤖 生成失敗，請確認 API Key。';
      alert(errMsg); 
    } finally { setIsLoading(false); }
  };

  const handleAudit = async () => {
    const card = localCards.find(c => c.id === currentId);
    if (!card || !card.content) return;
    setIsAuditing(true);
    try {
      if (creatorTool === 'KNOWLEDGE_CARD') {
        const genData: GenerationResponse = { ...card, content: card.content || "", summary: card.summary || "", keywords: card.keywords?.join(', ') || "", meta_json: card.meta_json || "", approved_by: "system", approved_at: new Date().toISOString() } as any;
        const res = await performAiAudit(genData);
        setAuditReport(res.report);
      } else {
        const res = await performLessonAudit(card.content, card.meta_json || "");
        setAuditReport(JSON.stringify(res)); 
      }
    } catch (e) { alert('審核失敗'); } finally { setIsAuditing(false); }
  };

  const finalizeHqReview = async () => {
    const cardId = hqCardId || currentId;
    const card = localCards.find(c => c.id === cardId);
    if (!card) return;
    
    let approvedInfo = { by: "HQ", at: new Date().toISOString() };
    if (creatorTool === 'LESSON_PLAN' && auditReport) {
        try {
            const data = JSON.parse(auditReport);
            if (data.result === '✅' && data.approved_fields?.approved_by) {
                approvedInfo = { by: data.approved_fields.approved_by, at: data.approved_fields.approved_at };
            }
        } catch(e) {}
    }

    setIsSavingToSheet(true);
    try {
      const tabName = creatorTool === 'LESSON_PLAN' ? '教案模板' : '主題知識卡';
      const result = await appendCard({ 
        ...card, 
        content: isEditingPreview ? editedContent : card.content,
        summary: isEditingPreview ? editedSummary : card.summary,
        keywords: isEditingPreview ? editedKeywords.split(',').map(k => k.trim()).filter(k => k) : card.keywords,
        meta_json: isEditingPreview ? editedMetaJson : card.meta_json,
        tab: tabName, 
        status: '已審定',
        approved_by: approvedInfo.by,
        approved_at: approvedInfo.at
      });
      if (result.result === "success") { 
        updateLocalCard(card.id, { status: '已審定' }); 
        alert('✅ 審定完成！'); 
        setShowHqModal(false); 
        handleFinderSearch(); 
      } else { throw new Error(result.message); }
    } catch (e) { alert('❌ 寫入失敗'); } finally { setIsSavingToSheet(false); }
  };

  const handleShortcutGenerateLesson = (card: FinderResult) => {
    setActiveTab('creator');
    setCreatorTool('LESSON_PLAN');
    setTopicNameInput(card.topic_name);
    setInputText(card.content || "");
    setRelatedTopicId(card.id); 
    setAuditReport('');
    setIsEditingPreview(false);
    setSelectedCard(null);
  };

  const renderAuditReport = () => {
    if (!auditReport) return null;

    if (creatorTool === 'LESSON_PLAN') {
      try {
        const data = JSON.parse(auditReport);
        const styles = {
          '✅': 'bg-green-50 border-green-200 text-green-800',
          '🔁': 'bg-amber-50 border-amber-200 text-amber-800',
          '❌': 'bg-red-50 border-red-200 text-red-800'
        };
        const activeStyle = styles[data.result as keyof typeof styles] || 'bg-slate-50 border-slate-200 text-slate-800';

        return (
          <div className={`mb-8 p-6 rounded-2xl border-2 shadow-sm ${activeStyle}`}>
            <div className="flex items-center gap-4 mb-6">
              <span className="text-4xl">{data.result}</span>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest opacity-60">HQ 審核助理 (內部版)</div>
                <div className="font-bold text-lg">{data.quick_notes}</div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-6 mb-6">
              <div className="space-y-3">
                <div className="text-[10px] font-bold uppercase opacity-50 tracking-wider">A) 可寫入門檻 (Hard)</div>
                {data.checklist?.hard_spec?.map((check: any, i: number) => (
                  <div key={i} className="flex gap-2 text-[11px] leading-snug">
                    <span>{check.pass ? '✅' : '❌'}</span>
                    <span className={check.pass ? 'opacity-80' : 'font-bold'}>{check.item}</span>
                  </div>
                ))}
              </div>
              <div className="space-y-3">
                <div className="text-[10px] font-bold uppercase opacity-50 tracking-wider">B) 教務可上線 (Content)</div>
                {data.checklist?.content?.map((check: any, i: number) => (
                  <div key={i} className="flex gap-2 text-[11px] leading-snug">
                    <span>{check.pass ? '✅' : '⚠️'}</span>
                    <span className={check.pass ? 'opacity-80' : 'font-bold'}>{check.item}</span>
                  </div>
                ))}
              </div>
            </div>
            
            {data.must_fix && data.must_fix.length > 0 && (
              <div className="mt-4 pt-4 border-t border-current border-opacity-10">
                <div className="text-[10px] font-bold uppercase mb-2 opacity-60">⚠️ 必修清單 (MUST FIX)</div>
                <ul className="space-y-1.5">
                  {data.must_fix.map((item: string, i: number) => <li key={i} className="text-xs flex gap-2"><span>•</span>{item}</li>)}
                </ul>
              </div>
            )}
          </div>
        );
      } catch (e) {
        return <div className="mb-6 p-4 bg-blue-50 text-blue-800 rounded-xl text-xs">{auditReport}</div>;
      }
    }
    return <div className="mb-6 p-4 bg-blue-50 text-blue-800 rounded-xl text-xs whitespace-pre-wrap"><div className="font-bold mb-2">AI 自審報告：</div>{auditReport}</div>;
  };

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900 font-sans relative">
      {selectedCard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" onClick={() => setSelectedCard(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="p-6 border-b bg-slate-50 flex justify-between items-start">
              <div><span className="text-xs text-slate-400 font-mono">{selectedCard.id}</span><h2 className="text-2xl font-bold">{selectedCard.topic_name}</h2></div>
              <div className="flex items-center gap-4">
                {selectedCard.id.toUpperCase().includes('-TOPIC-') && <button onClick={() => handleShortcutGenerateLesson(selectedCard)} className="px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold shadow-lg hover:bg-blue-700 transition-all flex items-center gap-2">📅 生成教案</button>}
                <button onClick={() => setSelectedCard(null)} className="text-slate-400 hover:text-slate-600 text-2xl">✕</button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-8 text-sm leading-relaxed">
              {selectedCard.summary && <div className="mb-8 p-6 bg-blue-50/50 rounded-2xl border border-blue-100"><h4 className="text-xs font-bold text-blue-500 uppercase mb-2 tracking-widest">📋 內容摘要</h4><div className="text-slate-700 italic">{selectedCard.summary}</div></div>}
              <div className="whitespace-pre-wrap text-slate-900 mb-8">{selectedCard.content}</div>
              {selectedCard.keywords && selectedCard.keywords.length > 0 && <div className="pt-6 border-t border-slate-100"><h4 className="text-xs font-bold text-slate-400 uppercase mb-3">🏷️ 關鍵字</h4><div className="flex flex-wrap gap-2">{selectedCard.keywords.map((k, idx) => <span key={idx} className="px-3 py-1 bg-slate-100 text-slate-600 text-[11px] font-medium rounded-full border border-slate-200">#{k}</span>)}</div></div>}
              {selectedCard.meta_json && <div className="mt-8 p-4 bg-slate-50 rounded-xl border border-dashed border-slate-200 font-mono text-[11px] text-slate-500"><div className="text-[10px] font-bold text-slate-400 uppercase mb-2">Meta JSON</div>{selectedCard.meta_json}</div>}
            </div>
          </div>
        </div>
      )}

      <aside className="w-[280px] bg-slate-900 text-white p-6 flex flex-col gap-6 fixed h-full z-40 shadow-2xl">
        <div className="mb-4"><div className="text-xl font-bold">LEADER HQ <span className="text-blue-500">v2</span></div><div className="text-[10px] opacity-40 uppercase tracking-widest font-bold">總部知識開發系統</div></div>
        <div className="flex flex-col gap-1">
          <button onClick={() => setActiveTab('finder')} className={`text-left p-3 rounded-xl text-sm transition-all ${activeTab === 'finder' ? 'bg-blue-600 font-bold shadow-lg' : 'text-slate-400 hover:bg-slate-800'}`}>🔍 查卡助手</button>
          <div className="mt-4 text-[10px] font-bold text-slate-500 mb-2 tracking-widest uppercase px-3">生卡模組</div>
          <button onClick={() => { setActiveTab('creator'); setCreatorTool('KNOWLEDGE_CARD'); setRelatedTopicId(''); }} className={`text-left p-3 rounded-xl text-sm transition-all ${activeTab === 'creator' && creatorTool === 'KNOWLEDGE_CARD' ? 'bg-blue-600 font-bold shadow-lg' : 'text-slate-400 hover:bg-slate-800'}`}>🧩 主題知識卡</button>
          <button onClick={() => { setActiveTab('creator'); setCreatorTool('LESSON_PLAN'); }} className={`text-left p-3 rounded-xl text-sm transition-all ${activeTab === 'creator' && creatorTool === 'LESSON_PLAN' ? 'bg-blue-600 font-bold shadow-lg' : 'text-slate-400 hover:bg-slate-800'}`}>📅 教案模板 (60/90)</button>
        </div>
        <div className="mt-auto pt-6 border-t border-slate-800 flex flex-col gap-3">
          <select value={selectedBrand} onChange={(e) => setSelectedBrand(e.target.value)} className="w-full p-2.5 bg-slate-800 text-white border-none rounded-xl text-xs outline-none">{BRANDS.map(b => <option key={b}>{b}</option>)}</select>
          <select value={selectedDomain} onChange={(e) => setSelectedDomain(e.target.value)} className="w-full p-2.5 bg-slate-800 text-white border-none rounded-xl text-xs outline-none">{DOMAINS.map(d => <option key={d}>{d}</option>)}</select>
          <button onClick={() => setShowConfigModal(true)} className={`flex items-center gap-3 w-full p-3 rounded-xl text-[10px] font-bold transition-all ${isConfigured ? 'bg-slate-800 text-green-400 border border-slate-700' : 'bg-red-500/20 text-red-400 border border-red-500/30'}`}>{isConfigured ? '雲端已連線' : '未連線 (請設定)'}</button>
        </div>
      </aside>

      <main className="flex-1 ml-[280px] p-10 overflow-y-auto">
        <header className="mb-10"><h1 className="text-3xl font-bold text-slate-900">{activeTab === 'finder' ? '查卡助手' : (creatorTool === 'KNOWLEDGE_CARD' ? '知識卡生成' : '教案生成 (60/90)')}</h1></header>

        {activeTab === 'finder' ? (
          <div className="bg-white rounded-[2rem] p-8 shadow-sm border border-slate-100">
            <div className="flex flex-col gap-6 mb-8"><div className="flex gap-2 p-1 bg-slate-100 rounded-2xl w-fit">{(['主題知識卡', '教案模板'] as FinderSource[]).map((src) => (<button key={src} onClick={() => setFinderSource(src)} className={`px-6 py-2 rounded-xl text-xs font-bold transition-all ${finderSource === src ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>{src}</button>))}</div><div className="flex gap-4"><input type="text" placeholder={`搜尋 ${finderSource}...`} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleFinderSearch()} className="flex-1 p-4 bg-slate-100 rounded-2xl text-sm outline-none border-2 border-transparent focus:border-blue-500 transition-all" /><button onClick={handleFinderSearch} className="px-8 bg-slate-900 text-white font-bold rounded-2xl hover:bg-slate-800 transition-colors">搜尋</button></div></div>
            <div className="overflow-hidden rounded-xl border border-slate-50"><table className="w-full text-left text-sm border-collapse"><thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-100"><tr><th className="py-4 px-6">ID</th><th className="py-4 px-6">主題名稱</th><th className="py-4 px-6">狀態</th></tr></thead><tbody className="text-slate-900">{displayResults.map(res => (<tr key={res.id} onClick={() => setSelectedCard(res)} className="border-b border-slate-50 hover:bg-blue-50/50 cursor-pointer transition-colors group"><td className="py-5 px-6 font-mono text-blue-600 font-bold group-hover:underline">{res.id}</td><td className="py-5 px-6 font-bold text-slate-900">{res.topic_name}</td><td className="py-5 px-6"><span className={`px-2 py-1 rounded-full text-[10px] font-bold ${res.status === '已審定' ? 'bg-green-100 text-green-700' : 'bg-slate-200 text-slate-600'}`}>{res.status}</span></td></tr>))}</tbody></table></div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-8 h-[calc(100vh-200px)]">
            <div className="flex flex-col gap-6">
              <div className="flex gap-4 items-center">
                <input type="text" value={topicNameInput} onChange={(e) => setTopicNameInput(e.target.value)} className="flex-1 p-4 bg-white border border-slate-200 rounded-2xl font-bold shadow-sm outline-none focus:ring-2 focus:ring-blue-500" placeholder="主題名稱..." />
                {relatedTopicId && <div className="px-3 py-1 bg-blue-100 text-blue-700 rounded-lg text-[10px] font-bold">Ref: {relatedTopicId}</div>}
              </div>
              <textarea value={inputText} onChange={(e) => setInputText(e.target.value)} className="flex-1 p-6 bg-white border border-slate-200 rounded-[2rem] shadow-sm resize-none outline-none leading-relaxed focus:ring-2 focus:ring-blue-500" placeholder="貼上原文素材..." />
              <div className="flex gap-4"><button onClick={() => { setTopicNameInput(''); setInputText(''); setAuditReport(''); }} className="px-6 py-4 bg-slate-200 text-slate-600 font-bold rounded-2xl">🗑️ 清空</button><button onClick={handleGenerate} disabled={isLoading} className="flex-1 py-4 bg-blue-600 text-white font-bold rounded-2xl shadow-xl">{isLoading ? '🤖 生成中...' : '✨ 開始生成'}</button></div>
            </div>
            <div className="flex flex-col h-full overflow-hidden">
                {currentCardForOutput ? (
                    <div className="flex flex-col h-full">
                        <div className="mb-4 flex justify-between items-center"><span className="text-[10px] font-bold text-slate-400 uppercase">生成結果預覽</span><div className="flex gap-2">
                           {creatorTool === 'KNOWLEDGE_CARD' && <button onClick={() => handleShortcutGenerateLesson(currentCardForOutput)} className="px-4 py-1.5 bg-blue-50 text-blue-600 rounded-lg text-xs font-bold hover:bg-blue-100 transition-all flex items-center gap-2 border border-blue-200">📅 生成教案</button>}
                           <button onClick={() => setIsEditingPreview(!isEditingPreview)} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${isEditingPreview ? 'bg-blue-600 text-white shadow-lg' : 'bg-slate-200 text-slate-700 hover:bg-slate-300'}`}>{isEditingPreview ? '✅ 完成' : '📝 編輯'}</button>
                           <button onClick={handleAudit} disabled={isAuditing} className="px-4 py-1.5 bg-slate-800 text-white rounded-lg text-xs font-bold">{isAuditing ? '⌛...' : '📋 AI 審核卡'}</button>
                           <button onClick={() => setShowHqModal(true)} disabled={isSavingToSheet} className="px-4 py-1.5 bg-green-600 text-white rounded-lg text-xs font-bold">🛡️ 審核發布</button>
                        </div></div>
                        <div className="flex-1 p-8 rounded-[2rem] bg-white border border-slate-200 shadow-inner overflow-y-auto text-sm text-slate-900 leading-relaxed relative">
                           {renderAuditReport()}
                           {isEditingPreview ? (
                             <div className="flex flex-col gap-6">
                               <div><label className="text-[10px] font-bold text-slate-400 uppercase block mb-2">正文內容</label><textarea className="w-full min-h-[400px] p-4 bg-slate-50 rounded-xl border border-slate-200 outline-none resize-none font-sans" value={editedContent} onChange={(e) => setEditedContent(e.target.value)} /></div>
                               <div><label className="text-[10px] font-bold text-slate-400 uppercase block mb-2">摘要 (Summary)</label><textarea className="w-full min-h-[80px] p-4 bg-slate-50 rounded-xl border border-slate-200 outline-none resize-none" value={editedSummary} onChange={(e) => setEditedSummary(e.target.value)} /></div>
                               <div><label className="text-[10px] font-bold text-slate-400 uppercase block mb-2">關鍵字 (逗號分隔)</label><input type="text" className="w-full p-4 bg-slate-50 rounded-xl border border-slate-200 outline-none" value={editedKeywords} onChange={(e) => setEditedKeywords(e.target.value)} /></div>
                               <div><label className="text-[10px] font-bold text-slate-400 uppercase block mb-2">Meta JSON</label><textarea className="w-full min-h-[80px] p-4 bg-slate-50 rounded-xl border border-slate-200 outline-none font-mono text-[10px]" value={editedMetaJson} onChange={(e) => setEditedMetaJson(e.target.value)} /></div>
                             </div>
                           ) : (
                             <div className="flex flex-col gap-8">
                               {currentCardForOutput.summary && <div className="p-5 bg-blue-50/50 rounded-2xl border border-blue-100"><h4 className="text-[10px] font-bold text-blue-500 uppercase mb-2 tracking-widest">📋 內容摘要</h4><div className="text-slate-700 italic">{currentCardForOutput.summary}</div></div>}
                               <div className="whitespace-pre-wrap">{currentCardForOutput.content}</div>
                               {currentCardForOutput.keywords && currentCardForOutput.keywords.length > 0 && <div className="pt-6 border-t border-slate-100"><h4 className="text-xs font-bold text-slate-400 uppercase mb-3">🏷️ 關鍵字</h4><div className="flex flex-wrap gap-2">{currentCardForOutput.keywords.map((k, idx) => <span key={idx} className="px-2 py-1 bg-slate-100 text-slate-600 text-[10px] font-bold rounded-md">#{k}</span>)}</div></div>}
                               {currentCardForOutput.meta_json && <div className="pt-6 border-t border-slate-100"><h4 className="text-xs font-bold text-slate-400 uppercase mb-3">Meta JSON</h4><div className="p-3 bg-slate-50 rounded-lg text-[10px] font-mono text-slate-500 break-all border border-slate-200">{currentCardForOutput.meta_json}</div></div>}
                             </div>
                           )}
                        </div>
                    </div>
                ) : (<div className="h-full flex flex-col items-center justify-center text-slate-300 border-2 border-dashed border-slate-200 rounded-[2rem] bg-white/50"><div className="text-5xl mb-4">🪄</div><p className="text-sm font-medium">填寫左側資訊並點擊生成</p></div>)}
            </div>
          </div>
        )}

        {showConfigModal && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-md"><div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8"><h3 className="text-xl font-bold mb-2">⚙️ 連線設定</h3><p className="text-sm text-slate-500 mb-6">請輸入 Apps Script 佈署網址以連線總部資料庫。</p><input type="text" className="w-full p-4 bg-slate-100 rounded-xl mb-6 text-sm font-mono" value={tempUrlInput} onChange={(e) => setTempUrlInput(e.target.value)} /><div className="flex gap-3"><button onClick={() => setShowConfigModal(false)} className="flex-1 py-3 bg-slate-100 rounded-xl font-bold">取消</button><button onClick={saveConfig} className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-bold">確認儲存</button></div></div></div>
        )}

        {showHqModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-md">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 flex flex-col max-h-[90vh]">
              <div className="mb-6"><h3 className="text-xl font-bold">🛡️ 總部審核發布</h3><p className="text-xs text-slate-500 mt-1">確認內容符合品牌規範且門檻全過後發布。</p></div>
              <div className="flex flex-col gap-4 overflow-y-auto pr-2">
                <label className="flex items-start gap-4 p-4 rounded-xl border-2 border-slate-100 hover:bg-slate-50 cursor-pointer"><input type="checkbox" className="mt-1 w-5 h-5" /><div className="flex-1 text-sm font-medium">確認 hard_spec 六大門檻全數通過</div></label>
                <label className="flex items-start gap-4 p-4 rounded-xl border-2 border-slate-100 hover:bg-slate-50 cursor-pointer"><input type="checkbox" className="mt-1 w-5 h-5" /><div className="flex-1 text-sm font-medium">確認 meta_json 包含 10 個硬規格 Key</div></label>
              </div>
              <div className="pt-6 border-t mt-6 flex gap-3"><button onClick={() => setShowHqModal(false)} className="flex-1 py-3 bg-slate-100 rounded-xl font-bold">取消</button><button disabled={isSavingToSheet} onClick={finalizeHqReview} className="flex-1 py-3 bg-green-600 text-white rounded-xl font-bold shadow-lg">{isSavingToSheet ? '發布中...' : '核准發布'}</button></div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

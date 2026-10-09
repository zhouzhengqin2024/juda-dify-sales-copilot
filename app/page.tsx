"use client";
import { useRef, useState } from "react";

export default function Home() {
  const [requirements, setRequirements] = useState("");
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const noticeRef = useRef<HTMLDialogElement>(null);

  function showNotice(event: React.FormEvent) {
    event.preventDefault();
    if (!requirements.trim() || running) return;
    if (!noticeRef.current?.open) noticeRef.current?.showModal();
  }

  async function run() {
    noticeRef.current?.close();
    if (!requirements.trim() || running) return;
    setRunning(true); setResult(""); setError("");
    try {
      const response = await fetch("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requirements }) });
      const data = await response.json() as { error?: string; report?: string };
      if (!response.ok) throw new Error(data.error || "当前无法完成分析，请稍后再试。");
      setResult(data.report || "未收到有效报告，请稍后再试。");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "请求失败，请稍后再试。"); }
    finally { setRunning(false); }
  }

  return <main className="shell">
    <header className="topbar"><div className="brand"><span className="brand-icon" aria-hidden="true">✳</span><span>据答</span></div><div className="top-right"><span className="status-dot" />公开演示</div></header>
    <div className="page">
      <div className="intro"><span className="eyebrow">据答 · 企业 AI 客服售前核对</span><h1>让每一项产品承诺，<br /><span>都有依据。</span></h1><p>粘贴客户原话，核对模拟产品资料中的能力、限制与未知项。提到价格时，只计算有明确版本和人数依据的模拟软件年费。</p></div>
      <div className="workspace">
        <section className="panel input-panel" aria-labelledby="input-heading"><div className="panel-head"><div><span className="step">01 / 输入</span><h2 id="input-heading">客户需求</h2></div><span className="panel-mark" aria-hidden="true">✎</span></div>
          <form onSubmit={showNotice}><label htmlFor="requirements">客户需求</label><textarea id="requirements" value={requirements} onChange={e => setRequirements(e.target.value)} maxLength={5000} placeholder="例如：我们有30名客服，需要接入官网和企业微信。请核对能否满足；若需试算，请写明按专业版计算软件年费。" required />
            <button className="run-button" type="submit" disabled={running || !requirements.trim()}>{running ? "正在核对资料…" : "开始核对"}<span aria-hidden="true">↗</span></button>
          </form></section>
        <section className="panel output-panel" aria-labelledby="output-heading"><div className="panel-head"><div><span className="step">02 / 结果</span><h2 id="output-heading">核对报告</h2></div><span className="panel-mark" aria-hidden="true">◫</span></div><div className="result-area" aria-live="polite">{running ? <div className="loading"><div className="loader" /><strong>正在核对产品资料</strong><p>通常需要几十秒，页面会自动显示结果。</p></div> : error ? <div className="error"><strong>暂时无法生成报告</strong><p>{error}</p></div> : result ? <div className="report">{result}</div> : <div className="empty"><span className="empty-glyph" aria-hidden="true">✳</span><strong>结果将显示在这里</strong><p>输入一段客户需求，再开始核对。</p></div>}</div></section>
      </div><footer><span>虚构产品资料 · 模拟价格 · 非正式方案</span><span>不提交真实客户或敏感信息</span></footer>
    </div>
    <dialog className="notice-dialog" ref={noticeRef} aria-labelledby="notice-title" aria-describedby="notice-description">
      <span className="notice-eyebrow">使用须知</span>
      <h2 id="notice-title">开始核对前，请先了解</h2>
      <div id="notice-description" className="notice-content">
        <p><strong>这是演示版本。</strong>产品资料和价格均为模拟数据；报告不构成正式方案、报价或交付承诺。</p>
        <p><strong>试用次数有限。</strong>同一公网 IP 每小时最多 5 次。同一公司或网络共用公网 IP 时，也会共用这 5 次；整个 Demo 每 24 小时最多 50 次。</p>
        <p>请勿输入真实客户资料或敏感信息。</p>
      </div>
      <div className="notice-actions">
        <button type="button" className="notice-cancel" onClick={() => noticeRef.current?.close()} autoFocus>返回修改</button>
        <button type="button" className="notice-confirm" onClick={() => void run()}>我知道了，开始核对</button>
      </div>
    </dialog>
  </main>;
}

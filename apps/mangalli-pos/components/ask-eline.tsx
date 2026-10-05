"use client";

import { ArrowUp, FileSpreadsheet, FileText, RotateCcw, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";

// Panel "Ask Eline": tanya-jawab soal fitur Mangalli dan ringkasan outlet.
// Riwayat hanya di sessionStorage browser ini (kenyamanan, bukan data resmi).

type Message = { role: "user" | "assistant"; content: string };

const STORAGE_KEY = "mangalli:ask-eline";

// Tebal dan tautan markdown. Tautan file Eline (/api/assistant/files/…) menjadi
// tombol unduh dengan ikon Excel atau PDF; tautan lain tetap tautan biasa.
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\([^)\s]+\))/g).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    const link = part.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
    if (link) {
      const [, label, href] = link;
      if (href.startsWith("/api/assistant/files/")) {
        const Icon = /\.pdf\b/i.test(label) ? FileText : FileSpreadsheet;
        return <a className="ask-eline-file" download href={href} key={index}><Icon size={18} /><span>{label.replace(/^Download\s+/i, "")}</span><small>Download</small></a>;
      }
      // Draf menu dari prepare_menu_draft: tombol ke halaman periksa (panel chat tetap terbuka).
      if (href.startsWith("/admin/products/import?draft=")) return <Link className="ask-eline-file" href={href} key={index}><Sparkles size={18} /><span>{label}</span><small>Review</small></Link>;
      if (/^(https?:\/\/|\/)/.test(href)) return <a className="link" href={href} key={index} rel="noreferrer" target={href.startsWith("/") ? undefined : "_blank"}>{label}</a>;
    }
    return <Fragment key={index}>{part}</Fragment>;
  });
}

// Markdown secukupnya: paragraf, judul, garis, kutipan, tabel, daftar, tebal, tautan.
function Rich({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let table: string[][] | null = null;
  const flush = () => {
    if (list) {
      const Tag = list.ordered ? "ol" : "ul";
      blocks.push(<Tag key={blocks.length}>{list.items.map((item, index) => <li key={index}>{inline(item)}</li>)}</Tag>);
      list = null;
    }
    if (table) {
      const [head, ...body] = table;
      blocks.push(<div className="ask-eline-table" key={blocks.length}><table><thead><tr>{head.map((cell, index) => <th key={index}>{inline(cell)}</th>)}</tr></thead>
        <tbody>{body.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, index) => <td key={index}>{inline(cell)}</td>)}</tr>)}</tbody></table></div>);
      table = null;
    }
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (/^\|.*\|$/.test(line)) {
      if (list) { const rows: string[][] | null = table; table = null; flush(); table = rows; }
      if (/^\|[\s:|-]+\|$/.test(line)) continue;
      (table ??= []).push(line.slice(1, -1).split("|").map((cell) => cell.trim()));
      continue;
    }
    const bullet = line.match(/^[-*•]\s+(.*)$/);
    const numbered = line.match(/^\d+[.)]\s+(.*)$/);
    if ((bullet || numbered) && !/^-{3,}$/.test(line)) {
      const ordered = Boolean(numbered);
      if (table || (list && list.ordered !== ordered)) flush();
      list ??= { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]);
      continue;
    }
    flush();
    if (!line) continue;
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) blocks.push(<hr key={blocks.length} />);
    else if (/^#{1,6}\s/.test(line)) blocks.push(<p className="ask-eline-heading" key={blocks.length}>{inline(line.replace(/^#+\s*/, ""))}</p>);
    else if (line.startsWith(">")) blocks.push(<blockquote key={blocks.length}>{inline(line.replace(/^>\s?/, ""))}</blockquote>);
    else blocks.push(<p key={blocks.length}>{inline(line)}</p>);
  }
  flush();
  return <>{blocks}</>;
}

export function AskEline({ role }: { role: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // Riwayat dibaca sekali saat mount; panel tertutup saat render server, jadi tidak ada beda hidrasi.
  const [messages, setMessages] = useState<Message[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "[]");
      return Array.isArray(saved) ? saved.slice(-16) : [];
    } catch {
      return [];
    }
  });
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const manager = role === "owner" || role === "manager";
  const suggestions = manager
    ? ["How did we do this week vs last week?", "Which products make the most profit?", "Buatkan laporan penjualan bulan lalu dalam PDF", "Export this month's orders to Excel"]
    : ["How do I void an item?", "How do I close my shift?", "What does Awaiting payment mean?", "How do I report a printer problem?"];

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-16)));
    } catch {
      // Abaikan bila penyimpanan diblokir.
    }
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    list.current?.scrollTo({ top: list.current.scrollHeight });
    // Saat drawer terbuka, Esc di luar panel milik drawer.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if ((event.target as Element | null)?.closest?.(".ask-eline") || !document.querySelector(".drawer")) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy) return;
    setError(null);
    setDraft("");
    const history = [...messages, { role: "user" as const, content: question.slice(0, 2000) }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setBusy(true);
    try {
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ page: pathname, messages: history.filter((message) => message.content).slice(-12) }),
      });
      if (!response.ok || !response.body) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.message || "Eline couldn't answer right now.");
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let raw = "";
      let answer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        raw += decoder.decode(value, { stream: true });
        // Baris berawalan \u001e berisi status alat atau galat, bukan jawaban.
        const statusLines = raw.match(/\u001e[^\n]*\n/g) ?? [];
        for (const line of statusLines) {
          try {
            const event = JSON.parse(line.slice(1));
            if (event.status) setStatus(event.status);
            if (event.error) throw new Error(event.error);
          } catch (reason) {
            if (reason instanceof Error && !(reason instanceof SyntaxError)) throw reason;
          }
        }
        answer = raw.replace(/\u001e[^\n]*\n/g, "").replace(/\u001e[^\n]*$/, "");
        if (answer) setStatus(null);
        setMessages([...history, { role: "assistant", content: answer }]);
      }
      if (!answer.trim()) throw new Error("Eline didn't answer. Try asking again.");
    } catch (reason) {
      setMessages(history);
      setError(reason instanceof Error ? reason.message : "Eline couldn't answer right now.");
    } finally {
      setBusy(false);
      setStatus(null);
    }
  }

  return (
    <>
      {!open ? (
        <button className="ask-eline-fab" onClick={() => setOpen(true)} type="button"><Sparkles size={18} /><span>Ask Eline</span></button>
      ) : null}
      {open ? (
        <aside aria-label="Ask Eline" className="ask-eline">
          <header className="ask-eline-head">
            <span className="ask-eline-mark"><Sparkles size={16} /></span>
            <div><strong>Ask Eline</strong><small>{manager ? "Reads your outlet's data and makes reports" : "Help with Mangalli"}</small></div>
            {messages.length ? <button aria-label="New conversation" className="icon-button" onClick={() => { setMessages([]); setError(null); }} title="New conversation" type="button"><RotateCcw size={16} /></button> : null}
            <button aria-label="Close" className="icon-button" onClick={() => setOpen(false)} type="button"><X size={18} /></button>
          </header>
          <div className="ask-eline-list" ref={list}>
            {messages.length ? messages.map((message, index) => (
              <div className={`ask-eline-msg ${message.role}`} key={index}>
                {message.role === "assistant" ? (message.content ? <Rich text={message.content} /> : status ? <span className="ask-eline-status"><Sparkles size={14} />{status}…</span> : <span className="ask-eline-typing"><i /><i /><i /></span>) : <p>{message.content}</p>}
              </div>
            )) : (
              <div className="ask-eline-empty">
                <span className="ask-eline-mark big"><Sparkles size={22} /></span>
                <strong>Hi, I&apos;m Eline.</strong>
                <p>{manager ? "Ask about sales, stock or shifts, or request an Excel or PDF report." : "Ask how to do anything in Mangalli."}</p>
                <div className="ask-eline-suggest">{suggestions.map((suggestion) => (
                  <button key={suggestion} onClick={() => send(suggestion)} type="button">{suggestion}</button>
                ))}</div>
              </div>
            )}
            {error ? <p className="form-message error">{error}</p> : null}
          </div>
          <form className="ask-eline-compose" onSubmit={(event) => { event.preventDefault(); void send(draft); }}>
            <textarea
              aria-label="Your question" maxLength={2000} onChange={(event) => setDraft(event.target.value)} placeholder="Ask anything about Mangalli…" ref={input} rows={1} value={draft}
              onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(draft); } }}
            />
            <button aria-label="Send" className="ask-eline-send" disabled={busy || !draft.trim()} type="submit"><ArrowUp size={18} /></button>
          </form>
        </aside>
      ) : null}
    </>
  );
}

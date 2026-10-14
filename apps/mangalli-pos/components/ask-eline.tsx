"use client";

import { ArrowRight, ArrowUp, BarChart3, Check, Copy, Download, FileSpreadsheet, FileText, SquarePen, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";

// Panel "Ask Eline": tanya-jawab soal fitur Mangalli dan ringkasan outlet.
// Riwayat hanya di sessionStorage browser ini (kenyamanan, bukan data resmi).

type Message = { role: "user" | "assistant"; content: string };

const STORAGE_KEY = "mangalli:ask-eline";

// Inline markdown: **tebal**, *miring*, `kode`, dan tautan. Tautan file Eline
// (/api/assistant/files/…) menjadi tombol unduh dengan ikon Excel atau PDF.
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|(?<![\w*])\*[^*\s][^*]*\*(?!\w))/g).map((part, index) => {
    if (!part) return null;
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{inline(part.slice(2, -2))}</strong>;
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) return <code key={index}>{part.slice(1, -1)}</code>;
    if (/^\*[^*].*\*$/.test(part)) return <em key={index}>{part.slice(1, -1)}</em>;
    const link = part.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
    if (link) {
      const [, label, href] = link;
      if (href.startsWith("/api/assistant/files/")) {
        const pdf = /\.pdf\b/i.test(label);
        const Icon = pdf ? FileText : FileSpreadsheet;
        return <a className="ask-eline-file" download href={href} key={index}><span className={`ask-eline-file-icon${pdf ? " pdf" : ""}`}><Icon size={18} /></span><span><strong>{label.replace(/^Download\s+/i, "")}</strong><small>{pdf ? "PDF" : "Excel"} · Download</small></span><Download size={16} /></a>;
      }
      // Draf menu dari prepare_menu_draft: tombol ke halaman periksa (panel chat tetap terbuka).
      if (href.startsWith("/admin/products/import?draft=")) return <Link className="ask-eline-file" href={href} key={index}><span className="ask-eline-file-icon"><Sparkles size={18} /></span><span><strong>{label}</strong><small>Nothing is saved yet</small></span><ArrowRight size={16} /></Link>;
      if (/^(https?:\/\/|\/(?![/\\]))/.test(href)) return <a className="link" href={href} key={index} rel="noreferrer" target={href.startsWith("/") ? undefined : "_blank"}>{label}</a>;
    }
    return <Fragment key={index}>{part}</Fragment>;
  });
}

// Angka sel tabel (Rp 1.250.000, 12%, -3) rata kanan seperti tabel dashboard.
const numeric = (cell: string) => /^[-−+]?\s*(Rp\s?)?[\d.,]+\s*(%|x|×|rb|k|jt)?$/i.test(cell.replace(/\*\*/g, "").trim());

// Grafik dari blok ```chart berisi JSON (lihat instruksi di server/assistant.ts):
// batang mendatar untuk peringkat, kolom tegak untuk deret waktu, opsional
// `compare` (periode sebelumnya) sebagai batang pucat.
type Chart = { type?: "bar" | "column"; title?: string; unit?: string; labels: string[]; values: number[]; compare?: number[]; compareLabel?: string; valueLabel?: string };
function parseChart(source: string): Chart | null {
  try {
    const chart = JSON.parse(source) as Chart;
    if (!Array.isArray(chart.labels) || !Array.isArray(chart.values) || !chart.labels.length || chart.labels.length !== chart.values.length) return null;
    if (chart.values.some((value) => typeof value !== "number" || !Number.isFinite(value))) return null;
    return { ...chart, labels: chart.labels.slice(0, 31).map(String), values: chart.values.slice(0, 31), compare: Array.isArray(chart.compare) && chart.compare.length === chart.values.length ? chart.compare.slice(0, 31) : undefined };
  } catch {
    return null;
  }
}
const chartNumber = (value: number, unit = "") => {
  const text = Math.abs(value) >= 1_000_000 ? `${(value / 1_000_000).toLocaleString("id-ID", { maximumFractionDigits: 1 })} jt` : Math.abs(value) >= 10_000 ? `${Math.round(value / 1000).toLocaleString("id-ID")} rb` : value.toLocaleString("id-ID");
  return unit.toLowerCase() === "rp" ? `Rp ${text}` : unit ? `${text}${unit.startsWith("%") ? "" : " "}${unit}` : text;
};

function ChartBlock({ chart }: { chart: Chart }) {
  const max = Math.max(1, ...chart.values, ...(chart.compare ?? []));
  const legend = chart.compare ? <div className="ask-chart-legend"><span><i />{chart.valueLabel ?? "This period"}</span><span><i className="soft" />{chart.compareLabel ?? "Previous"}</span></div> : null;
  if (chart.type === "column") {
    return (
      <figure className="ask-chart">
        {chart.title ? <figcaption>{chart.title}</figcaption> : null}
        <div className="ask-chart-columns" style={{ gridTemplateColumns: `repeat(${chart.values.length}, minmax(0, 1fr))` }}>
          {chart.values.map((value, index) => (
            <div className="ask-chart-column" key={index} title={`${chart.labels[index]}: ${chartNumber(value, chart.unit)}`}>
              <div className="ask-chart-stack">
                {chart.compare ? <span className="soft" style={{ height: `${(chart.compare[index] / max) * 100}%` }} /> : null}
                <span style={{ height: `${(Math.max(0, value) / max) * 100}%`, animationDelay: `${index * 30}ms` }} />
              </div>
              <small>{chart.labels[index]}</small>
            </div>
          ))}
        </div>
        {legend}
      </figure>
    );
  }
  return (
    <figure className="ask-chart">
      {chart.title ? <figcaption>{chart.title}</figcaption> : null}
      <div className="ask-chart-bars">
        {chart.values.map((value, index) => (
          <div className="ask-chart-row" key={index}>
            <span className="ask-chart-label">{chart.labels[index]}</span>
            <span className="ask-chart-track">
              {chart.compare ? <span className="soft" style={{ width: `${(chart.compare[index] / max) * 100}%` }} /> : null}
              <span style={{ width: `${(Math.max(0, value) / max) * 100}%`, animationDelay: `${index * 40}ms` }} />
            </span>
            <span className="ask-chart-value">{chartNumber(value, chart.unit)}</span>
          </div>
        ))}
      </div>
      {legend}
    </figure>
  );
}

// Markdown secukupnya: judul, paragraf, daftar, kutipan, garis, tabel (dengan
// perataan kolom), blok kode, dan grafik. Blok yang belum selesai saat jawaban
// masih mengalir tetap tampil (kode) atau menunggu (grafik).
function Rich({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; start: number; items: string[] } | null = null;
  let table: string[][] | null = null;
  let align: Array<"left" | "right" | undefined> = [];
  let quote: string[] | null = null;
  const flush = () => {
    if (list) {
      const items = list.items.map((item, index) => <li key={index}>{inline(item)}</li>);
      blocks.push(list.ordered ? <ol key={blocks.length} start={list.start}>{items}</ol> : <ul key={blocks.length}>{items}</ul>);
      list = null;
    }
    if (table) {
      const [head, ...body] = table;
      const right = head.map((_, column) => align[column] === "right" || (align[column] !== "left" && body.length > 0 && body.every((row) => !row[column] || numeric(row[column]))));
      blocks.push(<div className="ask-eline-table" key={blocks.length}><table><thead><tr>{head.map((cell, index) => <th className={right[index] ? "right" : undefined} key={index}>{inline(cell)}</th>)}</tr></thead>
        <tbody>{body.map((row, rowIndex) => <tr key={rowIndex}>{head.map((_, index) => <td className={right[index] ? "right num" : undefined} key={index}>{inline(row[index] ?? "")}</td>)}</tr>)}</tbody></table></div>);
      table = null;
      align = [];
    }
    if (quote) {
      blocks.push(<blockquote key={blocks.length}>{quote.map((line, index) => <p key={index}>{inline(line)}</p>)}</blockquote>);
      quote = null;
    }
  };
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    const fence = line.match(/^```\s*([\w-]*)/);
    if (fence) {
      flush();
      const body: string[] = [];
      let closed = false;
      for (index += 1; index < lines.length; index += 1) {
        if (lines[index].trim().startsWith("```")) { closed = true; break; }
        body.push(lines[index]);
      }
      if (fence[1] === "chart") {
        const chart = closed ? parseChart(body.join("\n")) : null;
        blocks.push(chart ? <ChartBlock chart={chart} key={blocks.length} /> : closed ? null : <div className="ask-chart pending" key={blocks.length}><BarChart3 size={16} /> Drawing the chart…</div>);
      } else blocks.push(<pre key={blocks.length}><code>{body.join("\n")}</code></pre>);
      continue;
    }
    if (/^\|.*\|$/.test(line)) {
      if (list || quote) { const rows: string[][] | null = table; table = null; flush(); table = rows; }
      if (/^\|[\s:|-]+\|$/.test(line)) {
        align = line.slice(1, -1).split("|").map((cell) => (/^\s*:?-+:\s*$/.test(cell) ? "right" : /^\s*:-+\s*$/.test(cell) ? "left" : undefined));
        continue;
      }
      (table ??= []).push(line.slice(1, -1).split("|").map((cell) => cell.trim()));
      continue;
    }
    if (line.startsWith(">")) {
      if (list || table) flush();
      (quote ??= []).push(line.replace(/^>\s?/, ""));
      continue;
    }
    const bullet = line.match(/^[-*•]\s+(.*)$/);
    const numbered = line.match(/^(\d+)[.)]\s+(.*)$/);
    if ((bullet || numbered) && !/^(-{3,}|\*{3,})$/.test(line)) {
      const ordered = Boolean(numbered);
      if (table || quote || (list && list.ordered !== ordered)) flush();
      list ??= { ordered, start: numbered ? Number(numbered[1]) : 1, items: [] };
      list.items.push(bullet ? bullet[1] : numbered![2]);
      continue;
    }
    flush();
    if (!line) continue;
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) blocks.push(<hr key={blocks.length} />);
    else if (/^#{1,6}\s/.test(line)) {
      const level = line.match(/^#+/)![0].length;
      blocks.push(<p className={`ask-eline-heading h${Math.min(level, 3)}`} key={blocks.length}>{inline(line.replace(/^#+\s*/, ""))}</p>);
    } else blocks.push(<p key={blocks.length}>{inline(line)}</p>);
  }
  flush();
  return <>{blocks}</>;
}

export function AskEline({ role, name }: { role: string; name: string }) {
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
  const firstName = name.trim().split(/\s+/)[0] || "there";
  const suggestions = manager
    ? ["How did we do this week vs last week?", "Which products make the most profit?", "Make last month's sales report as a PDF", "Export this month's orders to Excel"]
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
            <span className="ask-eline-mark"><Sparkles size={15} /></span>
            <strong>Eline</strong>
            <span className="ask-eline-head-actions">
              {messages.length ? <button aria-label="New conversation" className="ask-eline-tool" disabled={busy} onClick={() => { setMessages([]); setError(null); input.current?.focus(); }} title="New conversation" type="button"><SquarePen size={16} /></button> : null}
              <button aria-label="Close" className="ask-eline-tool" onClick={() => setOpen(false)} title="Close" type="button"><X size={17} /></button>
            </span>
          </header>
          <div className="ask-eline-list" ref={list}>
            {messages.length ? messages.map((message, index) => (
              <div className={`ask-eline-msg ${message.role}`} key={index}>
                {message.role === "assistant" ? (message.content ? (
                  <>
                    <Rich text={message.content} />
                    {!busy || index < messages.length - 1 ? <CopyAnswer text={message.content} /> : null}
                  </>
                ) : status ? <span className="ask-eline-status"><Sparkles size={14} />{status}…</span> : <span className="ask-eline-typing" aria-label="Eline is typing"><i /><i /><i /></span>) : <p>{message.content}</p>}
              </div>
            )) : (
              <div className="ask-eline-empty">
                <span className="ask-eline-mark big"><Sparkles size={22} /></span>
                <strong>Hi {firstName}, how can I help?</strong>
                <p>{manager ? "Sales, stock, shifts, or a report in Excel or PDF." : "Ask how to do anything in Mangalli."}</p>
                <div className="ask-eline-suggest">{suggestions.map((suggestion) => (
                  <button key={suggestion} onClick={() => send(suggestion)} type="button"><span>{suggestion}</span><ArrowRight size={14} /></button>
                ))}</div>
              </div>
            )}
            {error ? <p className="ask-eline-error" role="alert">{error}</p> : null}
          </div>
          <form className="ask-eline-compose" onSubmit={(event) => { event.preventDefault(); void send(draft); }}>
            <div className="ask-eline-box">
              <textarea
                aria-label="Your question" maxLength={2000} onChange={(event) => setDraft(event.target.value)} placeholder="Ask Eline…" ref={input} rows={1} value={draft}
                onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(draft); } }}
              />
              <button aria-label="Send" className="ask-eline-send" disabled={busy || !draft.trim()} type="submit"><ArrowUp size={17} /></button>
            </div>
            <small className="ask-eline-foot">Eline reads this outlet&apos;s data and can&apos;t change anything.</small>
          </form>
        </aside>
      ) : null}
    </>
  );
}

// Salin jawaban (teks markdown apa adanya) untuk ditempel ke WhatsApp atau catatan.
function CopyAnswer({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button className="ask-eline-copy" onClick={() => { void navigator.clipboard?.writeText(text.replace(/```chart[\s\S]*?```/g, "").trim()).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }} type="button">
      {copied ? <Check size={13} /> : <Copy size={13} />}{copied ? "Copied" : "Copy"}
    </button>
  );
}

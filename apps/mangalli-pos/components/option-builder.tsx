"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";

// Varian di form "Add product" (permintaan owner 13 Okt 2026): grup opsi
// (ukuran, level gula, topping) disusun sebelum produk disimpan, lalu dikirim
// sebagai JSON di isian `options` dan dibuat dalam transaksi yang sama.
// Produk yang sudah ada tetap memakai ModifierEditor (simpan per baris).
type Option = { key: number; name: string; price: string };
type Group = { key: number; name: string; required: boolean; max: string; options: Option[] };

let next = 1;
const blankOption = (): Option => ({ key: next++, name: "", price: "" });
const blankGroup = (): Group => ({ key: next++, name: "", required: true, max: "1", options: [blankOption()] });

export function OptionBuilder({ name = "options" }: { name?: string }) {
  const [groups, setGroups] = useState<Group[]>([]);
  const update = (key: number, change: (group: Group) => Group) => setGroups((current) => current.map((group) => (group.key === key ? change(group) : group)));
  // Yang dikirim hanya grup bernama dengan opsi bernama; baris kosong diabaikan.
  const value = groups
    .map((group) => ({ name: group.name.trim(), isRequired: group.required, maxSelect: Math.max(1, Number(group.max) || 1), options: group.options.filter((option) => option.name.trim()).map((option) => ({ name: option.name.trim(), priceDelta: Number(option.price) || 0 })) }))
    .filter((group) => group.name || group.options.length);

  return (
    <div className="option-builder">
      {groups.map((group, index) => (
        <div className="line-items option-group" key={group.key}>
          <div className="option-group-head">
            <input aria-label={`Group ${index + 1} name`} autoFocus={!group.name} maxLength={80} onChange={(event) => update(group.key, (current) => ({ ...current, name: event.target.value }))} placeholder="Group name, e.g. Size" value={group.name} />
            <label className="input-affix option-max" title="How many options a customer can pick">
              <span>Max</span>
              <input aria-label="Max choices" inputMode="numeric" max="20" min="1" onChange={(event) => update(group.key, (current) => ({ ...current, max: event.target.value }))} type="number" value={group.max} />
            </label>
            <label className="chip"><input checked={group.required} onChange={(event) => update(group.key, (current) => ({ ...current, required: event.target.checked }))} type="checkbox" /> Required</label>
            <button aria-label={`Remove ${group.name || "group"}`} className="icon-button small danger" onClick={() => setGroups((current) => current.filter((item) => item.key !== group.key))} type="button"><Trash2 size={15} /></button>
          </div>
          {group.options.map((option) => (
            <div className="line-item option-row" key={option.key}>
              <div className="option-edit">
                <input aria-label="Option name" maxLength={80} onChange={(event) => update(group.key, (current) => ({ ...current, options: current.options.map((item) => (item.key === option.key ? { ...item, name: event.target.value } : item)) }))} placeholder="Option, e.g. Large" value={option.name} />
                <span className="input-affix"><span>+Rp</span><input aria-label="Extra price" inputMode="numeric" min="0" onChange={(event) => update(group.key, (current) => ({ ...current, options: current.options.map((item) => (item.key === option.key ? { ...item, price: event.target.value } : item)) }))} placeholder="0" type="number" value={option.price} /></span>
              </div>
              <button aria-label={`Remove ${option.name || "option"}`} className="icon-button small danger" disabled={group.options.length === 1} onClick={() => update(group.key, (current) => ({ ...current, options: current.options.filter((item) => item.key !== option.key) }))} type="button"><Trash2 size={15} /></button>
            </div>
          ))}
          <div className="line-item option-add">
            <button className="button small ghost" onClick={() => update(group.key, (current) => ({ ...current, options: [...current.options, blankOption()] }))} type="button"><Plus size={14} /> Add option</button>
          </div>
        </div>
      ))}
      <button className="button option-builder-add" onClick={() => setGroups((current) => [...current, blankGroup()])} type="button"><Plus size={15} /> {groups.length ? "Add another group" : "Add option group"}</button>
      <input name={name} type="hidden" value={value.length ? JSON.stringify(value) : ""} />
    </div>
  );
}

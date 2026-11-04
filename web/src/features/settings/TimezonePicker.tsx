import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { getTimezones, type TimezoneOption } from "../../api/settings";
import { useAsync } from "../../api/useAsync";
import { cx, fieldClass } from "../../ui/cx";
import "./timezone.css";

interface Props {
  value: string | null;
  onChange: (tz: string) => void;
  describedBy?: string;
}

// Offsets are strings from the server (moment-timezone). The browser only shows them, it never works them out.
const label = (zone: TimezoneOption) => zone.offset ? `GMT${zone.offset}` : "";
const words = (text: string) => text.toLowerCase().replace(/[_/]+/g, " ").replace(/\s+/g, " ").trim();

export function TimezonePicker({ value, onChange, describedBy }: Props) {
  const zones = useAsync(async () => (await getTimezones()).zones, []);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const labelId = useId();
  const listId = useId();

  // A saved zone that is not offered (an alias, for example) stays selectable at the top.
  const options = useMemo(() => {
    const all = zones.data ?? [];
    return value && !all.some((zone) => zone.id === value) ? [{ id: value, offset: "" }, ...all] : all;
  }, [zones.data, value]);
  const shown = useMemo(() => {
    const q = words(query);
    return q ? options.filter((zone) => words(zone.id).includes(q) || zone.offset.includes(query.trim())) : options;
  }, [options, query]);
  const current = options.find((zone) => zone.id === value);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);
  useEffect(() => { if (open) search.current?.focus(); }, [open]);
  useEffect(() => { list.current?.children[active]?.scrollIntoView({ block: "nearest" }); }, [active, open]);

  function show() {
    setQuery("");
    setActive(Math.max(0, options.findIndex((zone) => zone.id === value)));
    setOpen(true);
  }
  function choose(zone: TimezoneOption) {
    onChange(zone.id);
    setOpen(false);
    trigger.current?.focus();
  }
  function onKey(event: KeyboardEvent) {
    if (event.key === "ArrowDown") { event.preventDefault(); setActive((index) => Math.min(shown.length - 1, index + 1)); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActive((index) => Math.max(0, index - 1)); }
    else if (event.key === "Enter") { event.preventDefault(); if (shown[active]) choose(shown[active]); }
    else if (event.key === "Escape") { event.preventDefault(); setOpen(false); trigger.current?.focus(); }
  }

  // If the list cannot load, fall back to typing an IANA name. The server still validates it.
  if (zones.error) return <input required type="text" value={value ?? ""} placeholder="Missing" spellCheck={false} aria-label="Timezone"
    onChange={(event) => onChange(event.target.value)} className={fieldClass} aria-describedby={describedBy} />;

  return <div ref={root} className="tzp">
    <span id={labelId} className="sr-only">Timezone</span>
    <button ref={trigger} type="button" role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-controls={listId}
      aria-labelledby={labelId} aria-describedby={describedBy} onClick={() => (open ? setOpen(false) : show())}
      className={cx(fieldClass, "tzp-trigger")}>
      <span className={cx("tzp-value", !value && "text-muted")}>{value ?? "Missing"}</span>
      {current && label(current) && <span className="tzp-offset">{label(current)}</span>}
      <span className="tzp-caret" aria-hidden="true" />
    </button>
    {open && <div className="tzp-panel animate-enter">
      <input ref={search} type="text" role="searchbox" value={query} placeholder="Search city, region or offset" spellCheck={false} autoComplete="off"
        aria-label="Search timezones" aria-controls={listId} onChange={(event) => { setQuery(event.target.value); setActive(0); }} onKeyDown={onKey} className={cx(fieldClass, "tzp-search")} />
      <ul ref={list} id={listId} role="listbox" aria-label="Timezones" className="tzp-list">
        {shown.map((zone, index) => <li key={zone.id} role="option" aria-selected={zone.id === value}
          className={cx("tzp-option", index === active && "is-active", zone.id === value && "is-selected")}
          onMouseEnter={() => setActive(index)} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(zone)}>
          <span className="tzp-dot" aria-hidden="true" />
          <span className="tzp-name">{zone.id}</span>
          <span className="tzp-offset">{label(zone)}</span>
        </li>)}
        {!zones.loading && shown.length === 0 && <li className="tzp-empty">No timezone matches</li>}
        {zones.loading && <li className="tzp-empty">Loading timezones</li>}
      </ul>
    </div>}
  </div>;
}

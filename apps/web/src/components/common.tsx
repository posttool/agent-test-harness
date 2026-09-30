import { useState, type ReactNode } from "react";

export const time = (iso: string) => iso.slice(11, 19);

export function Json({ value }: { value: unknown }) {
  return <pre className="json">{JSON.stringify(value, null, 2)}</pre>;
}

export function Collapsible({ title, children, open = false, right }: { title: ReactNode; children: ReactNode; open?: boolean; right?: ReactNode }) {
  const [isOpen, setOpen] = useState(open);
  return (
    <div className={`collapsible${isOpen ? " open" : ""}`}>
      <div className="collapsible-head" onClick={() => setOpen(!isOpen)}>
        <span className="chev">{isOpen ? "▾" : "▸"}</span>
        <span className="collapsible-title">{title}</span>
        {right ? <span className="right">{right}</span> : null}
      </div>
      {isOpen ? <div className="collapsible-body">{children}</div> : null}
    </div>
  );
}

export function Badge({ children, tone = "plain" }: { children: ReactNode; tone?: "plain" | "accent" | "ok" | "warn" | "bad" }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

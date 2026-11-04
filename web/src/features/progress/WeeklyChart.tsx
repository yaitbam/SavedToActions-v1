import { useId } from "react";
import type { Insights } from "../../api/types";
import { Card } from "../../ui/Card";

export function WeeklyChart({ weekly: history, note }: { weekly: Insights["weekly"]; note: string | null }) {
  const titleId = useId();
  const firstRecord = history.findIndex((week) => week.importedSaves > 0 || week.doneSaves > 0);
  const weekly = firstRecord < 0 ? [] : history.slice(Math.max(0, firstRecord - 1));
  const max = Math.max(1, ...weekly.map((week) => Math.max(week.importedSaves, week.doneSaves)));
  const x = (index: number) => 44 + (index * 640) / Math.max(1, weekly.length - 1);
  const y = (value: number) => 156 - (value / max) * 128;
  const points = (key: "importedSaves" | "doneSaves") => weekly.map((week, i) => `${x(i)},${y(week[key])}`).join(" ");

  return (
    <Card className="space-y-3" pad="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base">Saves into action, by week</h2>
        <div className="flex gap-4 text-small">
          <span className="flex items-center gap-2"><span aria-hidden className="h-0.5 w-5 bg-ink" />Imported saves</span>
          <span className="flex items-center gap-2"><span aria-hidden className="h-0.5 w-5 bg-fits" />Saves marked done</span>
        </div>
      </div>
      {weekly.length ? (
        <>
          <svg viewBox="0 0 728 192" role="img" aria-labelledby={titleId} className="w-full text-small">
            <title id={titleId}>Cumulative imported saves and saves marked done by week. Values follow in a table.</title>
            {[0, max / 2, max].filter((tick) => Number.isInteger(tick)).map((tick) => (
              <g key={tick}>
                <line x1="44" x2="684" y1={y(tick)} y2={y(tick)} className="stroke-line" />
                <text x="32" y={y(tick) + 4} textAnchor="end" className="fill-muted">{tick}</text>
              </g>
            ))}
            <polyline points={points("importedSaves")} fill="none" strokeWidth="2.5" className="stroke-ink" />
            <polyline points={points("doneSaves")} fill="none" strokeWidth="2.5" strokeDasharray="6 3" className="stroke-fits" />
            {weekly.map((week, i) => (
              <g key={week.weekStart}>
                <circle cx={x(i)} cy={y(week.importedSaves)} r="3" className="fill-ink" />
                <circle cx={x(i)} cy={y(week.doneSaves)} r="3" className="fill-fits" />
                <text x={x(i)} y="184" textAnchor="middle" className="fill-muted">{week.label}</text>
              </g>
            ))}
          </svg>
          <table className="sr-only">
            <caption>Weekly cumulative records</caption>
            <thead><tr><th>Week</th><th>Imported saves</th><th>Saves marked done</th></tr></thead>
            <tbody>{weekly.map((week) => (
              <tr key={week.weekStart}><th scope="row">{week.label}</th><td>{week.importedSaves}</td><td>{week.doneSaves}</td></tr>
            ))}</tbody>
          </table>
        </>
      ) : <p className="text-small text-muted">Weekly records will appear here after your first save</p>}
      {note && <p className="text-small text-muted">{note}</p>}
    </Card>
  );
}

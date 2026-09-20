import { useState } from "react";
import {
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  startOfMonth,
  startOfWeek,
  format,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { localDay, displayDate, type Content } from "./model";
export function ContentCalendar({
  contents,
  onCreate,
  onEdit,
}: {
  contents: Content[];
  onCreate: (date: string) => void;
  onEdit: (content: Content) => void;
}) {
  const [date, setDate] = useState(new Date());
  const [view, setView] = useState("month");
  const [selected, setSelected] = useState(localDay());
  const start =
    view === "week"
      ? startOfWeek(date, { weekStartsOn: 1 })
      : startOfWeek(startOfMonth(date), { weekStartsOn: 1 });
  const end =
    view === "week"
      ? endOfWeek(date, { weekStartsOn: 1 })
      : endOfWeek(endOfMonth(date), { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start, end });
  const dated = contents
    .filter((c) => (c.status === "published" ? c.published_at : c.planned_at))
    .sort((a, b) =>
      (a.status === "published" ? a.published_at : a.planned_at)!.localeCompare(
        (b.status === "published" ? b.published_at : b.planned_at)!,
      ),
    );
  const dayOf = (c: Content) =>
    localDay((c.status === "published" ? c.published_at : c.planned_at)!);
  const shown = dated.filter((c) =>
    view === "list"
      ? dayOf(c) >= localDay(start) && dayOf(c) <= localDay(end)
      : dayOf(c) === selected,
  );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          aria-label="Período anterior"
          onClick={() =>
            setDate(view === "week" ? addWeeks(date, -1) : addMonths(date, -1))
          }
        >
          ←
        </Button>
        <h3 className="capitalize text-sm font-medium">
          {format(date, "MMMM yyyy", { locale: ptBR })}
        </h3>
        <Button
          variant="outline"
          aria-label="Próximo período"
          onClick={() =>
            setDate(view === "week" ? addWeeks(date, 1) : addMonths(date, 1))
          }
        >
          →
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setDate(new Date());
            setSelected(localDay());
          }}
        >
          Hoje
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {[
          ["month", "Mês"],
          ["week", "Semana"],
          ["list", "Lista"],
        ].map(([k, l]) => (
          <Button
            key={k}
            variant={view === k ? "secondary" : "ghost"}
            onClick={() => setView(k)}
          >
            {l}
          </Button>
        ))}
      </div>
      {view !== "list" && (
        <div className="grid grid-cols-7 gap-1">
          {["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"].map((x) => (
            <div key={x} className="text-center text-xs text-muted-foreground">
              {x}
            </div>
          ))}
          {days.map((d) => {
            const key = localDay(d),
              count = dated.filter((c) => dayOf(c) === key).length;
            return (
              <button
                key={key}
                aria-label={`${key}, ${count} conteúdos`}
                aria-pressed={selected === key}
                onClick={() => setSelected(key)}
                onDoubleClick={() => onCreate(key)}
                className={`min-h-12 min-w-0 rounded-md border p-1 text-sm sm:min-h-20 ${selected === key ? "border-foreground bg-secondary" : "border-border"} ${d.getMonth() !== date.getMonth() ? "text-muted-foreground" : ""}`}
              >
                <span>{d.getDate()}</span>
                {count > 0 && (
                  <span className="block text-xs">
                    {count}
                    <span className="hidden sm:inline"> conteúdo(s)</span>
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm">
          {view === "list" ? "Conteúdos do período" : displayDate(selected)}
        </h3>
        <Button variant="outline" onClick={() => onCreate(selected)}>
          Adicionar conteúdo
        </Button>
      </div>
      {shown.length === 0 && (
        <p className="py-4 text-sm text-muted-foreground">
          Nenhum conteúdo neste período.
        </p>
      )}
      {shown.map((c) => (
        <button
          className="block w-full rounded-lg border bg-card p-3 text-left"
          key={c.id}
          onClick={() => onEdit(c)}
        >
          <p className="break-words text-sm font-medium">{c.title}</p>
          <p className="text-xs text-muted-foreground">
            {c.format} ·{" "}
            {displayDate(
              c.status === "published" ? c.published_at : c.planned_at,
            )}
            {c.status === "published" ? " · Publicado" : ""}
          </p>
        </button>
      ))}
      <p className="text-xs text-muted-foreground">
        Selecione um dia e use Adicionar conteúdo. O planejamento não publica
        automaticamente no Instagram.
      </p>
    </div>
  );
}

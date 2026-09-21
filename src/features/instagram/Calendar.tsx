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
import { ChevronLeft, ChevronRight } from "lucide-react";
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
  const today = localDay();
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label="Período anterior"
            onClick={() =>
              setDate(view === "week" ? addWeeks(date, -1) : addMonths(date, -1))
            }
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <h3 className="min-w-[9.5rem] text-center text-sm font-medium capitalize tracking-tight">
            {format(date, "MMMM yyyy", { locale: ptBR })}
          </h3>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label="Próximo período"
            onClick={() =>
              setDate(view === "week" ? addWeeks(date, 1) : addMonths(date, 1))
            }
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-muted-foreground"
            onClick={() => {
              setDate(new Date());
              setSelected(localDay());
            }}
          >
            Hoje
          </Button>
        </div>
        <div className="inline-flex rounded-md bg-muted/40 p-0.5">
          {[
            ["month", "Mês"],
            ["week", "Semana"],
            ["list", "Lista"],
          ].map(([k, l]) => (
            <Button
              key={k}
              variant="ghost"
              size="sm"
              className={`h-8 px-3 text-xs ${
                view === k
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setView(k)}
            >
              {l}
            </Button>
          ))}
        </div>
      </div>
      {view !== "list" && (
        <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg bg-border/40">
          {["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"].map((x) => (
            <div
              key={x}
              className="bg-background py-2 text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
            >
              {x}
            </div>
          ))}
          {days.map((d) => {
            const key = localDay(d),
              count = dated.filter((c) => dayOf(c) === key).length;
            const isSelected = selected === key;
            const isToday = key === today;
            const outside = d.getMonth() !== date.getMonth();
            return (
              <button
                key={key}
                aria-label={`${key}, ${count} conteúdos`}
                aria-pressed={isSelected}
                onClick={() => setSelected(key)}
                onDoubleClick={() => onCreate(key)}
                className={`flex min-h-12 min-w-0 flex-col items-start gap-1 bg-background p-1.5 text-left text-sm transition-colors sm:min-h-[4.5rem] sm:p-2 ${
                  isSelected
                    ? "bg-secondary"
                    : "hover:bg-muted/40"
                } ${outside ? "text-muted-foreground/50" : ""}`}
              >
                <span
                  className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                    isToday && !isSelected
                      ? "bg-foreground text-background"
                      : isSelected
                        ? "font-semibold"
                        : ""
                  }`}
                >
                  {d.getDate()}
                </span>
                {count > 0 && (
                  <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <span className="h-1.5 w-1.5 rounded-full bg-foreground/70" />
                    <span className="tabular-nums">{count}</span>
                    <span className="hidden sm:inline">
                      {count === 1 ? "item" : "itens"}
                    </span>
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm text-muted-foreground">
          {view === "list" ? "Conteúdos do período" : displayDate(selected)}
        </h3>
        <Button size="sm" variant="outline" onClick={() => onCreate(selected)}>
          Adicionar conteúdo
        </Button>
      </div>
      {shown.length === 0 && (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Nenhum conteúdo neste período.
        </p>
      )}
      <div className="divide-y divide-border/60">
        {shown.map((c) => (
          <button
            className="block w-full py-3 text-left transition-colors hover:bg-muted/30"
            key={c.id}
            onClick={() => onEdit(c)}
          >
            <p className="break-words text-sm font-medium">{c.title}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {c.format} ·{" "}
              {displayDate(
                c.status === "published" ? c.published_at : c.planned_at,
              )}
              {c.status === "published" ? " · Publicado" : ""}
            </p>
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground/80">
        Selecione um dia e use Adicionar conteúdo. O planejamento não publica
        automaticamente no Instagram.
      </p>
    </div>
  );
}

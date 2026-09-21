export interface Base {
  id: string;
  user_id: string;
  created_at: string;
  updated_at: string;
}
export interface Project extends Base {
  name: string;
  image_url: string | null;
}
export interface Account extends Base {
  project_id: string | null;
  username: string;
  name: string;
  avatar_url: string | null;
  category: string | null;
  status: string;
  niche: string | null;
  instagram_url: string | null;
  email: string | null;
  phone: string | null;
  responsible: string | null;
  account_created_on: string | null;
  notes: string | null;
}
export interface Label extends Base {
  name: string;
}
export interface AccountLabel extends Base {
  account_id: string;
  label_id: string;
}
export interface Content extends Base {
  account_id: string;
  title: string;
  caption: string | null;
  hashtags: string | null;
  notes: string | null;
  media_url: string | null;
  thumbnail_url: string | null;
  format: string;
  status: string;
  planned_at: string | null;
  published_at: string | null;
  publication_url: string | null;
}
export interface Task extends Base {
  account_id: string;
  title: string;
  description: string | null;
  notes: string | null;
  due_at: string | null;
  priority: string;
  status: string;
}
export const metricNames = {
  followers: "Seguidores",
  following: "Seguindo",
  posts: "Publicações",
  views: "Visualizações",
  reach: "Alcance",
  likes: "Curtidas",
  comments: "Comentários",
  shares: "Compartilhamentos",
  saves: "Salvamentos",
};
export type MetricKey = keyof typeof metricNames;
export type Metric = Base & {
  account_id: string;
  recorded_on: string;
} & Record<MetricKey, number | null>;
export interface History extends Base {
  account_id: string;
  action: string;
  details: Record<string, string | null>;
}
export interface Rows {
  projects: Project;
  accounts: Account;
  labels: Label;
  account_labels: AccountLabel;
  contents: Content;
  tasks: Task;
  metrics: Metric;
  history: History;
}
export type Table = keyof Rows;
export const statuses = {
  creating: "Em criação",
  warming: "Aquecendo",
  active: "Ativa",
};
export const stages = {
  idea: "Ideia",
  produce: "Para produzir",
  producing: "Em produção",
  ready: "Pronto",
  scheduled: "Agendado",
  published: "Publicado",
};
export const taskStatuses = {
  todo: "Pendente",
  doing: "Em andamento",
  done: "Concluída",
};
export const priorities = { low: "Baixa", medium: "Média", high: "Alta" };
export const defaultLabels = [
  "Principal",
  "Backup",
  "Aquecimento",
  "Nova",
  "Teste",
  "Reels",
  "Secundária",
];
export function localDay(value: Date | string = new Date()) {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function localInput(value: string) {
  const d = new Date(value);
  return `${localDay(d)}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
export function safeUrl(value: string | null | undefined) {
  if (!value) return undefined;
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:"
      ? u.href
      : undefined;
  } catch {
    return undefined;
  }
}
export function displayDate(value: string | null | undefined) {
  return value
    ? new Date(
        value.length === 10 ? `${value}T12:00:00` : value,
      ).toLocaleString(
        "pt-BR",
        value.length === 10
          ? { dateStyle: "short" }
          : { dateStyle: "short", timeStyle: "short" },
      )
    : "Sem data";
}
export function matchesSearch(
  a: Account,
  project: string,
  labels: string[],
  search: string,
) {
  return [a.username, a.name, a.notes, project, ...labels]
    .join(" ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .includes(
      search
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase(),
    );
}

import { describe, it, expect } from "vitest";
import {
  buildFlow,
  type FlowInput,
} from "../../../supabase/functions/instagram-publisher/flow";
const user = "00000000-0000-4000-8000-000000000001";
const accounts = [
  "00000000-0000-4000-8000-000000000002",
  "00000000-0000-4000-8000-000000000003",
];
const library = Array.from({ length: 4 }, (_, i) => ({
  id: String(i),
  url: `storage://${user}/${i}.jpg`,
  kind: "posts",
  caption: i === 0 ? "própria" : "",
}));
const input: FlowInput = {
  id: user,
  name: "Teste",
  accountIds: accounts,
  mediaIds: library.map((m) => m.id),
  gapMinutes: 3,
  random: false,
  distribution: "all",
  format: "auto",
  kind: "posts",
  caption: "Padrão",
  variations: ["A", "B"],
  startAt: null,
  coverId: null,
};
describe("Fluxos de publicação", () => {
  it("distribui todas as mídias para cada conta sem alterar a biblioteca", () => {
    const jobs = buildFlow(input, library, user, 0);
    expect(jobs).toHaveLength(8);
    for (const id of accounts) {
      const own = jobs.filter((j) => j.account_id === id);
      expect(own.map((j) => j.media_urls[0])).toEqual(
        library.map((m) => m.url),
      );
      expect(
        Date.parse(own[1].scheduled_at!) - Date.parse(own[0].scheduled_at!),
      ).toBe(180000);
    }
    expect(jobs[0].caption).toBe("própria");
    expect(jobs[1].caption).toBe("B");
    expect(library[0].id).toBe("0");
  });
  it("divide sem repetir ou perder mídias e mantém o GAP por conta", () => {
    const jobs = buildFlow(
      { ...input, distribution: "split", random: true },
      library,
      user,
      0,
      () => 0,
    );
    expect(jobs).toHaveLength(4);
    expect(new Set(jobs.map((j) => j.media_urls[0])).size).toBe(4);
    expect(jobs.filter((j) => j.account_id === accounts[0])).toHaveLength(2);
  });
  it("randomiza independentemente sem modificar a ordem original", () => {
    const jobs = buildFlow(
      { ...input, random: true },
      library,
      user,
      0,
      () => 0,
    );
    expect(jobs.slice(0, 4).map((j) => j.media_urls[0])).not.toEqual(
      library.map((m) => m.url),
    );
    expect(library.map((m) => m.id)).toEqual(["0", "1", "2", "3"]);
  });
  it("escolhe formatos, capa só em reels e stories sem legenda", () => {
    const media = [
      ...library,
      { id: "v", url: `storage://${user}/v.mp4`, kind: "posts", caption: "" },
      { id: "c", url: `storage://${user}/c.jpg`, kind: "cover", caption: "" },
    ];
    const jobs = buildFlow(
      { ...input, mediaIds: ["0", "v"], coverId: "c" },
      media,
      user,
      0,
    );
    expect(jobs[0].format).toBe("Feed");
    expect(jobs[0].cover_url).toBeNull();
    expect(jobs[1].format).toBe("Reel");
    expect(jobs[1].cover_url).toBe(media[5].url);
    const stories = buildFlow(
      { ...input, kind: "stories" },
      library.map((m) => ({ ...m, kind: "stories" })),
      user,
      0,
    );
    expect(stories.every((j) => j.format === "Story" && j.caption === "")).toBe(
      true,
    );
  });
  it("rejeita mídia alheia, tipo incompatível, horário passado, duplicatas e GAP curto", () => {
    for (const changes of [
      { mediaIds: ["other"] },
      { gapMinutes: 2 },
      { mediaIds: ["0", "0"] },
      { accountIds: [accounts[0], accounts[0]] },
      { startAt: "1970-01-01" },
      { format: "Reel" },
      { kind: "stories" },
    ])
      expect(() =>
        buildFlow({ ...input, ...changes } as FlowInput, library, user, 0),
      ).toThrow();
    expect(() =>
      buildFlow(
        input,
        library.map((m) => ({ ...m, url: "storage://other/a.jpg" })),
        user,
        0,
      ),
    ).toThrow("invalid_media_owner");
  });
});

describe("Campanhas recorrentes", () => {
  it("adiciona descanso extra depois de cada lote sem duplicar o GAP", () => {
    const jobs = buildFlow(
      { ...input, batchSize: 2, restMinutes: 20 },
      library,
      user,
      0,
    );
    const own = jobs.filter((j) => j.account_id === accounts[0]);
    expect(
      Date.parse(own[1].scheduled_at!) - Date.parse(own[0].scheduled_at!),
    ).toBe(3 * 60000);
    expect(
      Date.parse(own[2].scheduled_at!) - Date.parse(own[1].scheduled_at!),
    ).toBe(23 * 60000);
  });
  it("carrega o lote incompleto entre ciclos", () => {
    const jobs = buildFlow(
      { ...input, repeat: "loop", batchSize: 2, restMinutes: 20 },
      library,
      user,
      0,
      () => 0,
      { offsets: { [accounts[0]]: 3 } },
    );
    const own = jobs.filter((j) => j.account_id === accounts[0]);
    expect(
      Date.parse(own[1].scheduled_at!) - Date.parse(own[0].scheduled_at!),
    ).toBe(23 * 60000);
    expect(
      Date.parse(own[2].scheduled_at!) - Date.parse(own[1].scheduled_at!),
    ).toBe(3 * 60000);
  });
  it("sorteia legendas da pasta sem substituir a legenda individual", () => {
    const jobs = buildFlow(
      { ...input, folderCaptions: { cortes: ["Primeira", "Segunda"] } },
      library.map((m) => ({ ...m, folder: "cortes" })),
      user,
      0,
      () => 0.99,
    );
    expect(jobs[0].caption).toBe("própria");
    expect(jobs[1].caption).toBe("Segunda");
  });
  it("filtra usadas por conta sem excluir a mídia das outras contas", () => {
    const jobs = buildFlow(
      { ...input, avoidReuse: true },
      library,
      user,
      0,
      () => 0,
      { used: [{ account_id: accounts[0], url: library[0].url }] },
    );
    expect(jobs.filter((j) => j.account_id === accounts[0])).toHaveLength(3);
    expect(jobs.filter((j) => j.account_id === accounts[1])).toHaveLength(4);
    expect(() =>
      buildFlow({ ...input, avoidReuse: true }, library, user, 0, () => 0, {
        used: accounts.flatMap((account_id) =>
          library.map((m) => ({ account_id, url: m.url })),
        ),
      }),
    ).toThrow("no_unused_media");
  });
  it("mantém a distribuição das contas ao repetir um loop randomizado", () => {
    const first = buildFlow(
      { ...input, distribution: "split", repeat: "loop", random: true },
      library,
      user,
      0,
      () => 0,
    );
    const next = buildFlow(
      { ...input, distribution: "split", repeat: "loop", random: true },
      library,
      user,
      0,
      () => 0.99,
    );
    for (const account of accounts)
      expect(
        first
          .filter((j) => j.account_id === account)
          .map((j) => j.media_urls[0])
          .sort(),
      ).toEqual(
        next
          .filter((j) => j.account_id === account)
          .map((j) => j.media_urls[0])
          .sort(),
      );
  });
  it("rejeita lotes inválidos e legendas malformadas", () => {
    for (const changes of [
      { batchSize: 0 },
      { batchSize: 1.5 },
      { restMinutes: -1 },
      { restMinutes: Infinity },
      { repeat: "forever" },
      { folderCaptions: { folder: "invalid" } },
    ])
      expect(() =>
        buildFlow({ ...input, ...changes } as FlowInput, library, user, 0),
      ).toThrow();
  });
});

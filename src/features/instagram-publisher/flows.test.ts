import { describe, it, expect } from "vitest";
import {
  buildFlow,
  type FlowInput,
} from "../../../supabase/functions/instagram-publisher/flow";
import { slotInstants } from "../../../supabase/functions/instagram-publisher/schedule";
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
  it("ignora a conta indisponível e a mídia com falha apenas na conta afetada, mesmo com reutilização permitida", () => {
    const jobs = buildFlow(input, library, user, 0, Math.random, { excluded: [{ account_id: accounts[0], url: library[0].url }] });
    expect(jobs.filter(j => j.account_id === accounts[0])).toHaveLength(3);
    expect(jobs.filter(j => j.account_id === accounts[1])).toHaveLength(4);
    const healthy = buildFlow(input, library, user, 0, Math.random, { disabledAccounts: [accounts[0]] });
    expect(healthy).toHaveLength(4);
    expect(healthy.every(j => j.account_id === accounts[1])).toBe(true);
    expect(input.accountIds).toEqual(accounts);
    expect(library).toHaveLength(4);
  });
  it("preserva a distribuição split das outras contas quando uma conta é ignorada", () => {
    const jobs = buildFlow({ ...input, repeat: "loop", distribution: "split" }, library, user, 0, Math.random, { disabledAccounts: [accounts[0]] });
    expect(jobs.map(j => j.media_urls[0])).toEqual([library[1].url, library[3].url]);
  });
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

describe("Horários fixos", () => {
  const savedSlots = ["09:00", "12:24", "16:19", "18:22", "20:47", "22:31"];

  it("respeita os horários salvos em São Paulo em vez do GAP de três minutos", () => {
    const now = Date.parse("2026-11-09T14:15:47.420Z");
    const jobs = buildFlow(
      {
        ...input,
        schedule: "slots",
        slots: savedSlots,
        timeZone: "America/Sao_Paulo",
        repeat: "loop",
      },
      library,
      user,
      now,
    );
    for (const [index, account] of accounts.entries()) {
      expect(
        jobs.filter((job) => job.account_id === account).map((job) =>
          new Date(Date.parse(job.scheduled_at!) - index * 5000).toISOString(),
        ),
      ).toEqual([
        "2026-11-09T15:24:00.000Z",
        "2026-11-09T19:19:00.000Z",
        "2026-11-09T21:22:00.000Z",
        "2026-11-09T23:47:00.000Z",
      ]);
    }
  });

  it("um ciclo atrasado começa no próximo horário futuro sem recuperar horários passados em sequência", () => {
    const now = Date.parse("2026-11-10T02:50:00.000Z");
    const jobs = buildFlow(
      {
        ...input,
        accountIds: [accounts[0]],
        schedule: "slots",
        slots: savedSlots,
        timeZone: "America/Sao_Paulo",
        repeat: "loop",
      },
      library,
      user,
      now,
      () => 0,
      { offsets: { [accounts[0]]: 4 }, starts: { [accounts[0]]: now + 60000 } },
    );
    expect(jobs.map((job) => job.scheduled_at)).toEqual([
      "2026-11-10T12:00:00.000Z",
      "2026-11-10T15:24:00.000Z",
      "2026-11-10T19:19:00.000Z",
      "2026-11-10T21:22:00.000Z",
    ]);
  });

  const zoned = (iso: string, timeZone: string) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(new Date(iso));
    const get = (type: string) => parts.find((part) => part.type === type)?.value;
    return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
  };

  it("ignora o GAP e usa o relógio do fuso gravado", () => {
    const jobs = buildFlow(
      {
        ...input,
        schedule: "slots",
        slots: ["18:00", "09:00"],
        timeZone: "UTC",
        startAt: "2026-04-02T09:00:30.000Z",
      },
      library,
      user,
      Date.parse("2026-04-02T08:00:00.000Z"),
    );
    expect(
      jobs
        .filter((job) => job.account_id === accounts[0])
        .map((job) => job.scheduled_at),
    ).toEqual([
      "2026-04-02T18:00:00.000Z",
      "2026-04-03T09:00:00.000Z",
      "2026-04-03T18:00:00.000Z",
      "2026-04-04T09:00:00.000Z",
    ]);
    expect(
      Date.parse(jobs.find((job) => job.account_id === accounts[1])!.scheduled_at!) -
        Date.parse("2026-04-02T18:00:00.000Z"),
    ).toBe(5000);
  });

  it("trata schedule ausente como GAP, mesmo com slots no objeto", () => {
    const plain = buildFlow(input, library, user, 0);
    const labeled = buildFlow(
      { ...input, schedule: "gap", slots: ["09:00"], timeZone: "UTC" },
      library,
      user,
      0,
    );
    expect(labeled.map((job) => job.scheduled_at)).toEqual(
      plain.map((job) => job.scheduled_at),
    );
  });

  it("divide os horários por conta e aplica o descanso até o próximo relógio válido", () => {
    const split = buildFlow(
      {
        ...input,
        distribution: "split",
        schedule: "slots",
        slots: ["09:00", "18:00"],
        timeZone: "UTC",
        startAt: "2026-04-02T08:00:00.000Z",
      },
      library,
      user,
      Date.parse("2026-04-02T07:00:00.000Z"),
    );
    expect(split.filter((job) => job.account_id === accounts[0])).toHaveLength(2);

    const rested = buildFlow(
      {
        ...input,
        accountIds: [accounts[0]],
        schedule: "slots",
        slots: ["10:00", "11:00", "12:00", "13:00"],
        timeZone: "UTC",
        batchSize: 2,
        restMinutes: 20,
        startAt: "2026-04-02T09:30:00.000Z",
      },
      library,
      user,
      Date.parse("2026-04-02T09:00:00.000Z"),
    );
    expect(rested.map((job) => job.scheduled_at)).toEqual([
      "2026-04-02T10:00:00.000Z",
      "2026-04-02T11:00:00.000Z",
      "2026-04-02T12:00:00.000Z",
      "2026-04-02T13:00:00.000Z",
    ]);
  });

  it("rejeita horário duplicado, intervalo curto, fuso inválido e modo desconhecido", () => {
    for (const changes of [
      { schedule: "slots", slots: ["09:00", "09:02"], timeZone: "UTC" },
      { schedule: "slots", slots: ["23:59", "00:01"], timeZone: "UTC" },
      { schedule: "slots", slots: ["09:00", "09:00"], timeZone: "UTC" },
      { schedule: "slots", slots: ["09:00"], timeZone: "Mars/Base" },
      { schedule: "cron" },
    ]) {
      expect(() =>
        buildFlow(
          { ...input, ...changes } as FlowInput,
          library,
          user,
          Date.parse("2026-04-02T08:00:00.000Z"),
        ),
      ).toThrow();
    }
  });

  it("pula o buraco do horário de verão e usa a segunda ocorrência da hora repetida", () => {
    const skipped = buildFlow(
      {
        ...input,
        accountIds: [accounts[0]],
        mediaIds: ["0"],
        schedule: "slots",
        slots: ["02:30"],
        timeZone: "America/New_York",
        startAt: "2026-03-08T06:15:00.000Z",
      },
      library,
      user,
      Date.parse("2026-03-08T06:00:00.000Z"),
    );
    expect(zoned(skipped[0].scheduled_at!, "America/New_York")).toBe(
      "2026-03-09 02:30",
    );

    const repeated = buildFlow(
      {
        ...input,
        accountIds: [accounts[0]],
        mediaIds: ["0"],
        schedule: "slots",
        slots: ["01:30"],
        timeZone: "America/New_York",
        startAt: "2026-11-01T06:00:00.000Z",
      },
      library,
      user,
      Date.parse("2026-11-01T05:00:00.000Z"),
    );
    expect(repeated[0].scheduled_at).toBe("2026-11-01T06:30:00.000Z");
    expect(
      slotInstants(
        1,
        Date.parse("2026-11-01T06:00:00.000Z"),
        [90],
        "America/New_York",
      ),
    ).toEqual([Date.parse("2026-11-01T06:30:00.000Z")]);
  });

  it("não usa um horário que cai dentro do descanso", () => {
    const jobs = buildFlow(
      {
        ...input,
        accountIds: [accounts[0]],
        schedule: "slots",
        slots: ["10:00", "10:15", "10:30", "10:45", "11:00"],
        timeZone: "UTC",
        batchSize: 2,
        restMinutes: 20,
        startAt: "2026-04-02T09:00:00.000Z",
      },
      library,
      user,
      Date.parse("2026-04-02T08:00:00.000Z"),
    );
    expect(jobs.map((job) => job.scheduled_at?.slice(11, 16))).toEqual([
      "10:00",
      "10:15",
      "10:45",
      "11:00",
    ]);
  });
});

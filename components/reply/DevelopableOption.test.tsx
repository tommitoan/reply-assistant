import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { EMPTY_FEEDBACK, type LoadedOption } from "@/lib/reply/feedback-state";
import type { DevelopedGroup, ReplyStreamEvent, StoredOption } from "@/lib/reply/types";
import DevelopableOption from "./DevelopableOption";
import { useOptionFeedback } from "./useOptionFeedback";

const USAGE = { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
const OPTION = { id: "opt-base", generationId: "gen-base", variant: "short" as const, text: "I'll be late." };

const stored = (id: string, generationId: string, variant: StoredOption["variant"], text: string, chosen = false): StoredOption => ({
  id,
  generationId,
  variant,
  text,
  ...EMPTY_FEEDBACK,
  chosen,
});

function ndjson(events: ReplyStreamEvent[]): Response {
  return new Response(events.map((event) => JSON.stringify(event)).join("\n") + "\n", {
    status: 200,
    headers: { "Content-Type": "application/x-ndjson" },
  });
}

const DEVELOPED_EVENTS: ReplyStreamEvent[] = [
  { t: "meta", generationId: "gen-dev", model: "claude-haiku-4-5", tier: "fast", memoryStatus: "off", memories: [] },
  { t: "delta", text: "@@long\nI'll be late. The bus is slow.\n@@alt\nSorry, bus problem." },
  {
    t: "done",
    options: [
      { id: "dev-1", variant: "long", text: "I'll be late. The bus is slow." },
      { id: "dev-2", variant: "alt", text: "Sorry, bus problem." },
    ],
    usage: USAGE,
    costUsd: 0.001,
    firstTokenMs: 300,
    totalMs: 700,
    stopReason: "end_turn",
  },
];

const fetchMock = vi.fn();
let refineBodies: Array<Record<string, unknown>>;
let patches: Array<{ url: string; body: Record<string, unknown> }>;
let generateResponse: () => Response;

beforeEach(() => {
  refineBodies = [];
  patches = [];
  generateResponse = () => ndjson(DEVELOPED_EVENTS);
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === "/api/reply/generate") {
      refineBodies.push(JSON.parse(init?.body as string));
      return generateResponse();
    }
    if (url.startsWith("/api/reply/options/")) {
      const body = JSON.parse(init?.body as string) as Record<string, unknown>;
      patches.push({ url, body });
      return Response.json({
        option: { id: url.split("/").pop(), generationId: "x", variant: "long", text: "t", rating: null, editedText: null, chosen: body.chosen === true },
      });
    }
    return new Response(null, { status: 204 });
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const NONE: DevelopedGroup[] = [];

// Holds the feedback store the way the composer does, with the original
// reply (and any saved developed versions) already loaded.
function Harness({
  developed = NONE,
  originalChosen = false,
  speed = "auto" as const,
  learn = true,
}: {
  developed?: DevelopedGroup[];
  originalChosen?: boolean;
  speed?: "auto" | "fast" | "smart";
  learn?: boolean;
}) {
  const store = useOptionFeedback();
  const { load } = store;
  useEffect(() => {
    const options: LoadedOption[] = [
      { id: OPTION.id, generationId: OPTION.generationId, ...EMPTY_FEEDBACK, chosen: originalChosen },
      ...developed.flatMap((group) =>
        group.options.map((option) => ({
          id: option.id,
          generationId: group.generationId,
          familyId: OPTION.generationId,
          rating: option.rating,
          editedText: option.editedText,
          chosen: option.chosen,
        })),
      ),
    ];
    load(options);
  }, [load, developed, originalChosen]);
  return <DevelopableOption option={OPTION} store={store} settings={{ speed, learn }} developed={developed} />;
}

const openPanel = () => fireEvent.click(screen.getByRole("button", { name: "Mở rộng bản nháp này" }));
const direction = () => screen.getByRole("textbox", { name: /mở rộng bản nháp này theo hướng nào/i }) as HTMLTextAreaElement;
const submit = () => screen.getByRole("button", { name: "Mở rộng" });

describe("DevelopableOption", () => {
  it("shows the reply with a Develop button, and the panel only once it is opened", async () => {
    render(<Harness />);
    await screen.findByRole("button", { name: "Bản nháp hay" });
    expect(screen.getByText("I'll be late.")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /mở rộng bản nháp này theo hướng nào/i })).not.toBeInTheDocument();

    openPanel();
    expect(direction()).toHaveAttribute("placeholder", expect.stringContaining("Mở rộng theo hướng nào"));
    expect(screen.getByRole("button", { name: "Dài hơn" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hỏi lại họ" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Thêm chi tiết cá nhân" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Thân mật hơn" })).toBeInTheDocument();
  });

  it("needs a direction before it can be sent", async () => {
    render(<Harness />);
    await screen.findByRole("button", { name: "Bản nháp hay" });
    openPanel();
    expect(submit()).toBeDisabled();

    fireEvent.change(direction(), { target: { value: "  " } });
    expect(submit()).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Dài hơn" }));
    expect(submit()).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Dài hơn" }));
    expect(submit()).toBeDisabled();
  });

  it("asks for the detail itself when a personal detail is chosen without one", async () => {
    render(<Harness />);
    await screen.findByRole("button", { name: "Bản nháp hay" });
    openPanel();
    fireEvent.click(screen.getByRole("button", { name: "Thêm chi tiết cá nhân" }));
    expect(submit()).toBeDisabled();
    expect(screen.getByText(/không tự bịa chi tiết/i)).toBeInTheDocument();

    fireEvent.change(direction(), { target: { value: "mình mới dọn nhà" } });
    expect(submit()).toBeEnabled();
  });

  it("sends only the reply, the direction and the settings", async () => {
    render(<Harness speed="smart" learn={false} />);
    await screen.findByRole("button", { name: "Bản nháp hay" });
    openPanel();
    fireEvent.change(direction(), { target: { value: "  thêm là xe buýt chậm  " } });
    fireEvent.click(screen.getByRole("button", { name: "Dài hơn" }));
    fireEvent.click(submit());

    await waitFor(() => expect(refineBodies).toHaveLength(1));
    expect(refineBodies[0]).toEqual({
      refine: { optionId: "opt-base", instruction: "thêm là xe buýt chậm", preset: "longer" },
      speed: "smart",
      learn: false,
    });
  });

  it("can be sent from the keyboard", async () => {
    render(<Harness />);
    await screen.findByRole("button", { name: "Bản nháp hay" });
    openPanel();
    fireEvent.change(direction(), { target: { value: "hỏi họ ở tầng mấy" } });
    fireEvent.keyDown(direction(), { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(refineBodies).toHaveLength(1));
    expect(refineBodies[0]).toMatchObject({ refine: { instruction: "hỏi họ ở tầng mấy" } });
  });

  it("shows the two developed versions below the original, which stays", async () => {
    render(<Harness />);
    await screen.findByRole("button", { name: "Bản nháp hay" });
    openPanel();
    fireEvent.change(direction(), { target: { value: "thêm là xe buýt chậm" } });
    fireEvent.click(screen.getByRole("button", { name: "Dài hơn" }));
    fireEvent.click(submit());

    expect(await screen.findByText("I'll be late. The bus is slow.")).toBeInTheDocument();
    expect(screen.getByText("Sorry, bus problem.")).toBeInTheDocument();
    expect(screen.getByText("I'll be late.")).toBeInTheDocument();
    expect(screen.getByText("Đã mở rộng")).toBeInTheDocument();
    expect(screen.getByText("Đã mở rộng · cách khác")).toBeInTheDocument();
    expect(screen.getByText("🌱 [Dài hơn] thêm là xe buýt chậm")).toBeInTheDocument();
    // Ready for a next direction.
    await waitFor(() => expect(direction()).toHaveValue(""));
    expect(screen.getByRole("button", { name: "Dài hơn" })).toHaveAttribute("aria-pressed", "false");
  });

  it("gives each developed version its own rating, edit and use buttons", async () => {
    render(<Harness />);
    await screen.findByRole("button", { name: "Bản nháp hay" });
    openPanel();
    fireEvent.click(screen.getByRole("button", { name: "Thân mật hơn" }));
    fireEvent.click(submit());

    const developed = (await screen.findByText("Sorry, bus problem.")).closest("article") as HTMLElement;
    await waitFor(() => expect(within(developed).getByRole("button", { name: "Bản nháp hay" })).toBeEnabled());
    fireEvent.click(within(developed).getByRole("button", { name: "Bản nháp hay" }));
    await waitFor(() => expect(patches).toEqual([{ url: "/api/reply/options/dev-2", body: { rating: "good" } }]));
    expect(within(developed).getByRole("button", { name: "Bản nháp chưa ổn" })).toBeInTheDocument();
    expect(within(developed).getByRole("button", { name: /Sửa/ })).toBeInTheDocument();
    expect(within(developed).getByRole("button", { name: "Dùng bản này" })).toBeInTheDocument();
    // A developed version is not developed again.
    expect(within(developed).queryByRole("button", { name: "Mở rộng bản nháp này" })).not.toBeInTheDocument();
  });

  it("clears the original's 'Used' mark when a developed version is used", async () => {
    render(<Harness originalChosen />);
    const original = (await screen.findByText("I'll be late.")).closest("article") as HTMLElement;
    await waitFor(() => expect(within(original).getByRole("button", { name: "Đã dùng ✓" })).toBeInTheDocument());

    openPanel();
    fireEvent.click(screen.getByRole("button", { name: "Dài hơn" }));
    fireEvent.click(submit());
    const developed = (await screen.findByText("Sorry, bus problem.")).closest("article") as HTMLElement;
    await waitFor(() => expect(within(developed).getByRole("button", { name: "Dùng bản này" })).toBeEnabled());

    fireEvent.click(within(developed).getByRole("button", { name: "Dùng bản này" }));
    await waitFor(() => expect(within(developed).getByRole("button", { name: "Đã dùng ✓" })).toBeInTheDocument());
    expect(patches).toContainEqual({ url: "/api/reply/options/dev-2", body: { chosen: true } });
    expect(within(original).getByRole("button", { name: "Dùng bản này" })).toBeInTheDocument();
  });

  it("clears a developed version's mark when the original is used", async () => {
    const saved: DevelopedGroup = {
      generationId: "gen-dev",
      ofOptionId: OPTION.id,
      instruction: "[longer]",
      createdAt: "2026-10-01T10:00:00Z",
      options: [stored("dev-1", "gen-dev", "long", "Saved developed reply.", true)],
    };
    render(<Harness developed={[saved]} />);
    const developed = (await screen.findByText("Saved developed reply.")).closest("article") as HTMLElement;
    await waitFor(() => expect(within(developed).getByRole("button", { name: "Đã dùng ✓" })).toBeInTheDocument());

    const original = screen.getByText("I'll be late.").closest("article") as HTMLElement;
    fireEvent.click(within(original).getByRole("button", { name: "Dùng bản này" }));
    await waitFor(() => expect(within(original).getByRole("button", { name: "Đã dùng ✓" })).toBeInTheDocument());
    expect(within(developed).getByRole("button", { name: "Dùng bản này" })).toBeInTheDocument();
  });

  it("lists developed versions saved earlier, with their direction", async () => {
    const saved: DevelopedGroup[] = [
      {
        generationId: "gen-a",
        ofOptionId: OPTION.id,
        instruction: "[ask back]",
        createdAt: "2026-10-01T10:00:00Z",
        options: [stored("a-1", "gen-a", "long", "Earlier version. Are you free later?")],
      },
    ];
    render(<Harness developed={saved} />);
    expect(await screen.findByText("Earlier version. Are you free later?")).toBeInTheDocument();
    expect(screen.getByText("🌱 [Hỏi lại họ]")).toBeInTheDocument();
  });

  it("does not list a version twice when it was also made in this session", async () => {
    // The server later returns the group the page just created.
    const { rerender } = render(<Harness />);
    await screen.findByRole("button", { name: "Bản nháp hay" });
    openPanel();
    fireEvent.click(screen.getByRole("button", { name: "Dài hơn" }));
    fireEvent.click(submit());
    await screen.findByText("Sorry, bus problem.");

    const same: DevelopedGroup = {
      generationId: "gen-dev",
      ofOptionId: OPTION.id,
      instruction: "[longer]",
      createdAt: "2026-10-01T10:00:00Z",
      options: [stored("dev-1", "gen-dev", "long", "I'll be late. The bus is slow."), stored("dev-2", "gen-dev", "alt", "Sorry, bus problem.")],
    };
    rerender(<Harness developed={[same]} />);
    await waitFor(() => expect(screen.getAllByText("Sorry, bus problem.")).toHaveLength(1));
  });

  it("shows the server's reason when it cannot develop the reply", async () => {
    generateResponse = () => Response.json({ error: "That reply was not found." }, { status: 404 });
    render(<Harness />);
    await screen.findByRole("button", { name: "Bản nháp hay" });
    openPanel();
    fireEvent.click(screen.getByRole("button", { name: "Dài hơn" }));
    fireEvent.click(submit());

    expect(await screen.findByRole("alert")).toHaveTextContent("That reply was not found.");
    expect(screen.queryByText("Đã mở rộng")).not.toBeInTheDocument();
    // Still possible to try again.
    expect(submit()).toBeEnabled();
  });

  it("keeps the direction when the request fails", async () => {
    generateResponse = () => Response.json({ error: "x" }, { status: 429 });
    render(<Harness />);
    await screen.findByRole("button", { name: "Bản nháp hay" });
    openPanel();
    fireEvent.change(direction(), { target: { value: "thêm lý do" } });
    fireEvent.click(submit());
    await screen.findByRole("alert");
    expect(direction()).toHaveValue("thêm lý do");
  });
});

"use client";

import { useEffect, useState } from "react";
import { MAX_RULE_CHARS, MAX_RULES, MIN_EVIDENCE_TOTAL } from "@/lib/reply/style-profile";
import type { StyleProfileRecord } from "@/lib/reply/types";

interface Listing {
  profiles: StyleProfileRecord[];
  active: StyleProfileRecord | null;
}

const BUTTON =
  "rounded-full border border-stone-300 px-4 py-1.5 text-sm font-medium text-stone-700 transition hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-stone-600 dark:text-stone-200 dark:hover:bg-stone-700";
const PRIMARY =
  "rounded-full bg-accent-600 px-5 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-accent-700 disabled:cursor-not-allowed disabled:opacity-40";
const CARD = "rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-700 dark:bg-stone-800";

export function rulesOf(profile: StyleProfileRecord): string[] {
  return profile.rules
    .split("\n")
    .map((line) => line.replace(/^\s*-\s*/, "").trim())
    .filter(Boolean);
}

function Rules({ profile }: { profile: StyleProfileRecord }) {
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm text-stone-700 dark:text-stone-200">
      {rulesOf(profile).map((rule) => (
        <li key={rule}>{rule}</li>
      ))}
    </ul>
  );
}

// The rules of a version that is not in use, as a list the writer can reword,
// delete from and add to before switching it on. `onSave` resolves true when the
// server accepted the new list.
function RulesEditor({
  profile,
  busy,
  onSave,
  onCancel,
}: {
  profile: StyleProfileRecord;
  busy: boolean;
  onSave: (rules: string[]) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [rules, setRules] = useState<string[]>(() => rulesOf(profile));
  const kept = rules.map((rule) => rule.trim()).filter(Boolean);

  return (
    <div className="space-y-2" role="group" aria-label={`Sửa quy tắc của phiên bản ${profile.version}`}>
      <ul className="space-y-2">
        {rules.map((rule, index) => (
          <li key={index} className="flex items-start gap-2">
            <textarea
              value={rule}
              maxLength={MAX_RULE_CHARS}
              rows={2}
              aria-label={`Quy tắc ${index + 1}`}
              onChange={(e) => setRules(rules.map((value, i) => (i === index ? e.target.value : value)))}
              className="min-w-0 flex-1 rounded-lg border border-stone-300 bg-white p-2 text-sm text-stone-800 outline-none focus:border-stone-500 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
            />
            <button
              type="button"
              disabled={busy}
              aria-label={`Xóa quy tắc ${index + 1}`}
              onClick={() => setRules(rules.filter((_, i) => i !== index))}
              className={BUTTON}
            >
              Xóa
            </button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy || rules.length >= MAX_RULES}
          onClick={() => setRules([...rules, ""])}
          className={BUTTON}
        >
          Thêm quy tắc
        </button>
        <button type="button" disabled={busy || kept.length === 0} onClick={() => void onSave(kept)} className={PRIMARY}>
          {busy ? "Đang lưu…" : "Lưu quy tắc"}
        </button>
        <button type="button" disabled={busy} onClick={onCancel} className={BUTTON}>
          Hủy
        </button>
      </div>
      <p className="text-xs text-stone-400 dark:text-stone-500">
        {kept.length === 0
          ? "Cần giữ lại ít nhất một quy tắc. Muốn ngừng dùng hồ sơ thì cứ để nó ở trạng thái tắt."
          : `${kept.length} trên tối đa ${MAX_RULES} quy tắc. Quy tắc trống hoặc trùng sẽ tự bị bỏ khi lưu.`}
      </p>
    </div>
  );
}

function sourceLine(profile: StyleProfileRecord): string {
  const { edited, liked, disliked, refined = 0 } = profile.sourceCounts;
  const developed = refined > 0 ? `, ${refined} bản mở rộng` : "";
  return `từ ${edited} bản đã sửa, ${liked} bản thích, ${disliked} bản không thích${developed}`;
}

async function errorOf(res: Response, fallback: string): Promise<string> {
  if (res.status === 401) return "Phiên đăng nhập đã hết hạn. Tải lại trang để đăng nhập lại.";
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === "string") return body.error;
  } catch {
    // Not JSON; use the fallback.
  }
  return fallback;
}

// View the saved style profiles, build a new one, and choose which is in use.
export default function StyleProfilePanel() {
  const [listing, setListing] = useState<Listing | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState<"build" | "switch" | "edit" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [justBuiltId, setJustBuiltId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/reply/style-profile")
      .then(async (res) => {
        if (!res.ok) throw new Error(await errorOf(res, "Không tải được các hồ sơ phong cách."));
        const body = (await res.json()) as Listing;
        if (cancelled) return;
        setListing(body);
        setLoadError(null);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Không tải được các hồ sơ phong cách.");
      });
    return () => {
      cancelled = true;
    };
  }, [version]);

  // Resolves true when the server accepted the request.
  async function call(
    kind: "build" | "switch" | "edit",
    request: () => Promise<Response>,
    fallback: string,
  ): Promise<boolean> {
    setBusy(kind);
    setProblem(null);
    try {
      const res = await request();
      if (!res.ok) {
        setProblem(await errorOf(res, fallback));
        return false;
      }
      const body = (await res.json()) as Listing & { profile?: StyleProfileRecord };
      setListing({ profiles: body.profiles, active: body.active });
      if (body.profile) setJustBuiltId(body.profile.id);
      return true;
    } catch {
      setProblem("Không kết nối được với máy chủ. Kiểm tra mạng rồi thử lại.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function saveRules(id: string, rules: string[]): Promise<boolean> {
    const saved = await call(
      "edit",
      () =>
        fetch(`/api/reply/style-profile/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rules }),
        }),
      "Không lưu được các quy tắc.",
    );
    if (saved) setEditingId(null);
    return saved;
  }

  const build = () =>
    call("build", () => fetch("/api/reply/style-profile", { method: "POST" }), "Không tạo được hồ sơ phong cách.");
  const switchTo = (activeId: string | null) =>
    call(
      "switch",
      () =>
        fetch("/api/reply/style-profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ activeId }),
        }),
      "Không lưu được thay đổi này.",
    );

  if (loadError && !listing) {
    return (
      <p role="alert" className="text-sm text-red-600 dark:text-red-400">
        {loadError}{" "}
        <button type="button" className="underline" onClick={() => setVersion((v) => v + 1)}>
          Thử lại
        </button>
      </p>
    );
  }
  if (!listing) return <p className="text-sm text-stone-400">Đang tải…</p>;

  const { profiles, active } = listing;

  return (
    <div className="space-y-5">
      <section className={CARD} aria-label="Đang dùng">
        <h2 className="mb-2 text-sm font-semibold text-stone-800 dark:text-stone-100">Đang dùng</h2>
        {active ? (
          <>
            <p className="mb-2 text-xs text-stone-500 dark:text-stone-400">
              Phiên bản {active.version}, {sourceLine(active)}. Các quy tắc này được đặt vào mọi yêu cầu.
            </p>
            <Rules profile={active} />
            <button type="button" className={`${BUTTON} mt-3`} disabled={busy !== null} onClick={() => switchTo(null)}>
              Tắt hồ sơ này
            </button>
          </>
        ) : (
          <p className="text-sm text-stone-500 dark:text-stone-400">
            Chưa bật hồ sơ phong cách nào, nên bản nháp đang dùng giọng văn mặc định.
          </p>
        )}
      </section>

      <div>
        <button type="button" className={PRIMARY} disabled={busy !== null} onClick={build}>
          {busy === "build" ? "Đang tạo…" : "Tạo phiên bản mới"}
        </button>
        <p className="mt-2 text-xs text-stone-400 dark:text-stone-500">
          Học từ các bản nháp bạn đã sửa, đánh giá hoặc mở rộng (chỉ tính những yêu cầu có bật “Ghi nhớ để học”). Cần ít nhất{" "}
          {MIN_EVIDENCE_TOTAL} ví dụ, trong đó có ít nhất một ví dụ không phải 👎. Mỗi lần tạo tốn một lượt gọi model, và phiên bản mới
          luôn ở trạng thái tắt để bạn đọc trước.
        </p>
      </div>

      {problem && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400"
        >
          {problem}
        </p>
      )}

      {profiles.length === 0 && (
        <section aria-label="Chưa có phiên bản" className="rounded-xl border border-dashed border-stone-300 p-4 text-sm text-stone-500 dark:border-stone-700 dark:text-stone-400">
          <p className="font-medium text-stone-700 dark:text-stone-200">Chưa có phiên bản nào.</p>
          <p className="mt-1">
            Bạn cứ dùng app như bình thường: sửa lại bản nháp cho giống cách bạn viết, bấm 👍 hoặc 👎, hay thử “🌱 Mở rộng” rồi chọn bản
            ưng ý. Khi có từ {MIN_EVIDENCE_TOTAL} ví dụ trở lên, bấm “Tạo phiên bản mới” ở trên. Chưa đủ thì app sẽ báo cho bạn biết còn thiếu
            bao nhiêu.
          </p>
        </section>
      )}

      {profiles.length > 0 && (
        <section aria-label="Các phiên bản" className="space-y-2">
          <h2 className="text-sm font-semibold text-stone-800 dark:text-stone-100">Các phiên bản</h2>
          {profiles.map((profile) => (
            <details
              key={profile.id}
              open={profile.id === justBuiltId || profile.active}
              className="rounded-xl border border-stone-200 bg-white p-3 shadow-sm dark:border-stone-800 dark:bg-stone-800"
            >
              <summary className="cursor-pointer text-sm text-stone-700 dark:text-stone-200">
                <span className="font-medium">Phiên bản {profile.version}</span>
                <span className="ml-2 text-xs text-stone-400 dark:text-stone-500">
                  {new Date(profile.createdAt).toLocaleString("vi-VN")} · {sourceLine(profile)}
                </span>
                {profile.active && (
                  <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
                    Đang dùng
                  </span>
                )}
                {profile.id === justBuiltId && !profile.active && (
                  <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                    Mới tạo, chưa bật
                  </span>
                )}
              </summary>
              <div className="mt-3 space-y-3">
                {editingId === profile.id ? (
                  <RulesEditor
                    profile={profile}
                    busy={busy === "edit"}
                    onSave={(rules) => saveRules(profile.id, rules)}
                    onCancel={() => setEditingId(null)}
                  />
                ) : (
                  <Rules profile={profile} />
                )}
                {!profile.active && editingId !== profile.id && (
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className={BUTTON} disabled={busy !== null} onClick={() => setEditingId(profile.id)}>
                      Sửa quy tắc
                    </button>
                    <button type="button" className={BUTTON} disabled={busy !== null} onClick={() => switchTo(profile.id)}>
                      Bật phiên bản này
                    </button>
                  </div>
                )}
                {profile.active && (
                  <p className="text-xs text-stone-400 dark:text-stone-500">
                    Phiên bản này đang được dùng. Muốn sửa quy tắc, hãy tắt nó trước.
                  </p>
                )}
              </div>
            </details>
          ))}
        </section>
      )}
    </div>
  );
}

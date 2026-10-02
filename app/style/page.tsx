import type { Metadata } from "next";
import StyleProfilePanel from "@/components/reply/StyleProfilePanel";
import { MAX_RULE_CHARS, MAX_RULES, MIN_EVIDENCE_TOTAL } from "@/lib/reply/style-profile";

export const metadata: Metadata = { title: "Phong cách — Reply Assistant" };

const GUIDE_CARD =
  "mb-6 space-y-4 rounded-xl border border-stone-200 bg-stone-50 p-4 text-sm text-stone-600 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300";
const HEADING = "font-semibold text-stone-800 dark:text-stone-100";
const DETAILS = "rounded-lg border border-stone-200 bg-white px-3 py-2 dark:border-stone-700 dark:bg-stone-800";
const SUMMARY = "cursor-pointer font-medium text-stone-700 dark:text-stone-200";

export default function StyleProfilePage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-1 font-serif text-3xl tracking-tight text-stone-900 dark:text-stone-100">Phong cách</h1>
      <p className="mb-3 text-sm text-stone-500 dark:text-stone-400">
        Một danh sách ngắn các quy tắc về giọng văn, được học từ những bản nháp bạn đã sửa và đánh giá. Tạo một phiên bản, đọc
        thử, thấy giống mình thì bật lên.
      </p>

      <section aria-label="Hướng dẫn" className={GUIDE_CARD}>
        <div className="space-y-1">
          <h2 className={HEADING}>Hồ sơ phong cách là gì?</h2>
          <p>
            Là vài dòng quy tắc về <strong>cách bạn viết</strong>: câu ngắn hay dài, có hay viết tắt kiểu “I&apos;m”, “don&apos;t”
            không, nói thẳng đến mức nào, hay dùng từ nào. Khi bật, các quy tắc này được đặt vào <strong>mọi yêu cầu</strong>, để bản
            nháp nghe giống bạn hơn thay vì giọng chung chung.
          </p>
        </div>

        <div className="space-y-1">
          <h2 className={HEADING}>Cách dùng, từng bước</h2>
          <ol className="list-decimal space-y-1 pl-5">
            <li>
              <strong>Dùng app một thời gian.</strong> Với các bản nháp, hãy sửa lại cho giống cách bạn nói, bấm 👍 hoặc 👎, hoặc bấm
              “🌱 Mở rộng” rồi chọn bản ưng ý (“Dùng bản này”, sửa, hay 👍).
            </li>
            <li>
              <strong>Khi đủ dữ liệu thì bấm “Tạo phiên bản mới”.</strong> Cần ít nhất {MIN_EVIDENCE_TOTAL} ví dụ (bản đã sửa, đã
              đánh giá hoặc đã mở rộng), trong đó phải có ít nhất một ví dụ không phải 👎. Chưa đủ thì app sẽ cho bạn biết còn thiếu
              bao nhiêu. Mỗi lần tạo là một lượt gọi model, và giữa hai lần tạo cần cách nhau khoảng một phút.
            </li>
            <li>
              <strong>Đọc từng quy tắc.</strong> Sửa lời cho đúng ý, hoặc xóa những quy tắc không giống bạn. Bạn cũng có thể tự thêm
              quy tắc.
            </li>
            <li>
              <strong>Bật lên.</strong> Bấm “Bật phiên bản này”. Từ lúc đó, mọi bản nháp mới đều theo các quy tắc ấy.
            </li>
            <li>
              <strong>Tắt bất cứ lúc nào.</strong> Bấm “Tắt hồ sơ này” là app quay về giọng văn mặc định. Phiên bản mới tạo luôn ở
              trạng thái <strong>tắt</strong> cho đến khi bạn tự bật.
            </li>
          </ol>
        </div>

        <div className="space-y-1">
          <h2 className={HEADING}>App học từ đâu?</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Có học từ:</strong> bản nháp bạn đã sửa, bản bạn thích hoặc không thích (👍/👎), và bản bạn đã yêu cầu mở
              rộng rồi chọn, sửa hay thích. Mỗi lần chỉ lấy các ví dụ gần nhất.
            </li>
            <li>
              <strong>Không đọc</strong> tin nhắn người khác gửi cho bạn (những đoạn bạn dán vào để nhờ gợi ý trả lời).
            </li>
            <li>
              <strong>Không học</strong> từ các yêu cầu gửi khi đã tắt “Ghi nhớ để học”.
            </li>
          </ul>
        </div>

        <details className={DETAILS}>
          <summary className={SUMMARY}>Quy tắc thế nào là tốt, thế nào là chưa tốt?</summary>
          <div className="mt-2 space-y-2">
            <p>
              Quy tắc tốt thì <strong>cụ thể, làm theo được ngay</strong> và nói về cách viết. Ví dụ:
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>“Dùng câu ngắn, tối đa 15 từ.”</li>
              <li>“Mở đầu thân thiện, ví dụ ‘Hi’ thay vì ‘Dear’.”</li>
              <li>“Dùng dạng viết tắt như I&apos;m, don&apos;t thay vì I am, do not.”</li>
            </ul>
            <p>Quy tắc chưa tốt thì nên sửa hoặc xóa:</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <strong>Mơ hồ</strong>, như “Viết hay hơn” hay “Nghe tự nhiên hơn”. App không biết phải làm gì khác đi.
              </li>
              <li>
                <strong>Chứa thông tin cá nhân cụ thể</strong> (tên, công ty, nơi ở, công việc…). Những chuyện đó thuộc trang{" "}
                <strong>Về tôi</strong>, không phải ở đây.
              </li>
            </ul>
            <p className="text-xs text-stone-500 dark:text-stone-400">
              Mỗi phiên bản có tối đa {MAX_RULES} quy tắc, mỗi quy tắc tối đa {MAX_RULE_CHARS} ký tự.
            </p>
          </div>
        </details>

        <details className={DETAILS}>
          <summary className={SUMMARY}>Mẹo nhỏ</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              <strong>Nên tạo lại</strong> khi bạn đã sửa hoặc đánh giá thêm kha khá bản nháp, hoặc khi thấy bản nháp không còn giống
              giọng bạn. Phiên bản cũ vẫn được giữ lại, muốn quay về lúc nào cũng được.
            </li>
            <li>
              <strong>Vì sao phiên bản đang bật không sửa trực tiếp được?</strong> Vì quy tắc của nó nằm trong mọi yêu cầu, nên đổi
              giữa chừng sẽ làm giọng văn đổi theo mà bạn không hay. Muốn sửa thì tắt trước, sửa xong rồi bật lại, hoặc tạo phiên bản
              mới.
            </li>
            <li>
              <strong>Phong cách khác với “Về tôi”.</strong> Phong cách là <em>cách</em> bạn viết (giọng văn, độ dài câu, lời chào).
              Còn “Về tôi” là <em>sự thật</em> về bạn (công việc, gia đình, sở thích…). Hai trang bổ sung cho nhau, đừng ghi lẫn.
            </li>
            <li>Mới dùng thì chưa cần vội. Càng nhiều bản đã sửa, quy tắc tạo ra càng sát giọng của bạn.</li>
          </ul>
        </details>
      </section>

      <StyleProfilePanel />
    </main>
  );
}

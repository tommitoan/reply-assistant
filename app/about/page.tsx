import type { Metadata } from "next";
import NotesPanel from "@/components/reply/NotesPanel";
import { MAX_NOTES, MAX_NOTE_CHARS, MAX_PINNED_NOTES, MAX_WAITING_SUGGESTIONS } from "@/lib/reply/limits";

export const metadata: Metadata = { title: "Về tôi — Reply Assistant" };

const SECTION =
  "mb-6 space-y-3 rounded-xl border border-stone-200 bg-stone-50 p-4 text-sm text-stone-600 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300";
const HEADING = "font-semibold text-stone-800 dark:text-stone-100";
const DETAILS = "rounded-lg border border-stone-200 bg-white px-3 py-2 dark:border-stone-800 dark:bg-stone-800";
const SUMMARY = "cursor-pointer font-medium text-stone-700 dark:text-stone-200";

export default function AboutMePage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-1 font-serif text-3xl tracking-tight text-stone-900 dark:text-stone-100">Về tôi</h1>
      <p className="mb-3 text-sm text-stone-500 dark:text-stone-400">
        Những ghi chú ngắn về chính bạn: công việc, thói quen, chuyện mới xảy ra. Nhờ đó bản nháp tiếng Anh nhắc đúng chi tiết thật
        về bạn, thay vì để AI tự bịa.
      </p>

      <section aria-label="Hướng dẫn" className={SECTION}>
        <h2 className={HEADING}>Cách dùng</h2>
        <ol className="list-decimal space-y-1 pl-5">
          <li>
            <strong>Thêm ghi chú.</strong> Gõ tay ở khung &quot;Thêm ghi chú&quot;, hoặc dán nhật ký vào &quot;Nhập từ nhật ký&quot; để
            app tách thành từng ghi chú cho bạn xem lại trước khi lưu.
          </li>
          <li>
            <strong>Xem bản tiếng Anh.</strong> Mỗi ghi chú có một bản tiếng Anh để khớp với tin nhắn tiếng Anh. Bạn có thể bấm
            &quot;Gợi ý bản tiếng Anh&quot; để xem trước, tự sửa lại, hoặc bỏ trống để app tự viết khi lưu.
          </li>
          <li>
            <strong>Ghim ghi chú quan trọng.</strong> Ghi chú đã ghim luôn được gửi kèm mỗi lần viết trả lời (tối đa{" "}
            {MAX_PINNED_NOTES} ghi chú).
          </li>
          <li>
            <strong>Duyệt ghi chú gợi ý.</strong> Khi bạn gõ ý tiếng Việt, app có thể đề xuất ghi chú mới. Chúng nằm chờ ở đầu
            trang cho đến khi bạn thêm hoặc bỏ qua.
          </li>
          <li>
            <strong>Xem ghi chú nào được dùng.</strong> Sau mỗi lần trả lời tin nhắn tiếng Anh, bạn thấy dòng &quot;Đã dùng n ghi
            chú&quot;. Bấm vào để xem, sửa, lưu trữ, hoặc bảo app viết lại mà không dùng ghi chú đó.
          </li>
        </ol>
        <p>
          Ghi chú chỉ được dùng khi công tắc <strong>Dùng ghi chú của tôi</strong> ở trang trả lời đang bật.
        </p>
      </section>

      <section aria-label="Ví dụ ghi chú" className={SECTION}>
        <h2 className={HEADING}>Ghi chú thế nào là tốt?</h2>
        <p>Mỗi ghi chú một ý, viết ngắn, ngôi thứ nhất. Chuyện đã xảy ra thì nên kèm tháng.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <p className="mb-1 font-medium text-green-700 dark:text-green-400">Nên viết</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>&quot;Mình làm backend engineer, chủ yếu viết Go.&quot;</li>
              <li>&quot;Tháng 9 mình mới chuyển sang căn hộ mới ở Quận 7.&quot;</li>
              <li>&quot;Mình hay chạy bộ vào sáng thứ Bảy.&quot;</li>
            </ul>
          </div>
          <div>
            <p className="mb-1 font-medium text-red-700 dark:text-red-400">Nên tránh</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <strong>Quá dài, nhiều ý trộn lẫn:</strong> &quot;Mình làm backend, vừa chuyển nhà, cuối tuần hay chạy bộ, đang học
                tiếng Anh…&quot;. Hãy tách thành nhiều ghi chú.
              </li>
              <li>
                <strong>Mơ hồ:</strong> &quot;Mình hay bận.&quot; Bận chuyện gì, vào lúc nào?
              </li>
            </ul>
          </div>
        </div>
        <p className="text-xs text-stone-500 dark:text-stone-400">
          Mỗi ghi chú tối đa {MAX_NOTE_CHARS} ký tự, và bạn lưu được tối đa {MAX_NOTES} ghi chú.
        </p>
      </section>

      <div className="mb-6 space-y-2 text-sm text-stone-600 dark:text-stone-300">
        <details className={DETAILS}>
          <summary className={SUMMARY}>Thông tin hay sự kiện? Công việc hay thân mật?</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              <strong>Thông tin</strong> là điều luôn đúng (nghề nghiệp, sở thích, nơi ở). <strong>Sự kiện</strong> là chuyện xảy ra
              một lần, nên có ngày; app dùng tháng của sự kiện để biết chuyện đó còn mới hay đã cũ.
            </li>
            <li>
              <strong>Công việc / Thân mật</strong> cho app biết khi nào nên dùng ghi chú. Chọn &quot;Chỉ công việc&quot; thì ghi chú
              không xuất hiện khi bạn trả lời kiểu thân mật, và ngược lại. &quot;Công việc và thân mật&quot; thì dùng ở cả hai.
            </li>
          </ul>
        </details>

        <details className={DETAILS}>
          <summary className={SUMMARY}>Ghim, riêng tư và lưu trữ</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              <strong>📌 Ghim:</strong> ghi chú luôn được gửi kèm mọi yêu cầu, dù tin nhắn có liên quan hay không. Chỉ ghim được
              tối đa {MAX_PINNED_NOTES} ghi chú, nên hãy dành cho những điều thật sự quan trọng.
            </li>
            <li>
              <strong>🔒 Riêng tư:</strong> ghi chú chỉ nằm trong app, không bao giờ gửi cho AI, không có bản tiếng Anh và không
              ghim được. Hợp với chuyện bạn không muốn đưa cho bất kỳ mô hình nào. Về sau bạn có thể đổi lại thành &quot;Cho phép
              dùng&quot;; lúc đó nội dung sẽ được gửi đi để viết bản tiếng Anh.
            </li>
            <li>
              <strong>Lưu trữ:</strong> cất ghi chú đi mà không xóa. Ghi chú đã lưu trữ không được dùng nữa, nhưng bạn có thể khôi
              phục bất cứ lúc nào.
            </li>
          </ul>
        </details>

        <details className={DETAILS}>
          <summary className={SUMMARY}>Ghi chú gợi ý</summary>
          <p className="mt-2">
            Khi bạn gõ ý tiếng Việt và công tắc &quot;Ghi nhớ để học&quot; đang bật, app có thể nhận ra chi tiết về bạn trong câu đó
            và đề xuất thành ghi chú. Những gợi ý này chỉ nằm chờ ở đầu trang (tối đa {MAX_WAITING_SUGGESTIONS} gợi ý), chưa được
            dùng khi trả lời. Bạn có thể sửa lại, chọn phạm vi, ghim rồi bấm &quot;Thêm vào ghi chú của tôi&quot;, hoặc &quot;Bỏ
            qua&quot; để app không đề xuất lại.
          </p>
        </details>

        <details className={DETAILS}>
          <summary className={SUMMARY}>Quyền riêng tư và dữ liệu của bạn</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              <strong>Xuất dữ liệu:</strong> bấm &quot;Xuất ghi chú của tôi (JSON)&quot; để tải về một file. Ghi chú riêng tư không
              nằm trong file, chỉ có số lượng của chúng.
            </li>
            <li>
              <strong>Xóa:</strong> bạn xóa từng ghi chú bằng nút &quot;Xóa&quot; trên thẻ, hoặc &quot;Xóa tất cả ghi chú&quot; ở cuối
              trang. Xóa là xóa hẳn, kèm mọi thứ được tạo ra từ ghi chú (như bản tiếng Anh), và không hoàn tác được.
            </li>
            <li>
              Ghi chú thường (không riêng tư) và đoạn nhật ký bạn dán được gửi cho mô hình AI để viết bản tiếng Anh hoặc tách thành
              ghi chú.
            </li>
          </ul>
        </details>
      </div>

      <NotesPanel />
    </main>
  );
}

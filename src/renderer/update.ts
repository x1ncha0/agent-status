type UpdatePhase =
  'checking' | 'latest' | 'available' | 'downloading' | 'downloaded' | 'installing' | 'error';
type UpdateAction = 'download' | 'later' | 'cancel' | 'retry' | 'open' | 'dismiss';
interface UpdateView {
  phase: UpdatePhase;
  current: string;
  version?: string;
  received?: number;
  total?: number;
  message?: string;
}
declare global {
  interface Window {
    agentUpdate: {
      subscribe(callback: (view: UpdateView) => void): void;
      act(action: UpdateAction): void;
    };
  }
}

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const title = element<HTMLHeadingElement>('title');
const detail = element<HTMLParagraphElement>('detail');
const progress = element<HTMLDivElement>('progress');
const bar = element<HTMLDivElement>('bar');
const primary = element<HTMLButtonElement>('primary');
const secondary = element<HTMLButtonElement>('secondary');
const close = element<HTMLButtonElement>('close');

function megabytes(bytes: number): string {
  return (bytes / 1024 / 1024).toLocaleString('vi-VN', { maximumFractionDigits: 1 });
}

function setButton(button: HTMLButtonElement, label?: string, action?: UpdateAction): void {
  button.hidden = !label;
  button.textContent = label || '';
  button.dataset.action = action || '';
}

function render(view: UpdateView): void {
  const version = view.version || view.current;
  const received = view.received || 0;
  const total = view.total || 0;
  const percent = total ? Math.min(100, Math.round((received / total) * 100)) : 0;
  const texts: Record<UpdatePhase, { title: string; detail: string }> = {
    checking: {
      title: 'Đang kiểm tra cập nhật…',
      detail: `Phiên bản hiện tại ${view.current}`,
    },
    latest: {
      title: 'Bạn đang dùng bản mới nhất',
      detail: `Agent Status ${view.current}`,
    },
    available: {
      title: `Đã có Agent Status ${version}`,
      detail: `Phiên bản hiện tại ${view.current}`,
    },
    downloading: {
      title: `Đang tải Agent Status ${version}`,
      detail: total
        ? `${megabytes(received)} / ${megabytes(total)} MB · ${percent}%`
        : `Đã tải ${megabytes(received)} MB`,
    },
    downloaded: {
      title: `Đã tải Agent Status ${version}`,
      detail: view.message || 'File đã được lưu.',
    },
    installing: {
      title: `Đang cài Agent Status ${version}`,
      detail: 'App sẽ tự khởi động lại ngay.',
    },
    error: {
      title: 'Không thể cập nhật',
      detail: view.message || 'Không kết nối được GitHub.',
    },
  };
  title.textContent = texts[view.phase].title;
  detail.textContent = texts[view.phase].detail;
  const busy =
    view.phase === 'downloading' || view.phase === 'installing' || view.phase === 'checking';
  progress.hidden = !busy;
  // Không biết tổng dung lượng thì để CSS chạy animation; width inline sẽ đè mất animation đó.
  const indeterminate = view.phase === 'checking' || (view.phase === 'downloading' && !total);
  progress.classList.toggle('indeterminate', indeterminate);
  if (indeterminate) bar.style.removeProperty('width');
  else bar.style.width = view.phase === 'installing' ? '100%' : `${percent}%`;
  if (view.phase === 'downloading' && total)
    progress.setAttribute('aria-valuenow', String(percent));
  else progress.removeAttribute('aria-valuenow');
  close.hidden = view.phase === 'installing';
  if (view.phase === 'available') {
    setButton(primary, 'Tải bản cập nhật', 'download');
    setButton(secondary, 'Để sau', 'later');
  } else if (view.phase === 'downloading') {
    setButton(primary);
    setButton(secondary, 'Huỷ', 'cancel');
  } else if (view.phase === 'downloaded') {
    setButton(primary, 'Mở thư mục', 'open');
    setButton(secondary, 'Đóng', 'dismiss');
  } else if (view.phase === 'error') {
    setButton(primary, 'Thử lại', 'retry');
    setButton(secondary, 'Đóng', 'dismiss');
  } else {
    setButton(primary);
    setButton(secondary);
  }
}

for (const button of [primary, secondary]) {
  button.addEventListener('click', () => {
    const action = button.dataset.action;
    if (action) window.agentUpdate.act(action as UpdateAction);
  });
}
close.addEventListener('click', () => window.agentUpdate.act('dismiss'));
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') window.agentUpdate.act('dismiss');
});
window.agentUpdate.subscribe(render);
export {};
